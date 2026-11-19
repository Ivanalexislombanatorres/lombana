"""Configuración central de LOMBANA ESTUDIOS.

Todo se lee de variables de entorno (archivo .env opcional en la raíz).
No hay claves escritas en el código: los secretos se generan en el primer
arranque y se guardan en data/secret.key (fuera del control de versiones).
"""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[3]  # .../lombana-estudios


def _load_dotenv() -> None:
    env_file = ROOT_DIR / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()


def _data_dir() -> Path:
    d = Path(os.environ.get("LOMBANA_DATA_DIR", ROOT_DIR / "data"))
    d.mkdir(parents=True, exist_ok=True)
    (d / "erps").mkdir(exist_ok=True)
    return d


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "si", "sí", "yes")


def _normalize_pg(url: str) -> str:
    """Acepta la cadena que copia Supabase o la que inyecta la integración Supabase de Vercel
    (POSTGRES_URL, con parámetros extra como `supa=`) y la adapta al controlador psycopg2."""
    from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
    url = url.strip()
    if not url:
        return url
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            url = "postgresql+psycopg2://" + url[len(prefix):]
            break
    parts = urlsplit(url)
    allowed = {"sslmode", "connect_timeout", "application_name", "options", "sslrootcert"}
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query) if k in allowed])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def _pg_url_env() -> str:
    # LOMBANA_PG_URL manda; si no existe, se usa la que crea la integración Supabase de Vercel
    return os.environ.get("LOMBANA_PG_URL") or os.environ.get("POSTGRES_URL") or ""


def _secret(data_dir: Path) -> str:
    env = os.environ.get("LOMBANA_SECRET_KEY")
    if env:
        if len(env) < 32:
            raise ValueError("LOMBANA_SECRET_KEY debe tener al menos 32 caracteres")
        return env
    jwt_secret = os.environ.get("SUPABASE_JWT_SECRET", "")
    if _flag("LOMBANA_SERVERLESS") and len(jwt_secret) >= 32:
        # Integración Supabase de Vercel: clave maestra estable derivada de un secreto que ya existe
        import hashlib
        return hashlib.sha256(("lombana-estudios:" + jwt_secret).encode()).hexdigest()
    if _flag("LOMBANA_SERVERLESS"):
        # En la nube el disco es temporal: una clave generada se perdería en cada arranque
        raise ValueError("En modo nube debes definir LOMBANA_SECRET_KEY (mínimo 32 caracteres)")
    f = data_dir / "secret.key"
    if not f.exists():
        f.write_text(secrets.token_urlsafe(48), encoding="utf-8")
        try:
            os.chmod(f, 0o600)
        except OSError:
            pass
    return f.read_text(encoding="utf-8").strip()


@dataclass
class Settings:
    data_dir: Path = field(default_factory=_data_dir)
    # Motor: "sqlite" (local, un usuario) o "postgresql"
    db_engine: str = field(default_factory=lambda: os.environ.get("LOMBANA_DB_ENGINE", "sqlite").lower())
    # Solo PostgreSQL: servidor sin nombre de base, ej. postgresql+psycopg2://user:pass@localhost:5432
    pg_server_url: str = field(default_factory=lambda: _normalize_pg(_pg_url_env()))
    # Aislamiento en PostgreSQL: "database" (una base por ERP) o "schema" (un esquema por ERP en una sola base:
    # necesario en Supabase y otros servicios administrados). En modo schema LOMBANA_PG_URL incluye el nombre de la base.
    pg_isolation: str = field(default_factory=lambda: os.environ.get("LOMBANA_PG_ISOLATION", "database").lower())
    serverless: bool = field(default_factory=lambda: _flag("LOMBANA_SERVERLESS"))
    # Dónde guardar respaldos: "files" (carpeta backups) o "db" (tabla en la base central; para la nube)
    backup_storage: str = field(default_factory=lambda: os.environ.get("LOMBANA_BACKUP_STORAGE", "files").lower())
    trust_proxy: bool = field(default_factory=lambda: _flag("LOMBANA_TRUST_PROXY"))
    factory_db_name: str = "lombana_factory"
    backups_dir: Path = field(default_factory=lambda: Path(os.environ.get("LOMBANA_BACKUPS_DIR", ROOT_DIR / "backups")))
    templates_dir: Path = ROOT_DIR / "templates" / "sectores"
    frontend_dist: Path = ROOT_DIR / "frontend" / "dist"
    token_minutes: int = int(os.environ.get("LOMBANA_TOKEN_MINUTES", "480"))
    secret_key: str = ""

    def __post_init__(self) -> None:
        self.secret_key = _secret(self.data_dir)
        if self.backup_storage == "files":
            self.backups_dir.mkdir(parents=True, exist_ok=True)
        if self.db_engine not in ("sqlite", "postgresql"):
            raise ValueError("LOMBANA_DB_ENGINE debe ser 'sqlite' o 'postgresql'")
        if self.db_engine == "postgresql" and not self.pg_server_url:
            raise ValueError("Con PostgreSQL debes definir LOMBANA_PG_URL")
        if self.pg_isolation not in ("database", "schema"):
            raise ValueError("LOMBANA_PG_ISOLATION debe ser 'database' o 'schema'")
        if self.backup_storage not in ("files", "db"):
            raise ValueError("LOMBANA_BACKUP_STORAGE debe ser 'files' o 'db'")
        if self.serverless and self.db_engine != "postgresql":
            raise ValueError("En modo nube se requiere PostgreSQL (LOMBANA_DB_ENGINE=postgresql)")

    @property
    def schema_mode(self) -> bool:
        return self.db_engine == "postgresql" and self.pg_isolation == "schema"

    def db_url(self, db_name: str) -> str:
        if self.db_engine == "sqlite":
            if db_name == self.factory_db_name:
                return f"sqlite:///{(self.data_dir / (db_name + '.db')).as_posix()}"
            return f"sqlite:///{(self.data_dir / 'erps' / (db_name + '.db')).as_posix()}"
        if self.schema_mode:
            return self.pg_server_url  # una sola base; el ERP se aísla por esquema
        return f"{self.pg_server_url.rstrip('/')}/{db_name}"


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings() -> None:
    """Usado por las pruebas para recargar la configuración."""
    global _settings
    _settings = None
