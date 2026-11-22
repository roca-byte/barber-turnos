-- Reservar, ver y cancelar un turno desde el link público (sin cuenta).
-- Los errores son `raise exception '<CODIGO>'`: el front los traduce a mensajes humanos.

-- ---------- 1. Ajustes con valores razonables ----------
-- Un paso de 0 haría que generate_series no avance nunca; una ventana de 10 años o un
-- límite de 0 turnos dejarían la barbería inutilizable. La base lo frena aunque el
-- formulario del dueño falle.
alter table barberias
  add constraint barberias_paso_min_ck check (paso_min between 5 and 60),
  add constraint barberias_anticipacion_min_ck check (anticipacion_min >= 0),
  add constraint barberias_dias_adelante_ck check (dias_adelante between 1 and 90),
  add constraint barberias_cancelacion_horas_ck check (cancelacion_horas >= 0),
  add constraint barberias_faltas_max_ck check (faltas_max >= 1),
  add constraint barberias_turnos_futuros_max_ck check (turnos_futuros_max >= 1),
  add constraint barberias_reservas_por_hora_ip_ck check (reservas_por_hora_ip >= 1);

-- ---------- 2. Faltas ----------
-- Se cuentan los `no_vino` posteriores al último desbloqueo: así el dueño "perdona" sin
-- borrar historia. Bloqueado <=> faltas >= faltas_max de la barbería.
create or replace function app.faltas(p_cliente uuid) returns int
language sql stable security definer set search_path = public, app as $$
  select count(*)::int
  from public.turnos t
  join public.clientes c on c.id = t.cliente_id
  where c.id = p_cliente and t.estado = 'no_vino'
    and t.inicio > coalesce(c.desbloqueado_en, '-infinity'::timestamptz)
$$;

-- ---------- 3. Reservar ----------
create or replace function public.reservar(p_slug text, p_servicio uuid, p_inicio timestamptz,
                                           p_nombre text, p_telefono text)
returns text
language plpgsql security definer set search_path = public, app as $$
declare
  v_barberia public.barberias%rowtype;
  v_servicio public.servicios%rowtype;
  v_barbero uuid;
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_tel text;
  v_cliente public.clientes%rowtype;
  v_ip text;
  v_token text;
begin
  select * into v_barberia from public.barberias where slug = p_slug and activa;
  if not found then raise exception 'BARBERIA_NO_EXISTE'; end if;

  select * into v_servicio from public.servicios
  where id = p_servicio and barberia_id = v_barberia.id and activo;
  if not found then raise exception 'SERVICIO_NO_EXISTE'; end if;

  if char_length(v_nombre) not between 2 and 60 then raise exception 'NOMBRE_INVALIDO'; end if;

  v_tel := app.normalizar_telefono(p_telefono, v_barberia.codigo_area);
  if v_tel is null then raise exception 'TELEFONO_INVALIDO'; end if;

  v_barbero := app.barbero_principal(v_barberia.id);
  if v_barbero is null then raise exception 'HORARIO_NO_DISPONIBLE'; end if;

  -- Serializa contra otras reservas y contra crear_bloqueo del mismo barbero: sin esto,
  -- dos personas podrían ver el slot libre a la vez. (La exclusión de la tabla es la
  -- red de seguridad final; el lock evita llegar a ella en el caso común.)
  perform 1 from public.barberos where id = v_barbero for update;

  -- La fecha se interpreta en la zona de la barbería, no en la de la sesión.
  if not exists (
    select 1 from app.slots(v_barbero, v_servicio.id,
                            (p_inicio at time zone v_barberia.zona_horaria)::date) s
    where s = p_inicio
  ) then
    raise exception 'HORARIO_NO_DISPONIBLE';
  end if;

  insert into public.clientes (barberia_id, telefono, nombre)
  values (v_barberia.id, v_tel, v_nombre)
  on conflict (barberia_id, telefono) do update set nombre = excluded.nombre
  returning * into v_cliente;

  if app.faltas(v_cliente.id) >= v_barberia.faltas_max then
    raise exception 'CLIENTE_BLOQUEADO';
  end if;

  if (select count(*) from public.turnos t
      where t.cliente_id = v_cliente.id and t.estado = 'confirmado' and t.inicio > app.ahora())
     >= v_barberia.turnos_futuros_max then
    raise exception 'LIMITE_TURNOS';
  end if;

  -- IP: primer elemento de x-forwarded-for (el cliente real; el resto son proxies).
  v_ip := coalesce(nullif(trim(split_part(
            coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''),
            ',', 1)), ''), 'desconocida');

  -- Cuentan también los turnos ya cancelados: cancelar y reservar en bucle sigue siendo spam.
  if (select count(*) from public.turnos t
      where t.barberia_id = v_barberia.id and t.origen = 'online' and t.ip_origen = v_ip
        and t.creado > app.ahora() - interval '1 hour')
     >= v_barberia.reservas_por_hora_ip then
    raise exception 'LIMITE_HORA';
  end if;

  begin
    insert into public.turnos (barberia_id, barbero_id, servicio_id, cliente_id, inicio, fin,
                               origen, ip_origen, creado)
    values (v_barberia.id, v_barbero, v_servicio.id, v_cliente.id, p_inicio,
            p_inicio + make_interval(mins => v_servicio.duracion_min),
            'online', v_ip, app.ahora())
    returning token into v_token;
  exception when exclusion_violation then
    raise exception 'HORARIO_NO_DISPONIBLE';
  end;

  return v_token;
