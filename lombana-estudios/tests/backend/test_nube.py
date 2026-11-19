"""Pruebas del modo nube (Supabase/Vercel). Las de esquemas requieren LOMBANA_TEST_SCHEMA=1 y PostgreSQL."""
import os

import pytest
from conftest import make_erp, rt_login

SCHEMA = os.environ.get("LOMBANA_TEST_SCHEMA") == "1" and os.environ.get("LOMBANA_TEST_PG")


def test_nube_exige_clave_maestra(monkeypatch):
    from app.core import config
    monkeypatch.setenv("LOMBANA_SERVERLESS", "1")
    monkeypatch.delenv("LOMBANA_SECRET_KEY", raising=False)
    config.reset_settings()
    with pytest.raises(ValueError, match="LOMBANA_SECRET_KEY"):
        config.get_settings()
    monkeypatch.setenv("LOMBANA_SECRET_KEY", "corta")
    config.reset_settings()
    with pytest.raises(ValueError, match="32"):
        config.get_settings()
    config.reset_settings()


def test_cadena_de_supabase_se_normaliza():
    from app.core.config import _normalize_pg
    assert _normalize_pg("postgresql://u:p@h:6543/postgres") == "postgresql+psycopg2://u:p@h:6543/postgres"
    assert _normalize_pg("postgres://u:p@h/db") == "postgresql+psycopg2://u:p@h/db"


@pytest.mark.skipif(not SCHEMA, reason="requiere PostgreSQL en modo esquema")
def test_cada_erp_en_su_propio_esquema(admin):
    from sqlalchemy import text
    from app.database import manager
    a = make_erp(admin, "Barbería Uno")
    b = make_erp(admin, "Barbería Dos")
    h = rt_login(admin, a["slug"])
    admin.post(f"/api/rt/{a['slug']}/customers", json={"name": "Solo en A"}, headers=h)
    eng = manager._engines["__base__"]
    with eng.connect() as c:
        tabs = c.execute(text("select table_schema, count(*) from information_schema.tables "
                              "where table_schema in ('public','lombana_factory','erp_barberia_001','erp_barberia_002') "
                              "group by 1")).all()
        nombres_a = c.execute(text('select name from "erp_barberia_001".customers')).scalars().all()
        nombres_b = c.execute(text('select name from "erp_barberia_002".customers')).scalars().all()
        backups = c.execute(text('select count(*) from "lombana_factory".backup_files')).scalar()
    tabs = dict(tabs)
    assert "public" not in tabs  # nada queda expuesto en el esquema público de Supabase
    assert tabs["erp_barberia_001"] == tabs["erp_barberia_002"] >= 11
    assert nombres_a == ["Solo en A"] and nombres_b == []
    admin.post(f"/api/erps/{b['id']}/backups")
    with eng.connect() as c:
        assert c.execute(text('select count(*) from "lombana_factory".backup_files')).scalar() == backups + 1


def test_codigo_de_instalacion(client, monkeypatch):
    monkeypatch.setenv("LOMBANA_SETUP_CODE", "codigo-secreto-123")
    assert client.get("/api/auth/setup-status").json()["requires_code"] is True
    body = {"name": "Ana", "email": "a@b.co", "password": "Clave-Segura-1"}
    assert client.post("/api/auth/setup", json=body).status_code == 403
    assert client.post("/api/auth/setup", json={**body, "setup_code": "otro"}).status_code == 403
    assert client.post("/api/auth/setup", json={**body, "setup_code": "codigo-secreto-123"}).status_code == 200


def test_integracion_supabase_de_vercel(monkeypatch):
    from app.core import config
    for v in ("LOMBANA_PG_URL", "LOMBANA_SECRET_KEY"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("LOMBANA_SERVERLESS", "1")
    monkeypatch.setenv("LOMBANA_DB_ENGINE", "postgresql")
    monkeypatch.setenv("POSTGRES_URL", "postgres://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "j" * 40)
    config.reset_settings()
    s = config.get_settings()
    assert s.pg_server_url == "postgresql+psycopg2://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require"
    k1 = s.secret_key
    config.reset_settings()
    assert config.get_settings().secret_key == k1 and len(k1) == 64  # estable entre arranques
    config.reset_settings()
