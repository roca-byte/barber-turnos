-- Horarios libres: app.slots, public.disponibilidad y public.dias_disponibles.
-- Reloj fijo: martes 2026-12-01 08:00 (-03). Martes = dia_semana 2.
-- Franjas martes 09:00-13:00 y 16:00-18:00; servicio de 30 min; paso 15.


insert into barberias (id, slug, nombre) values
  ('00000000-0000-0000-0000-00000000000a', 'aaa', 'Barbería A'), ('00000000-0000-0000-0000-00000000000b', 'bbb', 'Barbería B');
-- El principal es el primero por `creado` entre los activos (el segundo, más nuevo, no cuenta).
insert into barberos (id, barberia_id, nombre, creado) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 'Barbero A', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000000a', 'Barbero A2', '2026-02-01');
insert into servicios (id, barberia_id, nombre, duracion_min, activo) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a', 'Corte', 30, true),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-00000000000a', 'Corte y barba', 60, true),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-00000000000a', 'Viejo', 30, false),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000000b', 'Corte B', 30, true);
insert into horarios (barberia_id, barbero_id, dia_semana, desde, hasta) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 2, '09:00', '13:00'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 2, '16:00', '18:00'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 3, '09:00', '10:00');   -- miércoles

select set_config('app.ahora', '2026-12-01 08:00-03', false);

-- ---------- día base ----------
do $$
declare v timestamptz[];
begin
  select array_agg(x order by x) into v from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01') x;
  assert array_length(v, 1) = 22, 'total esperado 22, hubo ' || coalesce(array_length(v, 1), 0);
  assert v[1] = '2026-12-01 09:00-03', 'primero ' || v[1];
  assert v[22] = '2026-12-01 17:30-03', 'último ' || v[22];
  assert not ('2026-12-01 12:45-03'::timestamptz = any(v)), '12:45 no debería estar';
  assert not ('2026-12-01 13:00-03'::timestamptz = any(v)), '13:00 no debería estar';
  assert '2026-12-01 12:30-03'::timestamptz = any(v), '12:30 sí';
  assert '2026-12-01 16:00-03'::timestamptz = any(v), '16:00 sí';
  -- Ya vienen ordenadas sin pedir order by.
  assert (select array_agg(x) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01') x) = v,
    'resultado no ordenado ascendente';
end $$;

-- ---------- turno confirmado / cancelado ----------
insert into turnos (id, barberia_id, barbero_id, servicio_id, inicio, fin, origen, nombre_manual)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3',
        '2026-12-01 10:00-03', '2026-12-01 10:30-03', 'manual', 'x');
do $$
declare v timestamptz[];
begin
  select array_agg(x) into v from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01') x;
  assert not ('2026-12-01 09:45-03'::timestamptz = any(v)), '09:45 pisa el turno';
  assert not ('2026-12-01 10:00-03'::timestamptz = any(v)), '10:00 pisa el turno';
  assert not ('2026-12-01 10:15-03'::timestamptz = any(v)), '10:15 pisa el turno';
  assert '2026-12-01 10:30-03'::timestamptz = any(v), '10:30 toca el borde: libre';
  assert '2026-12-01 09:30-03'::timestamptz = any(v), '09:30 termina justo en 10:00: libre';
end $$;
update turnos set estado = 'cancelado' where id = '00000000-0000-0000-0000-0000000000c1';
do $$
declare v timestamptz[];
begin
  select array_agg(x) into v from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01') x;
  assert '2026-12-01 10:00-03'::timestamptz = any(v) and '2026-12-01 09:45-03'::timestamptz = any(v),
    'con el turno cancelado el hueco vuelve';
  assert array_length(v, 1) = 22, 'vuelven los 22';
end $$;

-- ---------- bloqueo ----------
insert into bloqueos (barberia_id, barbero_id, inicio, fin)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', '2026-12-01 16:00-03', '2026-12-01 18:00-03');
do $$
declare v timestamptz[];
begin
  select array_agg(x) into v from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01') x;
  assert array_length(v, 1) = 15, 'sin la tarde quedan 15, hubo ' || array_length(v, 1);
  assert v[15] = '2026-12-01 12:30-03', 'último de la mañana ' || v[15];
end $$;
delete from bloqueos;

