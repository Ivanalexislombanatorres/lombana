"""ERP RUNTIME: API de cada ERP generado. Todo ocurre dentro de la base del ERP indicado por {slug};
un token emitido para un ERP no es válido en otro."""
from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..core.deps import _payload, bearer, limiter
from ..core.security import create_token, hash_password, verify_password
from ..database import manager
from ..factory.models import ErpProject
from ..formulas.engine import FormulaError, evaluate
from .models import (CustomRecord, Customer, InventoryMovement, Product, Role, Sale, SaleItem, Setting, Supplier,
                     TenantAudit, User)

router = APIRouter(prefix="/api/rt/{slug}")
CENT = Decimal("0.01")


# ------------------------------------------------------------------ contexto
class Ctx:
    def __init__(self, erp: ErpProject, db: Session, user: User | None, config: dict, branding: dict):
        self.erp, self.db, self.user, self.config, self.branding = erp, db, user, config, branding

    @property
    def perms(self) -> list[str]:
        return self.user.role.permissions if self.user else []

    def enabled(self) -> set[str]:
        return {m["key"] for m in self.config.get("modules", []) if m.get("enabled")}

    def can(self, perm: str) -> bool:
        mod, action = perm.split(":")
        if mod not in self.enabled():
            return False
        p = self.perms
        return "*" in p or perm in p or f"*:{action}" in p or f"{mod}:*" in p

    def require(self, perm: str) -> None:
        if not self.can(perm):
            raise HTTPException(403, f"No tienes permiso: {perm}")

    @property
    def tz(self):
        """Zona horaria de la empresa: los días y meses se cuentan en hora local, no en UTC."""
        try:
            return ZoneInfo(self.config.get("company", {}).get("timezone") or "UTC")
        except (ZoneInfoNotFoundError, ValueError):
            return timezone.utc

    def log(self, action: str, entity: str, entity_id=None, detail: dict | None = None) -> None:
        self.db.add(TenantAudit(actor=self.user.username if self.user else "sistema", action=action, entity=entity,
                                entity_id=str(entity_id) if entity_id is not None else None, detail=detail or {}))


def _erp(slug: str) -> ErpProject:
    with manager.factory_session() as f:
        erp = f.scalar(select(ErpProject).where(ErpProject.slug == slug))
    if not erp:
        raise HTTPException(404, "ERP no encontrado")
    if not erp.published_version:
        raise HTTPException(409, "Este ERP aún no ha sido publicado")
    if erp.status in ("suspendido", "archivado"):
        raise HTTPException(423, f"Este ERP está {erp.status}. Contacta al proveedor del software.")
    return erp


def _settings(db: Session) -> tuple[dict, dict]:
    c, b = db.get(Setting, "config"), db.get(Setting, "branding")
    return (c.value if c else {}), (b.value if b else {})


def tenant(slug: str, creds=Depends(bearer)):
    erp = _erp(slug)
    p = _payload(creds)
    if p.get("scope") != f"erp:{slug}":
        raise HTTPException(403, "La sesión no pertenece a este ERP")
    db = manager.tenant_session(erp.db_name)
    try:
        user = db.get(User, int(p["sub"]))
        if not user or not user.is_active:
            raise HTTPException(401, "Usuario inactivo")
        cfg, brd = _settings(db)
        yield Ctx(erp, db, user, cfg, brd)
    finally:
        db.close()


T = Depends(tenant)


def _money(v, field="valor", min_value: Decimal | None = Decimal(0)) -> Decimal:
    try:
        d = Decimal(str(v))
    except (InvalidOperation, ValueError):
        raise HTTPException(422, f"{field}: número inválido") from None
    if not d.is_finite() or (min_value is not None and d < min_value):
        raise HTTPException(422, f"{field}: debe ser mayor o igual a {min_value}")
    return d


# ------------------------------------------------------------------ público / sesión
@router.get("/public")
def public(slug: str):
    erp = _erp(slug)
    with manager.tenant_session(erp.db_name) as db:
        _, brd = _settings(db)
    return {"slug": slug, "name": erp.name, "branding": brd}


