import os
from conftest import make_erp, rt_login


def test_setup_unico_y_login(client):
    assert client.get("/api/auth/setup-status").json()["needs_setup"] is True
    assert client.get("/api/dashboard").status_code == 401
    r = client.post("/api/auth/setup", json={"name": "A", "email": "a@b.co", "password": "corta"})
    assert r.status_code == 422
    assert client.post("/api/auth/setup", json={"name": "Ana", "email": "a@b.co", "password": "Clave-Segura-1", "setup_code": os.environ.get("LOMBANA_SETUP_CODE")}).status_code == 200
    assert client.post("/api/auth/setup", json={"name": "Xavi", "email": "x@b.co", "password": "Clave-Segura-1"}).status_code == 409
    assert client.post("/api/auth/login", json={"email": "a@b.co", "password": "mala-clave"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "A@B.co", "password": "Clave-Segura-1"}).status_code == 200


def test_bloqueo_por_intentos(client):
    client.post("/api/auth/setup", json={"name": "Ana", "email": "a@b.co", "password": "Clave-Segura-1", "setup_code": os.environ.get("LOMBANA_SETUP_CODE")})
    for _ in range(5):
        client.post("/api/auth/login", json={"email": "a@b.co", "password": "x"})
    assert client.post("/api/auth/login", json={"email": "a@b.co", "password": "Clave-Segura-1"}).status_code == 429


def test_catalogo_y_dashboard(admin):
    sectors = admin.get("/api/catalog/sectors").json()
    assert {s["code"] for s in sectors} >= {"barberia", "restaurante", "hotel", "nomina", "personalizado"}
    d = admin.get("/api/dashboard").json()
    assert d["erps_total"] == 0 and d["plantillas"] == len(sectors)
    make_erp(admin)
    d = admin.get("/api/dashboard").json()
    assert d["erps_activos"] == 1
    assert next(s for s in d["por_sector"] if s["code"] == "barberia")["count"] == 1


def test_crear_erp_con_bd_independiente(admin):
    a = make_erp(admin, "Barbería Pro")
    b = make_erp(admin, "Barbería Centro")
    assert a["db_name"] == "erp_barberia_001" and b["db_name"] == "erp_barberia_002"
    assert a["status"] == "activo" and a["published_version"] == 1
    h = admin.get(f"/api/erps/{a['id']}/health").json()
    assert h["ok"] and not h["pending_migrations"] and h["counts"]["users"] == 1
    # datos de A no aparecen en B
    ha = rt_login(admin, a["slug"])
    admin.post(f"/api/rt/{a['slug']}/customers", json={"name": "Cliente de A"}, headers=ha)
    hb = rt_login(admin, b["slug"])
    assert admin.get(f"/api/rt/{b['slug']}/customers", headers=hb).json() == []
    # token de A no sirve en B
    assert admin.get(f"/api/rt/{b['slug']}/customers", headers=ha).status_code == 403
    # token de fábrica no sirve en runtime y viceversa
    assert admin.get(f"/api/rt/{a['slug']}/customers").status_code == 403
    assert admin.get("/api/erps", headers=ha).status_code == 403


def test_validaciones_constructor(admin):
    base = {"name": "Tienda X", "sector": "tienda", "company": {"name": "Tienda X"}, "admin_password": "Admin-12345"}
    assert admin.post("/api/erps", json={**base, "sector": "inexistente"}).status_code == 422
    r = admin.post("/api/erps", json={**base, "modules": ["contabilidad"]})
    assert r.status_code == 422 and "aún no está disponible" in r.json()["detail"]
    r = admin.post("/api/erps", json={**base, "modules": ["ventas"]})
    assert r.status_code == 422 and "requiere activar" in r.json()["detail"]
    r = admin.post("/api/erps", json={**base, "admin_password": "123"})
    assert r.status_code == 422
    assert admin.get("/api/erps").json() == []  # nada quedó a medias
    assert admin.get("/api/databases").json()["databases"].__len__() == 1


def test_versiones_publicar_restaurar_duplicar(admin):
    e = make_erp(admin)
    cfg = e["config"]
    cfg["entities"].append({"key": "productos_promo", "label": "Promos", "fields": [
        {"key": "precio", "label": "Precio", "type": "money"}, {"key": "pct", "label": "%", "type": "number"},
        {"key": "final", "label": "Final", "type": "calculated", "formula": "DESCUENTO(precio, pct)"}]})
    r = admin.put(f"/api/erps/{e['id']}/config", json={"config": cfg, "note": "Agrego promos"})
    assert r.status_code == 200 and r.json()["current_version"] == 2 and r.json()["published_version"] == 1
    bad = {**cfg, "entities": [{"key": "x", "label": "X", "fields": [{"key": "c", "label": "C", "type": "calculated", "formula": "open(1)"}]}]}
    assert admin.put(f"/api/erps/{e['id']}/config", json={"config": bad}).status_code == 422
    assert admin.post(f"/api/erps/{e['id']}/publish", json={}).json()["published_version"] == 2
    h = rt_login(admin, e["slug"])
    assert any(x["key"] == "productos_promo" for x in admin.get(f"/api/rt/{e['slug']}/me", headers=h).json()["entities"])
    r = admin.post(f"/api/erps/{e['id']}/versions/1/restore")
    assert r.json()["current_version"] == 3
    assert len(admin.get(f"/api/erps/{e['id']}/versions").json()) == 3
    d = admin.post(f"/api/erps/{e['id']}/duplicate", json={"name": "Copia", "admin_password": "Otra-clave-99"})
    assert d.status_code == 201 and d.json()["db_name"] == "erp_barberia_002"
    rt_login(admin, d.json()["slug"], password="Otra-clave-99")


