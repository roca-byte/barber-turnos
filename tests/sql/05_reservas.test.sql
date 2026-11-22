-- Reservar, ver y cancelar. Reloj fijo: martes 2026-12-01 08:00 (-03).
-- Martes: franjas 09:00-13:00 y 16:00-18:00; servicio de 30 min; paso 15; cancelación 2 h.

insert into barberias (id, slug, nombre, direccion, whatsapp) values
  ('00000000-0000-0000-0000-00000000000a', 'aaa', 'Barbería A', 'Calle 1', '5491100000000'),
  ('00000000-0000-0000-0000-00000000000b', 'bbb', 'Barbería B', null, null);
insert into barberos (id, barberia_id, nombre) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a', 'Barbero A');
insert into servicios (id, barberia_id, nombre, duracion_min) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a', 'Corte', 30),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000000b', 'Corte B', 30);
insert into horarios (barberia_id, barbero_id, dia_semana, desde, hasta) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 2, '09:00', '13:00'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 2, '16:00', '18:00');

select set_config('app.ahora', '2026-12-01 08:00-03', false);

-- Devuelve el mensaje de error de una sentencia (o null si anduvo), para afirmar códigos.
create function pg_temp.err(q text) returns text language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- Atajo: reservar en la barbería A, servicio Corte, el martes 1/12 a la hora indicada.
create function pg_temp.res(hora text, nombre text, tel text) returns text language sql as $$
  select public.reservar('aaa', '00000000-0000-0000-0000-0000000000a3', ('2026-12-01 ' || hora || '-03')::timestamptz, nombre, tel)
$$;
create function pg_temp.res_err(hora text, nombre text, tel text) returns text language sql as $$
  select pg_temp.err(format('select pg_temp.res(%L, %L, %L)', hora, nombre, tel))
$$;

-- ---------- reserva feliz ----------
-- x-forwarded-for trae la cadena de proxies: vale el ÚLTIMO (el primero lo escribe el cliente).
select set_config('request.headers', '{"x-forwarded-for":"9.9.9.9, 1.2.3.4"}', false);
select pg_temp.res('10:00', '  Juan Pérez ', '011 15 1234-5678') as tok \gset t1_
do $$
declare t public.turnos; c public.clientes;
begin
  select * into t from public.turnos;
  assert length(t.token) = 64, 'token de 64 hex: ' || length(t.token);
  assert t.estado = 'confirmado' and t.origen = 'online', 'confirmado y online';
  assert t.ip_origen = '1.2.3.4', 'ip: ' || coalesce(t.ip_origen, 'null');
  assert t.inicio = '2026-12-01 10:00-03' and t.fin = '2026-12-01 10:30-03', 'inicio/fin';
  select * into c from public.clientes where id = t.cliente_id;
  assert c.telefono = '5491112345678', 'teléfono normalizado: ' || c.telefono;
  assert c.nombre = 'Juan Pérez', 'nombre sin espacios sobrantes: [' || c.nombre || ']';
  assert not exists (select 1 from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01') x
                     where x = '2026-12-01 10:00-03'), '10:00 ya no figura en disponibilidad';
end $$;

-- ---------- horario ocupado o inválido ----------
select set_config('request.headers', '{"x-forwarded-for":"5.5.5.5"}', false);
do $$
begin
  assert pg_temp.res_err('10:00', 'Otro', '011 15 2222-3333') = 'HORARIO_NO_DISPONIBLE', 'mismo horario';
  assert pg_temp.res_err('10:07', 'Otro', '011 15 2222-3333') = 'HORARIO_NO_DISPONIBLE', 'no es un slot';
  assert pg_temp.res_err('13:00', 'Otro', '011 15 2222-3333') = 'HORARIO_NO_DISPONIBLE', 'fuera de franja';
  assert pg_temp.res_err('08:15', 'Otro', '011 15 2222-3333') = 'HORARIO_NO_DISPONIBLE', 'antes de abrir';
  assert pg_temp.err($q$select public.reservar('aaa', '00000000-0000-0000-0000-0000000000a3', '2026-11-30 10:00-03', 'Otro', '011 15 2222-3333')$q$)
         = 'HORARIO_NO_DISPONIBLE', 'fecha pasada';
  -- Una reserva rechazada no deja cliente a medias.
  assert not exists (select 1 from public.clientes where telefono = '5491122223333'), 'rollback del cliente';
