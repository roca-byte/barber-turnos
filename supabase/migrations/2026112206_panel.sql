-- Operaciones del panel del barbero (RPC solo para `authenticated`).
-- Todas verifican que quien llama sea miembro de la barbería con app.es_miembro; si no,
-- `raise exception 'NO_AUTORIZADO'`. Cuando la RPC recibe un id de turno o de cliente, la
-- barbería se deduce de la fila, y un id inexistente da el MISMO error que uno ajeno:
-- así no se puede explorar qué ids existen.
--
-- Códigos de error (el front los traduce): NO_AUTORIZADO, NOMBRE_INVALIDO,
-- TELEFONO_INVALIDO, SERVICIO_NO_EXISTE, HORARIO_NO_DISPONIBLE (turno que se pisa o
-- barbería sin barbero), RANGO_INVALIDO (bloqueo con fin <= inicio o con nulos),
-- ESTADO_INVALIDO (marcar_turno con un estado fuera de la lista).

-- ---------- 1. Turno manual ----------
-- El barbero puede atender fuera de horario: acá no se pasa por app.slots (ni franjas ni
-- anticipación). Lo único que se respeta es que no se pise con otro turno confirmado.
create or replace function public.crear_turno_manual(p_barberia uuid, p_servicio uuid,
    p_inicio timestamptz, p_nombre text, p_telefono text default null)
returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  v_barberia public.barberias%rowtype;
  v_servicio public.servicios%rowtype;
  v_barbero uuid;
  v_nombre text := btrim(coalesce(p_nombre, ''), E' \t\r\n\f\v');
  v_tel text;
  v_cliente_id uuid;
  v_id uuid;
begin
  if not app.es_miembro(p_barberia) then raise exception 'NO_AUTORIZADO'; end if;
  select * into v_barberia from public.barberias where id = p_barberia;

  select * into v_servicio from public.servicios
  where id = p_servicio and barberia_id = p_barberia and activo;
  if not found then raise exception 'SERVICIO_NO_EXISTE'; end if;

  if char_length(v_nombre) not between 2 and 60 then raise exception 'NOMBRE_INVALIDO'; end if;
  if p_inicio is null then raise exception 'HORARIO_NO_DISPONIBLE'; end if;

  -- Teléfono en blanco = turno sin WhatsApp (queda solo el nombre); uno con contenido
  -- que no se puede normalizar es un error, no se descarta en silencio.
  if btrim(coalesce(p_telefono, ''), E' \t\r\n\f\v') <> '' then
    v_tel := app.normalizar_telefono(p_telefono, v_barberia.codigo_area);
    if v_tel is null then raise exception 'TELEFONO_INVALIDO'; end if;
  end if;

  v_barbero := app.barbero_principal(p_barberia);
  if v_barbero is null then raise exception 'HORARIO_NO_DISPONIBLE'; end if;

  -- Mismo lock que reservar y crear_bloqueo: se serializa contra reservas simultáneas.
  perform 1 from public.barberos where id = v_barbero for update;

  if v_tel is not null then
    -- Igual que reservar: el nombre ya guardado de un cliente no se pisa.
    insert into public.clientes (barberia_id, telefono, nombre)
    values (p_barberia, v_tel, v_nombre)
    on conflict (barberia_id, telefono) do update set nombre = public.clientes.nombre
    returning id into v_cliente_id;
  end if;

  begin
    insert into public.turnos (barberia_id, barbero_id, servicio_id, cliente_id, nombre_manual,
                               inicio, fin, origen, creado)
    values (p_barberia, v_barbero, v_servicio.id, v_cliente_id,
            case when v_cliente_id is null then v_nombre end,
            p_inicio, p_inicio + make_interval(mins => v_servicio.duracion_min),
            'manual', app.ahora())
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'HORARIO_NO_DISPONIBLE';
  end;
  return v_id;
