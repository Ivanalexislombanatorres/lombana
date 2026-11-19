"""Punto de entrada de LOMBANA ESTUDIOS (monolito modular)."""
from __future__ import annotations

from contextlib import asynccontextmanager
from decimal import Decimal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from .ai_gateway.api import router as ai_router
from .core.config import get_settings
from .database import manager
from .erp_runtime.api import router as rt_router
from .factory.api import router as factory_router
from .factory.models import Plan
from .formulas.api import router as formulas_router

VERSION = "1.0.0"


def _seed_plans() -> None:
    with manager.factory_session() as db:
        if db.scalar(select(Plan.id).limit(1)):
            return
        db.add_all([
            Plan(code="basico", name="Básico", price_monthly=Decimal("29"), max_users=3, max_storage_mb=500, max_modules=6),
            Plan(code="profesional", name="Profesional", price_monthly=Decimal("59"), max_users=10, max_storage_mb=2000, max_modules=12),
            Plan(code="empresarial", name="Empresarial", price_monthly=Decimal("119"), max_users=50, max_storage_mb=10000, max_modules=30),
        ])
        db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    manager.init_factory()
    _seed_plans()
    yield
    manager.dispose_all()


def create_app() -> FastAPI:
    app = FastAPI(title="LOMBANA ESTUDIOS — Fábrica Inteligente de ERP", version=VERSION, lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        msgs = []
        for e in exc.errors():
            loc = ".".join(str(x) for x in e["loc"] if x not in ("body", "query", "path"))
            msgs.append(f"{loc}: {e['msg']}" if loc else e["msg"])
        return JSONResponse({"detail": "; ".join(msgs)}, status_code=422)

    @app.middleware("http")
    async def _security_headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api"):
            resp.headers["Cache-Control"] = "no-store"
        if get_settings().serverless:  # en la nube siempre hay HTTPS
            resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return resp

    for r in (factory_router, rt_router, ai_router, formulas_router):
        app.include_router(r)

    dist = get_settings().frontend_dist
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa(full_path: str):
            if full_path.startswith("api/"):
                return JSONResponse({"detail": "No encontrado"}, status_code=404)
            f = (dist / full_path).resolve()
            if full_path and f.is_file() and dist.resolve() in f.parents:
                return FileResponse(f)
            return FileResponse(dist / "index.html")
    return app


app = create_app()