end $$;

-- ---------- validaciones de entrada ----------
do $$
begin
  assert pg_temp.res_err('11:00', 'Pedro', '123') = 'TELEFONO_INVALIDO', 'teléfono corto';
  assert pg_temp.res_err('11:00', 'Pedro', null) = 'TELEFONO_INVALIDO', 'teléfono null';
  assert pg_temp.res_err('11:00', ' ', '011 15 2222-3333') = 'NOMBRE_INVALIDO', 'nombre en blanco';
  assert pg_temp.res_err('11:00', 'P', '011 15 2222-3333') = 'NOMBRE_INVALIDO', 'nombre de 1 letra';
  assert pg_temp.res_err('11:00', E'\n\t \r\n', '011 15 2222-3333') = 'NOMBRE_INVALIDO', 'nombre de solo tabs y saltos';
  assert pg_temp.res_err('11:00', null, '011 15 2222-3333') = 'NOMBRE_INVALIDO', 'nombre null';
  assert pg_temp.res_err('11:00', repeat('x', 61), '011 15 2222-3333') = 'NOMBRE_INVALIDO', 'nombre de 61';
  assert pg_temp.res_err('11:00', repeat('x', 60), '011 15 2222-3333') is null, 'nombre de 60 vale';
  assert pg_temp.err($q$select public.reservar('nadie', '00000000-0000-0000-0000-0000000000a3', '2026-12-01 11:30-03', 'Pedro', '011 15 2222-3334')$q$)
         = 'BARBERIA_NO_EXISTE', 'slug inexistente';
  assert pg_temp.err($q$select public.reservar('aaa', '00000000-0000-0000-0000-0000000000b3', '2026-12-01 11:30-03', 'Pedro', '011 15 2222-3334')$q$)
         = 'SERVICIO_NO_EXISTE', 'servicio de otra barbería';
  assert pg_temp.err($q$select public.reservar('aaa', '00000000-0000-0000-0000-0000000000ff', '2026-12-01 11:30-03', 'Pedro', '011 15 2222-3334')$q$)
         = 'SERVICIO_NO_EXISTE', 'servicio inexistente';
end $$;
delete from turnos where nombre_manual is null and inicio = '2026-12-01 11:00-03';  -- el del nombre de 60
delete from clientes where telefono = '5491122223333' and not exists (select 1 from turnos t where t.cliente_id = clientes.id);

-- ---------- límite de turnos futuros por cliente ----------
select set_config('request.headers', '{"x-forwarded-for":"2.2.2.2"}', false);
select pg_temp.res('11:00', 'Juan', '011 15 1234-5678') as tok \gset t2_
-- El nombre guardado de un cliente conocido no se pisa con otra reserva.
do $$
begin
  assert (select nombre from public.clientes where telefono = '5491112345678') = 'Juan Pérez', 'nombre sin cambios';
end $$;

select set_config('request.headers', '{"x-forwarded-for":"3.3.3.3"}', false);
do $$
begin
  assert pg_temp.res_err('11:30', 'Juan', '011 15 1234-5678') = 'LIMITE_TURNOS', 'tercera reserva futura';
end $$;

-- ---------- límite por hora por IP ----------
select set_config('request.headers', '{"x-forwarded-for":"7.7.0.1, 9.9.9.9"}', false);
select pg_temp.res('16:00', 'Ana', '011 15 4000-0001') as tok \gset t3_
select pg_temp.res('16:30', 'Beto', '011 15 4000-0002') as tok \gset t4_
select pg_temp.res('17:00', 'Carla', '011 15 4000-0003') as tok \gset t5_
do $$
begin
  assert pg_temp.res_err('17:30', 'Dani', '011 15 4000-0004') = 'LIMITE_HORA', 'cuarta de la misma IP en la hora';
  -- Rotar el elemento izquierdo (falsificable) no saltea el límite.
  perform set_config('request.headers', '{"x-forwarded-for":"6.6.0.2, 9.9.9.9"}', false);
  assert pg_temp.res_err('17:30', 'Dani', '011 15 4000-0004') = 'LIMITE_HORA', 'rotar la IP izquierda no sirve';
  -- cf-connecting-ip manda sobre x-forwarded-for.
  perform set_config('request.headers', '{"cf-connecting-ip":"9.9.9.9","x-forwarded-for":"1.1.1.1"}', false);
  assert pg_temp.res_err('17:30', 'Dani', '011 15 4000-0004') = 'LIMITE_HORA', 'cf-connecting-ip cuenta';