class LoginIn(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(slug: str, data: LoginIn, request: Request):
    erp = _erp(slug)
    limiter.check(request, slug, data.username)
    with manager.tenant_session(erp.db_name) as db:
        u = db.scalar(select(User).where(User.username == data.username.lower().strip()))
        if not u or not u.is_active or not verify_password(data.password, u.password_hash):
            limiter.fail(request, slug, data.username)
            raise HTTPException(401, "Usuario o contraseña incorrectos")
        limiter.ok(request, slug, data.username)
        db.add(TenantAudit(actor=u.username, action="login", entity="usuario", entity_id=str(u.id)))
        db.commit()
        return {"token": create_token(str(u.id), f"erp:{slug}")}


@router.get("/me")
def me(ctx: Ctx = T):
    modules = [m for m in sorted(ctx.config.get("modules", []), key=lambda m: m.get("order", 0))
               if m.get("enabled") and ctx.can(f"{m['key']}:ver")]
    return {"user": {"id": ctx.user.id, "username": ctx.user.username, "name": ctx.user.name,
                     "role": ctx.user.role.name},
            "permissions": ctx.perms, "modules": modules,
            "entities": ctx.config.get("entities", []) if ctx.can("registros:ver") else [],
            "company": ctx.config.get("company", {}), "branding": ctx.branding, "erp": {"name": ctx.erp.name, "slug": ctx.erp.slug}}


# ------------------------------------------------------------------ dashboard
@router.get("/dashboard")
def dashboard(ctx: Ctx = T):
    ctx.require("dashboard:ver")
    db = ctx.db
    tz = ctx.tz
    now = datetime.now(tz)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    since = (now - timedelta(days=14)).replace(hour=0, minute=0, second=0, microsecond=0)
    since = min(since, month_start).astimezone(timezone.utc)
    sales = db.scalars(select(Sale).where(Sale.status == "confirmada", Sale.created_at >= since)).all()

    def local(d: datetime) -> datetime:
        return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(tz)
    month = [s for s in sales if local(s.created_at) >= month_start]
    today = [s for s in sales if local(s.created_at).date() == now.date()]
    per_day = defaultdict(Decimal)
    for s in sales:
        per_day[local(s.created_at).date().isoformat()] += s.total
    days = [(now.date() - timedelta(days=i)).isoformat() for i in range(13, -1, -1)]
    total_month = sum((s.total for s in month), Decimal(0))
    top = defaultdict(lambda: [Decimal(0), ""])
    for s in month:
        for it in db.scalars(select(SaleItem).where(SaleItem.sale_id == s.id)):
            top[it.product_id][0] += it.line_total
    names = {p.id: p.name for p in db.scalars(select(Product))}
    low = [{"id": p.id, "name": p.name, "stock": str(p.stock), "min_stock": str(p.min_stock)}
           for p in db.scalars(select(Product).where(Product.kind == "producto", Product.active.is_(True)))
           if p.stock <= p.min_stock]
    rec_counts = defaultdict(int)
    for r in db.scalars(select(CustomRecord.entity)):
        rec_counts[r] += 1
    return {
        "ventas_mes": str(total_month.quantize(CENT)),
        "ventas_hoy": str(sum((s.total for s in today), Decimal(0)).quantize(CENT)),
        "num_ventas_mes": len(month),
        "ticket_promedio": str((total_month / len(month)).quantize(CENT) if month else Decimal("0.00")),
        "clientes": db.query(Customer).count(),
        "productos": db.query(Product).count(),
        "stock_bajo": low,
        "ventas_por_dia": [{"dia": d, "total": str(per_day.get(d, Decimal(0)).quantize(CENT))} for d in days],
        "top_productos": sorted([{"name": names.get(k, "?"), "total": str(v[0].quantize(CENT))} for k, v in top.items()],
                                key=lambda x: Decimal(x["total"]), reverse=True)[:5],
        "registros": dict(rec_counts),
        "currency": ctx.config.get("company", {}).get("currency", "COP"),
    }


# ------------------------------------------------------------------ clientes / proveedores
class PartyIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    document: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    address: str | None = Field(default=None, max_length=240)


def _party_out(p) -> dict:
    return {"id": p.id, "name": p.name, "document": p.document, "email": p.email, "phone": p.phone,
            "address": p.address, "created_at": p.created_at.isoformat()}


def _party_routes(path: str, model, module: str, label: str):
    @router.get(f"/{path}", name=f"list_{path}")
    def _list(q: str = "", ctx: Ctx = T):
        ctx.require(f"{module}:ver")
        stmt = select(model).order_by(model.name)
        if q:
            stmt = stmt.where(model.name.ilike(f"%{q}%"))
        return [_party_out(p) for p in ctx.db.scalars(stmt.limit(500))]

    @router.post(f"/{path}", status_code=201, name=f"create_{path}")
    def _create(data: PartyIn, ctx: Ctx = T):
        ctx.require(f"{module}:crear")
        p = model(**data.model_dump())
        ctx.db.add(p)
        ctx.db.flush()
        ctx.log("crear", label, p.id)
        ctx.db.commit()
        return _party_out(p)

    @router.put(f"/{path}/{{pid}}", name=f"update_{path}")
    def _update(pid: int, data: PartyIn, ctx: Ctx = T):
        ctx.require(f"{module}:editar")
        p = ctx.db.get(model, pid)
        if not p:
            raise HTTPException(404, f"{label} no encontrado")
        for k, v in data.model_dump().items():
            setattr(p, k, v)
        ctx.log("editar", label, p.id)
        ctx.db.commit()
        return _party_out(p)

    @router.delete(f"/{path}/{{pid}}", name=f"delete_{path}")
    def _delete(pid: int, ctx: Ctx = T):
        ctx.require(f"{module}:eliminar")
        p = ctx.db.get(model, pid)
        if not p:
            raise HTTPException(404, f"{label} no encontrado")
        try:
            ctx.db.delete(p)
            ctx.db.flush()
        except IntegrityError:
            ctx.db.rollback()
            raise HTTPException(409, f"No se puede eliminar: el {label} tiene movimientos asociados") from None
        ctx.log("eliminar", label, pid, {"name": p.name})
        ctx.db.commit()
        return {"ok": True}


_party_routes("customers", Customer, "clientes", "cliente")
_party_routes("suppliers", Supplier, "proveedores", "proveedor")


# ------------------------------------------------------------------ productos
class ProductIn(BaseModel):
    sku: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=2, max_length=160)
    kind: str = Field(default="producto", pattern="^(producto|servicio)$")
    price: Decimal = Field(ge=0, max_digits=16, decimal_places=4)
    cost: Decimal = Field(default=Decimal(0), ge=0, max_digits=16, decimal_places=4)
    tax_rate: Decimal = Field(default=Decimal(0), ge=0, le=100, max_digits=7, decimal_places=4)
    min_stock: Decimal = Field(default=Decimal(0), ge=0, max_digits=16, decimal_places=4)
    initial_stock: Decimal = Field(default=Decimal(0), ge=0, max_digits=16, decimal_places=4)
    active: bool = True


