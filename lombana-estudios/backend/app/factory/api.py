"""API de LOMBANA ERP FACTORY (centro de control)."""
from __future__ import annotations

import secrets
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.deps import audit, current_factory_user, factory_db, limiter
from ..core.security import create_token, hash_password, verify_password
from ..database import manager
from ..erp_generator import service as gen
from ..erp_generator.catalog import MODULES, sectors
from ..erp_generator.schemas import FONTS, Branding
from .models import (AiProvider, BrandTemplate, Client, ErpProject, FactoryAudit, FactoryUser, Installation,
                     License, Plan)

router = APIRouter(prefix="/api")
Auth = Depends(current_factory_user)


def _bad(e: Exception) -> HTTPException:
    msg = str(e)
    if hasattr(e, "errors"):  # pydantic ValidationError → mensajes legibles
        msg = "; ".join(f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}".lstrip(": ")
                        for err in e.errors())  # type: ignore[attr-defined]
    return HTTPException(422, msg)


# ------------------------------------------------------------------ auth
class SetupIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    setup_code: str | None = Field(default=None, max_length=200)


def _setup_code() -> str | None:
    """En la nube, crear el primer administrador exige LOMBANA_SETUP_CODE (evita que un extraño
    que encuentre la dirección antes que tú se apropie de la fábrica)."""
    import os
    return os.environ.get("LOMBANA_SETUP_CODE") or None


class LoginIn(BaseModel):
    email: str
    password: str


@router.get("/health")
def health():
    s = get_settings()
    return {"status": "ok", "db_engine": s.db_engine,
            "factory_revision": manager.current_revision(s.factory_db_name),
            "factory_head": manager.head_revision("factory"), "tenant_head": manager.head_revision("tenant")}


@router.get("/auth/setup-status")
def setup_status(db: Session = Depends(factory_db)):
    return {"needs_setup": db.scalar(select(func.count(FactoryUser.id))) == 0,
            "requires_code": get_settings().serverless or bool(_setup_code())}


@router.post("/auth/setup")
def setup(data: SetupIn, db: Session = Depends(factory_db)):
    if db.scalar(select(func.count(FactoryUser.id))):
        raise HTTPException(409, "La fábrica ya tiene administrador")
    expected = _setup_code()
    if get_settings().serverless and not expected:
        raise HTTPException(503, "Define LOMBANA_SETUP_CODE en Vercel para poder crear el administrador")
    if expected and not secrets.compare_digest((data.setup_code or "").encode(), expected.encode()):
        raise HTTPException(403, "Código de instalación incorrecto")
    u = FactoryUser(email=data.email.lower(), name=data.name, password_hash=hash_password(data.password))
    db.add(u)
    db.flush()
    audit(db, u.email, "crear_admin", "factory_user", u.id)
    db.commit()
    return {"token": create_token(str(u.id), "factory"), "user": {"name": u.name, "email": u.email}}


@router.post("/auth/login")
def login(data: LoginIn, request: Request, db: Session = Depends(factory_db)):
    limiter.check(request, "factory", data.email)
    u = db.scalar(select(FactoryUser).where(FactoryUser.email == data.email.lower().strip()))
    if not u or not u.is_active or not verify_password(data.password, u.password_hash):
        limiter.fail(request, "factory", data.email)
        raise HTTPException(401, "Correo o contraseña incorrectos")
    limiter.ok(request, "factory", data.email)
    audit(db, u.email, "login", "factory_user", u.id)
    db.commit()
    return {"token": create_token(str(u.id), "factory"), "user": {"name": u.name, "email": u.email}}


@router.get("/auth/me")
def me(user: FactoryUser = Auth):
    return {"name": user.name, "email": user.email}


class PasswordIn(BaseModel):
    current: str
    new: str = Field(min_length=8, max_length=128)


