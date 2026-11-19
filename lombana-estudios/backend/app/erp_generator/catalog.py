"""Catálogo de módulos universales y plantillas de sector."""
from __future__ import annotations

import json
from functools import lru_cache

from ..core.config import get_settings

# operational=True → el runtime ya tiene pantallas, API y pruebas para este módulo.
MODULES: list[dict] = [
    {"key": "dashboard", "name": "Dashboard", "icon": "gauge", "operational": True, "core": True},
    {"key": "clientes", "name": "Clientes / CRM", "icon": "users", "operational": True},
    {"key": "proveedores", "name": "Proveedores", "icon": "truck", "operational": True},
    {"key": "productos", "name": "Productos y servicios", "icon": "package", "operational": True},
    {"key": "ventas", "name": "Ventas", "icon": "receipt", "operational": True, "depends": ["productos", "clientes"]},
    {"key": "inventario", "name": "Inventario", "icon": "boxes", "operational": True, "depends": ["productos"]},
    {"key": "registros", "name": "Registros personalizados", "icon": "table", "operational": True},
    {"key": "reportes", "name": "Reportes", "icon": "chart", "operational": True},
    {"key": "usuarios", "name": "Usuarios y roles", "icon": "shield", "operational": True, "core": True},
    {"key": "auditoria", "name": "Auditoría", "icon": "history", "operational": True, "core": True},
    # Planificados (fases siguientes). No se pueden activar hasta tener runtime real.
    {"key": "compras", "name": "Compras", "icon": "cart", "operational": False},
    {"key": "caja", "name": "Caja", "icon": "wallet", "operational": False},
    {"key": "bancos", "name": "Bancos", "icon": "bank", "operational": False},
    {"key": "contabilidad", "name": "Contabilidad", "icon": "book", "operational": False},
    {"key": "cxc", "name": "Cuentas por cobrar", "icon": "arrow-down", "operational": False},
    {"key": "cxp", "name": "Cuentas por pagar", "icon": "arrow-up", "operational": False},
    {"key": "presupuestos", "name": "Presupuestos", "icon": "target", "operational": False},
    {"key": "nomina", "name": "Nómina", "icon": "id", "operational": False},
    {"key": "rrhh", "name": "Recursos humanos", "icon": "user-check", "operational": False},
    {"key": "activos", "name": "Activos fijos", "icon": "building", "operational": False},
    {"key": "facturacion_electronica", "name": "Facturación electrónica", "icon": "file", "operational": False},
    {"key": "automatizaciones", "name": "Automatizaciones", "icon": "zap", "operational": False},
]

PERMISSION_ACTIONS = ["ver", "crear", "editar", "eliminar"]


def all_permissions(enabled_modules: list[str]) -> list[str]:
    return [f"{m}:{a}" for m in enabled_modules for a in PERMISSION_ACTIONS]


@lru_cache
def sectors() -> dict[str, dict]:
    out = {}
    d = get_settings().templates_dir
    for p in sorted(d.glob("*.json")):
        data = json.loads(p.read_text(encoding="utf-8"))
        out[data["code"]] = data
    return dict(sorted(out.items(), key=lambda kv: kv[1].get("order", 99)))


def sector(code: str) -> dict:
    s = sectors()
    if code not in s:
        raise KeyError(code)
    return s[code]