def test_estado_suspendido_bloquea_runtime(admin):
    e = make_erp(admin)
    assert admin.patch(f"/api/erps/{e['id']}/status", json={"status": "suspendido"}).status_code == 200
    assert admin.post(f"/api/rt/{e['slug']}/login", json={"username": "admin", "password": "Admin-12345"}).status_code == 423


def test_marca_independiente_y_plantillas(admin):
    a, b = make_erp(admin, "A uno"), make_erp(admin, "B dos")
    brand = {**a["branding"], "software_name": "Barber Gold", "primary": "#c9a227"}
    r = admin.put(f"/api/erps/{a['id']}/branding", json={"branding": brand, "publish": True})
    assert r.status_code == 200 and r.json()["branding"]["primary"] == "#C9A227"
    assert admin.get(f"/api/rt/{a['slug']}/public").json()["branding"]["software_name"] == "Barber Gold"
    assert admin.get(f"/api/rt/{b['slug']}/public").json()["branding"]["software_name"] == "B dos"
    assert admin.put(f"/api/erps/{a['id']}/branding", json={"branding": {**brand, "primary": "rojo"}}).status_code == 422
    assert admin.put(f"/api/erps/{a['id']}/branding",
                     json={"branding": {**brand, "logo": "data:image/svg+xml;base64,PHN2Zz4="}}).status_code == 422
    t = admin.post("/api/brand-templates", json={"name": "Dorado", "branding": brand})
    assert t.status_code == 201
    assert admin.post("/api/brand-templates", json={"name": "Dorado", "branding": brand}).status_code == 409
    assert admin.delete(f"/api/brand-templates/{t.json()['id']}").json() == {"ok": True}


def test_clientes_planes_licencias(admin):
    c = admin.post("/api/clients", json={"name": "Barbería El Rey", "email": "rey@correo.co"}).json()
    e = make_erp(admin, client_id=c["id"])
    plans = admin.get("/api/plans").json()
    assert [p["code"] for p in plans] == ["basico", "profesional", "empresarial"]
    l = admin.post("/api/licenses", json={"client_id": c["id"], "plan_id": plans[1]["id"], "erp_id": e["id"],
                                          "billing_cycle": "anual", "start_date": "2026-01-31"}).json()
    assert l["amount"] == "708.0000" and l["renewal_date"] == "2027-01-31" and l["license_key"].startswith("LE-")
    l2 = admin.post("/api/licenses", json={"client_id": c["id"], "plan_id": plans[0]["id"], "start_date": "2026-01-31"}).json()
    assert l2["renewal_date"] == "2026-02-28"
    r = admin.patch(f"/api/licenses/{l2['id']}", json={"payment_status": "al_dia", "renew": True}).json()
    assert r["renewal_date"] == "2026-03-28" and r["payment_status"] == "al_dia"
    d = admin.get("/api/dashboard").json()
    assert d["licencias_activas"] == 2 and d["ingresos_recurrentes_mes"] == "88.00"
    assert admin.delete(f"/api/clients/{c['id']}").status_code == 409
    assert admin.get("/api/audit").json()[0]["entity"] == "licencia"


def test_respaldo_y_restauracion(admin):
    e = make_erp(admin)
    h = rt_login(admin, e["slug"])
    slug = e["slug"]
    admin.post(f"/api/rt/{slug}/customers", json={"name": "Antes del respaldo"}, headers=h)
    b = admin.post(f"/api/erps/{e['id']}/backups").json()["file"]
    admin.post(f"/api/rt/{slug}/customers", json={"name": "Después del respaldo"}, headers=h)
    assert len(admin.get(f"/api/rt/{slug}/customers", headers=h).json()) == 2
    r = admin.post(f"/api/erps/{e['id']}/restore", json={"file": b})
    assert r.status_code == 200, r.text
    names = [x["name"] for x in admin.get(f"/api/rt/{slug}/customers", headers=h).json()]
    assert names == ["Antes del respaldo"]
    # tras restaurar, los ids siguen funcionando (secuencias correctas en PostgreSQL)
    assert admin.post(f"/api/rt/{slug}/customers", json={"name": "Nuevo"}, headers=h).status_code == 201
    assert len(admin.get(f"/api/erps/{e['id']}/backups").json()) == 2  # incluye respaldo de seguridad
    assert admin.post(f"/api/erps/{e['id']}/restore", json={"file": "../../secret.key"}).status_code == 422
    assert admin.post("/api/databases/factory/backup").status_code == 201