def _product_out(p: Product) -> dict:
    margin = ((p.price - p.cost) / p.price * 100).quantize(CENT) if p.price else Decimal("0.00")
    return {"id": p.id, "sku": p.sku, "name": p.name, "kind": p.kind, "price": str(p.price), "cost": str(p.cost),
            "tax_rate": str(p.tax_rate), "stock": str(p.stock), "min_stock": str(p.min_stock), "active": p.active,
            "margin_pct": str(margin), "low_stock": p.kind == "producto" and p.stock <= p.min_stock}


@router.get("/products")
def list_products(q: str = "", ctx: Ctx = T):
    ctx.require("productos:ver")
    stmt = select(Product).order_by(Product.name)
    if q:
        stmt = stmt.where(Product.name.ilike(f"%{q}%") | Product.sku.ilike(f"%{q}%"))
    return [_product_out(p) for p in ctx.db.scalars(stmt.limit(1000))]


@router.post("/products", status_code=201)
def create_product(data: ProductIn, ctx: Ctx = T):
    ctx.require("productos:crear")
    d = data.model_dump()
    initial = d.pop("initial_stock")
    p = Product(**d, stock=Decimal(0))
    ctx.db.add(p)
    try:
        ctx.db.flush()
    except IntegrityError:
        ctx.db.rollback()
        raise HTTPException(409, "Ya existe un producto con ese código (SKU)") from None
    if initial > 0 and p.kind == "producto":
        p.stock = initial
        ctx.db.add(InventoryMovement(product_id=p.id, kind="entrada", qty=initial, reference="Inventario inicial",
                                     created_by=ctx.user.username))
    ctx.log("crear", "producto", p.id)
    ctx.db.commit()
    return _product_out(p)


