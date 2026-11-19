"""LOMBANA AI GATEWAY: proveedores, claves cifradas, pruebas reales, enrutamiento por tarea, límites y registro."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.deps import audit, current_factory_user, factory_db
from ..core.security import decrypt_secret, encrypt_secret, mask_secret
from ..database import manager
from ..erp_runtime.models import TenantAudit
from ..factory.models import AiProvider, AiRequest, AiTaskRoute, ErpProject, FactoryUser
from .adapters import PRESETS, AiError, build
from .agents import agent_list, build_context, AGENTS

router = APIRouter(prefix="/api/ai")
Auth = Depends(current_factory_user)
TASKS = ["general", "constructor_erp"] + [f"agente_{k}" for k in AGENTS]


def _out(p: AiProvider, db: Session) -> dict:
    month = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    used = db.scalar(select(func.count(AiRequest.id)).where(AiRequest.provider_id == p.id, AiRequest.created_at >= month))
    toks = db.execute(select(func.coalesce(func.sum(AiRequest.tokens_in), 0), func.coalesce(func.sum(AiRequest.tokens_out), 0))
                      .where(AiRequest.provider_id == p.id, AiRequest.created_at >= month)).one()
    key_hint = None
    if p.api_key_enc:
        try:
            key_hint = mask_secret(decrypt_secret(p.api_key_enc))
        except ValueError:
            key_hint = "(no se puede descifrar)"
    return {"id": p.id, "code": p.code, "name": p.name, "kind": p.kind, "base_url": p.base_url,
            "has_key": bool(p.api_key_enc), "key_hint": key_hint, "default_model": p.default_model,
            "models": p.models, "extra": p.extra, "enabled": p.enabled, "status": p.status,
            "last_test_at": p.last_test_at.isoformat() if p.last_test_at else None, "last_error": p.last_error,
            "monthly_limit_requests": p.monthly_limit_requests, "requests_this_month": used,
            "tokens_in_month": int(toks[0]), "tokens_out_month": int(toks[1])}


def _adapter(p: AiProvider):
    key = decrypt_secret(p.api_key_enc) if p.api_key_enc else None
    preset = next((x for x in PRESETS if x["code"] == p.code), None)
    if preset and preset["needs_key"] and not key:
        raise AiError("Falta la API key")
    return build(p.kind, p.base_url, key, p.extra)


@router.get("/presets")
def presets(_=Auth):
    return PRESETS


@router.get("/providers")
def providers(_=Auth, db: Session = Depends(factory_db)):
    return [_out(p, db) for p in db.scalars(select(AiProvider).order_by(AiProvider.name))]


class ProviderIn(BaseModel):
    code: str


@router.post("/providers", status_code=201)
def add_provider(data: ProviderIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    preset = next((x for x in PRESETS if x["code"] == data.code), None)
    if not preset:
        raise HTTPException(422, "Proveedor no soportado")
    if db.scalar(select(AiProvider).where(AiProvider.code == data.code)):
        raise HTTPException(409, "Ese proveedor ya está agregado")
    p = AiProvider(code=preset["code"], name=preset["name"], kind=preset["kind"], base_url=preset["base_url"],
                   models=[], extra={}, enabled=False, status="sin_probar")
    db.add(p)
    db.flush()
    audit(db, user.email, "agregar", "proveedor_ia", p.id, {"code": p.code})
    db.commit()
    return _out(p, db)


class ProviderPatch(BaseModel):
    api_key: str | None = Field(default=None, max_length=500)
    clear_key: bool = False
    base_url: str | None = Field(default=None, max_length=300)
    default_model: str | None = Field(default=None, max_length=120)
    enabled: bool | None = None
    monthly_limit_requests: int | None = Field(default=None, ge=0, le=10_000_000)
    extra: dict | None = None


@router.put("/providers/{pid}")
def update_provider(pid: int, data: ProviderPatch, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    p = db.get(AiProvider, pid)
    if not p:
        raise HTTPException(404, "Proveedor no encontrado")
    changed = []
    if data.api_key:
        p.api_key_enc = encrypt_secret(data.api_key.strip())
        p.status, changed = "sin_probar", changed + ["api_key"]
    if data.clear_key:
        p.api_key_enc, p.status, changed = None, "sin_probar", changed + ["api_key_borrada"]
    if data.base_url:
        u = urlparse(data.base_url)
        if u.scheme not in ("http", "https") or not u.netloc:
            raise HTTPException(422, "URL base inválida")
        p.base_url, p.status, changed = data.base_url.rstrip("/"), "sin_probar", changed + ["base_url"]
    if data.default_model is not None:
        p.default_model, changed = data.default_model or None, changed + ["modelo"]
    if data.monthly_limit_requests is not None:
        p.monthly_limit_requests, changed = data.monthly_limit_requests, changed + ["limite"]
    if data.extra is not None:
        p.extra = {k: str(v)[:300] for k, v in data.extra.items()}
        changed.append("extra")
    if data.enabled is not None:
        if data.enabled and p.status != "conectado":
            raise HTTPException(422, "Prueba la conexión con éxito antes de activar el proveedor")
        p.enabled, changed = data.enabled, changed + ["activo" if data.enabled else "inactivo"]
    audit(db, user.email, "editar", "proveedor_ia", p.id, {"cambios": changed})  # nunca se registra la clave
    db.commit()
    return _out(p, db)


@router.delete("/providers/{pid}")
def delete_provider(pid: int, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    p = db.get(AiProvider, pid)
    if not p:
        raise HTTPException(404, "Proveedor no encontrado")
    db.delete(p)
    audit(db, user.email, "eliminar", "proveedor_ia", pid)
    db.commit()
    return {"ok": True}


@router.post("/providers/{pid}/test")
def test_provider(pid: int, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    """Prueba REAL: consulta la lista de modelos del proveedor con la clave guardada."""
    p = db.get(AiProvider, pid)
    if not p:
        raise HTTPException(404, "Proveedor no encontrado")
    p.last_test_at = datetime.now(timezone.utc)
    try:
        models = _adapter(p).list_models()
        p.models, p.status, p.last_error = models[:300], "conectado", None
        if not p.default_model and models:
            p.default_model = models[0]
    except (AiError, ValueError) as e:
        p.status, p.last_error, p.enabled = "error", str(e)[:500], False
    audit(db, user.email, "probar", "proveedor_ia", p.id, {"resultado": p.status})
    db.commit()
    return _out(p, db)


# ------------------------------------------------------------------ enrutamiento por tarea
@router.get("/routes")
def routes(_=Auth, db: Session = Depends(factory_db)):
    current = {r.task: r for r in db.scalars(select(AiTaskRoute))}
    return [{"task": t, "provider_id": current[t].provider_id if t in current else None,
             "model": current[t].model if t in current else None} for t in TASKS]


class RouteIn(BaseModel):
    provider_id: int | None
    model: str | None = Field(default=None, max_length=120)


@router.put("/routes/{task}")
def set_route(task: str, data: RouteIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    if task not in TASKS:
        raise HTTPException(404, "Tarea desconocida")
    r = db.scalar(select(AiTaskRoute).where(AiTaskRoute.task == task))
    if data.provider_id is None:
        if r:
            db.delete(r)
    else:
        if not db.get(AiProvider, data.provider_id):
            raise HTTPException(422, "Proveedor inexistente")
        if r:
            r.provider_id, r.model = data.provider_id, data.model
        else:
            db.add(AiTaskRoute(task=task, provider_id=data.provider_id, model=data.model))
    audit(db, user.email, "enrutar", "tarea_ia", task, data.model_dump())
    db.commit()
    return {"ok": True}


def _resolve(db: Session, task: str) -> tuple[AiProvider, str]:
    r = db.scalar(select(AiTaskRoute).where(AiTaskRoute.task == task)) or \
        db.scalar(select(AiTaskRoute).where(AiTaskRoute.task == "general"))
    p = db.get(AiProvider, r.provider_id) if r else None
    if not p:
        p = db.scalar(select(AiProvider).where(AiProvider.enabled.is_(True)).order_by(AiProvider.id))
    if not p or not p.enabled:
        raise HTTPException(409, "No hay un proveedor de IA activo para esta tarea. Configúralo en AI Gateway.")
    model = (r.model if r and r.provider_id == p.id and r.model else None) or p.default_model
    if not model:
        raise HTTPException(409, f"{p.name} no tiene modelo seleccionado")
    month = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    used = db.scalar(select(func.count(AiRequest.id)).where(AiRequest.provider_id == p.id, AiRequest.created_at >= month))
    if used >= p.monthly_limit_requests:
        raise HTTPException(429, f"Se alcanzó el límite mensual de solicitudes de {p.name}")
    return p, model


def run_chat(db: Session, task: str, system: str, prompt: str, max_tokens: int = 800) -> dict:
    p, model = _resolve(db, task)
    try:
        res = _adapter(p).chat(model, system, prompt, max_tokens)
    except (AiError, ValueError) as e:
        db.add(AiRequest(provider_id=p.id, model=model, task=task, ok=False, error=str(e)[:500]))
        db.commit()
        raise HTTPException(502, f"{p.name}: {e}") from None
    db.add(AiRequest(provider_id=p.id, model=res.model, task=task, ok=True, latency_ms=res.latency_ms,
                     tokens_in=res.tokens_in, tokens_out=res.tokens_out))
    db.commit()
    return {"provider": p.name, "model": res.model, "text": res.text, "tokens_in": res.tokens_in,
            "tokens_out": res.tokens_out, "latency_ms": res.latency_ms}


class ChatIn(BaseModel):
    task: str = "general"
    prompt: str = Field(min_length=1, max_length=8000)


@router.post("/chat")
def chat(data: ChatIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    if data.task not in TASKS:
        raise HTTPException(404, "Tarea desconocida")
    out = run_chat(db, data.task, "Eres el asistente de LOMBANA ESTUDIOS, fábrica de ERP. Responde en español.", data.prompt)
    audit(db, user.email, "chat_ia", "tarea_ia", data.task)
    db.commit()
    return out


@router.get("/requests")
def requests_log(_=Auth, db: Session = Depends(factory_db)):
    names = {p.id: p.name for p in db.scalars(select(AiProvider))}
    rows = db.scalars(select(AiRequest).order_by(AiRequest.id.desc()).limit(200))
    return [{"id": r.id, "provider": names.get(r.provider_id), "model": r.model, "task": r.task, "ok": r.ok,
             "latency_ms": r.latency_ms, "tokens_in": r.tokens_in, "tokens_out": r.tokens_out, "error": r.error,
             "created_at": r.created_at.isoformat()} for r in rows]


# ------------------------------------------------------------------ agentes
@router.get("/agents")
def agents(_=Auth):
    return agent_list()


class AgentRunIn(BaseModel):
    erp_id: int
    question: str = Field(min_length=3, max_length=2000)


@router.post("/agents/{code}/run")
def run_agent(code: str, data: AgentRunIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    if code not in AGENTS:
        raise HTTPException(404, "Agente desconocido")
    erp = db.get(ErpProject, data.erp_id)
    if not erp:
        raise HTTPException(404, "ERP no encontrado")
    system, context = build_context(code, erp.db_name)  # contexto limitado a ESTA empresa, solo lectura
    prompt = (f"Datos de la empresa (JSON, solo lectura):\n{json.dumps(context, ensure_ascii=False)}\n\n"
              f"Pregunta: {data.question}")
    out = run_chat(db, f"agente_{code}", system, prompt, max_tokens=900)
    with manager.tenant_session(erp.db_name) as t:
        t.add(TenantAudit(actor=f"IA:{code} ({user.email})", action="consulta_agente", entity="ia",
                          detail={"pregunta": data.question[:300], "modelo": out["model"]}))
        t.commit()
    audit(db, user.email, "ejecutar_agente", "agente", code, {"erp": erp.id})
    db.commit()
    return {**out, "context": context}
