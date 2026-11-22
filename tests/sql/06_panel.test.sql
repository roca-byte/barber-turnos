-- Operaciones del panel (RPC de authenticated). Reloj fijo: martes 2026-12-01 08:00 (-03).
-- Martes: franjas 09:00-13:00 y 16:00-18:00; servicio de 30 min; paso 15.
-- Los cambios de rol son de sesión (set role / reset role): las RPC dejan datos que
-- las pruebas siguientes necesitan.

\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set SA '00000000-0000-0000-0000-0000000000a3'

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ua@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'ub@x.test');
insert into barberias (id, slug, nombre) values (:'A', 'aaa', 'Barbería A'), (:'B', 'bbb', 'Barbería B');
insert into miembros (user_id, barberia_id) values
  ('00000000-0000-0000-0000-0000000000a1', :'A'),
  ('00000000-0000-0000-0000-0000000000b1', :'B');
insert into barberos (id, barberia_id, nombre) values
  ('00000000-0000-0000-0000-0000000000a2', :'A', 'Barbero A'),
  ('00000000-0000-0000-0000-0000000000b2', :'B', 'Barbero B');
insert into servicios (id, barberia_id, nombre, duracion_min, activo) values
  (:'SA', :'A', 'Corte', 30, true),
  ('00000000-0000-0000-0000-0000000000a4', :'A', 'Viejo', 30, false),
  ('00000000-0000-0000-0000-0000000000b3', :'B', 'Corte B', 30, true);
insert into horarios (barberia_id, barbero_id, dia_semana, desde, hasta) values
  (:'A', '00000000-0000-0000-0000-0000000000a2', 2, '09:00', '13:00'),
  (:'A', '00000000-0000-0000-0000-0000000000a2', 2, '16:00', '18:00'),
  (:'B', '00000000-0000-0000-0000-0000000000b2', 2, '09:00', '13:00');
-- Un turno y un cliente de B, para probar que A no los toca.
insert into clientes (id, barberia_id, telefono, nombre) values
  ('00000000-0000-0000-0000-0000000000b6', :'B', '5491100000011', 'Cliente B');
insert into turnos (id, barberia_id, barbero_id, servicio_id, cliente_id, inicio, fin, origen) values
  ('00000000-0000-0000-0000-0000000000b7', :'B', '00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b6',
   '2026-12-01 09:00-03', '2026-12-01 09:30-03', 'online');

select set_config('app.ahora', '2026-12-01 08:00-03', false);

-- Devuelve el mensaje de error de una sentencia (o null si anduvo). Corre con los
-- permisos de quien llama, así vale también para probar rechazos por rol.
create function public.t_err(q text) returns text language plpgsql as $$
begin execute q; return null;
exception when others then return sqlerrm; end $$;
grant execute on function public.t_err(text) to anon, authenticated;

-- Atajos como uA: turno manual en A, servicio Corte, el martes 1/12.
create function public.t_man(hora text, nombre text, tel text default null) returns uuid language sql as $$
  select public.crear_turno_manual('00000000-0000-0000-0000-00000000000a',
    '00000000-0000-0000-0000-0000000000a3', ('2026-12-01 ' || hora || '-03')::timestamptz, nombre, tel)
$$;
grant execute on function public.t_man(text, text, text) to authenticated;

-- ---------- anon no puede ejecutar ninguna ----------
set role anon;
do $$
declare q text;
begin
  foreach q in array array[
    $q$select public.crear_turno_manual('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a3','2026-12-01 10:00-03','X Y',null)$q$,
    $q$select public.crear_bloqueo('00000000-0000-0000-0000-00000000000a','2026-12-01 10:00-03','2026-12-01 11:00-03','x')$q$,
    $q$select public.agenda_dia('00000000-0000-0000-0000-00000000000a','2026-12-01')$q$,
    $q$select public.marcar_turno('00000000-0000-0000-0000-0000000000b7','atendido')$q$,
    $q$select public.clientes_con_faltas('00000000-0000-0000-0000-00000000000a')$q$,
    $q$select public.desbloquear_cliente('00000000-0000-0000-0000-0000000000b6')$q$]
  loop
    assert public.t_err(q) like 'permission denied%', 'anon ejecutó: ' || q;
  end loop;
end $$;
reset role;