end $$;
-- Otra IP no se ve afectada.
select set_config('request.headers', '{"x-forwarded-for":"8.8.8.8"}', false);
select pg_temp.res('17:30', 'Dani', '011 15 4000-0004') as tok \gset t6_
-- Pasada la hora, la IP vuelve a poder reservar.
select set_config('app.ahora', '2026-12-01 09:01-03', false);
select set_config('request.headers', '{"x-forwarded-for":"9.9.9.9"}', false);
select pg_temp.res('12:30', 'Eli', '011 15 4000-0005') as tok \gset t7_
select set_config('app.ahora', '2026-12-01 08:00-03', false);
delete from turnos where cliente_id in (select id from clientes where telefono in ('5491140000001','5491140000002','5491140000003','5491140000004','5491140000005'));

-- ---------- cf-connecting-ip ----------
select set_config('request.headers', '{"cf-connecting-ip":" 5.5.5.5 ","x-forwarded-for":"9.9.9.9"}', false);
select pg_temp.res('12:00', 'Cf', '011 15 5100-0001') as tok \gset tcf_
do $$
begin
  assert (select ip_origen from public.turnos where inicio = '2026-12-01 12:00-03') = '5.5.5.5', 'cf-connecting-ip gana';
end $$;
select set_config('request.headers', '{"cf-connecting-ip":"","x-forwarded-for":"9.9.9.9, 1.2.3.4"}', false);
select pg_temp.res('12:30', 'Cf', '011 15 5100-0002') as tok \gset tcf2_
do $$
begin
  assert (select ip_origen from public.turnos where inicio = '2026-12-01 12:30-03') = '1.2.3.4', 'cf vacío: último de xff';
end $$;
delete from turnos where inicio in ('2026-12-01 12:00-03', '2026-12-01 12:30-03');

-- ---------- sin cabecera de IP ----------
select set_config('request.headers', '', false);
select pg_temp.res('12:00', 'Sin Ip', '011 15 5000-0001') as tok \gset t8_
do $$
begin
  assert (select ip_origen from public.turnos where inicio = '2026-12-01 12:00-03') = 'desconocida', 'sin headers: desconocida';
end $$;
select set_config('request.headers', '{"x-real-ip":"1.1.1.1"}', false);
select pg_temp.res('12:30', 'Sin Ip', '011 15 5000-0002') as tok \gset t9_
do $$
begin
  assert (select ip_origen from public.turnos where inicio = '2026-12-01 12:30-03') = 'desconocida', 'sin x-forwarded-for: desconocida';
end $$;
delete from turnos where inicio in ('2026-12-01 12:00-03', '2026-12-01 12:30-03');

-- ---------- cliente bloqueado ----------
insert into clientes (id, barberia_id, telefono, nombre) values
  ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-00000000000a', '5491155550000', 'Faltador');
insert into turnos (barberia_id, barbero_id, servicio_id, cliente_id, inicio, fin, origen, estado) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c9', '2026-11-20 10:00-03', '2026-11-20 10:30-03', 'manual', 'no_vino'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c9', '2026-11-21 10:00-03', '2026-11-21 10:30-03', 'manual', 'no_vino');
select set_config('request.headers', '{"x-forwarded-for":"6.6.6.6"}', false);
do $$
begin
  assert app.faltas('00000000-0000-0000-0000-0000000000c9') = 2, 'dos faltas';
  assert pg_temp.res_err('12:00', 'Faltador', '011 15 5555-0000') = 'CLIENTE_BLOQUEADO', 'bloqueado con 2 faltas';