-- ---------- servicio de 60 min ----------
do $$
declare v timestamptz[];
begin
  select array_agg(x order by x) into v from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a4'::uuid, '2026-12-01') x;
  assert '2026-12-01 12:00-03'::timestamptz = any(v), '12:00 entra (termina 13:00)';
  assert not ('2026-12-01 12:15-03'::timestamptz = any(v)), '12:15 se pasa de las 13:00';
  assert v[array_length(v, 1)] = '2026-12-01 17:00-03', 'último de la tarde 17:00';
end $$;

-- ---------- anticipación ----------
select set_config('app.ahora', '2026-12-01 09:20-03', false);
do $$
declare v timestamptz[];
begin
  select array_agg(x order by x) into v from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01') x;
  assert v[1] = '2026-12-01 10:00-03', 'con anticipación 30 el primero es 10:00, fue ' || v[1];
end $$;
select set_config('app.ahora', '2026-12-01 09:30-03', false);
do $$
begin
  -- 09:30 + 30 = 10:00: el límite exacto es válido.
  assert (select min(x) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01') x)
         = '2026-12-01 10:00-03', 'borde exacto de anticipación';
end $$;
select set_config('app.ahora', '2026-12-01 08:00-03', false);

-- ---------- ventana de fechas ----------
do $$
begin
  assert (select count(*) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-23')) = 0, '23/12 fuera de rango';
  assert (select count(*) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-11-30')) = 0, 'pasado';
  assert (select count(*) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-08')) = 22, '08/12 (martes) dentro';
  -- Domingo sin franjas.
  assert (select count(*) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-06')) = 0, 'domingo vacío';
end $$;
-- Último día de la ventana (hoy + 21 = 22/12, martes): entra.
insert into horarios (barberia_id, barbero_id, dia_semana, desde, hasta) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 2, '20:00', '21:00');
do $$
begin
  assert (select count(*) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-22')) = 22 + 3,
    'el último día de la ventana (22/12) entra';
end $$;
delete from horarios where desde = '20:00';

-- ---------- hoy en la zona de la barbería, no en UTC ----------
-- 2026-12-02 01:00 UTC = 2026-12-01 22:00 -03: para la barbería todavía es martes 1.
select set_config('app.ahora', '2026-12-02 01:00+00', false);
do $$
begin
  assert (select count(*) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01')) = 0,
    'martes a las 22:00 local: ya no quedan horarios, pero la fecha sigue siendo válida (no da error)';
  assert (select count(*) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-08')) = 22, 'martes siguiente';
  assert (select count(*) from public.dias_disponibles('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid) d where d = '2026-12-01') = 0,
    'sin slots, el 1/12 no figura';
end $$;
select set_config('app.ahora', '2026-12-01 08:00-03', false);

-- ---------- dias_disponibles ----------
do $$
declare d date[];
begin
  select array_agg(x order by x) into d from public.dias_disponibles('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid) x;
  -- martes y miércoles dentro de [1/12, 22/12]: martes 1, 8, 15, 22 y miércoles 2, 9, 16.
  assert d = array['2026-12-01','2026-12-02','2026-12-08','2026-12-09','2026-12-15','2026-12-16','2026-12-22']::date[],
    'días: ' || d::text;
  assert (select array_agg(x) from public.dias_disponibles('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid) x) = d, 'orden ascendente';
  assert not exists (select 1 from unnest(d) f where extract(dow from f) = 0), 'sin domingos';
end $$;
-- Día completo ocupado por un bloqueo: desaparece de la lista.
insert into bloqueos (barberia_id, barbero_id, inicio, fin)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', '2026-12-08 00:00-03', '2026-12-09 00:00-03');
do $$
begin
  assert not exists (select 1 from public.dias_disponibles('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid) d where d = '2026-12-08'),
    'día bloqueado no figura';
end $$;
delete from bloqueos;

-- ---------- zona horaria de la sesión ----------
set timezone = 'Asia/Tokyo';
do $$
declare v timestamptz[];
begin
  select array_agg(x order by x) into v from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01') x;
  assert array_length(v, 1) = 22 and v[1] = '2026-12-01 09:00-03' and v[22] = '2026-12-01 17:30-03',
    'con timezone Tokyo los instantes son los mismos';
  assert (select count(*) from public.dias_disponibles('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid)) = 7, 'dias_disponibles igual en Tokyo';
end $$;
reset timezone;

-- ---------- zona de la barbería distinta ----------
update barberias set zona_horaria = 'Asia/Tokyo' where id = '00000000-0000-0000-0000-00000000000a';
-- Ahora son las 20:00 del 1/12 en Tokio: el miércoles 2/12 (franja 09-10) es futuro y válido.
do $$
declare v timestamptz[];
begin
  select array_agg(x order by x) into v from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-02') x;
  assert v = array['2026-12-02 09:00+09','2026-12-02 09:15+09','2026-12-02 09:30+09']::timestamptz[],
    'las horas se leen en la zona de la barbería: ' || v::text;
end $$;
update barberias set zona_horaria = 'America/Argentina/Buenos_Aires' where id = '00000000-0000-0000-0000-00000000000a';

-- ---------- barbero_principal ----------
do $$
begin
  assert app.barbero_principal('00000000-0000-0000-0000-00000000000a') = '00000000-0000-0000-0000-0000000000a2'::uuid, 'principal = el más antiguo';
end $$;
update barberos set activo = false where id = '00000000-0000-0000-0000-0000000000a2';
do $$
begin
  assert app.barbero_principal('00000000-0000-0000-0000-00000000000a') = '00000000-0000-0000-0000-0000000000a9'::uuid, 'si el primero está inactivo, el siguiente';
  assert (select count(*) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01')) = 0,
    'el segundo no tiene franjas';
end $$;
update barberos set activo = true where id = '00000000-0000-0000-0000-0000000000a2';
do $$
begin
  assert app.barbero_principal('00000000-0000-0000-0000-0000000000ff') is null, 'barbería inexistente: null';
end $$;

-- ---------- casos que devuelven vacío sin error ----------
do $$
begin
  assert (select count(*) from public.disponibilidad('nadie', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01')) = 0, 'slug inexistente';
  assert (select count(*) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a5'::uuid, '2026-12-01')) = 0, 'servicio inactivo';
  assert (select count(*) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000b3'::uuid, '2026-12-01')) = 0, 'servicio de otra barbería';
  assert (select count(*) from public.dias_disponibles('nadie', '00000000-0000-0000-0000-0000000000a3'::uuid)) = 0, 'dias: slug inexistente';
  assert (select count(*) from public.dias_disponibles('aaa', '00000000-0000-0000-0000-0000000000a5'::uuid)) = 0, 'dias: servicio inactivo';
  assert (select count(*) from public.dias_disponibles('aaa', '00000000-0000-0000-0000-0000000000b3'::uuid)) = 0, 'dias: servicio de otra';
end $$;
update barberias set activa = false where id = '00000000-0000-0000-0000-00000000000a';
do $$
begin
  assert (select count(*) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01')) = 0, 'barbería inactiva';
  assert (select count(*) from public.dias_disponibles('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid)) = 0, 'dias: barbería inactiva';
end $$;
update barberias set activa = true where id = '00000000-0000-0000-0000-00000000000a';

-- ---------- app.slots con p_ignorar_reglas ----------
do $$
begin
  -- Fecha pasada: con reglas vacío, ignorando reglas calcula igual (para uso interno del dueño).
  assert (select count(*) from app.slots('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3', '2026-11-24')) = 0, 'pasado con reglas: vacío';
  assert (select count(*) from app.slots('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3', '2026-11-24', true)) = 22, 'pasado sin reglas: 22';
  perform set_config('app.ahora', '2026-12-01 09:20-03', false);
  assert (select min(x) from app.slots('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3', '2026-12-01', true) x) = '2026-12-01 09:00-03',
    'sin reglas no hay anticipación';
end $$;
select set_config('app.ahora', '2026-12-01 08:00-03', false);

-- ---------- permisos: anon y authenticated llaman a las RPC; a app.slots no ----------
begin;
set local role anon;
do $$
begin
  assert (select count(*) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01')) = 22, 'anon: disponibilidad';
  assert (select count(*) from public.dias_disponibles('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid)) = 7, 'anon: dias_disponibles';
  begin
    perform app.slots('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3', '2026-12-01');
    assert false, 'anon pudo llamar a app.slots';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
begin;
set local role authenticated;
do $$
begin
  assert (select count(*) from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01')) = 22, 'authenticated: disponibilidad';
  assert (select count(*) from public.dias_disponibles('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid)) = 7, 'authenticated: dias_disponibles';
end $$;
rollback;
