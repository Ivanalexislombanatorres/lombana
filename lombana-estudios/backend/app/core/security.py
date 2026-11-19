"""Seguridad: hash de contraseñas (bcrypt), tokens JWT y cifrado de secretos (Fernet)."""
from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    if len(password) < 8:
        raise ValueError("La contraseña debe tener al menos 8 caracteres")
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], hashed.encode())
    except ValueError:
        return False


def create_token(subject: str, scope: str, extra: dict | None = None) -> str:
    """scope = 'factory' o 'erp:<slug>' — un token de un ERP no sirve en otro."""
    s = get_settings()
    now = datetime.now(timezone.utc)
    payload = {"sub": subject, "scope": scope, "iat": now, "exp": now + timedelta(minutes=s.token_minutes)}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, s.secret_key, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, get_settings().secret_key, algorithms=[ALGORITHM])


def _fernet() -> Fernet:
    digest = hashlib.sha256(("fernet:" + get_settings().secret_key).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_secret(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as e:  # clave maestra cambiada
        raise ValueError("No se pudo descifrar el secreto (¿cambió data/secret.key?)") from e


def mask_secret(value: str) -> str:
    if len(value) <= 8:
        return "••••"
    return value[:3] + "••••" + value[-4:]
