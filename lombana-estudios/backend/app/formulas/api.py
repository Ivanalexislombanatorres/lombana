"""API del motor de fórmulas: catálogo, validación, prueba, guardado y versiones."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.deps import audit, current_factory_user, factory_db
from ..factory.models import FactoryUser, Formula
from .engine import FormulaError, catalog, evaluate, validate

router = APIRouter(prefix="/api/formulas")
Auth = Depends(current_factory_user)


def _fmt(v):
    if isinstance(v, bool):
        return v
    return format(v.normalize(), "f")


class TestIn(BaseModel):
    expression: str = Field(max_length=500)
    values: dict[str, str | float | int | bool] = {}


class FormulaIn(BaseModel):
    code: str = Field(pattern=r"^[a-z][a-z0-9_]{1,59}$")
    name: str = Field(min_length=2, max_length=120)
    expression: str = Field(max_length=500)
    variables: list[str] = Field(default_factory=list, max_length=50)
    module: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=2000)
    sample: dict[str, str | float | int | bool] = {}


@router.get("/functions")
def functions(_=Auth):
    return catalog()


@router.post("/test")
def test(data: TestIn, _=Auth):
    try:
        used = validate(data.expression)
        return {"ok": True, "variables": used, "result": _fmt(evaluate(data.expression, data.values))}
    except FormulaError as e:
        return {"ok": False, "error": str(e)}


def _out(f: Formula) -> dict:
    return {"id": f.id, "code": f.code, "name": f.name, "expression": f.expression, "variables": f.variables,
            "module": f.module, "description": f.description, "version": f.version, "created_at": f.created_at.isoformat()}


@router.get("")
def list_formulas(_=Auth, db: Session = Depends(factory_db)):
    latest = select(Formula.code, func.max(Formula.version).label("v")).group_by(Formula.code).subquery()
    rows = db.scalars(select(Formula).join(latest, (Formula.code == latest.c.code) & (Formula.version == latest.c.v))
                      .order_by(Formula.code))
    return [_out(f) for f in rows]


@router.get("/{code}/versions")
def versions(code: str, _=Auth, db: Session = Depends(factory_db)):
    return [_out(f) for f in db.scalars(select(Formula).where(Formula.code == code).order_by(Formula.version.desc()))]


@router.post("", status_code=201)
def save(data: FormulaIn, user: FactoryUser = Auth, db: Session = Depends(factory_db)):
    """Guardar crea siempre una versión nueva; exige que la fórmula se valide y se pruebe con datos de ejemplo."""
    try:
        validate(data.expression, data.variables)
        sample = {v: data.sample.get(v, Decimal(1)) for v in data.variables}
        evaluate(data.expression, sample)
    except FormulaError as e:
        raise HTTPException(422, str(e)) from None
    last = db.scalar(select(func.max(Formula.version)).where(Formula.code == data.code)) or 0
    f = Formula(code=data.code, name=data.name, expression=data.expression, variables=data.variables,
                module=data.module, description=data.description, version=last + 1)
    db.add(f)
    db.flush()
    audit(db, user.email, "guardar", "formula", data.code, {"version": f.version})
    db.commit()
    return _out(f)
