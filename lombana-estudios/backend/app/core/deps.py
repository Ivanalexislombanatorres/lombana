"""Dependencias de FastAPI: sesiones, autenticación, permisos y auditoría."""
from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..database import manager
from ..factory.models import FactoryAudit, FactoryUser, LoginAttempt
from .config import get_settings
from .security import decode_token

bearer = HTTPBearer(auto_error=False)


def factory_db() -> Iterator[Session]:
    s = manager.factory_session()
    try:
        yield s
    finally:
        s.close()


def _payload(creds: HTTPAuthorizationCredentials | None) -> dict:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión requerida")
    try:
        return decode_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "La sesión expiró, inicia sesión de nuevo") from None
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido") from None


def current_factory_user(creds=Depends(bearer), db: Session = Depends(factory_db)) -> FactoryUser:
    p = _payload(creds)
    if p.get("scope") != "factory":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Este token no pertenece a la fábrica")
    user = db.get(FactoryUser, int(p["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario inactivo")
    return user


def audit(db: Session, actor: str, action: str, entity: str, entity_id=None, detail: dict | None = None) -> None:
    db.add(FactoryAudit(actor=actor, action=action, entity=entity,
                        entity_id=str(entity_id) if entity_id is not None else None, detail=detail or {}))


class LoginLimiter:
    """Bloquea temporalmente tras varios intentos fallidos (por ámbito + usuario + IP).
    Los intentos se guardan en la base central para que el bloqueo funcione aunque
    el servidor tenga varias instancias (nube)."""

    def __init__(self, max_attempts: int = 5, window: int = 300):
        self.max, self.window = max_attempts, window

    def _key(self, request: Request, scope: str, user: str) -> str:
        ip = request.client.host if request.client else "?"
        if get_settings().trust_proxy:
            fwd = request.headers.get("x-forwarded-for", "")
            if fwd:
                ip = fwd.split(",")[0].strip()
        return f"{scope}|{user.lower().strip()}|{ip}"[:300]

    def check(self, request: Request, scope: str, user: str) -> None:
        since = datetime.now(timezone.utc) - timedelta(seconds=self.window)
        with manager.factory_session() as db:
            n = db.scalar(select(func.count(LoginAttempt.id)).where(
                LoginAttempt.key == self._key(request, scope, user), LoginAttempt.created_at >= since))
        if n >= self.max:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                                "Demasiados intentos fallidos. Espera 5 minutos e inténtalo de nuevo.")

    def fail(self, request: Request, scope: str, user: str) -> None:
        with manager.factory_session() as db:
            db.add(LoginAttempt(key=self._key(request, scope, user)))
            # limpieza de intentos viejos
            db.execute(delete(LoginAttempt).where(
                LoginAttempt.created_at < datetime.now(timezone.utc) - timedelta(days=1)))
            db.commit()

    def ok(self, request: Request, scope: str, user: str) -> None:
        with manager.factory_session() as db:
            db.execute(delete(LoginAttempt).where(LoginAttempt.key == self._key(request, scope, user)))
            db.commit()

    def clear(self) -> None:  # usado por las pruebas
        with manager.factory_session() as db:
            db.execute(delete(LoginAttempt))
            db.commit()


limiter = LoginLimiter()
