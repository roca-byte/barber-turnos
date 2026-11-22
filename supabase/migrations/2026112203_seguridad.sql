-- Seguridad: claves compuestas, RLS y datos públicos de la barbería.
-- Regla de oro: un barbero (usuario) solo toca filas de SUS barberías; el público
-- anónimo no lee ninguna tabla y entra solo por las funciones RPC de public.

-- ---------- 1. Claves compuestas ----------
-- Con FK simples, un turno de la barbería A podría apuntar a un barbero de B (el
-- barberia_id del hijo y el del padre no se comparan). Con (barberia_id, id) la base
-- lo rechaza aunque falle el código o una política.
alter table barberos add constraint barberos_barberia_id_key unique (barberia_id, id);
alter table servicios add constraint servicios_barberia_id_key unique (barberia_id, id);
alter table clientes add constraint clientes_barberia_id_key unique (barberia_id, id);

alter table horarios drop constraint horarios_barbero_id_fkey;
alter table horarios add constraint horarios_barbero_fk
  foreign key (barberia_id, barbero_id) references barberos (barberia_id, id) on delete cascade;

alter table bloqueos drop constraint bloqueos_barbero_id_fkey;
alter table bloqueos add constraint bloqueos_barbero_fk
  foreign key (barberia_id, barbero_id) references barberos (barberia_id, id) on delete cascade;

alter table turnos drop constraint turnos_barbero_id_fkey;
alter table turnos drop constraint turnos_servicio_id_fkey;
alter table turnos drop constraint turnos_cliente_id_fkey;
alter table turnos add constraint turnos_barbero_fk
  foreign key (barberia_id, barbero_id) references barberos (barberia_id, id) on delete cascade;
alter table turnos add constraint turnos_servicio_fk
  foreign key (barberia_id, servicio_id) references servicios (barberia_id, id);
-- cliente_id puede ser null (turno manual): con MATCH SIMPLE una FK con alguna columna
-- nula no se verifica, y ahí no hay cliente que cruzar.
alter table turnos add constraint turnos_cliente_fk
  foreign key (barberia_id, cliente_id) references clientes (barberia_id, id);

-- ---------- 2. Token independiente del search_path ----------
-- gen_random_bytes vive en public (local) o en `extensions` (Supabase): un default que
-- lo nombre sin esquema se rompe según quién inserte. gen_random_uuid() es del núcleo
-- de Postgres (pg_catalog), sin extensión ni esquema. Dos uuid v4 = 64 hex, más de
-- 240 bits aleatorios: imposible de adivinar.
alter table turnos alter column token set default
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

-- ---------- 3. Permisos de funciones ----------
-- Postgres da execute a PUBLIC en toda función nueva. Las de app son internas: nadie
-- de afuera las llama; solo las usan las políticas y las funciones security definer.
revoke execute on all functions in schema app from public;
alter default privileges in schema app revoke execute on functions from public;

-- ---------- 4. Membresía ----------
-- security definer: lee `miembros` sin pasar por su propia RLS (que si no, se mordería
-- la cola desde las políticas de las otras tablas). search_path fijo: evita que alguien
-- cree un objeto homónimo en su esquema y lo secuestre.
create or replace function app.es_miembro(p_barberia uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from public.miembros m
    where m.barberia_id = p_barberia and m.user_id = auth.uid()
  )
$$;
revoke execute on function app.es_miembro(uuid) from public;
-- Las políticas se evalúan con los permisos de quien consulta: necesita usage sobre el
-- esquema y execute sobre esta función (y solo esta). anon no: no tiene políticas.
grant usage on schema app to authenticated;
grant execute on function app.es_miembro(uuid) to authenticated;

-- ---------- 5. RLS ----------
alter table barberias enable row level security;
alter table barberos enable row level security;
alter table miembros enable row level security;
alter table servicios enable row level security;
alter table horarios enable row level security;
alter table bloqueos enable row level security;
alter table clientes enable row level security;
alter table turnos enable row level security;
alter table push_suscripciones enable row level security;

-- Tablas de la barbería: el miembro hace todo, pero solo dentro de la suya.
-- `using` filtra lo que ve/toca; `with check` impide insertar o mover filas a otra.
create policy miembro_todo on barberos for all to authenticated
  using (app.es_miembro(barberia_id)) with check (app.es_miembro(barberia_id));
create policy miembro_todo on servicios for all to authenticated
  using (app.es_miembro(barberia_id)) with check (app.es_miembro(barberia_id));
create policy miembro_todo on horarios for all to authenticated
  using (app.es_miembro(barberia_id)) with check (app.es_miembro(barberia_id));
create policy miembro_todo on bloqueos for all to authenticated
  using (app.es_miembro(barberia_id)) with check (app.es_miembro(barberia_id));
create policy miembro_todo on clientes for all to authenticated
  using (app.es_miembro(barberia_id)) with check (app.es_miembro(barberia_id));
create policy miembro_todo on turnos for all to authenticated
  using (app.es_miembro(barberia_id)) with check (app.es_miembro(barberia_id));

-- Las suscripciones push son además personales.
create policy propia_todo on push_suscripciones for all to authenticated
  using (user_id = auth.uid() and app.es_miembro(barberia_id))
  with check (user_id = auth.uid() and app.es_miembro(barberia_id));

-- La barbería: ver y editar la propia. Crearla/borrarla es cosa del alta (service_role).
create policy miembro_ver on barberias for select to authenticated
  using (app.es_miembro(id));
create policy miembro_editar on barberias for update to authenticated
  using (app.es_miembro(id)) with check (app.es_miembro(id));

-- miembros: cada uno ve solo sus filas; altas y bajas solo con service_role.
create policy ver_propio on miembros for select to authenticated
  using (user_id = auth.uid());

-- Cinturón y tirantes: aunque una política se rompa, estos permisos no existen.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
revoke insert, delete on barberias from authenticated;
revoke insert, update, delete on miembros from authenticated;

-- ---------- 6. Datos públicos de la barbería ----------
-- Lo único que ve el público anónimo. security definer porque anon no lee tablas.
-- Devuelve solo lo necesario para mostrar y reservar (nunca ajustes internos ni plan).
create or replace function public.barberia_publica(p_slug text) returns json
language sql stable security definer set search_path = public, app as $$
  select json_build_object(
    'id', b.id, 'slug', b.slug, 'nombre', b.nombre, 'direccion', b.direccion,
    'whatsapp', b.whatsapp, 'zona_horaria', b.zona_horaria, 'codigo_area', b.codigo_area,
    'servicios', coalesce((
      select json_agg(json_build_object('id', s.id, 'nombre', s.nombre,
                                        'duracion_min', s.duracion_min, 'precio', s.precio)
                      order by s.orden, s.nombre)
      from public.servicios s where s.barberia_id = b.id and s.activo
    ), '[]'::json))
  from public.barberias b
  where b.slug = p_slug and b.activa
$$;
revoke execute on function public.barberia_publica(text) from public;
grant execute on function public.barberia_publica(text) to anon, authenticated;