@router.put("/products/{pid}")
def update_product(pid: int, data: ProductIn, ctx: Ctx = T):
    ctx.require("productos:editar")
    p = ctx.db.get(Product, pid)
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    d = data.model_dump()
    d.pop("initial_stock")  # el stock solo cambia con movimientos de inventario
    for k, v in d.items():
        setattr(p, k, v)
    try:
        ctx.db.flush()
    except IntegrityError:
        ctx.db.rollback()
        raise HTTPException(409, "Ya existe un producto con ese código (SKU)") from None
    ctx.log("editar", "producto", p.id)
    ctx.db.commit()
    return _product_out(p)


@router.delete("/products/{pid}")
def delete_product(pid: int, ctx: Ctx = T):
    ctx.require("productos:eliminar")
    p = ctx.db.get(Product, pid)
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    try:
        ctx.db.delete(p)
        ctx.db.flush()
    except IntegrityError:
        ctx.db.rollback()
        raise HTTPException(409, "El producto tiene ventas o movimientos: desactívalo en lugar de eliminarlo") from None
    ctx.log("eliminar", "producto", pid, {"sku": p.sku})
    ctx.db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ inventario
class MovementIn(BaseModel):
    product_id: int
    kind: str = Field(pattern="^(entrada|salida|ajuste)$")
    qty: Decimal = Field(max_digits=16, decimal_places=4)
    reference: str | None = Field(default=None, max_length=120)


@router.get("/inventory/movements")
def list_movements(ctx: Ctx = T):
    ctx.require("inventario:ver")
    names = {p.id: p.name for p in ctx.db.scalars(select(Product))}
    rows = ctx.db.scalars(select(InventoryMovement).order_by(InventoryMovement.id.desc()).limit(300))
    return [{"id": m.id, "product_id": m.product_id, "product": names.get(m.product_id), "kind": m.kind,
             "qty": str(m.qty), "reference": m.reference, "created_by": m.created_by,
             "created_at": m.created_at.isoformat()} for m in rows]


@router.post("/inventory/movements", status_code=201)
def create_movement(data: MovementIn, ctx: Ctx = T):
    ctx.require("inventario:crear")
    p = ctx.db.get(Product, data.product_id)
    if not p or p.kind != "producto":
        raise HTTPException(422, "Producto inexistente o es un servicio (sin inventario)")
    if data.kind in ("entrada", "salida") and data.qty <= 0:
        raise HTTPException(422, "La cantidad debe ser mayor que cero")
    if data.kind == "ajuste" and data.qty < 0:
        raise HTTPException(422, "El ajuste indica la existencia final (no puede ser negativa)")
    if data.kind == "entrada":
        p.stock += data.qty
        qty = data.qty
    elif data.kind == "salida":
        if p.stock < data.qty:
            raise HTTPException(422, f"Existencia insuficiente: hay {p.stock}")
        p.stock -= data.qty
        qty = data.qty
    else:
        qty = data.qty - p.stock  # diferencia registrada
        p.stock = data.qty
    m = InventoryMovement(product_id=p.id, kind=data.kind, qty=qty, reference=data.reference, created_by=ctx.user.username)
    ctx.db.add(m)
    ctx.db.flush()
    ctx.log("movimiento", "inventario", m.id, {"producto": p.sku, "tipo": data.kind, "cantidad": str(qty)})
    ctx.db.commit()
    return {"id": m.id, "stock": str(p.stock)}


# ------------------------------------------------------------------ ventas
class SaleLine(BaseModel):
    product_id: int
    qty: Decimal = Field(gt=0, max_digits=16, decimal_places=4)
    unit_price: Decimal | None = Field(default=None, ge=0, max_digits=16, decimal_places=4)


class SaleIn(BaseModel):
    customer_id: int | None = None
    discount_pct: Decimal = Field(default=Decimal(0), ge=0, le=100, max_digits=7, decimal_places=4)
    items: list[SaleLine] = Field(min_length=1, max_length=200)


def _sale_out(s: Sale, full=False) -> dict:
    out = {"id": s.id, "number": s.number, "customer_id": s.customer_id,
           "customer": s.customer.name if s.customer else "Consumidor final", "subtotal": str(s.subtotal),
           "discount": str(s.discount), "tax": str(s.tax), "total": str(s.total), "status": s.status,
           "created_by": s.created_by, "created_at": s.created_at.isoformat()}
    if full:
        out["items"] = [{"product_id": i.product_id, "product": i.product.name, "qty": str(i.qty),
                         "unit_price": str(i.unit_price), "tax_rate": str(i.tax_rate), "line_total": str(i.line_total)}
                        for i in s.items]
    return out


