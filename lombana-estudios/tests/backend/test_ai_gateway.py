"""Pruebas del AI Gateway contra un servidor HTTP local que implementa los protocolos reales
(OpenAI-compatible y Anthropic). Así se verifica el adaptador de punta a punta sin claves reales."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from conftest import make_erp, rt_login

SEEN = []


class FakeAI(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        auth = self.headers.get("Authorization") or self.headers.get("x-api-key")
        if "bad" in (auth or ""):
            return self._send(401, {"error": {"message": "Incorrect API key"}})
        self._send(200, {"data": [{"id": "modelo-b"}, {"id": "modelo-a"}]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        SEEN.append({"path": self.path, "headers": dict(self.headers), "body": body})
        if self.path.endswith("/messages"):
            return self._send(200, {"model": body["model"], "content": [{"type": "text", "text": "Hola desde Claude"}],
                                    "usage": {"input_tokens": 11, "output_tokens": 4}})
        self._send(200, {"model": body["model"], "choices": [{"message": {"content": "Respuesta real del servidor"}}],
                         "usage": {"prompt_tokens": 20, "completion_tokens": 5}})


@pytest.fixture()
def fake_ai():
    srv = HTTPServer(("127.0.0.1", 0), FakeAI)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    SEEN.clear()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_flujo_proveedor(admin, fake_ai):
    assert len(admin.get("/api/ai/presets").json()) == 11
    p = admin.post("/api/ai/providers", json={"code": "openai"}).json()
    assert p["status"] == "sin_probar" and not p["enabled"]
    assert admin.post("/api/ai/providers", json={"code": "openai"}).status_code == 409
    # sin clave: la prueba falla de verdad
    r = admin.post(f"/api/ai/providers/{p['id']}/test").json()
    assert r["status"] == "error" and "API key" in r["last_error"]
    assert admin.put(f"/api/ai/providers/{p['id']}", json={"enabled": True}).status_code == 422
    # clave inválida → 401 real del servidor
    admin.put(f"/api/ai/providers/{p['id']}", json={"api_key": "sk-bad-123456789", "base_url": fake_ai})
    r = admin.post(f"/api/ai/providers/{p['id']}/test").json()
    assert r["status"] == "error" and "401" in r["last_error"]
    # clave válida
    r = admin.put(f"/api/ai/providers/{p['id']}", json={"api_key": "sk-good-123456789"}).json()
    assert r["key_hint"] == "sk-••••6789" and "sk-good" not in json.dumps(r)
    r = admin.post(f"/api/ai/providers/{p['id']}/test").json()
    assert r["status"] == "conectado" and r["models"] == ["modelo-a", "modelo-b"] and r["default_model"] == "modelo-a"
    assert admin.put(f"/api/ai/providers/{p['id']}", json={"enabled": True}).json()["enabled"]
    out = admin.post("/api/ai/chat", json={"prompt": "hola"}).json()
    assert out["text"] == "Respuesta real del servidor" and out["tokens_in"] == 20
    assert SEEN[-1]["headers"]["Authorization"] == "Bearer sk-good-123456789"
    # la clave nunca queda en auditoría
    assert "sk-good" not in json.dumps(admin.get("/api/audit").json())
    # límite mensual
    admin.put(f"/api/ai/providers/{p['id']}", json={"monthly_limit_requests": 1})
    assert admin.post("/api/ai/chat", json={"prompt": "otra"}).status_code == 429
    log = admin.get("/api/ai/requests").json()
    assert len(log) == 1 and log[0]["ok"]


def test_anthropic_enrutamiento_y_agente(admin, fake_ai):
    oa = admin.post("/api/ai/providers", json={"code": "groq"}).json()
    an = admin.post("/api/ai/providers", json={"code": "anthropic"}).json()
    for p in (oa, an):
        admin.put(f"/api/ai/providers/{p['id']}", json={"api_key": "key-valida-1234", "base_url": fake_ai})
        admin.post(f"/api/ai/providers/{p['id']}/test")
        admin.put(f"/api/ai/providers/{p['id']}", json={"enabled": True})
    assert admin.put("/api/ai/routes/agente_cfo", json={"provider_id": an["id"], "model": "claude-x"}).json() == {"ok": True}
    e = make_erp(admin, "Tienda IA", "tienda")
    h = rt_login(admin, e["slug"])
    admin.post(f"/api/rt/{e['slug']}/products", json={"sku": "Z", "name": "Arroz", "price": "4000", "initial_stock": "1",
                                                     "min_stock": "5"}, headers=h)
    r = admin.post("/api/ai/agents/cfo/run", json={"erp_id": e["id"], "question": "¿Cómo va el negocio?"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["text"] == "Hola desde Claude" and out["provider"] == "Anthropic Claude" and out["model"] == "claude-x"
    sent = SEEN[-1]
    assert sent["path"].endswith("/messages") and sent["headers"]["x-api-key"] == "key-valida-1234"
    assert "Arroz" in sent["body"]["messages"][0]["content"] and "No puedes modificar datos" in sent["body"]["system"]
    # otro agente sin ruta usa el primer proveedor activo (groq)
    assert admin.post("/api/ai/agents/comercial/run", json={"erp_id": e["id"], "question": "Clientes top"}).json()["provider"] == "Groq"
    acts = [a["action"] for a in admin.get(f"/api/rt/{e['slug']}/audit", headers=h).json()]
    assert acts.count("consulta_agente") == 2
    assert len(admin.get("/api/ai/agents").json()) == 11


def test_proveedor_inalcanzable(admin):
    p = admin.post("/api/ai/providers", json={"code": "ollama"}).json()
    admin.put(f"/api/ai/providers/{p['id']}", json={"base_url": "http://127.0.0.1:9/v1"})
    r = admin.post(f"/api/ai/providers/{p['id']}/test").json()
    assert r["status"] == "error" and "Sin conexión" in r["last_error"]
    assert admin.post("/api/ai/chat", json={"prompt": "x"}).status_code == 409
