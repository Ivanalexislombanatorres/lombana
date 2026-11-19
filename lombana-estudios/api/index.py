"""Punto de entrada de LOMBANA ESTUDIOS en Vercel (función Python serverless).

Valores por defecto del modo nube; se pueden sobrescribir con variables de entorno en Vercel.
Variables OBLIGATORIAS en Vercel:
  LOMBANA_PG_URL      cadena de conexión de Supabase (Transaction pooler, puerto 6543)
  LOMBANA_SECRET_KEY  clave maestra larga y aleatoria (mínimo 32 caracteres) — no la cambies después
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

for k, v in {
    "LOMBANA_SERVERLESS": "1",
    "LOMBANA_DB_ENGINE": "postgresql",
    "LOMBANA_PG_ISOLATION": "schema",   # Supabase entrega una sola base: un esquema por ERP
    "LOMBANA_BACKUP_STORAGE": "db",     # Vercel no tiene disco permanente
    "LOMBANA_DATA_DIR": "/tmp/lombana",
    "LOMBANA_TRUST_PROXY": "1",         # IP real del visitante desde la cabecera de Vercel
}.items():
    os.environ.setdefault(k, v)



def _build():
    try:
        from app.database import manager
        from app.main import _seed_plans, create_app

        manager.init_factory()   # migraciones con bloqueo: seguro aunque arranquen varias instancias
        _seed_plans()
        return create_app()
    except Exception as exc:  # configuración incompleta: mensaje claro en vez de un error 500 vacío
        from fastapi import FastAPI
        from fastapi.responses import JSONResponse

        msg = f"{type(exc).__name__}: {exc}"
        fallback = FastAPI()

        @fallback.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
        def _config_error(path: str):
            return JSONResponse(status_code=503, content={
                "detail": "LOMBANA ESTUDIOS no pudo iniciar en la nube. Revisa las variables de entorno en Vercel "
                          "(LOMBANA_PG_URL o la integración Supabase, LOMBANA_SECRET_KEY y LOMBANA_SETUP_CODE). Detalle: " + msg[:400]})
        return fallback


# Vercel detecta la función por esta asignación de nivel superior
app = _build()
