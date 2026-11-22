-- Pruebas de seguridad: aislamiento entre barberías (RLS), permisos por rol y claves
-- compuestas. Cada archivo corre en su propia base, así que los datos no se limpian.
-- Los cambios de rol usan `set local` dentro de una transacción: al terminar (rollback)
-- se vuelve solo a postgres.

\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'

-- Datos de dos barberías (como postgres, que no está sujeto a RLS).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ua@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'ub@x.test');
insert into barberias (id, slug, nombre, direccion, whatsapp) values
  (:'A', 'aaa', 'Barbería A', 'Calle 1', '5491100000001'),
  (:'B', 'bbb', 'Barbería B', 'Calle 2', '5491100000002');
insert into miembros (user_id, barberia_id) values
  ('00000000-0000-0000-0000-0000000000a1', :'A'),
  ('00000000-0000-0000-0000-0000000000b1', :'B');
insert into barberos (id, barberia_id, nombre) values
  ('00000000-0000-0000-0000-0000000000a2', :'A', 'Barbero A'),
  ('00000000-0000-0000-0000-0000000000b2', :'B', 'Barbero B');
insert into servicios (id, barberia_id, nombre, duracion_min, precio, activo, orden) values
  ('00000000-0000-0000-0000-0000000000a3', :'A', 'Corte', 30, 1000, true, 2),
  ('00000000-0000-0000-0000-0000000000a4', :'A', 'Barba', 15, 500, true, 1),
  ('00000000-0000-0000-0000-0000000000a5', :'A', 'Viejo', 15, 500, false, 0),
  ('00000000-0000-0000-0000-0000000000b3', :'B', 'Corte B', 30, 900, true, 0);
insert into clientes (id, barberia_id, telefono, nombre) values
  ('00000000-0000-0000-0000-0000000000a6', :'A', '5491100000010', 'Cliente A'),
  ('00000000-0000-0000-0000-0000000000b6', :'B', '5491100000011', 'Cliente B');
insert into turnos (id, barberia_id, barbero_id, servicio_id, inicio, fin, origen, nombre_manual) values
  ('00000000-0000-0000-0000-0000000000a7', :'A', '00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-0000000000a3', '2026-12-01 10:00-03', '2026-12-01 10:30-03', 'manual', 'x'),
  ('00000000-0000-0000-0000-0000000000b7', :'B', '00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-0000000000b3', '2026-12-01 10:00-03', '2026-12-01 10:30-03', 'manual', 'y');
insert into horarios (barberia_id, barbero_id, dia_semana, desde, hasta) values
  (:'A', '00000000-0000-0000-0000-0000000000a2', 1, '09:00', '13:00'),
  (:'B', '00000000-0000-0000-0000-0000000000b2', 1, '09:00', '13:00');
insert into bloqueos (barberia_id, barbero_id, inicio, fin) values
  (:'A', '00000000-0000-0000-0000-0000000000a2', '2026-12-02 10:00-03', '2026-12-02 11:00-03'),
  (:'B', '00000000-0000-0000-0000-0000000000b2', '2026-12-02 10:00-03', '2026-12-02 11:00-03');
insert into push_suscripciones (user_id, barberia_id, endpoint, p256dh, auth) values
  ('00000000-0000-0000-0000-0000000000a1', :'A', 'https://p/a', 'k', 'k'),
  ('00000000-0000-0000-0000-0000000000b1', :'B', 'https://p/b', 'k', 'k');

-- RLS activado en todas las tablas de public (con las tablas de hoy y las que vengan).
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    raise exception 'la tabla % no tiene RLS activado', t;
  end loop;
end $$;

-- ---------- anon: ninguna tabla ----------
begin;
set local role anon;
do $$
declare t text; n bigint;
begin
  foreach t in array array['barberias','barberos','miembros','servicios','horarios','bloqueos',
                           'clientes','turnos','push_suscripciones'] loop
    begin
      execute format('select count(*) from %I', t) into n;
      assert n = 0, 'anon vio filas de ' || t;
    exception when insufficient_privilege then
      null; -- también vale: ni siquiera tiene permiso
    end;
  end loop;
  -- Tampoco puede escribir.
  begin
    insert into servicios (barberia_id, nombre, duracion_min)
    values ('00000000-0000-0000-0000-00000000000a', 'hack', 10);
    assert false, 'anon pudo insertar';
  exception when insufficient_privilege then null;
  end;
  -- Ni llamar a las funciones internas.
  begin
    perform app.es_miembro('00000000-0000-0000-0000-00000000000a');
    assert false, 'anon pudo llamar a app.es_miembro';
  exception when insufficient_privilege then null;
  end;
  begin
    perform app.ahora();
    assert false, 'anon pudo llamar a app.ahora';
  exception when insufficient_privilege then null;
  end;
