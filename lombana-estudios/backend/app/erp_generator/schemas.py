"""Esquemas validados de la configuración de un ERP y de su marca (white label).

El constructor NO genera ni ejecuta código: produce una configuración JSON que
se valida aquí, se versiona y luego el runtime la interpreta.
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from ..formulas.engine import FormulaError, validate as validate_formula

KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
FONTS = ["Inter", "Poppins", "Montserrat", "Roboto", "Lato", "Playfair Display", "Source Sans 3", "system-ui"]
MAX_IMAGE_BYTES = 400_000


def _key(v: str) -> str:
    if not KEY_RE.match(v):
        raise ValueError("Clave inválida: usa minúsculas, números y guion bajo, empezando por letra")
    return v


class Company(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    sector: str = Field(min_length=2, max_length=40)
    activity: str = Field(default="", max_length=200)
    size: Literal["micro", "pequeña", "mediana", "grande"] = "micro"
    country: str = Field(default="Colombia", max_length=60)
    currency: str = Field(default="COP", pattern=r"^[A-Z]{3}$")
    language: Literal["es", "en", "pt"] = "es"
    timezone: str = Field(default="America/Bogota", max_length=60)
    operation_type: Literal["productos", "servicios", "mixta"] = "mixta"


class ModuleConfig(BaseModel):
    key: str
    enabled: bool = True
    label: str = Field(min_length=1, max_length=60)
    order: int = 0


FieldType = Literal["text", "number", "money", "date", "select", "checkbox", "relation", "calculated"]


class FieldDef(BaseModel):
    key: str
    label: str = Field(min_length=1, max_length=60)
    type: FieldType = "text"
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=50)
    relation: str | None = None  # customers | products | suppliers | <entidad>
    formula: str | None = None
    min: float | None = None
    max: float | None = None
    max_length: int | None = Field(default=None, ge=1, le=2000)

    _k = field_validator("key")(_key)

    @model_validator(mode="after")
    def _check(self):
        if self.type == "select" and not self.options:
            raise ValueError(f"El campo '{self.key}' es una lista y necesita opciones")
        if self.type == "relation" and not self.relation:
            raise ValueError(f"El campo '{self.key}' es relación y necesita indicar la entidad")
        if self.type == "calculated" and not self.formula:
            raise ValueError(f"El campo '{self.key}' es calculado y necesita una fórmula")
        return self


class EntityDef(BaseModel):
    key: str
    label: str = Field(min_length=1, max_length=60)
    fields: list[FieldDef] = Field(min_length=1, max_length=40)

    _k = field_validator("key")(_key)

    @model_validator(mode="after")
    def _check(self):
        keys = [f.key for f in self.fields]
        if len(keys) != len(set(keys)):
            raise ValueError(f"Campos duplicados en la entidad '{self.key}'")
        numeric = [f.key for f in self.fields if f.type in ("number", "money")]
        for f in self.fields:
            if f.type == "calculated":
                try:
                    validate_formula(f.formula, numeric)
                except FormulaError as e:
                    raise ValueError(f"Fórmula del campo '{f.key}': {e}") from None
        return self


class ErpConfig(BaseModel):
    company: Company
    modules: list[ModuleConfig] = Field(default_factory=list)
    entities: list[EntityDef] = Field(default_factory=list, max_length=30)
    kpis: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self):
        from .catalog import MODULES
        known = {m["key"]: m for m in MODULES}
        seen = set()
        for m in self.modules:
            if m.key not in known:
                raise ValueError(f"Módulo desconocido: {m.key}")
            if m.key in seen:
                raise ValueError(f"Módulo repetido: {m.key}")
            seen.add(m.key)
            if m.enabled and not known[m.key]["operational"]:
                raise ValueError(f"El módulo '{known[m.key]['name']}' aún no está disponible en el runtime")
        enabled = {m.key for m in self.modules if m.enabled}
        for m in self.modules:
            if m.enabled:
                for dep in known[m.key].get("depends", []):
                    if dep not in enabled:
                        raise ValueError(f"El módulo '{m.label}' requiere activar '{known[dep]['name']}'")
        ekeys = [e.key for e in self.entities]
        if len(ekeys) != len(set(ekeys)):
            raise ValueError("Hay entidades con la misma clave")
        valid_rel = {"customers", "products", "suppliers", *ekeys}
        for e in self.entities:
            for f in e.fields:
                if f.type == "relation" and f.relation not in valid_rel:
                    raise ValueError(f"Relación inválida en {e.key}.{f.key}: {f.relation}")
        return self


class Branding(BaseModel):
    software_name: str = Field(default="Mi ERP", min_length=1, max_length=60)
    company_name: str = Field(default="", max_length=120)
    slogan: str = Field(default="", max_length=160)
    logo: str | None = None          # data URL png/jpeg/webp
    favicon: str | None = None
    login_image: str | None = None
    primary: str = "#2563EB"
    secondary: str = "#0F172A"
    button: str = "#2563EB"
    background: str = "#F8FAFC"
    surface: str = "#FFFFFF"
    text: str = "#0F172A"
    font: str = "Inter"
    theme: Literal["claro", "oscuro"] = "claro"
    welcome_title: str = Field(default="Bienvenido", max_length=80)
    welcome_text: str = Field(default="", max_length=300)
    contact_email: str = Field(default="", max_length=160)
    contact_phone: str = Field(default="", max_length=40)
    contact_address: str = Field(default="", max_length=200)
    document_footer: str = Field(default="", max_length=300)
    invoice_template: Literal["clasica", "moderna", "minimal"] = "moderna"

    @field_validator("primary", "secondary", "button", "background", "surface", "text")
    @classmethod
    def _hex(cls, v: str) -> str:
        if not HEX_RE.match(v):
            raise ValueError("Color inválido: usa formato #RRGGBB")
        return v.upper()

    @field_validator("font")
    @classmethod
    def _font(cls, v: str) -> str:
        if v not in FONTS:
            raise ValueError(f"Tipografía no soportada. Opciones: {', '.join(FONTS)}")
        return v

    @field_validator("logo", "favicon", "login_image")
    @classmethod
    def _img(cls, v: str | None) -> str | None:
        if v in (None, ""):
            return None
        if not re.match(r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$", v):
            raise ValueError("La imagen debe ser PNG, JPG o WEBP")
        if len(v) * 3 / 4 > MAX_IMAGE_BYTES:
            raise ValueError("La imagen supera 400 KB")
        return v
