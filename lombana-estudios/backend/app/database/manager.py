"""Motor de bases de datos: base central + un espacio aislado por ERP.

Modos de aislamiento:
- SQLite: un archivo por ERP (local, un usuario).
- PostgreSQL "database": una base de datos por ERP (servidor propio).
- PostgreSQL "schema": un esquema por ERP dentro de una sola base (Supabase / nube).
  Cada consulta se reescribe con el esquema del ERP (schema_translate_map), así que funciona
  también detrás de poolers en modo transacción (no depende de SET search_path).

Además: migraciones Alembic con bloqueo (solo upgrade) y respaldos lógicos portables
guardados en archivos (local) o en la base central (nube).
"""
from __future__ import annotations

import gzip
import io
import json
import re
import threading
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Date, DateTime, create_engine, event, func, inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from ..core.config import get_settings
from ..erp_runtime.models import TenantBase
from ..factory.models import BackupFile, FactoryBase
from .types import Money, UTCDateTime

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"
DB_NAME_RE = re.compile(r"^erp_[a-z0-9_]{1,50}$")
SKIP_BACKUP_TABLES = {"backup_files", "login_attempts"}  # nunca se respaldan a sí mismas

_engines: dict[str, Engine] = {}
_lock = threading.Lock()


def _make_engine(url: str) -> Engine:
    s = get_settings()
    if url.startswith("sqlite"):
        eng = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})

        @event.listens_for(eng, "connect")
        def _pragmas(dbapi_conn, _):  # integridad referencial real en SQLite
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.close()
        return eng
    if s.serverless:  # cada invocación abre y cierra; el pooler del proveedor reutiliza conexiones
        return create_engine(url, poolclass=NullPool, connect_args={"connect_timeout": 10})
    return create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)


def _schema(db_name: str) -> str | None:
    return db_name if get_settings().schema_mode else None


def engine_for(db_name: str) -> Engine:
    s = get_settings()
    with _lock:
        if s.schema_mode:
            base = _engines.get("__base__")
            if base is None:
                base = _engines["__base__"] = _make_engine(s.db_url(db_name))
            if db_name not in _engines:
                _engines[db_name] = base.execution_options(schema_translate_map={None: db_name})
            return _engines[db_name]
        if db_name not in _engines:
            _engines[db_name] = _make_engine(s.db_url(db_name))
        return _engines[db_name]


def dispose_all() -> None:
    with _lock:
        for e in _engines.values():
            e.dispose()
        _engines.clear()


def validate_db_name(db_name: str) -> str:
    if not DB_NAME_RE.match(db_name):
        raise ValueError(f"Nombre de base inválido: {db_name}")
    return db_name


def _admin_engine() -> Engine:
    s = get_settings()
    if s.schema_mode:
        return create_engine(s.pg_server_url, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    return create_engine(f"{s.pg_server_url.rstrip('/')}/postgres", isolation_level="AUTOCOMMIT", poolclass=NullPool)


def database_exists(db_name: str) -> bool:
    s = get_settings()
    if s.db_engine == "sqlite":
        return (s.data_dir / ("erps" if db_name != s.factory_db_name else "") / f"{db_name}.db").exists()
    admin = _admin_engine()
    try:
        with admin.connect() as c:
            if s.schema_mode:
                q = "SELECT 1 FROM information_schema.schemata WHERE schema_name=:n"
            else:
                q = "SELECT 1 FROM pg_database WHERE datname=:n"
            return c.execute(text(q), {"n": db_name}).scalar() is not None
    finally:
        admin.dispose()


def create_database(db_name: str) -> None:
    s = get_settings()
    if db_name != s.factory_db_name:
        validate_db_name(db_name)
    if s.db_engine == "sqlite":
        return  # el archivo se crea al conectar
    admin = _admin_engine()
    try:
        with admin.connect() as c:
            if s.schema_mode:  # nombre validado por regex
                c.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{db_name}"'))
            elif not c.execute(text("SELECT 1 FROM pg_database WHERE datname=:n"), {"n": db_name}).scalar():
                c.execute(text(f'CREATE DATABASE "{db_name}" ENCODING \'UTF8\''))
    finally:
        admin.dispose()


def _alembic_cfg(kind: str) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS / kind))
    return cfg


