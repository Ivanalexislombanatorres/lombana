// Configuración de pruebas. Por defecto usa el Postgres local por socket;
// en CI se sobrescribe con variables de entorno.
export const APP_PASSWORD = process.env.LOMBANA_APP_DB_PASSWORD ?? 'dev_app_pw';

export function adminUrl(): string {
  return process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres@localhost/lombana_test?host=/tmp';
}

export function appUrl(): string {
  return (
    process.env.TEST_DATABASE_APP_URL ??
    `postgres://lombana_app:${encodeURIComponent(APP_PASSWORD)}@localhost/lombana_test?host=/tmp`
  );
}