-- ---------- uB (miembro de B) no toca A: NO_AUTORIZADO en todo ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$
begin
  assert public.t_err($q$select public.crear_turno_manual('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a3','2026-12-01 10:00-03','Pedro Gómez',null)$q$) = 'NO_AUTORIZADO', 'manual en A';
  assert public.t_err($q$select public.crear_bloqueo('00000000-0000-0000-0000-00000000000a','2026-12-01 10:00-03','2026-12-01 11:00-03','x')$q$) = 'NO_AUTORIZADO', 'bloqueo en A';
  assert public.t_err($q$select public.agenda_dia('00000000-0000-0000-0000-00000000000a','2026-12-01')$q$) = 'NO_AUTORIZADO', 'agenda de A';
  assert public.t_err($q$select public.clientes_con_faltas('00000000-0000-0000-0000-00000000000a')$q$) = 'NO_AUTORIZADO', 'faltas de A';
  assert not exists (select 1 from public.bloqueos), 'no se creó nada en A';
end $$;
-- Y uA no toca lo de B; un id inexistente da el mismo error (no revela existencia).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$
begin
  assert public.t_err($q$select public.marcar_turno('00000000-0000-0000-0000-0000000000b7','atendido')$q$) = 'NO_AUTORIZADO', 'marcar turno de B';
  assert public.t_err($q$select public.marcar_turno('00000000-0000-0000-0000-0000000000ee','atendido')$q$) = 'NO_AUTORIZADO', 'marcar turno inexistente';
  assert public.t_err($q$select public.desbloquear_cliente('00000000-0000-0000-0000-0000000000b6')$q$) = 'NO_AUTORIZADO', 'desbloquear cliente de B';
  assert public.t_err($q$select public.desbloquear_cliente('00000000-0000-0000-0000-0000000000ee')$q$) = 'NO_AUTORIZADO', 'desbloquear inexistente';
  assert public.t_err($q$select public.marcar_turno('00000000-0000-0000-0000-0000000000b7','cualquiera')$q$) = 'NO_AUTORIZADO', 'autorización antes que estado';
end $$;
-- Sin sesión (sub vacío) tampoco.
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  assert public.t_err($q$select public.agenda_dia('00000000-0000-0000-0000-00000000000a','2026-12-01')$q$) = 'NO_AUTORIZADO', 'sin sub';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);

-- ---------- turnos manuales ----------
do $$
declare t public.turnos; v_id uuid;
begin
  -- 20:00 está fuera de franja y se acepta.
  v_id := public.t_man('20:00', '  Ana Díaz ', '011 15 4000-0001');
  select * into t from public.turnos where turnos.id = v_id;
  assert t.origen = 'manual' and t.estado = 'confirmado', 'manual y confirmado';
  assert t.fin = t.inicio + interval '30 minutes', 'fin = inicio + duración';
  assert t.barbero_id = '00000000-0000-0000-0000-0000000000a2', 'barbero principal';
  assert t.cliente_id is not null and t.nombre_manual is null, 'con teléfono: cliente';
  assert (select telefono || '|' || nombre from public.clientes where clientes.id = t.cliente_id)
         = '5491140000001|Ana Díaz', 'cliente normalizado y nombre sin espacios';
  -- Se pisa con el anterior (20:15 cae dentro de 20:00-20:30).
  assert public.t_err($q$select public.t_man('20:15', 'Otro Más', null)$q$) = 'HORARIO_NO_DISPONIBLE', 'manual que pisa';
  -- Sin teléfono: sin cliente, con nombre_manual.
  v_id := public.t_man('21:00', ' Beto Ruiz ', null);
  select * into t from public.turnos where turnos.id = v_id;
  assert t.cliente_id is null and t.nombre_manual = 'Beto Ruiz', 'sin teléfono: nombre_manual';
  v_id := public.t_man('22:00', 'Carla Paz', '   ');
  assert (select cliente_id is null and nombre_manual = 'Carla Paz' from public.turnos where turnos.id = v_id), 'teléfono en blanco = sin teléfono';
  -- Cliente existente: no se pisa su nombre.
  perform public.t_man('23:00', 'Otro Nombre', '+54 9 11 4000-0001');
  assert (select nombre from public.clientes where telefono = '5491140000001') = 'Ana Díaz', 'nombre guardado intacto';
  assert (select count(*) from public.clientes where barberia_id = '00000000-0000-0000-0000-00000000000a') = 1, 'mismo cliente';
  -- Validaciones.
  assert public.t_err($q$select public.t_man('10:00', 'Dani Sol', '123')$q$) = 'TELEFONO_INVALIDO', 'teléfono inválido';
  assert public.t_err($q$select public.t_man('10:00', ' ', null)$q$) = 'NOMBRE_INVALIDO', 'nombre en blanco';
  assert public.t_err($q$select public.t_man('10:00', 'D', null)$q$) = 'NOMBRE_INVALIDO', 'nombre de 1 letra';
  assert public.t_err($q$select public.t_man('10:00', null, null)$q$) = 'NOMBRE_INVALIDO', 'nombre null';
  assert public.t_err($q$select public.t_man('10:00', repeat('x', 61), null)$q$) = 'NOMBRE_INVALIDO', 'nombre de 61';
  assert public.t_err($q$select public.crear_turno_manual('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000a4','2026-12-01 10:00-03','Dani Sol',null)$q$) = 'SERVICIO_NO_EXISTE', 'servicio inactivo';
  assert public.t_err($q$select public.crear_turno_manual('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000b3','2026-12-01 10:00-03','Dani Sol',null)$q$) = 'SERVICIO_NO_EXISTE', 'servicio de B';
  assert (select count(*) from public.turnos where barberia_id = '00000000-0000-0000-0000-00000000000a') = 4, 'rechazados no dejan turnos';