end $$;
update clientes set desbloqueado_en = app.ahora() where id = '00000000-0000-0000-0000-0000000000c9';
do $$
begin
  assert app.faltas('00000000-0000-0000-0000-0000000000c9') = 0, 'desbloqueado: cuenta en cero';
  assert pg_temp.res_err('12:00', 'Faltador', '011 15 5555-0000') is null, 'tras desbloquear puede reservar';
  assert (select count(*) from public.clientes where telefono = '5491155550000') = 1, 'upsert: mismo cliente';
end $$;
-- Una falta nueva después del desbloqueo vuelve a contar (1 < faltas_max 2: todavía puede).
insert into turnos (barberia_id, barbero_id, servicio_id, cliente_id, inicio, fin, origen, estado) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c9', '2026-12-02 10:00-03', '2026-12-02 10:30-03', 'manual', 'no_vino');
do $$
begin
  assert app.faltas('00000000-0000-0000-0000-0000000000c9') = 1, 'una falta posterior al desbloqueo';
end $$;
delete from turnos where cliente_id = '00000000-0000-0000-0000-0000000000c9';

-- ---------- ver_turno ----------
select set_config('app.ahora', '2026-12-01 07:30-03', false);
do $$
declare v json; k text[];
begin
  v := public.ver_turno((select token from public.turnos where inicio = '2026-12-01 10:00-03'));
  assert v->>'estado' = 'confirmado', 'estado';
  assert (v->>'inicio')::timestamptz = '2026-12-01 10:00-03', 'inicio';
  assert (v->>'fin')::timestamptz = '2026-12-01 10:30-03', 'fin';
  assert v->>'servicio' = 'Corte', 'servicio';
  -- La segunda reserva del mismo número (como 'Juan') NO cambió el nombre guardado.
  assert v->>'cliente_nombre' = 'Juan Pérez', 'el nombre guardado no se pisa';
  assert (v->>'puede_cancelar')::boolean, 'a 2 h 30 min: se puede cancelar';
  assert v->'barberia'->>'nombre' = 'Barbería A' and v->'barberia'->>'direccion' = 'Calle 1'
     and v->'barberia'->>'whatsapp' = '5491100000000' and v->'barberia'->>'slug' = 'aaa'
     and v->'barberia'->>'zona_horaria' = 'America/Argentina/Buenos_Aires', 'barbería';
  -- Lista cerrada de claves: nada de teléfono, ip ni ajustes.
  select array_agg(key order by key) into k from json_object_keys(v) key;
  assert k = array['barberia','cliente_nombre','estado','fin','inicio','puede_cancelar','servicio'], 'claves: ' || k::text;
  select array_agg(key order by key) into k from json_object_keys(v->'barberia') key;
  assert k = array['direccion','nombre','slug','whatsapp','zona_horaria'], 'claves barbería: ' || k::text;
  assert v::text not like '%5491112345678%' and v::text not like '%1.2.3.4%', 'sin teléfono ni ip';
  assert public.ver_turno('xxx') is null, 'token inválido: null';
end $$;

-- ---------- plazo de cancelación (2 h antes de las 10:00) ----------
select set_config('app.ahora', '2026-12-01 07:59-03', false);
do $$ begin
  assert (public.ver_turno((select token from public.turnos where inicio = '2026-12-01 10:00-03'))->>'puede_cancelar')::boolean,
    '07:59: puede cancelar';
end $$;
select set_config('app.ahora', '2026-12-01 09:00-03', false);  -- a 1 h
do $$
declare tok text := (select token from public.turnos where inicio = '2026-12-01 10:00-03');
begin
  assert not (public.ver_turno(tok)->>'puede_cancelar')::boolean, 'a 1 h: no puede cancelar';
  assert pg_temp.err(format('select public.cancelar_turno(%L)', tok)) = 'FUERA_DE_PLAZO', 'fuera de plazo';
  assert (select estado from public.turnos where token = tok) = 'confirmado', 'sigue confirmado';
