-- Imita Supabase solo para pruebas: en producción estos roles y el esquema `auth`
-- los pone Supabase. Acá solo existe lo mínimo para que las migraciones y las
-- políticas RLS se puedan aplicar y probar en un Postgres común.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;

create table auth.users (
  id uuid primary key,
  email text
);

-- Igual que Supabase: el usuario sale del claim "sub" del JWT, que PostgREST deja
-- en esta variable de sesión. Las pruebas la fijan con set_config(...).
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