end $$;
-- Limpieza para las pruebas siguientes (como postgres; el cliente de Ana se conserva).
reset role;
delete from turnos where barberia_id = :'A';
set role authenticated;

-- ---------- bloqueo ----------
select public.t_man('10:30', 'Eli Mora', '011 15 4000-0002') as tmed \gset
do $$
declare r json;
begin
  assert public.t_err($q$select public.crear_bloqueo('00000000-0000-0000-0000-00000000000a','2026-12-01 12:00-03','2026-12-01 11:00-03','x')$q$) = 'RANGO_INVALIDO', 'fin antes de inicio';
  assert public.t_err($q$select public.crear_bloqueo('00000000-0000-0000-0000-00000000000a','2026-12-01 11:00-03','2026-12-01 11:00-03','x')$q$) = 'RANGO_INVALIDO', 'rango vacío';
  assert public.t_err($q$select public.crear_bloqueo('00000000-0000-0000-0000-00000000000a',null,'2026-12-01 11:00-03','x')$q$) = 'RANGO_INVALIDO', 'inicio null';
  r := public.crear_bloqueo('00000000-0000-0000-0000-00000000000a', '2026-12-01 10:00-03', '2026-12-01 12:00-03', 'Trámite');
  assert (r->>'id')::uuid = (select id from public.bloqueos), 'id del bloqueo';
  assert json_array_length(r->'afectados') = 1, 'un afectado: ' || r::text;
  assert (r->'afectados'->0->>'nombre') = 'Eli Mora' and (r->'afectados'->0->>'telefono') = '5491140000002', 'datos del afectado';
  assert (r->'afectados'->0->>'inicio')::timestamptz = '2026-12-01 10:30-03', 'inicio del afectado';
  assert (select estado from public.turnos) = 'confirmado', 'el turno sigue confirmado';
  assert (select barbero_id from public.bloqueos) = '00000000-0000-0000-0000-0000000000a2', 'bloqueo del barbero principal';
  assert not exists (select 1 from public.disponibilidad('aaa', '00000000-0000-0000-0000-0000000000a3', '2026-12-01') x
                     where x = '2026-12-01 11:00-03'), '11:00 ya no se ofrece';
  -- Un bloqueo sin turnos pisados devuelve afectados vacío; los cancelados no cuentan.
  r := public.crear_bloqueo('00000000-0000-0000-0000-00000000000a', '2026-12-01 16:00-03', '2026-12-01 17:00-03', null);
  assert json_array_length(r->'afectados') = 0, 'sin afectados';
  -- Un turno que termina justo cuando empieza el bloqueo no se pisa.
  perform public.t_man('09:30', 'Fede Gil', null);
  r := public.crear_bloqueo('00000000-0000-0000-0000-00000000000a', '2026-12-01 10:00-03', '2026-12-01 10:10-03', null);
  assert json_array_length(r->'afectados') = 0, 'rango [): 09:30-10:00 no pisa un bloqueo que empieza 10:00';
end $$;
-- Con un cliente sin teléfono, afectados trae nombre_manual y teléfono null.
do $$
declare r json;
begin
  r := public.crear_bloqueo('00000000-0000-0000-0000-00000000000a', '2026-12-01 09:15-03', '2026-12-01 09:45-03', null);
  assert json_array_length(r->'afectados') = 1 and (r->'afectados'->0->>'nombre') = 'Fede Gil'
         and json_typeof(r->'afectados'->0->'telefono') = 'null', 'manual sin teléfono: nombre_manual y teléfono null';
end $$;
reset role;
delete from bloqueos where barberia_id = :'A';
delete from turnos where barberia_id = :'A';
set role authenticated;

