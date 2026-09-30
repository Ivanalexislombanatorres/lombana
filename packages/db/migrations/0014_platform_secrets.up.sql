-- 0014_platform_secrets — lectura controlada de secretos de integración desde Supabase Vault.
--
-- Alternativa a las variables de entorno del hosting: el secreto vive cifrado en Vault
-- (vault.secrets) y la aplicación solo puede leer los nombres de esta lista blanca, a
-- través de esta función. Si Vault no existe (desarrollo local) devuelve NULL.
-- La variable de entorno, si existe, siempre tiene prioridad (lo decide la aplicación).

create or replace function app.platform_secret(p_name text) returns text
language plpgsql stable security definer
set search_path = pg_catalog
as $$
declare
  v_secret text;
begin
  if p_name not in ('gemini_api_key') then
    raise exception 'Secreto no permitido' using errcode = 'insufficient_privilege';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 order by updated_at desc limit 1'
    into v_secret using p_name;
  return nullif(btrim(v_secret), '');
end
$$;

revoke execute on all functions in schema app from public;
grant execute on function app.platform_secret(text) to lombana_app;