@router.get("/sales")
def list_sales(ctx: Ctx = T):
    ctx.require("ventas:ver")
    rows = ctx.db.scalars(select(Sale).options(selectinload(Sale.customer)).order_by(Sale.id.desc()).limit(300))
    return [_sale_out(s) for s in rows]


@router.get("/sales/{sid}")
def get_sale(sid: int, ctx: Ctx = T):
    ctx.require("ventas:ver")
    s = ctx.db.get(Sale, sid)
    if not s:
        raise HTTPException(404, "Venta no encontrada")
    return _sale_out(s, True)


@router.post("/sales", status_code=201)
def create_sale(data: SaleIn, ctx: Ctx = T):
    """Venta en una sola transacción: calcula totales con Decimal, descuenta inventario y registra movimientos."""
    ctx.require("ventas:crear")
    db = ctx.db
    if data.customer_id is not None and not db.get(Customer, data.customer_id):
        raise HTTPException(422, "Cliente inexistente")
    can_change_price = ctx.can("ventas:editar")
    subtotal = tax = Decimal(0)
    lines = []
    needed = defaultdict(Decimal)
    for it in data.items:
        p = db.get(Product, it.product_id)
        if not p or not p.active:
            raise HTTPException(422, f"Producto {it.product_id} inexistente o inactivo")
        price = p.price
        if it.unit_price is not None and it.unit_price != p.price:
            if not can_change_price:
                raise HTTPException(403, "No tienes permiso para cambiar precios (ventas:editar)")
            price = it.unit_price
        if p.kind == "producto":
            needed[p.id] += it.qty
            if p.stock < needed[p.id]:
                raise HTTPException(422, f"Existencia insuficiente de '{p.name}': hay {p.stock}")
        base = (price * it.qty)
        lines.append((p, it.qty, price, base))
    factor = 1 - data.discount_pct / 100
    discount = Decimal(0)
    for p, qty, price, base in lines:
        discounted = base * factor
        discount += base - discounted
        subtotal += base
        tax += discounted * p.tax_rate / 100
    subtotal, discount, tax = subtotal.quantize(CENT), discount.quantize(CENT), tax.quantize(CENT)
    total = subtotal - discount + tax
    last = db.scalar(select(Sale.id).order_by(Sale.id.desc()).limit(1)) or 0
    sale = Sale(number=f"V-{last + 1:06d}", customer_id=data.customer_id, subtotal=subtotal, discount=discount,
                tax=tax, total=total, created_by=ctx.user.username)
    for p, qty, price, base in lines:
        sale.items.append(SaleItem(product_id=p.id, qty=qty, unit_price=price, tax_rate=p.tax_rate,
                                   line_total=base.quantize(CENT)))
        if p.kind == "producto":
            p.stock -= qty
    db.add(sale)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Conflicto al numerar la venta, inténtalo de nuevo") from None
    for p, qty, *_ in lines:
        if p.kind == "producto":
            db.add(InventoryMovement(product_id=p.id, kind="salida", qty=qty, reference=sale.number,
                                     created_by=ctx.user.username))
    ctx.log("crear", "venta", sale.id, {"numero": sale.number, "total": str(total)})
    db.commit()
    return _sale_out(sale, True)


@router.post("/sales/{sid}/void")
def void_sale(sid: int, ctx: Ctx = T):
    ctx.require("ventas:eliminar")
    s = ctx.db.get(Sale, sid)
    if not s:
        raise HTTPException(404, "Venta no encontrada")
    if s.status == "anulada":
        raise HTTPException(409, "La venta ya está anulada")
    for it in s.items:
        if it.product.kind == "producto":
            it.product.stock += it.qty
            ctx.db.add(InventoryMovement(product_id=it.product_id, kind="entrada", qty=it.qty,
                                         reference=f"Anulación {s.number}", created_by=ctx.user.username))
    s.status = "anulada"
    ctx.log("anular", "venta", s.id, {"numero": s.number})
    ctx.db.commit()
    return _sale_out(s, True)