end $$;
revoke execute on function public.reservar(text, uuid, timestamptz, text, text) from public;
grant execute on function public.reservar(text, uuid, timestamptz, text, text) to anon, authenticated;

-- ---------- 4. Ver el turno por token ----------
-- Solo lo que necesita la pantalla del cliente: nunca el teléfono, la IP ni los ajustes
-- internos de la barbería. Token inexistente -> null (no revela nada).
create or replace function public.ver_turno(p_token text) returns json
language sql stable security definer set search_path = public, app as $$
  select json_build_object(
    'estado', t.estado, 'inicio', t.inicio, 'fin', t.fin,
    'servicio', s.nombre,
    'barberia', json_build_object('nombre', b.nombre, 'direccion', b.direccion,
                                  'whatsapp', b.whatsapp, 'zona_horaria', b.zona_horaria,
                                  'slug', b.slug),
    'cliente_nombre', coalesce(c.nombre, t.nombre_manual),
    'puede_cancelar', t.estado = 'confirmado'
                      and app.ahora() < t.inicio - make_interval(hours => b.cancelacion_horas))
  from public.turnos t
  join public.barberias b on b.id = t.barberia_id
  join public.servicios s on s.id = t.servicio_id
  left join public.clientes c on c.id = t.cliente_id
  where t.token = p_token
$$;
revoke execute on function public.ver_turno(text) from public;
grant execute on function public.ver_turno(text) to anon, authenticated;

-- ---------- 5. Cancelar ----------
create or replace function public.cancelar_turno(p_token text) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_turno public.turnos%rowtype;
  v_horas int;
begin
  select * into v_turno from public.turnos where token = p_token for update;
  if not found then raise exception 'TURNO_NO_EXISTE'; end if;

  select cancelacion_horas into v_horas from public.barberias where id = v_turno.barberia_id;
  if v_turno.estado <> 'confirmado'
     or app.ahora() >= v_turno.inicio - make_interval(hours => v_horas) then
    raise exception 'FUERA_DE_PLAZO';
  end if;

  update public.turnos set estado = 'cancelado' where id = v_turno.id;
end $$;
revoke execute on function public.cancelar_turno(text) from public;
grant execute on function public.cancelar_turno(text) to anon, authenticated;
