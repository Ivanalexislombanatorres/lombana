"""Herramientas de administración por línea de comandos.

    python scripts/admin.py respaldar     → respalda la base central y todos los ERP
    python scripts/admin.py migrar        → respalda y aplica migraciones pendientes (nunca borra datos)
    python scripts/admin.py estado        → muestra cada base, su versión de esquema y respaldos
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import select  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.database import manager  # noqa: E402
from app.factory.models import ErpProject  # noqa: E402


def erps():
    with manager.factory_session() as db:
        return [(e.name, e.db_name) for e in db.scalars(select(ErpProject))]


def respaldar():
    s = get_settings()
    manager.init_factory()
    print("Fábrica  →", manager.backup(s.factory_db_name, "factory").name)
    for name, db in erps():
        try:
            print(f"{name:20} →", manager.backup(db, "tenant").name)
        except Exception as e:  # una base dañada no detiene el resto
            print(f"{name:20} → ERROR: {e}")


def migrar():
    s = get_settings()
    if manager.database_exists(s.factory_db_name):
        manager.backup(s.factory_db_name, "factory")
    manager.init_factory()
    print("Fábrica:", manager.current_revision(s.factory_db_name))
    head = manager.head_revision("tenant")
    for name, db in erps():
        if manager.current_revision(db) != head:
            manager.backup(db, "tenant")
            print(f"{name}: migrado a", manager.migrate(db, "tenant"))
        else:
            print(f"{name}: al día ({head})")


def estado():
    s = get_settings()
    manager.init_factory()
    print("Motor:", s.db_engine, "| Datos:", s.data_dir, "| Respaldos:", s.backups_dir)
    print(f"{s.factory_db_name:24} {manager.current_revision(s.factory_db_name)}  respaldos={len(manager.list_backups(s.factory_db_name))}")
    for name, db in erps():
        print(f"{db:24} {manager.current_revision(db)}  respaldos={len(manager.list_backups(db))}  ({name})")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "estado"
    {"respaldar": respaldar, "migrar": migrar, "estado": estado}.get(cmd, estado)()
