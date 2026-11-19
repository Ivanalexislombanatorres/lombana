"""ERP Generator: construye, versiona, publica y duplica ERP a partir de configuraciones validadas."""
from __future__ import annotations

import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.security import hash_password
from ..database import manager
from ..erp_runtime.models import Role, Setting, TenantAudit, User
from ..factory.models import ErpProject, ErpVersion, Installation
from .catalog import MODULES, all_permissions, sector
from .schemas import Branding, ErpConfig

DEFAULT_ROLES = {
    "Administrador": ["*"],
    "Vendedor": ["dashboard:ver", "clientes:ver", "clientes:crear", "clientes:editar", "productos:ver",
                 "ventas:ver", "ventas:crear", "registros:ver", "registros:crear", "registros:editar"],
    "Consulta": ["*:ver"],
}


def slugify(text: str) -> str:
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:40] or "erp"


def config_from_sector(sector_code: str, company: dict, modules: list[str] | None = None) -> dict:
    tpl = sector(sector_code)
    chosen = modules if modules is not None else tpl["modules"]
    core = [m["key"] for m in MODULES if m.get("core")]
    keys = list(dict.fromkeys(core + list(chosen)))
    names = {m["key"]: m["name"] for m in MODULES}
    mods = [{"key": k, "enabled": True, "label": tpl["labels"].get(k, names.get(k, k)), "order": i}
            for i, k in enumerate(keys)]
    comp = {"sector": sector_code, "operation_type": tpl.get("operation_type", "mixta"), **company}
    return {"company": comp, "modules": mods, "entities": tpl["entities"], "kpis": tpl["kpis"]}


def branding_from_sector(sector_code: str, software_name: str, company_name: str) -> dict:
    tpl = sector(sector_code)
    return Branding(software_name=software_name, company_name=company_name, **tpl.get("branding", {})).model_dump()


def _next_db_name(db: Session, sector_code: str) -> str:
    base = re.sub(r"[^a-z0-9]", "", sector_code)[:20] or "erp"
    existing = set(db.scalars(select(ErpProject.db_name)))
    n = 1
    while True:
        name = f"erp_{base}_{n:03d}"
        if name not in existing and not manager.database_exists(name):
            return name
        n += 1


def _unique_slug(db: Session, name: str) -> str:
    base = slugify(name)
    slug, n = base, 2
    while db.scalar(select(ErpProject.id).where(ErpProject.slug == slug)):
        slug = f"{base}-{n}"
        n += 1
    return slug


def _seed_tenant(db_name: str, config: dict, branding: dict, admin_user: str, admin_name: str, admin_password: str,
                 actor: str) -> None:
    pw = hash_password(admin_password)
    with manager.tenant_session(db_name) as t:
        roles = {}
        for name, perms in DEFAULT_ROLES.items():
            r = Role(name=name, permissions=perms)
            t.add(r)
            roles[name] = r
        t.flush()
        t.add(User(username=admin_user.lower(), name=admin_name, password_hash=pw, role_id=roles["Administrador"].id))
        t.add(Setting(key="config", value=config))
        t.add(Setting(key="branding", value=branding))
        t.add(TenantAudit(actor=actor, action="crear_erp", entity="erp", detail={"db": db_name}))
        t.commit()


def create_erp(db: Session, *, name: str, config: dict, branding: dict, admin_user: str, admin_name: str,
               admin_password: str, client_id: int | None, actor: str) -> ErpProject:
    cfg = ErpConfig.model_validate(config).model_dump()
    brd = Branding.model_validate(branding).model_dump()
    if not re.match(r"^[a-zA-Z0-9_.-]{3,40}$", admin_user):
        raise ValueError("Usuario administrador inválido (3-40 letras, números, . _ -)")
    hash_password(admin_password)  # valida longitud antes de crear nada
    db_name = _next_db_name(db, cfg["company"]["sector"])
    erp = ErpProject(slug=_unique_slug(db, name), name=name, sector=cfg["company"]["sector"], client_id=client_id,
                     status="borrador", db_name=db_name, db_engine=get_settings().db_engine,
                     config=cfg, branding=brd, current_version=1)
    erp.versions.append(ErpVersion(version=1, config=cfg, branding=brd, note="Versión inicial", created_by=actor))
    db.add(erp)
    db.flush()
    try:
        manager.create_database(db_name)
        rev = manager.migrate(db_name, "tenant")
        _seed_tenant(db_name, cfg, brd, admin_user, admin_name, admin_password, actor)
    except Exception:
        db.rollback()
        try:
            manager.drop_database(db_name)
        except Exception:
            pass
        raise
    db.add(Installation(erp_id=erp.id, action="creado", detail=f"Base {db_name} creada y migrada a {rev}"))
    db.commit()
    return erp


def save_version(db: Session, erp: ErpProject, *, config: dict | None, branding: dict | None, note: str,
                 actor: str) -> ErpProject:
    cfg = ErpConfig.model_validate(config if config is not None else erp.config).model_dump()
    brd = Branding.model_validate(branding if branding is not None else erp.branding).model_dump()
    erp.current_version += 1
    erp.config, erp.branding = cfg, brd
    erp.versions.append(ErpVersion(version=erp.current_version, config=cfg, branding=brd, note=note, created_by=actor))
    db.commit()
    return erp


def publish(db: Session, erp: ErpProject, version: int | None, actor: str) -> ErpProject:
    v = version or erp.current_version
    ver = next((x for x in erp.versions if x.version == v), None)
    if ver is None:
        raise ValueError("Versión inexistente")
    ErpConfig.model_validate(ver.config)
    Branding.model_validate(ver.branding)
    manager.migrate(erp.db_name, "tenant")
    with manager.tenant_session(erp.db_name) as t:
        for key, val in (("config", ver.config), ("branding", ver.branding)):
            s = t.get(Setting, key)
            if s:
                s.value = val
            else:
                t.add(Setting(key=key, value=val))
        t.add(TenantAudit(actor=actor, action="publicar", entity="erp", detail={"version": v}))
        t.commit()
    erp.published_version = v
    if erp.status == "borrador":
        erp.status = "activo"
    db.add(Installation(erp_id=erp.id, action="publicado", detail=f"Versión {v} publicada"))
    db.commit()
    return erp


def restore_version(db: Session, erp: ErpProject, version: int, actor: str) -> ErpProject:
    ver = next((x for x in erp.versions if x.version == version), None)
    if ver is None:
        raise ValueError("Versión inexistente")
    return save_version(db, erp, config=ver.config, branding=ver.branding,
                        note=f"Restaurada desde v{version}", actor=actor)


def tenant_permissions(config: dict) -> list[str]:
    return all_permissions([m["key"] for m in config.get("modules", []) if m.get("enabled")])
