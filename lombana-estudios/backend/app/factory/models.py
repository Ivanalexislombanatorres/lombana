"""Modelos de la base central `lombana_factory` (solo datos de la fábrica, nunca operación de clientes)."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import (Boolean, Date, DateTime, ForeignKey, Integer, LargeBinary, String, Text,
                        UniqueConstraint, Index)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from ..database.types import JSONType, Money, UTCDateTime


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FactoryBase(DeclarativeBase):
    pass


class FactoryUser(FactoryBase):
    __tablename__ = "factory_users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Client(FactoryBase):
    __tablename__ = "clients"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    document: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(160))
    phone: Mapped[str | None] = mapped_column(String(40))
    country: Mapped[str | None] = mapped_column(String(60))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    erps: Mapped[list["ErpProject"]] = relationship(back_populates="client")


class Plan(FactoryBase):
    __tablename__ = "plans"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    price_monthly: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    max_users: Mapped[int] = mapped_column(Integer, default=3)
    max_storage_mb: Mapped[int] = mapped_column(Integer, default=500)
    max_modules: Mapped[int] = mapped_column(Integer, default=8)


class ErpProject(FactoryBase):
    __tablename__ = "erp_projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    sector: Mapped[str] = mapped_column(String(40), index=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="borrador")  # borrador|activo|suspendido|archivado
    db_name: Mapped[str] = mapped_column(String(63), unique=True)
    db_engine: Mapped[str] = mapped_column(String(20))
    config: Mapped[dict] = mapped_column(JSONType, default=dict)
    branding: Mapped[dict] = mapped_column(JSONType, default=dict)
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    published_version: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    client: Mapped[Client | None] = relationship(back_populates="erps")
    versions: Mapped[list["ErpVersion"]] = relationship(back_populates="erp", cascade="all, delete-orphan",
                                                        order_by="ErpVersion.version")


class ErpVersion(FactoryBase):
    __tablename__ = "erp_versions"
    __table_args__ = (UniqueConstraint("erp_id", "version", name="uq_erp_version"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    erp_id: Mapped[int] = mapped_column(ForeignKey("erp_projects.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    config: Mapped[dict] = mapped_column(JSONType)
    branding: Mapped[dict] = mapped_column(JSONType)
    note: Mapped[str | None] = mapped_column(String(240))
    created_by: Mapped[str | None] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    erp: Mapped[ErpProject] = relationship(back_populates="versions")


class BrandTemplate(FactoryBase):
    __tablename__ = "brand_templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    branding: Mapped[dict] = mapped_column(JSONType)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class License(FactoryBase):
    __tablename__ = "licenses"
    id: Mapped[int] = mapped_column(primary_key=True)
    license_key: Mapped[str] = mapped_column(String(40), unique=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="RESTRICT"), index=True)
    erp_id: Mapped[int | None] = mapped_column(ForeignKey("erp_projects.id", ondelete="SET NULL"))
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id", ondelete="RESTRICT"))
    status: Mapped[str] = mapped_column(String(20), default="activa")  # activa|suspendida|vencida
    billing_cycle: Mapped[str] = mapped_column(String(20), default="mensual")  # mensual|anual
    start_date: Mapped[date] = mapped_column(Date)
    renewal_date: Mapped[date] = mapped_column(Date)
    payment_status: Mapped[str] = mapped_column(String(20), default="pendiente")  # pendiente|al_dia|vencido
    amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    client: Mapped[Client] = relationship()
    plan: Mapped[Plan] = relationship()
    erp: Mapped[ErpProject | None] = relationship()


class Installation(FactoryBase):
    __tablename__ = "installations"
    id: Mapped[int] = mapped_column(primary_key=True)
    erp_id: Mapped[int | None] = mapped_column(ForeignKey("erp_projects.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(30))
    detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class AiProvider(FactoryBase):
    __tablename__ = "ai_providers"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(30))  # openai_compatible|anthropic|gemini|cohere|azure_openai|ollama
    base_url: Mapped[str] = mapped_column(String(300))
    api_key_enc: Mapped[str | None] = mapped_column(Text)
    default_model: Mapped[str | None] = mapped_column(String(120))
    models: Mapped[list] = mapped_column(JSONType, default=list)
    extra: Mapped[dict] = mapped_column(JSONType, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="sin_probar")  # sin_probar|conectado|error
    last_test_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_error: Mapped[str | None] = mapped_column(Text)
    monthly_limit_requests: Mapped[int] = mapped_column(Integer, default=1000)
    monthly_budget_usd: Mapped[Decimal] = mapped_column(Money, default=Decimal("10"))


class AiRequest(FactoryBase):
    __tablename__ = "ai_requests"
    __table_args__ = (Index("ix_ai_requests_provider_date", "provider_id", "created_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("ai_providers.id", ondelete="CASCADE"))
    model: Mapped[str | None] = mapped_column(String(120))
    task: Mapped[str] = mapped_column(String(60))
    ok: Mapped[bool] = mapped_column(Boolean)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class AiTaskRoute(FactoryBase):
    __tablename__ = "ai_task_routes"
    id: Mapped[int] = mapped_column(primary_key=True)
    task: Mapped[str] = mapped_column(String(60), unique=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("ai_providers.id", ondelete="CASCADE"))
    model: Mapped[str | None] = mapped_column(String(120))


class Formula(FactoryBase):
    __tablename__ = "formulas"
    __table_args__ = (UniqueConstraint("code", "version", name="uq_formula_version"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(60), index=True)
    name: Mapped[str] = mapped_column(String(120))
    expression: Mapped[str] = mapped_column(Text)
    variables: Mapped[list] = mapped_column(JSONType, default=list)
    module: Mapped[str | None] = mapped_column(String(40))
    description: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class FactoryAudit(FactoryBase):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor: Mapped[str] = mapped_column(String(160))
    action: Mapped[str] = mapped_column(String(60))
    entity: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str | None] = mapped_column(String(60))
    detail: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class BackupFile(FactoryBase):
    """Respaldos guardados en la base central (modo nube: el servidor no tiene disco permanente)."""
    __tablename__ = "backup_files"
    __table_args__ = (UniqueConstraint("db_name", "file_name", name="uq_backup_file"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    db_name: Mapped[str] = mapped_column(String(63), index=True)
    file_name: Mapped[str] = mapped_column(String(160))
    size: Mapped[int] = mapped_column(Integer)
    content: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class LoginAttempt(FactoryBase):
    """Intentos fallidos de inicio de sesión (compartidos entre todas las instancias del servidor)."""
    __tablename__ = "login_attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(300), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