# ------------------------------------------------------------------ reportes
@router.get("/reports/sales")
def report_sales(start: date, end: date, fmt: str = "json", ctx: Ctx = T):
    ctx.require("reportes:ver")
    if end < start or (end - start).days > 366:
        raise HTTPException(422, "Rango inválido (máximo 1 año)")
    t0 = datetime.combine(start, datetime.min.time(), ctx.tz).astimezone(timezone.utc)
    t1 = datetime.combine(end + timedelta(days=1), datetime.min.time(), ctx.tz).astimezone(timezone.utc)
    rows = ctx.db.scalars(select(Sale).options(selectinload(Sale.customer))
                          .where(Sale.created_at >= t0, Sale.created_at < t1).order_by(Sale.id)).all()
    ok = [s for s in rows if s.status == "confirmada"]
    summary = {"ventas": len(ok), "anuladas": len(rows) - len(ok),
               "subtotal": str(sum((s.subtotal for s in ok), Decimal(0))),
               "descuentos": str(sum((s.discount for s in ok), Decimal(0))),
               "impuestos": str(sum((s.tax for s in ok), Decimal(0))),
               "total": str(sum((s.total for s in ok), Decimal(0)))}
    if fmt == "csv":
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(["Número", "Fecha", "Cliente", "Subtotal", "Descuento", "Impuesto", "Total", "Estado", "Usuario"])
        for s in rows:
            loc = (s.created_at if s.created_at.tzinfo else s.created_at.replace(tzinfo=timezone.utc)).astimezone(ctx.tz)
            w.writerow([s.number, loc.strftime("%Y-%m-%d %H:%M"), s.customer.name if s.customer else "Consumidor final",
                        s.subtotal, s.discount, s.tax, s.total, s.status, s.created_by])
        ctx.log("exportar", "reporte_ventas", None, {"desde": str(start), "hasta": str(end)})
        ctx.db.commit()
        return StreamingResponse(iter(["﻿" + buf.getvalue()]), media_type="text/csv; charset=utf-8",
                                 headers={"Content-Disposition": f'attachment; filename="ventas_{start}_{end}.csv"'})
    return {"summary": summary, "rows": [_sale_out(s) for s in rows]}


# ------------------------------------------------------------------ registros personalizados
def _entity(ctx: Ctx, key: str) -> dict:
    for e in ctx.config.get("entities", []):
        if e["key"] == key:
            return e
    raise HTTPException(404, "Entidad no definida en este ERP")


def _validate_record(ctx: Ctx, ent: dict, data: dict) -> dict:
    out, errors = {}, []
    numeric: dict = {}
    for f in ent["fields"]:
        k, t, v = f["key"], f["type"], data.get(f["key"])
        if t == "calculated":
            continue
        if v in (None, ""):
            if f.get("required"):
                errors.append(f"{f['label']} es obligatorio")
            out[k] = None
            continue
        try:
            if t in ("number", "money"):
                d = Decimal(str(v))
                if not d.is_finite():
                    raise ValueError
                if f.get("min") is not None and d < Decimal(str(f["min"])):
                    errors.append(f"{f['label']} debe ser ≥ {f['min']}")
                if f.get("max") is not None and d > Decimal(str(f["max"])):
                    errors.append(f"{f['label']} debe ser ≤ {f['max']}")
                out[k] = str(d)
                numeric[k] = d
            elif t == "date":
                out[k] = date.fromisoformat(str(v)).isoformat()
            elif t == "checkbox":
                if not isinstance(v, bool):
                    raise ValueError
                out[k] = v
            elif t == "select":
                if v not in f.get("options", []):
                    errors.append(f"{f['label']}: opción no válida")
                out[k] = v
            elif t == "relation":
                rid = int(v)
                rel = f["relation"]
                model = {"customers": Customer, "products": Product, "suppliers": Supplier}.get(rel)
                exists = ctx.db.get(model, rid) if model else ctx.db.scalar(
                    select(CustomRecord.id).where(CustomRecord.id == rid, CustomRecord.entity == rel))
                if not exists:
                    errors.append(f"{f['label']}: registro relacionado inexistente")
                out[k] = rid
            else:
                s = str(v).strip()
                if len(s) > (f.get("max_length") or 500):
                    errors.append(f"{f['label']}: texto demasiado largo")
                out[k] = s
        except (ValueError, InvalidOperation, TypeError):
            errors.append(f"{f['label']}: valor inválido")
    for f in ent["fields"]:
        if f["type"] == "calculated":
            try:
                vals = {k: numeric.get(k, Decimal(0)) for k in
                        [x["key"] for x in ent["fields"] if x["type"] in ("number", "money")]}
                out[f["key"]] = str(Decimal(evaluate(f["formula"], vals)).quantize(CENT))
            except FormulaError as e:
                errors.append(f"{f['label']}: {e}")
    if errors:
        raise HTTPException(422, "; ".join(errors))
    return out


