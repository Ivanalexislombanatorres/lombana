// Genera un único archivo SQL con todas las migraciones, para aplicarlas pegándolo en
// Supabase → SQL Editor cuando no se puede usar el workflow de GitHub Actions.
// Registra cada migración en schema_migrations con el mismo checksum que el migrador,
// así el migrador reconoce la base como migrada. Uso: npm run db:bundle > archivo.sql
import { loadMigrations } from './migrator.js';

const ms = await loadMigrations();
const lines = [
  `-- LOMBANA AI GLOBAL — base de datos completa (${ms[0]!.id} a ${ms.at(-1)!.id})`,
  '-- Pegar TODO en Supabase → SQL Editor → Run. Una sola transacción: si algo falla, no',
  '-- queda nada a medias. Solo para una base vacía (se niega a correr dos veces).',
  'begin;',
  `create table if not exists public.schema_migrations (
  id         text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
);`,
  `do $guard$ begin
  if exists (select 1 from public.schema_migrations) then
    raise exception 'La base ya tiene migraciones aplicadas: este archivo no se debe volver a ejecutar.';
  end if;
end $guard$;`,
];
for (const m of ms) {
  lines.push(`\n-- ================= ${m.id} =================\n${m.up}`);
  lines.push(`insert into public.schema_migrations (id, checksum) values ('${m.id}', '${m.checksum}');`);
}
lines.push('commit;');
lines.push(`select 'LISTO: ' || count(*) || ' migraciones aplicadas' as resultado from public.schema_migrations;`);
process.stdout.write(lines.join('\n') + '\n');