-- ---------- marcar turno y faltas ----------
select public.t_man('09:00', 'Gabi Luna', '011 15 4000-0003') as t1 \gset
select public.t_man('10:00', 'Gabi Luna', '011 15 4000-0003') as t2 \gset
select public.t_man('11:00', 'Gabi Luna', '011 15 4000-0003') as t3 \gset
do $$
declare c json;
begin
  assert json_array_length(public.clientes_con_faltas('00000000-0000-0000-0000-00000000000a')) = 0, 'sin faltas: vacío';
  assert public.t_err($q$select public.marcar_turno((select id from public.turnos where inicio = '2026-12-01 09:00-03'), 'volando')$q$) = 'ESTADO_INVALIDO', 'estado inválido';
  assert public.t_err($q$select public.marcar_turno((select id from public.turnos where inicio = '2026-12-01 09:00-03'), null)$q$) = 'ESTADO_INVALIDO', 'estado null';
end $$;
select set_config('app.ahora', '2026-12-01 14:00-03', false);  -- ya pasaron los turnos de la mañana
do $$
declare c json; t1 uuid; t2 uuid; t3 uuid;
begin
  select id into t1 from public.turnos where inicio = '2026-12-01 09:00-03';
  select id into t2 from public.turnos where inicio = '2026-12-01 10:00-03';
  select id into t3 from public.turnos where inicio = '2026-12-01 11:00-03';
  perform public.marcar_turno(t1, 'no_vino');
  c := public.clientes_con_faltas('00000000-0000-0000-0000-00000000000a');
  assert (c->0->>'faltas')::int = 1 and (c->0->>'bloqueado')::boolean = false, 'una falta, no bloqueado: ' || c::text;
  perform public.marcar_turno(t2, 'no_vino');
  c := public.clientes_con_faltas('00000000-0000-0000-0000-00000000000a');
  assert json_array_length(c) = 1 and (c->0->>'faltas')::int = 2 and (c->0->>'bloqueado')::boolean, 'dos faltas: bloqueado';
  assert c->0->>'nombre' = 'Gabi Luna' and c->0->>'telefono' = '5491140000003', 'datos del cliente';
  perform public.marcar_turno(t2, 'atendido');
  c := public.clientes_con_faltas('00000000-0000-0000-0000-00000000000a');
  assert (c->0->>'faltas')::int = 1 and not (c->0->>'bloqueado')::boolean, 'corregido a atendido: 1 falta';
  perform public.marcar_turno(t2, 'no_vino');
  perform public.marcar_turno(t3, 'cancelado');
  assert (select estado from public.turnos where id = t3) = 'cancelado', 'cancelado';
  -- Deshacer: confirmado de nuevo respeta la exclusión.
  perform public.marcar_turno(t1, 'cancelado');
  perform public.t_man('09:00', 'Hugo Paz', null);  -- ocupa el hueco liberado
  assert public.t_err(format('select public.marcar_turno(%L, ''confirmado'')', t1)) = 'HORARIO_NO_DISPONIBLE', 'deshacer sobre hueco ocupado';
  assert (select estado from public.turnos where id = t1) = 'cancelado', 'sigue cancelado';
  perform public.marcar_turno(t3, 'confirmado');
  assert (select estado from public.turnos where id = t3) = 'confirmado', 'deshacer con hueco libre';
  -- Quitar la falta de t1 (cancelado) y volver a 1.
  assert (public.clientes_con_faltas('00000000-0000-0000-0000-00000000000a')->0->>'faltas')::int = 1, 'queda 1 falta (t2)';
  perform public.marcar_turno(t2, 'no_vino');
  -- t1 cancelado ya no cuenta; hace falta otra falta para bloquear: t3.
  perform public.marcar_turno(t3, 'no_vino');
  c := public.clientes_con_faltas('00000000-0000-0000-0000-00000000000a');
  assert (c->0->>'faltas')::int = 2 and (c->0->>'bloqueado')::boolean, 'otra vez 2: bloqueado';
end $$;

-- ---------- desbloquear ----------
-- Un cliente bloqueado no puede reservar online; al desbloquearlo, sí.
reset role;
select set_config('request.headers', '{"x-forwarded-for":"1.1.1.1"}', false);
do $$
begin
  assert public.t_err($q$select public.reservar('aaa','00000000-0000-0000-0000-0000000000a3','2026-12-08 10:00-03','Gabi Luna','011 15 4000-0003')$q$) = 'CLIENTE_BLOQUEADO', 'bloqueado no reserva';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$