def _labels(ctx: Ctx, ent: dict, rows: list[CustomRecord]) -> dict:
    """Etiquetas legibles de los campos relación (para mostrar nombres en vez de ids)."""
    labels: dict = {}
    for f in ent["fields"]:
        if f["type"] != "relation":
            continue
        ids = {r.data.get(f["key"]) for r in rows if r.data.get(f["key"])}
        rel = f["relation"]
        model = {"customers": Customer, "products": Product, "suppliers": Supplier}.get(rel)
        m = {}
        if model and ids:
            m = {x.id: x.name for x in ctx.db.scalars(select(model).where(model.id.in_(ids)))}
        elif ids:
            for x in ctx.db.scalars(select(CustomRecord).where(CustomRecord.id.in_(ids))):
                first = next((v for v in x.data.values() if isinstance(v, str)), f"#{x.id}")
                m[x.id] = first
        labels[f["key"]] = {str(k): v for k, v in m.items()}
    return labels


@router.get("/records/{entity}")
def list_records(entity: str, ctx: Ctx = T):
    ctx.require("registros:ver")
    ent = _entity(ctx, entity)
    rows = ctx.db.scalars(select(CustomRecord).where(CustomRecord.entity == entity)
                          .order_by(CustomRecord.id.desc()).limit(1000)).all()
    return {"entity": ent, "labels": _labels(ctx, ent, rows),
            "rows": [{"id": r.id, **r.data, "_created_at": r.created_at.isoformat()} for r in rows]}


@router.post("/records/{entity}", status_code=201)
def create_record(entity: str, data: dict, ctx: Ctx = T):
    ctx.require("registros:crear")
    ent = _entity(ctx, entity)
    r = CustomRecord(entity=entity, data=_validate_record(ctx, ent, data), created_by=ctx.user.username)
    ctx.db.add(r)
    ctx.db.flush()
    ctx.log("crear", entity, r.id)
    ctx.db.commit()
    return {"id": r.id, **r.data}


@router.put("/records/{entity}/{rid}")
def update_record(entity: str, rid: int, data: dict, ctx: Ctx = T):
    ctx.require("registros:editar")
    ent = _entity(ctx, entity)
    r = ctx.db.get(CustomRecord, rid)
    if not r or r.entity != entity:
        raise HTTPException(404, "Registro no encontrado")
    r.data = _validate_record(ctx, ent, data)
    ctx.log("editar", entity, r.id)
    ctx.db.commit()
    return {"id": r.id, **r.data}


@router.delete("/records/{entity}/{rid}")
def delete_record(entity: str, rid: int, ctx: Ctx = T):
    ctx.require("registros:eliminar")
    _entity(ctx, entity)
    r = ctx.db.get(CustomRecord, rid)
    if not r or r.entity != entity:
        raise HTTPException(404, "Registro no encontrado")
    referenced = any(
        r_.data.get(f["key"]) == rid
        for e in ctx.config.get("entities", []) for f in e["fields"]
        if f["type"] == "relation" and f["relation"] == entity
        for r_ in ctx.db.scalars(select(CustomRecord).where(CustomRecord.entity == e["key"]))
    )
    if referenced:
        raise HTTPException(409, "Otros registros dependen de este: elimínalos primero")
    ctx.db.delete(r)
    ctx.log("eliminar", entity, rid, r.data)
    ctx.db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ usuarios y roles
class UserIn(BaseModel):
    username: str = Field(pattern=r"^[a-zA-Z0-9_.-]{3,40}$")
    name: str = Field(min_length=2, max_length=120)
    role_id: int
    password: str | None = Field(default=None, min_length=8, max_length=128)
    is_active: bool = True


class RoleIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    permissions: list[str] = Field(max_length=500)


def _user_out(u: User) -> dict:
    return {"id": u.id, "username": u.username, "name": u.name, "role_id": u.role_id, "role": u.role.name,
            "is_active": u.is_active, "created_at": u.created_at.isoformat()}


