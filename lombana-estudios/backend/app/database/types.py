"""Tipos de columna compartidos.

Money: en PostgreSQL es NUMERIC(18,4) real; en SQLite se guarda como texto para
no perder precisión (SQLite convierte NUMERIC a float). Siempre devuelve Decimal.
"""
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import JSON, DateTime, Numeric, String
from sqlalchemy.types import TypeDecorator

SCALE = Decimal("0.0001")


class Money(TypeDecorator):
    impl = Numeric(18, 4)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "sqlite":
            return dialect.type_descriptor(String(40))
        return dialect.type_descriptor(Numeric(18, 4))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        d = Decimal(str(value)).quantize(SCALE)
        return str(d) if dialect.name == "sqlite" else d

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return Decimal(str(value)).quantize(SCALE)  # mismo formato en SQLite y PostgreSQL


JSONType = JSON


class UTCDateTime(TypeDecorator):
    """Fecha-hora siempre en UTC con zona (SQLite no guarda la zona: aquí se restaura)."""
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        value = value.astimezone(timezone.utc)
        return value.replace(tzinfo=None) if dialect.name == "sqlite" else value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, str):
            value = datetime.fromisoformat(value)
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