end $$;

-- barberia_publica: lo único que ve anon.
do $$
declare r json;
begin
  r := public.barberia_publica('aaa');
  assert r->>'nombre' = 'Barbería A', 'nombre: ' || r::text;
  assert r->>'slug' = 'aaa' and r->>'direccion' = 'Calle 1' and r->>'whatsapp' = '5491100000001';
  assert r->>'zona_horaria' = 'America/Argentina/Buenos_Aires' and r->>'codigo_area' = '11';
  assert r->>'id' = '00000000-0000-0000-0000-00000000000a';
  assert json_array_length(r->'servicios') = 2, 'debía haber 2 servicios activos: ' || r::text;
  assert r->'servicios'->0->>'nombre' = 'Barba', 'orden por "orden": ' || r::text;
  assert r->'servicios'->1->>'nombre' = 'Corte';
  assert (r->'servicios'->1->>'duracion_min')::int = 30 and (r->'servicios'->1->>'precio')::numeric = 1000;
  assert (r->'servicios'->0->>'id') is not null, 'el servicio lleva id';
  assert public.barberia_publica('no-existe') is null, 'slug inexistente debía dar null';
end $$;
rollback;

-- Barbería inactiva: null. Sin servicios activos: lista vacía (no null).
update barberias set activa = false where slug = 'bbb';
do $$
begin
  assert public.barberia_publica('bbb') is null, 'barbería inactiva debía dar null';
end $$;
update barberias set activa = true where slug = 'bbb';
update servicios set activo = false where barberia_id = '00000000-0000-0000-0000-00000000000b';
do $$
begin
  assert json_array_length(public.barberia_publica('bbb')->'servicios') = 0,
    'sin servicios activos la lista debía ser []';
end $$;
update servicios set activo = true where barberia_id = '00000000-0000-0000-0000-00000000000b';

-- ---------- uA: miembro de A ----------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare n bigint; t text;
begin
  assert (select count(*) from turnos where barberia_id = '00000000-0000-0000-0000-00000000000a') = 1,
    'uA debía ver su turno';
  assert (select count(*) from turnos where barberia_id = '00000000-0000-0000-0000-00000000000b') = 0,
    'uA vio turnos de B';
  assert (select count(*) from barberias) = 1, 'uA debía ver solo su barbería';
  assert (select count(*) from miembros) = 1, 'miembros: solo el propio';
  foreach t in array array['barberos','servicios','horarios','bloqueos','clientes','push_suscripciones'] loop
    execute format('select count(*) from %I where barberia_id = %L', t,
                   '00000000-0000-0000-0000-00000000000b') into n;
    assert n = 0, 'uA vio filas de B en ' || t;
  end loop;
  assert (select count(*) from push_suscripciones) = 1;

  -- update/delete sobre B: 0 filas.
  update turnos set estado = 'cancelado' where barberia_id = '00000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  assert n = 0, 'uA modificó turnos de B';
  delete from turnos where barberia_id = '00000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  assert n = 0, 'uA borró turnos de B';
  update barberias set nombre = 'hackeada' where id = '00000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  assert n = 0, 'uA modificó la barbería B';

  -- Sí puede en A.
  update turnos set estado = 'atendido' where barberia_id = '00000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  assert n = 1, 'uA debía poder modificar sus turnos';
  update barberias set nombre = 'A nueva' where id = '00000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  assert n = 1, 'uA debía poder editar su barbería';
  insert into servicios (barberia_id, nombre, duracion_min)
  values ('00000000-0000-0000-0000-00000000000a', 'Nuevo', 20);

  -- insert en B: violación de RLS.
  begin
    insert into servicios (barberia_id, nombre, duracion_min)
    values ('00000000-0000-0000-0000-00000000000b', 'hack', 10);
    assert false, 'uA pudo insertar un servicio en B';
  exception when insufficient_privilege then null;
  end;
  -- Mover una fila propia a B tampoco vale (with check).
  begin
    update servicios set barberia_id = '00000000-0000-0000-0000-00000000000b' where nombre = 'Nuevo';
    assert false, 'uA pudo mover un servicio a B';
  exception when insufficient_privilege then null;
  end;
  -- barberias: sin insert ni delete.
  begin
    insert into barberias (slug, nombre) values ('ccc', 'C');
    assert false, 'uA pudo crear una barbería';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from barberias where id = '00000000-0000-0000-0000-00000000000a';
    assert false, 'uA pudo borrar su barbería';
  exception when insufficient_privilege then null;
  end;
  -- miembros: solo lectura.
  begin
    insert into miembros (user_id, barberia_id)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000b');
    assert false, 'uA pudo hacerse miembro de B';
  exception when insufficient_privilege then null;
  end;
  -- push: no puede suscribir a otro usuario aunque sea de su barbería.
  begin
    insert into push_suscripciones (user_id, barberia_id, endpoint, p256dh, auth)
    values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000a', 'https://p/z', 'k', 'k');
    assert false, 'uA pudo suscribir a otro usuario';
  exception when insufficient_privilege then null;
  end;
  -- Las funciones internas no son suyas: solo es_miembro (la usan las políticas).
  begin
    perform app.ahora();
    assert false, 'authenticated pudo llamar a app.ahora';
  exception when insufficient_privilege then null;
  end;