def _admins_left(ctx: Ctx, excluding: int) -> int:
    return sum(1 for u in ctx.db.scalars(select(User).where(User.is_active.is_(True), User.id != excluding))
               if "*" in u.role.permissions)


@router.get("/users")
def list_users(ctx: Ctx = T):
    ctx.require("usuarios:ver")
    return [_user_out(u) for u in ctx.db.scalars(select(User).order_by(User.username))]


@router.post("/users", status_code=201)
def create_user(data: UserIn, ctx: Ctx = T):
    ctx.require("usuarios:crear")
    if not data.password:
        raise HTTPException(422, "La contraseña es obligatoria al crear el usuario")
    if not ctx.db.get(Role, data.role_id):
        raise HTTPException(422, "Rol inexistente")
    u = User(username=data.username.lower(), name=data.name, role_id=data.role_id, is_active=data.is_active,
             password_hash=hash_password(data.password))
    ctx.db.add(u)
    try:
        ctx.db.flush()
    except IntegrityError:
        ctx.db.rollback()
        raise HTTPException(409, "Ese nombre de usuario ya existe") from None
    ctx.log("crear", "usuario", u.id, {"username": u.username})
    ctx.db.commit()
    return _user_out(u)


@router.put("/users/{uid}")
def update_user(uid: int, data: UserIn, ctx: Ctx = T):
    ctx.require("usuarios:editar")
    u = ctx.db.get(User, uid)
    role = ctx.db.get(Role, data.role_id)
    if not u or not role:
        raise HTTPException(404, "Usuario o rol inexistente")
    losing_admin = "*" in u.role.permissions and ("*" not in role.permissions or not data.is_active)
    if losing_admin and _admins_left(ctx, u.id) == 0:
        raise HTTPException(409, "Debe quedar al menos un administrador activo")
    u.name, u.role_id, u.is_active = data.name, data.role_id, data.is_active
    if data.password:
        u.password_hash = hash_password(data.password)
    ctx.log("editar", "usuario", u.id, {"rol": role.name, "activo": data.is_active, "cambio_clave": bool(data.password)})
    ctx.db.commit()
    ctx.db.refresh(u)
    return _user_out(u)


@router.get("/roles")
def list_roles(ctx: Ctx = T):
    ctx.require("usuarios:ver")
    from ..erp_generator.service import tenant_permissions
    return {"roles": [{"id": r.id, "name": r.name, "permissions": r.permissions} for r in ctx.db.scalars(select(Role))],
            "available": tenant_permissions(ctx.config)}


@router.post("/roles", status_code=201)
def create_role(data: RoleIn, ctx: Ctx = T):
    ctx.require("usuarios:crear")
    r = Role(name=data.name, permissions=sorted(set(data.permissions)))
    ctx.db.add(r)
    try:
        ctx.db.flush()
    except IntegrityError:
        ctx.db.rollback()
        raise HTTPException(409, "Ya existe un rol con ese nombre") from None
    ctx.log("crear", "rol", r.id, {"permisos": r.permissions})
    ctx.db.commit()
    return {"id": r.id, "name": r.name, "permissions": r.permissions}


@router.put("/roles/{rid}")
def update_role(rid: int, data: RoleIn, ctx: Ctx = T):
    ctx.require("usuarios:editar")
    r = ctx.db.get(Role, rid)
    if not r:
        raise HTTPException(404, "Rol no encontrado")
    if "*" in r.permissions and "*" not in data.permissions:
        raise HTTPException(409, "El rol administrador conserva todos los permisos")
    r.name, r.permissions = data.name, sorted(set(data.permissions))
    ctx.log("editar", "rol", r.id, {"permisos": r.permissions})
    ctx.db.commit()
    return {"id": r.id, "name": r.name, "permissions": r.permissions}


# ------------------------------------------------------------------ auditoría
@router.get("/audit")
def audit(ctx: Ctx = T):
    ctx.require("auditoria:ver")
    rows = ctx.db.scalars(select(TenantAudit).order_by(TenantAudit.id.desc()).limit(300))
    return [{"id": a.id, "actor": a.actor, "action": a.action, "entity": a.entity, "entity_id": a.entity_id,
             "detail": a.detail, "created_at": a.created_at.isoformat()} for a in rows]