@router.post("/auth/password")
def change_password(data: PasswordIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    u = db.get(FactoryUser, user.id)
    if not verify_password(data.current, u.password_hash):
        raise HTTPException(422, "La contraseña actual no es correcta")
    u.password_hash = hash_password(data.new)
    audit(db, u.email, "cambiar_clave", "factory_user", u.id)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ catálogo
@router.get("/catalog/modules")
def catalog_modules(_=Auth):
    return MODULES


@router.get("/catalog/sectors")
def catalog_sectors(_=Auth):
    return list(sectors().values())


@router.get("/catalog/fonts")
def catalog_fonts(_=Auth):
    return FONTS


# ------------------------------------------------------------------ dashboard
def _monthly(lic: License) -> Decimal:
    return lic.amount / 12 if lic.billing_cycle == "anual" else lic.amount


@router.get("/dashboard")
def dashboard(_=Auth, db: Session = Depends(factory_db)):
    erps = db.scalars(select(ErpProject)).all()
    lics = db.scalars(select(License)).all()
    active_lics = [l for l in lics if l.status == "activa"]
    by_sector = Counter(e.sector for e in erps)
    today = date.today()
    months = []
    for i in range(5, -1, -1):
        y, m = today.year, today.month - i
        while m <= 0:
            m += 12
            y -= 1
        months.append((y, m))
    created = Counter((e.created_at.year, e.created_at.month) for e in erps)
    sec = sectors()
    recent = sorted(erps, key=lambda e: e.updated_at, reverse=True)[:6]
    return {
        "erps_total": len(erps),
        "erps_activos": sum(1 for e in erps if e.status == "activo"),
        "clientes": db.scalar(select(func.count(Client.id))),
        "plantillas": len(sec),
        "proveedores_ia_activos": db.scalar(select(func.count(AiProvider.id)).where(AiProvider.enabled.is_(True))),
        "licencias_activas": len(active_lics),
        "pagos_al_dia": sum(1 for l in active_lics if l.payment_status == "al_dia"),
        "renovaciones_30_dias": sum(1 for l in active_lics if l.renewal_date <= today + timedelta(days=30)),
        "ingresos_recurrentes_mes": str(sum((_monthly(l) for l in active_lics), Decimal(0)).quantize(Decimal("0.01"))),
        "por_sector": [{"code": c, "name": sec[c]["name"], "short": sec[c].get("short", sec[c]["name"]), "icon": sec.get(c, {}).get("icon", "box"),
                        "count": by_sector.get(c, 0)} for c in sec],
        "creados_por_mes": [{"mes": f"{y}-{m:02d}", "cantidad": created.get((y, m), 0)} for y, m in months],
        "recientes": [_erp_out(e) for e in recent],
    }


# ------------------------------------------------------------------ ERPs
class CreateErpIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    sector: str
    company: dict
    modules: list[str] | None = None
    config: dict | None = None
    branding: dict | None = None
    client_id: int | None = None
    admin_user: str = "admin"
    admin_name: str = "Administrador"
    admin_password: str = Field(min_length=8, max_length=128)
    publish: bool = True


def _erp_out(e: ErpProject, full: bool = False) -> dict:
    out = {"id": e.id, "slug": e.slug, "name": e.name, "sector": e.sector, "status": e.status,
           "db_name": e.db_name, "db_engine": e.db_engine, "client_id": e.client_id,
           "client_name": e.client.name if e.client else None,
           "current_version": e.current_version, "published_version": e.published_version,
           "software_name": e.branding.get("software_name"), "primary": e.branding.get("primary"),
           "modules": [m["key"] for m in e.config.get("modules", []) if m.get("enabled")],
           "created_at": e.created_at.isoformat(), "updated_at": e.updated_at.isoformat()}
    if full:
        out["config"], out["branding"] = e.config, e.branding
    return out


def _get_erp(db: Session, erp_id: int) -> ErpProject:
    e = db.get(ErpProject, erp_id)
    if not e:
        raise HTTPException(404, "ERP no encontrado")
    return e


@router.get("/erps")
def list_erps(_=Auth, db: Session = Depends(factory_db)):
    return [_erp_out(e) for e in db.scalars(select(ErpProject).order_by(ErpProject.updated_at.desc()))]


@router.post("/erps", status_code=201)
def create_erp(data: CreateErpIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    if data.sector not in sectors():
        raise HTTPException(422, "Sector desconocido")
    if data.client_id is not None and not db.get(Client, data.client_id):
        raise HTTPException(422, "Cliente inexistente")
    try:
        config = data.config or gen.config_from_sector(data.sector, data.company, data.modules)
        config.setdefault("company", {})["sector"] = data.sector
        branding = data.branding or gen.branding_from_sector(data.sector, data.name, data.company.get("name", ""))
        erp = gen.create_erp(db, name=data.name, config=config, branding=branding, admin_user=data.admin_user,
                             admin_name=data.admin_name, admin_password=data.admin_password,
                             client_id=data.client_id, actor=user.email)
        if data.publish:
            gen.publish(db, erp, None, user.email)
    except ValueError as e:
        raise _bad(e) from None
    audit(db, user.email, "crear_erp", "erp", erp.id, {"db": erp.db_name})
    db.commit()
    return _erp_out(erp, True)


@router.get("/erps/{erp_id}")
def get_erp(erp_id: int, _=Auth, db: Session = Depends(factory_db)):
    return _erp_out(_get_erp(db, erp_id), True)


class ConfigIn(BaseModel):
    config: dict
    note: str = Field(default="Cambio de configuración", max_length=240)


@router.put("/erps/{erp_id}/config")
def update_config(erp_id: int, data: ConfigIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    e = _get_erp(db, erp_id)
    try:
        gen.save_version(db, e, config=data.config, branding=None, note=data.note, actor=user.email)
    except ValueError as ex:
        raise _bad(ex) from None
    audit(db, user.email, "editar_config", "erp", e.id, {"version": e.current_version})
    db.commit()
    return _erp_out(e, True)


class BrandingIn(BaseModel):
    branding: dict
    note: str = Field(default="Cambio de marca", max_length=240)
    publish: bool = False


@router.put("/erps/{erp_id}/branding")
def update_branding(erp_id: int, data: BrandingIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    e = _get_erp(db, erp_id)
    try:
        gen.save_version(db, e, config=None, branding=data.branding, note=data.note, actor=user.email)
        if data.publish:
            gen.publish(db, e, None, user.email)
    except ValueError as ex:
        raise _bad(ex) from None
    audit(db, user.email, "editar_marca", "erp", e.id, {"version": e.current_version})
    db.commit()
    return _erp_out(e, True)


class PublishIn(BaseModel):
    version: int | None = None


@router.post("/erps/{erp_id}/publish")
def publish(erp_id: int, data: PublishIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    e = _get_erp(db, erp_id)
    try:
        gen.publish(db, e, data.version, user.email)
    except ValueError as ex:
        raise _bad(ex) from None
    audit(db, user.email, "publicar", "erp", e.id, {"version": e.published_version})
    db.commit()
    return _erp_out(e, True)


@router.get("/erps/{erp_id}/versions")
def versions(erp_id: int, _=Auth, db: Session = Depends(factory_db)):
    e = _get_erp(db, erp_id)
    return [{"version": v.version, "note": v.note, "created_by": v.created_by, "created_at": v.created_at.isoformat(),
             "published": v.version == e.published_version} for v in reversed(e.versions)]


@router.post("/erps/{erp_id}/versions/{version}/restore")
def restore_version(erp_id: int, version: int, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    e = _get_erp(db, erp_id)
    try:
        gen.restore_version(db, e, version, user.email)
    except ValueError as ex:
        raise _bad(ex) from None
    audit(db, user.email, "restaurar_version", "erp", e.id, {"desde": version})
    db.commit()
    return _erp_out(e, True)


class DuplicateIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    admin_user: str = "admin"
    admin_password: str = Field(min_length=8, max_length=128)
    client_id: int | None = None


@router.post("/erps/{erp_id}/duplicate", status_code=201)
def duplicate(erp_id: int, data: DuplicateIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    src = _get_erp(db, erp_id)
    try:
        erp = gen.create_erp(db, name=data.name, config=src.config, branding=src.branding,
                             admin_user=data.admin_user, admin_name="Administrador",
                             admin_password=data.admin_password, client_id=data.client_id, actor=user.email)
        gen.publish(db, erp, None, user.email)
    except ValueError as ex:
        raise _bad(ex) from None
    db.add(Installation(erp_id=erp.id, action="duplicado", detail=f"Copia de configuración de {src.slug} (sin datos)"))
    audit(db, user.email, "duplicar_erp", "erp", erp.id, {"origen": src.id})
    db.commit()
    return _erp_out(erp, True)


class StatusIn(BaseModel):
    status: str = Field(pattern="^(activo|suspendido|archivado)$")


@router.patch("/erps/{erp_id}/status")
def set_status(erp_id: int, data: StatusIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    e = _get_erp(db, erp_id)
    if data.status == "activo" and not e.published_version:
        raise HTTPException(422, "Publica una versión antes de activar el ERP")
    e.status = data.status
    audit(db, user.email, "cambiar_estado", "erp", e.id, {"estado": data.status})
    db.commit()
    return _erp_out(e)


@router.get("/erps/{erp_id}/health")
def erp_health(erp_id: int, _=Auth, db: Session = Depends(factory_db)):
    e = _get_erp(db, erp_id)
    try:
        rev = manager.current_revision(e.db_name)
        counts = manager.table_counts(e.db_name, "tenant")
        ok = True
        err = None
    except Exception as ex:  # base inaccesible
        rev, counts, ok, err = None, {}, False, str(ex)[:300]
    head = manager.head_revision("tenant")
    return {"ok": ok, "error": err, "revision": rev, "head": head, "pending_migrations": ok and rev != head,
            "counts": counts}


@router.post("/erps/{erp_id}/migrate")
def erp_migrate(erp_id: int, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    e = _get_erp(db, erp_id)
    manager.backup(e.db_name, "tenant")  # respaldo previo obligatorio
    rev = manager.migrate(e.db_name, "tenant")
    db.add(Installation(erp_id=e.id, action="migrado", detail=f"Migrado a {rev} (con respaldo previo)"))
    audit(db, user.email, "migrar", "erp", e.id, {"revision": rev})
    db.commit()
    return {"revision": rev}


@router.get("/erps/{erp_id}/backups")
def erp_backups(erp_id: int, _=Auth, db: Session = Depends(factory_db)):
    return manager.list_backups(_get_erp(db, erp_id).db_name)


@router.post("/erps/{erp_id}/backups", status_code=201)
def erp_backup(erp_id: int, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    e = _get_erp(db, erp_id)
    p = manager.backup(e.db_name, "tenant")
    db.add(Installation(erp_id=e.id, action="respaldo", detail=p.name))
    audit(db, user.email, "respaldo", "erp", e.id, {"archivo": p.name})
    db.commit()
    return {"file": p.name}


class RestoreIn(BaseModel):
    file: str


@router.post("/erps/{erp_id}/restore")
def erp_restore(erp_id: int, data: RestoreIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    e = _get_erp(db, erp_id)
    try:
        res = manager.restore(e.db_name, "tenant", data.file)
    except (ValueError, FileNotFoundError) as ex:
        raise HTTPException(422, f"No se pudo restaurar: {ex}") from None
    db.add(Installation(erp_id=e.id, action="restaurado", detail=f"{data.file} (seguridad: {res['safety_backup']})"))
    audit(db, user.email, "restaurar", "erp", e.id, {"archivo": data.file})
    db.commit()
    return res


@router.get("/databases")
def databases(_=Auth, db: Session = Depends(factory_db)):
    s = get_settings()
    out = [{"name": s.factory_db_name, "kind": "factory", "erp_id": None, "erp_name": "Fábrica central",
            "revision": manager.current_revision(s.factory_db_name), "head": manager.head_revision("factory"),
            "backups": len(manager.list_backups(s.factory_db_name))}]
    for e in db.scalars(select(ErpProject).order_by(ErpProject.db_name)):
        try:
            rev = manager.current_revision(e.db_name)
        except Exception:
            rev = None
        out.append({"name": e.db_name, "kind": "tenant", "erp_id": e.id, "erp_name": e.name, "revision": rev,
                    "head": manager.head_revision("tenant"), "backups": len(manager.list_backups(e.db_name))})
    return {"engine": s.db_engine, "databases": out}


@router.post("/databases/factory/backup", status_code=201)
def factory_backup(user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    p = manager.backup(get_settings().factory_db_name, "factory")
    audit(db, user.email, "respaldo", "factory", None, {"archivo": p.name})
    db.commit()
    return {"file": p.name}


@router.get("/installations")
def installations(_=Auth, db: Session = Depends(factory_db)):
    rows = db.scalars(select(Installation).order_by(Installation.id.desc()).limit(200))
    return [{"id": i.id, "erp_id": i.erp_id, "action": i.action, "detail": i.detail,
             "created_at": i.created_at.isoformat()} for i in rows]


# ------------------------------------------------------------------ clientes
class ClientIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    document: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=40)
    country: str | None = Field(default=None, max_length=60)
    notes: str | None = Field(default=None, max_length=2000)


def _client_out(c: Client) -> dict:
    return {"id": c.id, "name": c.name, "document": c.document, "email": c.email, "phone": c.phone,
            "country": c.country, "notes": c.notes, "erps": len(c.erps), "created_at": c.created_at.isoformat()}


@router.get("/clients")
def list_clients(_=Auth, db: Session = Depends(factory_db)):
    return [_client_out(c) for c in db.scalars(select(Client).order_by(Client.name))]


@router.post("/clients", status_code=201)
def create_client(data: ClientIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    c = Client(**data.model_dump())
    db.add(c)
    db.flush()
    audit(db, user.email, "crear", "cliente", c.id)
    db.commit()
    return _client_out(c)


@router.put("/clients/{cid}")
def update_client(cid: int, data: ClientIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    c = db.get(Client, cid)
    if not c:
        raise HTTPException(404, "Cliente no encontrado")
    for k, v in data.model_dump().items():
        setattr(c, k, v)
    audit(db, user.email, "editar", "cliente", c.id)
    db.commit()
    return _client_out(c)


@router.delete("/clients/{cid}")
def delete_client(cid: int, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    c = db.get(Client, cid)
    if not c:
        raise HTTPException(404, "Cliente no encontrado")
    if db.scalar(select(func.count(License.id)).where(License.client_id == cid)):
        raise HTTPException(409, "El cliente tiene licencias: suspéndelas en vez de borrar el cliente")
    db.delete(c)
    audit(db, user.email, "eliminar", "cliente", cid)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ planes y licencias
class PlanIn(BaseModel):
    code: str = Field(pattern=r"^[a-z0-9_-]{2,40}$")
    name: str = Field(min_length=2, max_length=80)
    price_monthly: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    max_users: int = Field(default=3, ge=1, le=10000)
    max_storage_mb: int = Field(default=500, ge=10)
    max_modules: int = Field(default=8, ge=1, le=100)


def _plan_out(p: Plan) -> dict:
    return {"id": p.id, "code": p.code, "name": p.name, "price_monthly": str(p.price_monthly), "currency": p.currency,
            "max_users": p.max_users, "max_storage_mb": p.max_storage_mb, "max_modules": p.max_modules}


@router.get("/plans")
def list_plans(_=Auth, db: Session = Depends(factory_db)):
    return [_plan_out(p) for p in sorted(db.scalars(select(Plan)), key=lambda p: p.price_monthly)]  # orden en Python: exacto en ambos motores


@router.post("/plans", status_code=201)
def create_plan(data: PlanIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    p = Plan(**data.model_dump())
    db.add(p)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(409, "Ya existe un plan con ese código") from None
    audit(db, user.email, "crear", "plan", p.id)
    db.commit()
    return _plan_out(p)


@router.put("/plans/{pid}")
def update_plan(pid: int, data: PlanIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    p = db.get(Plan, pid)
    if not p:
        raise HTTPException(404, "Plan no encontrado")
    for k, v in data.model_dump().items():
        setattr(p, k, v)
    audit(db, user.email, "editar", "plan", p.id)
    db.commit()
    return _plan_out(p)


class LicenseIn(BaseModel):
    client_id: int
    plan_id: int
    erp_id: int | None = None
    billing_cycle: str = Field(default="mensual", pattern="^(mensual|anual)$")
    start_date: date | None = None


class LicensePatch(BaseModel):
    status: str | None = Field(default=None, pattern="^(activa|suspendida|vencida)$")
    payment_status: str | None = Field(default=None, pattern="^(pendiente|al_dia|vencido)$")
    renew: bool = False


def _lic_out(l: License) -> dict:
    return {"id": l.id, "license_key": l.license_key, "client_id": l.client_id, "client_name": l.client.name,
            "plan_id": l.plan_id, "plan_name": l.plan.name, "erp_id": l.erp_id, "erp_name": l.erp.name if l.erp else None,
            "status": l.status, "billing_cycle": l.billing_cycle, "start_date": l.start_date.isoformat(),
            "renewal_date": l.renewal_date.isoformat(), "payment_status": l.payment_status, "amount": str(l.amount),
            "currency": l.plan.currency}


def _add_cycle(d: date, cycle: str) -> date:
    if cycle == "anual":
        try:
            return d.replace(year=d.year + 1)
        except ValueError:
            return d.replace(year=d.year + 1, day=28)
    m = d.month + 1
    y = d.year + (m > 12)
    m = m - 12 if m > 12 else m
    import calendar
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


@router.get("/licenses")
def list_licenses(_=Auth, db: Session = Depends(factory_db)):
    return [_lic_out(l) for l in db.scalars(select(License).order_by(License.renewal_date))]


@router.post("/licenses", status_code=201)
def create_license(data: LicenseIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    plan = db.get(Plan, data.plan_id)
    if not plan or not db.get(Client, data.client_id):
        raise HTTPException(422, "Cliente o plan inexistente")
    if data.erp_id is not None and not db.get(ErpProject, data.erp_id):
        raise HTTPException(422, "ERP inexistente")
    start = data.start_date or date.today()
    amount = plan.price_monthly * 12 if data.billing_cycle == "anual" else plan.price_monthly
    l = License(license_key="LE-" + "-".join(secrets.token_hex(2).upper() for _ in range(4)), client_id=data.client_id,
                plan_id=plan.id, erp_id=data.erp_id, billing_cycle=data.billing_cycle, start_date=start,
                renewal_date=_add_cycle(start, data.billing_cycle), amount=amount)
    db.add(l)
    db.flush()
    audit(db, user.email, "crear", "licencia", l.id)
    db.commit()
    return _lic_out(l)


@router.patch("/licenses/{lid}")
def patch_license(lid: int, data: LicensePatch, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    l = db.get(License, lid)
    if not l:
        raise HTTPException(404, "Licencia no encontrada")
    if data.status:
        l.status = data.status
    if data.payment_status:
        l.payment_status = data.payment_status
    if data.renew:
        l.renewal_date = _add_cycle(l.renewal_date, l.billing_cycle)
        l.status = "activa"
    audit(db, user.email, "editar", "licencia", l.id, data.model_dump())
    db.commit()
    return _lic_out(l)


# ------------------------------------------------------------------ plantillas de marca
class BrandTplIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    branding: dict


@router.get("/brand-templates")
def list_brand_templates(_=Auth, db: Session = Depends(factory_db)):
    return [{"id": t.id, "name": t.name, "branding": t.branding} for t in db.scalars(select(BrandTemplate).order_by(BrandTemplate.name))]


@router.post("/brand-templates", status_code=201)
def create_brand_template(data: BrandTplIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    try:
        b = Branding.model_validate(data.branding).model_dump()
    except ValueError as e:
        raise _bad(e) from None
    t = BrandTemplate(name=data.name, branding=b)
    db.add(t)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(409, "Ya existe una plantilla con ese nombre") from None
    audit(db, user.email, "crear", "plantilla_marca", t.id)
    db.commit()
    return {"id": t.id, "name": t.name, "branding": t.branding}


@router.delete("/brand-templates/{tid}")
def delete_brand_template(tid: int, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    t = db.get(BrandTemplate, tid)
    if not t:
        raise HTTPException(404, "Plantilla no encontrada")
    db.delete(t)
    audit(db, user.email, "eliminar", "plantilla_marca", tid)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ auditoría
@router.get("/audit")
def audit_log(_=Auth, db: Session = Depends(factory_db)):
    rows = db.scalars(select(FactoryAudit).order_by(FactoryAudit.id.desc()).limit(300))
    return [{"id": a.id, "actor": a.actor, "action": a.action, "entity": a.entity, "entity_id": a.entity_id,
             "detail": a.detail, "created_at": a.created_at.isoformat()} for a in rows]