def migrate(db_name: str, kind: str) -> str:
    """Aplica migraciones pendientes (solo upgrade). Con PostgreSQL usa un bloqueo para que
    dos instancias que arrancan a la vez no migren la misma base simultáneamente."""
    eng = engine_for(db_name)
    cfg = _alembic_cfg(kind)
    with eng.begin() as conn:
        if conn.dialect.name == "postgresql":
            conn.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": "lombana:" + db_name})
        cfg.attributes["connection"] = conn
        cfg.attributes["schema"] = _schema(db_name)
        command.upgrade(cfg, "head")
    return current_revision(db_name)


def current_revision(db_name: str) -> str | None:
    with engine_for(db_name).connect() as conn:
        opts = {"version_table_schema": _schema(db_name)} if _schema(db_name) else {}
        return MigrationContext.configure(conn, opts=opts).get_current_revision()


def head_revision(kind: str) -> str | None:
    return ScriptDirectory.from_config(_alembic_cfg(kind)).get_current_head()


def factory_session() -> Session:
    return sessionmaker(engine_for(get_settings().factory_db_name), expire_on_commit=False)()


def tenant_session(db_name: str) -> Session:
    # expire_on_commit=True: tras confirmar, los valores se releen de la base (formato monetario uniforme)
    return sessionmaker(engine_for(validate_db_name(db_name)), expire_on_commit=True)()


def init_factory() -> None:
    s = get_settings()
    create_database(s.factory_db_name)
    migrate(s.factory_db_name, "factory")


def drop_database(db_name: str) -> None:
    """Solo se usa para revertir una creación fallida (base recién creada y vacía)."""
    validate_db_name(db_name)
    s = get_settings()
    with _lock:
        e = _engines.pop(db_name, None)
        if e and not s.schema_mode:
            e.dispose()
    if s.db_engine == "sqlite":
        for suffix in ("", "-wal", "-shm"):
            p = s.data_dir / "erps" / f"{db_name}.db{suffix}"
            if p.exists():
                p.unlink()
        return
    admin = _admin_engine()
    try:
        with admin.connect() as c:
            if s.schema_mode:
                c.execute(text(f'DROP SCHEMA IF EXISTS "{db_name}" CASCADE'))
            else:
                c.execute(text(f'DROP DATABASE IF EXISTS "{db_name}"'))
    finally:
        admin.dispose()


# ----------------------------------------------------------------- respaldos
def _metadata(kind: str):
    return (FactoryBase if kind == "factory" else TenantBase).metadata


def _tables(kind: str):
    return [t for t in _metadata(kind).sorted_tables if t.name not in SKIP_BACKUP_TABLES]


def _ser(v):
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def _deser(col, v):
    if v is None:
        return None
    if isinstance(col.type, (DateTime, UTCDateTime)):
        return datetime.fromisoformat(v)
    if isinstance(col.type, Date):
        return date.fromisoformat(v)
    if isinstance(col.type, Money):
        return Decimal(v)
    return v


def _store(db_name: str, file_name: str, data: bytes) -> None:
    s = get_settings()
    if s.backup_storage == "db":
        with factory_session() as f:
            f.add(BackupFile(db_name=db_name, file_name=file_name, size=len(data), content=data))
            f.commit()
        return
    out_dir = s.backups_dir / db_name
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / file_name).write_bytes(data)