end $$;
revoke execute on function public.crear_turno_manual(uuid, uuid, timestamptz, text, text) from public;
grant execute on function public.crear_turno_manual(uuid, uuid, timestamptz, text, text) to authenticated;

-- ---------- 2. Bloqueo ----------
-- No cancela nada: devuelve los turnos confirmados que quedan dentro del bloqueo para que
-- el dueño decida a quién avisar.
create or replace function public.crear_bloqueo(p_barberia uuid, p_inicio timestamptz,
    p_fin timestamptz, p_motivo text)
returns json
language plpgsql security definer set search_path = public, app as $$
declare
  v_barbero uuid;
  v_id uuid;
  v_afectados json;
begin
  if not app.es_miembro(p_barberia) then raise exception 'NO_AUTORIZADO'; end if;
  if p_inicio is null or p_fin is null or p_fin <= p_inicio then
    raise exception 'RANGO_INVALIDO';
  end if;

  v_barbero := app.barbero_principal(p_barberia);
  if v_barbero is null then raise exception 'HORARIO_NO_DISPONIBLE'; end if;

  -- El mismo lock que reservar: una reserva en curso termina antes de que el bloqueo
  -- exista, así `afectados` no se pierde un turno que se está confirmando justo ahora.
  perform 1 from public.barberos where id = v_barbero for update;

  insert into public.bloqueos (barberia_id, barbero_id, inicio, fin, motivo)
  values (p_barberia, v_barbero, p_inicio, p_fin, p_motivo)
  returning id into v_id;

  select coalesce(json_agg(json_build_object(
           'turno_id', t.id, 'inicio', t.inicio,
           'nombre', coalesce(c.nombre, t.nombre_manual), 'telefono', c.telefono)
         order by t.inicio), '[]'::json)
  into v_afectados
  from public.turnos t
  left join public.clientes c on c.id = t.cliente_id
  where t.barbero_id = v_barbero and t.estado = 'confirmado'
    and tstzrange(t.inicio, t.fin) && tstzrange(p_inicio, p_fin);

  return json_build_object('id', v_id, 'afectados', v_afectados);