declare c json;
begin
  perform public.desbloquear_cliente((select id from public.clientes where telefono = '5491140000003'));
  assert (select desbloqueado_en from public.clientes where telefono = '5491140000003') = '2026-12-01 14:00-03', 'desbloqueado_en = ahora';
  -- Sin faltas posteriores: ya no figura en la lista (faltas > 0).
  assert json_array_length(public.clientes_con_faltas('00000000-0000-0000-0000-00000000000a')) = 0, 'faltas = 0 tras desbloquear';
end $$;
reset role;
do $$
begin
  assert public.reservar('aaa','00000000-0000-0000-0000-0000000000a3','2026-12-08 10:00-03','Gabi Luna','011 15 4000-0003') is not null, 'desbloqueado reserva';
end $$;

-- ---------- agenda_dia ----------
reset role;
delete from turnos where barberia_id = :'A';
delete from bloqueos where barberia_id = :'A';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.t_man('11:00', 'Ines Vera', '011 15 4000-0004') as ta \gset
select public.t_man('09:00', 'Juan Manual', null) as tb \gset
select public.crear_bloqueo('00000000-0000-0000-0000-00000000000a', '2026-12-01 16:00-03', '2026-12-01 17:00-03', 'Médico') as bl \gset
select public.t_man('10:00', 'Kari Sol', '011 15 4000-0005') as tc \gset
do $$
declare a json;
begin
  -- Kari cancela: sigue apareciendo en la agenda con su estado.
  perform public.marcar_turno((select id from public.turnos where inicio = '2026-12-01 10:00-03'), 'cancelado');
  a := public.agenda_dia('00000000-0000-0000-0000-00000000000a', '2026-12-01');
  assert json_array_length(a->'franjas') = 2, 'dos franjas';
  assert (a->'franjas'->0->>'desde')::timestamptz = '2026-12-01 09:00-03' and (a->'franjas'->0->>'hasta')::timestamptz = '2026-12-01 13:00-03', 'franja 1';
  assert (a->'franjas'->1->>'desde')::timestamptz = '2026-12-01 16:00-03' and (a->'franjas'->1->>'hasta')::timestamptz = '2026-12-01 18:00-03', 'franja 2';
  assert json_array_length(a->'turnos') = 3, 'tres turnos (con el cancelado)';
  assert (a->'turnos'->0->>'nombre') = 'Juan Manual' and (a->'turnos'->1->>'nombre') = 'Kari Sol'
         and (a->'turnos'->2->>'nombre') = 'Ines Vera', 'ordenados por inicio con nombre';
  assert (a->'turnos'->0->>'estado') = 'confirmado' and (a->'turnos'->1->>'estado') = 'cancelado', 'estados';
  assert (a->'turnos'->0->>'origen') = 'manual' and (a->'turnos'->0->>'servicio') = 'Corte', 'origen y servicio';
  assert json_typeof(a->'turnos'->0->'telefono') = 'null' and (a->'turnos'->0->>'faltas')::int = 0, 'manual: sin teléfono, 0 faltas';
  assert (a->'turnos'->2->>'telefono') = '5491140000004', 'teléfono visible al miembro';
  assert (a->'turnos'->2->>'inicio')::timestamptz = '2026-12-01 11:00-03' and (a->'turnos'->2->>'fin')::timestamptz = '2026-12-01 11:30-03', 'inicio y fin';
  assert json_array_length(a->'bloqueos') = 1 and (a->'bloqueos'->0->>'motivo') = 'Médico', 'el bloqueo';
  -- Otro día: sin franjas (miércoles), sin turnos.
  a := public.agenda_dia('00000000-0000-0000-0000-00000000000a', '2026-12-02');
  assert json_array_length(a->'franjas') = 0 and json_array_length(a->'turnos') = 0 and json_array_length(a->'bloqueos') = 0, 'día vacío';
end $$;
reset role;
-- Faltas en la agenda: una falta de Gabi posterior al desbloqueo (14:00) cuenta de nuevo.
insert into turnos (barberia_id, barbero_id, servicio_id, cliente_id, inicio, fin, origen, estado)
select barberia_id, '00000000-0000-0000-0000-0000000000a2', :'SA', id,
       '2026-12-01 15:30-03', '2026-12-01 16:00-03', 'manual', 'no_vino'
from clientes where telefono = '5491140000003';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$
declare a json;
begin
  a := public.agenda_dia('00000000-0000-0000-0000-00000000000a', '2026-12-01');
  assert (select (t->>'faltas')::int from json_array_elements(a->'turnos') t where t->>'nombre' = 'Gabi Luna') = 1, 'faltas en la agenda';
end $$;
reset role;