def _load(db_name: str, file_name: str) -> bytes:
    s = get_settings()
    if s.backup_storage == "db":
        with factory_session() as f:
            row = f.scalar(select(BackupFile).where(BackupFile.db_name == db_name, BackupFile.file_name == file_name))
            if not row:
                raise FileNotFoundError(file_name)
            return row.content
    path = s.backups_dir / db_name / file_name
    if not path.exists():
        raise FileNotFoundError(file_name)
    return path.read_bytes()


def backup(db_name: str, kind: str) -> Path:
    """Respaldo lógico portable: todas las tablas + revisión de esquema. Devuelve el nombre (como Path)."""
    eng = engine_for(db_name)
    payload = {"db_name": db_name, "kind": kind, "engine": eng.dialect.name,
               "revision": current_revision(db_name),
               "created_at": datetime.now(timezone.utc).isoformat(), "tables": {}}
    with eng.connect() as conn:
        for table in _tables(kind):
            rows = conn.execute(select(table)).mappings().all()
            payload["tables"][table.name] = [{k: _ser(v) for k, v in r.items()} for r in rows]
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
        gz.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    name = f"{db_name}_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}.json.gz"
    _store(db_name, name, buf.getvalue())
    return Path(name)


def list_backups(db_name: str) -> list[dict]:
    s = get_settings()
    if s.backup_storage == "db":
        with factory_session() as f:
            rows = f.execute(select(BackupFile.file_name, BackupFile.size, BackupFile.created_at)
                             .where(BackupFile.db_name == db_name).order_by(BackupFile.id.desc())).all()
        return [{"file": r[0], "size": r[1], "created_at": r[2].isoformat()} for r in rows]
    d = s.backups_dir / db_name
    if not d.exists():
        return []
    return [{"file": p.name, "size": p.stat().st_size,
             "created_at": datetime.fromtimestamp(p.stat().st_mtime).isoformat()}
            for p in sorted(d.glob("*.json.gz"), reverse=True)]


def restore(db_name: str, kind: str, file_name: str) -> dict:
    """Restaura un respaldo. Antes crea un respaldo de seguridad del estado actual.
    Todo ocurre en una transacción: si algo falla, la base queda como estaba."""
    if "/" in file_name or "\\" in file_name or not file_name.endswith(".json.gz"):
        raise ValueError("Archivo de respaldo inválido")
    payload = json.loads(gzip.decompress(_load(db_name, file_name)).decode("utf-8"))
    if payload.get("db_name") != db_name or payload.get("kind") != kind:
        raise ValueError("El respaldo no pertenece a esta base de datos")
    if payload.get("revision") != current_revision(db_name):
        raise ValueError("La versión de esquema del respaldo no coincide con la base actual")
    safety = backup(db_name, kind)
    tables = _tables(kind)
    eng = engine_for(db_name)
    counts = {}
    with eng.begin() as conn:
        for table in reversed(tables):
            conn.execute(table.delete())
        for table in tables:
            rows = payload["tables"].get(table.name, [])
            if rows:
                cols = {c.name: c for c in table.columns}
                conn.execute(table.insert(), [{k: _deser(cols[k], v) for k, v in r.items() if k in cols} for r in rows])
            counts[table.name] = len(rows)
        if eng.dialect.name == "postgresql":
            sch = _schema(db_name)
            for table in tables:
                if "id" in table.columns and len(table.primary_key.columns) == 1:
                    qual = f'"{sch}"."{table.name}"' if sch else f'"{table.name}"'
                    conn.execute(text(
                        f"SELECT setval(pg_get_serial_sequence('{qual}','id'), "
                        f"COALESCE((SELECT MAX(id) FROM {qual}),0)+1, false)"))
    return {"restored": counts, "safety_backup": safety.name}


def table_counts(db_name: str, kind: str) -> dict[str, int]:
    eng = engine_for(db_name)
    existing = set(inspect(eng).get_table_names(schema=_schema(db_name)))
    with eng.connect() as conn:
        return {t.name: conn.execute(select(func.count()).select_from(t)).scalar_one()
                for t in _tables(kind) if t.name in existing}
