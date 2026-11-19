from alembic import context
from app.factory.models import FactoryBase

target_metadata = FactoryBase.metadata
connection = context.config.attributes["connection"]
# Modo nube (un esquema por ERP): la tabla de versiones vive dentro del esquema del ERP y la
# conexión ya trae schema_translate_map, de modo que las tablas se crean en ese esquema.
schema = context.config.attributes.get("schema")
context.configure(connection=connection, target_metadata=target_metadata,
                  render_as_batch=connection.dialect.name == "sqlite", compare_type=True,
                  version_table_schema=schema)
with context.begin_transaction():
    context.run_migrations()