end $$;
select set_config('app.ahora', '2026-12-01 08:00-03', false);  -- justo 2 h: ya no
do $$ begin
  assert not (public.ver_turno((select token from public.turnos where inicio = '2026-12-01 10:00-03'))->>'puede_cancelar')::boolean,
    'a 2 h exactas: no (hay que cancelar con más de 2 h)';
end $$;

-- ---------- cancelar ----------
select set_config('app.ahora', '2026-12-01 07:00-03', false);
do $$
declare tok text := (select token from public.turnos where inicio = '2026-12-01 11:00-03');
begin
  perform public.cancelar_turno(tok);
  assert (select estado from public.turnos where token = tok) = 'cancelado', 'cancelado';
  assert public.ver_turno(tok)->>'estado' = 'cancelado' and not (public.ver_turno(tok)->>'puede_cancelar')::boolean,
    'ver_turno cancelado';
  assert exists (select 1 from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3'::uuid, '2026-12-01') x
                 where x = '2026-12-01 11:00-03'), 'el horario vuelve a disponibilidad';
  assert pg_temp.err(format('select public.cancelar_turno(%L)', tok)) = 'FUERA_DE_PLAZO', 'cancelar de nuevo';
  assert pg_temp.err($q$select public.cancelar_turno('xxx')$q$) = 'TURNO_NO_EXISTE', 'token inexistente';
end $$;
-- Cancelar libera el cupo de turnos futuros del cliente: ahora puede reservar otro.
select set_config('request.headers', '{"x-forwarded-for":"4.4.4.4"}', false);
do $$ begin
  assert pg_temp.res_err('11:00', 'Juan', '011 15 1234-5678') is null, 'tras cancelar puede volver a reservar';
end $$;
select set_config('app.ahora', '2026-12-01 08:00-03', false);

-- ---------- barbería inactiva ----------
update barberias set activa = false where id = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert pg_temp.res_err('14:00', 'Pedro', '011 15 6000-0001') = 'BARBERIA_NO_EXISTE', 'barbería inactiva';
end $$;
update barberias set activa = true where id = '00000000-0000-0000-0000-00000000000a';

-- ---------- ajustes con valores absurdos los rechaza la base ----------
do $$
declare q text;
begin
  foreach q in array array[
    'paso_min = 4', 'paso_min = 61', 'anticipacion_min = -1', 'dias_adelante = 0', 'dias_adelante = 91',
    'cancelacion_horas = -1', 'faltas_max = 0', 'turnos_futuros_max = 0', 'reservas_por_hora_ip = 0']
  loop
    begin
      execute 'update barberias set ' || q || ' where slug = ''aaa''';
      assert false, 'la base aceptó ' || q;
    exception when check_violation then null;
    end;
  end loop;
  update barberias set paso_min = 5, dias_adelante = 90 where slug = 'aaa';
  update barberias set paso_min = 15, dias_adelante = 21 where slug = 'aaa';
end $$;

-- ---------- como anon ----------
begin;
set local role anon;
select set_config('request.headers', '{"x-forwarded-for":"7.7.7.7"}', true);
select public.reservar('aaa', '00000000-0000-0000-0000-0000000000a3', '2026-12-01 12:30-03', 'Anon Cliente', '011 15 7000-0001') as tok \gset anon_
-- psql no interpola dentro de $$...$$: el token pasa por una variable de sesión.
select set_config('test.tok', :'anon_tok', true);
do $$
declare v json; tok text := current_setting('test.tok'); n int;
begin
  v := public.ver_turno(tok);
  assert v->>'estado' = 'confirmado', 'anon ve su turno';
  assert not (v::jsonb ? 'telefono') and not (v::jsonb ? 'ip_origen') and not (v::jsonb ? 'cliente_telefono'), 'sin teléfono';
  assert v::text not like '%5491170000001%', 'el teléfono no aparece en ningún lado';
  begin
    select count(*) into n from public.turnos;
    assert false, 'anon leyó turnos';
  exception when insufficient_privilege then null;
  end;
  perform public.cancelar_turno(tok);
  assert public.ver_turno(tok)->>'estado' = 'cancelado', 'anon cancela';
end $$;
rollback;