end $$;
revoke execute on function public.crear_bloqueo(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.crear_bloqueo(uuid, timestamptz, timestamptz, text) to authenticated;

-- ---------- 3. Agenda del día ----------
-- El "día" es el de la barbería (su zona), no el de la sesión. Las franjas salen con la
-- misma regla que app.slots: hora de pared + zona.
create or replace function public.agenda_dia(p_barberia uuid, p_fecha date) returns json
language plpgsql stable security definer set search_path = public, app as $$
declare
  v_zona text;
  v_dia_ini timestamptz;
  v_dia_fin timestamptz;
  v_barbero uuid;
  v_franjas json;
  v_turnos json;
  v_bloqueos json;
begin
  if not app.es_miembro(p_barberia) then raise exception 'NO_AUTORIZADO'; end if;
  select zona_horaria into v_zona from public.barberias where id = p_barberia;
  v_dia_ini := p_fecha::timestamp at time zone v_zona;
  v_dia_fin := (p_fecha + 1)::timestamp at time zone v_zona;
  v_barbero := app.barbero_principal(p_barberia);

  select coalesce(json_agg(json_build_object(
           'desde', (p_fecha + h.desde) at time zone v_zona,
           'hasta', (p_fecha + h.hasta) at time zone v_zona) order by h.desde, h.hasta), '[]'::json)
  into v_franjas
  from public.horarios h
  where h.barbero_id = v_barbero and h.dia_semana = extract(dow from p_fecha)::int;

  -- Todos los estados: la pantalla muestra también los cancelados y los que no vinieron.
  select coalesce(json_agg(json_build_object(
           'id', t.id, 'inicio', t.inicio, 'fin', t.fin, 'estado', t.estado,
           'origen', t.origen, 'servicio', s.nombre,
           'nombre', coalesce(c.nombre, t.nombre_manual), 'telefono', c.telefono,
           'faltas', case when c.id is null then 0 else app.faltas(c.id) end)
         order by t.inicio, t.id), '[]'::json)
  into v_turnos
  from public.turnos t
  join public.servicios s on s.id = t.servicio_id
  left join public.clientes c on c.id = t.cliente_id
  where t.barberia_id = p_barberia and t.inicio >= v_dia_ini and t.inicio < v_dia_fin;

  select coalesce(json_agg(json_build_object(
           'id', b.id, 'inicio', b.inicio, 'fin', b.fin, 'motivo', b.motivo)
         order by b.inicio, b.id), '[]'::json)
  into v_bloqueos
  from public.bloqueos b
  where b.barberia_id = p_barberia and b.inicio < v_dia_fin and b.fin > v_dia_ini;

  return json_build_object('franjas', v_franjas, 'turnos', v_turnos, 'bloqueos', v_bloqueos);
end $$;
revoke execute on function public.agenda_dia(uuid, date) from public;
grant execute on function public.agenda_dia(uuid, date) to authenticated;

-- ---------- 4. Marcar un turno ----------
create or replace function public.marcar_turno(p_turno uuid, p_estado text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_barberia uuid;
begin
  -- Primero la autorización (con el mismo error para id ajeno e inexistente) y recién
  -- después el estado: un extraño no debe poder distinguir nada por el tipo de error.
  select barberia_id into v_barberia from public.turnos where id = p_turno;
  if v_barberia is null or not app.es_miembro(v_barberia) then
    raise exception 'NO_AUTORIZADO';
  end if;
  if p_estado is null or p_estado not in ('atendido', 'no_vino', 'cancelado', 'confirmado') then
    raise exception 'ESTADO_INVALIDO';
  end if;

  begin
    update public.turnos set estado = p_estado where id = p_turno;
  exception when exclusion_violation then
    -- Deshacer a `confirmado` cuando el hueco ya lo ocupó otro turno.
    raise exception 'HORARIO_NO_DISPONIBLE';
  end;
end $$;
revoke execute on function public.marcar_turno(uuid, text) from public;
grant execute on function public.marcar_turno(uuid, text) to authenticated;

-- ---------- 5. Faltas ----------
create or replace function public.clientes_con_faltas(p_barberia uuid) returns json
language plpgsql stable security definer set search_path = public, app as $$
declare
  v_faltas_max int;
begin
  if not app.es_miembro(p_barberia) then raise exception 'NO_AUTORIZADO'; end if;
  select faltas_max into v_faltas_max from public.barberias where id = p_barberia;

  return coalesce((
    select json_agg(json_build_object('id', x.id, 'nombre', x.nombre, 'telefono', x.telefono,
                                      'faltas', x.faltas, 'bloqueado', x.faltas >= v_faltas_max)
                    order by x.faltas desc, x.nombre, x.id)
    from (select c.id, c.nombre, c.telefono, app.faltas(c.id) as faltas
          from public.clientes c where c.barberia_id = p_barberia) x
    where x.faltas > 0
  ), '[]'::json);
end $$;
revoke execute on function public.clientes_con_faltas(uuid) from public;
grant execute on function public.clientes_con_faltas(uuid) to authenticated;

-- "Perdonar": no se borran los no_vino (queda la historia), se mueve la fecha desde la
-- cual cuentan.
create or replace function public.desbloquear_cliente(p_cliente uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_barberia uuid;
begin
  select barberia_id into v_barberia from public.clientes where id = p_cliente;
  if v_barberia is null or not app.es_miembro(v_barberia) then
    raise exception 'NO_AUTORIZADO';
  end if;
  update public.clientes set desbloqueado_en = app.ahora() where id = p_cliente;
end $$;
revoke execute on function public.desbloquear_cliente(uuid) from public;
grant execute on function public.desbloquear_cliente(uuid) to authenticated;
