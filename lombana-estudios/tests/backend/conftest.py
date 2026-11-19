import os
import sys
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """App con datos aislados. Si LOMBANA_TEST_PG está definida, usa PostgreSQL real."""
    from fastapi.testclient import TestClient
    from app.core import config
    from app.database import manager
    from app.erp_generator import catalog

    monkeypatch.setenv("LOMBANA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("LOMBANA_BACKUPS_DIR", str(tmp_path / "backups"))
    for var in ("LOMBANA_SETUP_CODE", "LOMBANA_PG_ISOLATION", "LOMBANA_BACKUP_STORAGE", "LOMBANA_SERVERLESS", "LOMBANA_SECRET_KEY"):
        monkeypatch.delenv(var, raising=False)
    pg = os.environ.get("LOMBANA_TEST_PG")
    schema_mode = os.environ.get("LOMBANA_TEST_SCHEMA") == "1"  # simula la nube (Supabase): un esquema por ERP
    if pg:
        monkeypatch.setenv("LOMBANA_DB_ENGINE", "postgresql")
        if schema_mode:
            test_db = "lt_" + uuid.uuid4().hex[:10]
            from sqlalchemy import create_engine, text
            adm = create_engine(f"{pg}/postgres", isolation_level="AUTOCOMMIT")
            with adm.connect() as conn:
                conn.execute(text(f'CREATE DATABASE "{test_db}"'))
            adm.dispose()
            monkeypatch.setenv("LOMBANA_PG_ISOLATION", "schema")
            monkeypatch.setenv("LOMBANA_PG_URL", f"{pg}/{test_db}")
            monkeypatch.setenv("LOMBANA_BACKUP_STORAGE", "db")
            monkeypatch.setenv("LOMBANA_SERVERLESS", "1")
            monkeypatch.setenv("LOMBANA_SECRET_KEY", "prueba-" + "x" * 40)
            monkeypatch.setenv("LOMBANA_SETUP_CODE", "codigo-de-prueba")
        else:
            monkeypatch.setenv("LOMBANA_PG_URL", pg)
    else:
        monkeypatch.setenv("LOMBANA_DB_ENGINE", "sqlite")
    manager.dispose_all()
    config.reset_settings()
    catalog.sectors.cache_clear()
    s = config.get_settings()
    if pg and not schema_mode:  # nombre de base central único por prueba
        s.factory_db_name = "lf_" + uuid.uuid4().hex[:10]
    from app.main import create_app
    with TestClient(create_app()) as c:
        yield c
    manager.dispose_all()
    if pg and schema_mode:
        from sqlalchemy import create_engine, text
        admin = create_engine(f"{pg}/postgres", isolation_level="AUTOCOMMIT")
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{test_db}" WITH (FORCE)'))
        admin.dispose()
    elif pg:
        from sqlalchemy import create_engine, text
        admin = create_engine(f"{pg}/postgres", isolation_level="AUTOCOMMIT")
        with admin.connect() as conn:
            for (name,) in conn.execute(text("SELECT datname FROM pg_database WHERE datname LIKE 'erp_%' OR datname = :f"),
                                        {"f": s.factory_db_name}):
                conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()
    config.reset_settings()


@pytest.fixture()
def admin(client):
    r = client.post("/api/auth/setup", json={"name": "Admin", "email": "admin@lombana.co", "password": "Clave-Segura-1",
                                                "setup_code": os.environ.get("LOMBANA_SETUP_CODE")})
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return client


def make_erp(c, name="Barbería Pro", sector="barberia", password="Admin-12345", **kw):
    body = {"name": name, "sector": sector, "company": {"name": name, "currency": "COP"},
            "admin_user": "admin", "admin_password": password, **kw}
    r = c.post("/api/erps", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def rt_login(c, slug, user="admin", password="Admin-12345"):
    r = c.post(f"/api/rt/{slug}/login", json={"username": user, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}