end $$;
-- La RPC pública también anda logueado.
do $$ begin
  assert public.barberia_publica('bbb')->>'nombre' = 'Barbería B';
end $$;
rollback;

-- Un usuario sin membresías no ve nada; sin sesión (sub vacío) tampoco.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
do $$ begin
  assert (select count(*) from turnos) = 0 and (select count(*) from barberias) = 0;
end $$;
rollback;
begin;
set local role authenticated;
do $$ begin
  assert (select count(*) from turnos) = 0, 'authenticated sin sub no debía ver nada';
end $$;
rollback;

-- ---------- Claves compuestas: un hijo no puede apuntar a otra barbería ----------
do $$
begin
  begin
    insert into turnos (barberia_id, barbero_id, servicio_id, inicio, fin, origen, nombre_manual)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b2',
            '00000000-0000-0000-0000-0000000000a3', '2026-12-05 10:00-03', '2026-12-05 10:30-03', 'manual', 'z');
    assert false, 'turno de A con barbero de B debía ser rechazado';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into turnos (barberia_id, barbero_id, servicio_id, inicio, fin, origen, nombre_manual)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000b3', '2026-12-05 10:00-03', '2026-12-05 10:30-03', 'manual', 'z');
    assert false, 'turno de A con servicio de B debía ser rechazado';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into turnos (barberia_id, barbero_id, servicio_id, cliente_id, inicio, fin, origen)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2',
            '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b6',
            '2026-12-05 10:00-03', '2026-12-05 10:30-03', 'manual');
    assert false, 'turno de A con cliente de B debía ser rechazado';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into horarios (barberia_id, barbero_id, dia_semana, desde, hasta)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b2', 2, '09:00', '10:00');
    assert false, 'horario de A con barbero de B debía ser rechazado';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into bloqueos (barberia_id, barbero_id, inicio, fin)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b2',
            '2026-12-06 10:00-03', '2026-12-06 11:00-03');
    assert false, 'bloqueo de A con barbero de B debía ser rechazado';
  exception when foreign_key_violation then null;
  end;
  -- Lo coherente sí entra, con cliente_id nulo y con cliente de la misma barbería.
  insert into turnos (barberia_id, barbero_id, servicio_id, cliente_id, inicio, fin, origen)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2',
          '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a6',
          '2026-12-05 11:00-03', '2026-12-05 11:30-03', 'manual');
  -- Borrar el barbero arrastra sus hijos (se mantiene el on delete cascade).
  delete from barberos where id = '00000000-0000-0000-0000-0000000000b2';
  assert (select count(*) from turnos where barberia_id = '00000000-0000-0000-0000-00000000000b') = 0,
    'borrar un barbero debía borrar sus turnos';
end $$;

-- ---------- Token del turno: no depende del search_path de quien inserta ----------
create function public.prueba_insertar_turno() returns text
language plpgsql security definer set search_path = public, app as $$
declare t text;
begin
  insert into turnos (barberia_id, barbero_id, servicio_id, inicio, fin, origen, nombre_manual)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2',
          '00000000-0000-0000-0000-0000000000a3', '2026-12-09 10:00-03', '2026-12-09 10:30-03', 'manual', 'tok')
  returning token into t;
  return t;
end $$;
do $$
declare t text;
begin
  t := public.prueba_insertar_turno();
  assert length(t) >= 32 and t ~ '^[0-9a-f]+$', 'token inválido: ' || t;
end $$;
