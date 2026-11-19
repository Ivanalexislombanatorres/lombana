"""Agentes de IA especializados.

Diseño de seguridad:
- Cada agente tiene objetivo, instrucciones, herramientas autorizadas y límites.
- Las herramientas disponibles hoy son SOLO DE LECTURA y operan sobre la base de UNA empresa.
- Ningún agente puede crear, modificar ni borrar datos. Las operaciones sensibles (pagos, nómina,
  cierres, eliminaciones) quedan fuera de su alcance: requieren un humano en el runtime.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select

from ..database import manager
from ..erp_runtime.models import CustomRecord, Customer, Product, Sale, SaleItem, Setting


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def tool_resumen_ventas(db_name: str) -> dict:
    now = datetime.now(timezone.utc)
    with manager.tenant_session(db_name) as db:
        sales = [s for s in db.scalars(select(Sale).where(Sale.status == "confirmada"))
                 if _aware(s.created_at) >= now - timedelta(days=90)]
        by_month = defaultdict(Decimal)
        for s in sales:
            by_month[_aware(s.created_at).strftime("%Y-%m")] += s.total
        prod = defaultdict(Decimal)
        names = {p.id: p.name for p in db.scalars(select(Product))}
        for s in sales:
            for it in s.items:
                prod[names.get(it.product_id, "?")] += it.line_total
        return {"ventas_90_dias": len(sales), "total_90_dias": str(sum((s.total for s in sales), Decimal(0))),
                "por_mes": {k: str(v) for k, v in sorted(by_month.items())},
                "top_productos": {k: str(v) for k, v in sorted(prod.items(), key=lambda x: -x[1])[:10]}}


def tool_inventario(db_name: str) -> dict:
    with manager.tenant_session(db_name) as db:
        prods = db.scalars(select(Product).where(Product.kind == "producto")).all()
        return {"productos": len(prods),
                "stock_bajo": [{"producto": p.name, "stock": str(p.stock), "minimo": str(p.min_stock)}
                               for p in prods if p.stock <= p.min_stock][:30],
                "valor_inventario_costo": str(sum((p.stock * p.cost for p in prods), Decimal(0)))}


def tool_clientes(db_name: str) -> dict:
    with manager.tenant_session(db_name) as db:
        total = db.scalar(select(func.count(Customer.id)))
        buyers = defaultdict(Decimal)
        names = {c.id: c.name for c in db.scalars(select(Customer))}
        for s in db.scalars(select(Sale).where(Sale.status == "confirmada", Sale.customer_id.is_not(None))):
            buyers[names.get(s.customer_id, "?")] += s.total
        return {"clientes": total, "mejores_clientes": {k: str(v) for k, v in sorted(buyers.items(), key=lambda x: -x[1])[:10]}}


def tool_registros(db_name: str) -> dict:
    with manager.tenant_session(db_name) as db:
        counts = defaultdict(int)
        for e in db.scalars(select(CustomRecord.entity)):
            counts[e] += 1
        cfg = db.get(Setting, "config")
        return {"entidades": dict(counts), "empresa": (cfg.value if cfg else {}).get("company", {})}


TOOLS = {
    "resumen_ventas": (tool_resumen_ventas, "Ventas de los últimos 90 días, por mes y por producto"),
    "inventario": (tool_inventario, "Existencias, productos bajo mínimo y valor del inventario"),
    "clientes": (tool_clientes, "Número de clientes y mejores compradores"),
    "registros": (tool_registros, "Datos de la empresa y conteo de registros personalizados"),
}

BASE_RULES = ("Eres un agente de LOMBANA ESTUDIOS. Responde en español, de forma clara y accionable. "
              "Usa SOLO los datos entregados; si faltan datos, dilo. Nunca inventes cifras ni transacciones. "
              "No puedes modificar datos: si una acción requiere cambios (pagos, nómina, cierres, eliminaciones), "
              "recomiéndala para que un humano la apruebe y la ejecute.")

AGENTS = {
    "ceo": ("Agente CEO", "Análisis general del negocio y prioridades.", ["resumen_ventas", "inventario", "clientes", "registros"]),
    "cfo": ("Agente CFO", "Análisis financiero: ingresos, tendencias y márgenes.", ["resumen_ventas", "inventario"]),
    "contable": ("Agente contable", "Apoyo en revisión de registros de ventas e inventario.", ["resumen_ventas", "inventario"]),
    "auditor": ("Agente auditor", "Detección de inconsistencias y riesgos en los datos.", ["resumen_ventas", "inventario", "registros"]),
    "comercial": ("Agente comercial", "Seguimiento de clientes y oportunidades de venta.", ["resumen_ventas", "clientes"]),
    "inventario": ("Agente de inventario", "Análisis de existencias y reabastecimiento.", ["inventario", "resumen_ventas"]),
    "nomina": ("Agente de nómina", "Apoyo en revisión de novedades de personal (solo lectura).", ["registros"]),
    "rrhh": ("Agente de recursos humanos", "Gestión del personal a partir de los registros.", ["registros"]),
    "operativo": ("Agente operativo", "Seguimiento de procesos y registros operativos.", ["registros", "inventario"]),
    "consultor": ("Agente consultor", "Recomendaciones empresariales generales.", ["resumen_ventas", "inventario", "clientes", "registros"]),
    "constructor": ("Agente constructor", "Sugiere módulos, entidades y campos para el ERP (no los crea).", ["registros"]),
}


def agent_list() -> list[dict]:
    return [{"code": k, "name": v[0], "objective": v[1], "tools": v[2], "task": f"agente_{k}",
             "permissions": "solo lectura", "max_tokens": 900} for k, v in AGENTS.items()]


def build_context(code: str, db_name: str) -> tuple[str, str]:
    name, objective, tools = AGENTS[code]
    data = {t: TOOLS[t][0](db_name) for t in tools}
    system = f"{BASE_RULES}\nRol: {name}. Objetivo: {objective}"
    return system, data
