-- Horarios libres: se calculan en la base, no en el navegador, para que el público
-- (anon) vea solo los huecos y nunca los datos de los turnos ajenos.

-- "Barbero principal" = el más antiguo activo. Hace falta una marca de alta: la tabla
-- no la tenía. Las filas existentes quedan con la hora de la migración (da igual el orden).
alter table barberos add column creado timestamptz not null default now();

-- Por ahora cada barbería agenda con un solo barbero; esta función es el único lugar que
-- decide cuál, así sumar elección de barbero después no toca a los llamadores.
-- Desempate por id para que el resultado sea estable si dos comparten `creado`.
create or replace function app.barbero_principal(p_barberia uuid) returns uuid
language sql stable security definer set search_path = public, app as $$
  select b.id from public.barberos b
  where b.barberia_id = p_barberia and b.activo
  order by b.creado, b.id
  limit 1
$$;

-- Inicios posibles de un servicio para un barbero en una fecha (la fecha es del
-- calendario de la barbería). Devuelve instantes (timestamptz) ordenados.
-- p_ignorar_reglas = true saltea anticipación y ventana de días: lo usa el dueño al
-- cargar un turno manual a mano; los choques con turnos y bloqueos se respetan siempre.
create or replace function app.slots(p_barbero uuid, p_servicio uuid, p_fecha date,
                                     p_ignorar_reglas boolean default false)
returns setof timestamptz
language plpgsql stable security definer set search_path = public, app as $$
declare
  v_barberia public.barberias%rowtype;
  v_dur interval;
  v_hoy date;
begin
  select b.* into v_barberia
  from public.barberos br join public.barberias b on b.id = br.barberia_id
  where br.id = p_barbero;
  if not found then return; end if;

  -- El servicio tiene que ser de la misma barbería (el barbero y el servicio vienen
  -- del cliente: no se confía en que coincidan) y estar activo.
  select make_interval(mins => s.duracion_min) into v_dur
  from public.servicios s
  where s.id = p_servicio and s.barberia_id = v_barberia.id and s.activo;
  if not found then return; end if;

  -- "Hoy" según el calendario de la barbería, no el de la sesión ni UTC: a las 22:00
  -- de Buenos Aires ya es el día siguiente en UTC.
  v_hoy := (app.ahora() at time zone v_barberia.zona_horaria)::date;
  if not p_ignorar_reglas
     and (p_fecha < v_hoy or p_fecha > v_hoy + v_barberia.dias_adelante) then
    return;
  end if;

  return query
  with franja as (
    select h.desde, h.hasta
    from public.horarios h
    where h.barbero_id = p_barbero and h.dia_semana = extract(dow from p_fecha)::int
  ),
  candidato as (
    -- Se genera con hora de pared (timestamp sin zona) y recién después se interpreta en
    -- la zona de la barbería: así "09:00" es 09:00 allá aunque la sesión esté en otra zona.
    select (g.t at time zone v_barberia.zona_horaria) as inicio,
           ((g.t + v_dur) at time zone v_barberia.zona_horaria) as fin
    from franja f,
         generate_series(p_fecha + f.desde, p_fecha + f.hasta - v_dur,
                         make_interval(mins => v_barberia.paso_min)) as g(t)
  )
  -- distinct: si el dueño carga franjas que se superponen (09-13 y 10-12), el mismo
  -- inicio saldría repetido.
  select distinct c.inicio
  from candidato c
  where (p_ignorar_reglas or c.inicio >= app.ahora() + make_interval(mins => v_barberia.anticipacion_min))
    -- Rangos [inicio, fin): un turno que termina justo cuando empieza otro no se pisa.
    and not exists (select 1 from public.turnos t
                    where t.barbero_id = p_barbero and t.estado = 'confirmado'
                      and tstzrange(t.inicio, t.fin) && tstzrange(c.inicio, c.fin))
    and not exists (select 1 from public.bloqueos bl
                    where bl.barbero_id = p_barbero
                      and tstzrange(bl.inicio, bl.fin) && tstzrange(c.inicio, c.fin))
  order by c.inicio;
end $$;

-- RPC pública: horarios libres de un día. Slug, servicio o barbería inválidos → vacío
-- (no error), para no revelar qué existe.
create or replace function public.disponibilidad(p_slug text, p_servicio uuid, p_fecha date)
returns setof timestamptz
language sql stable security definer set search_path = public, app as $$
  select s
  from public.barberias b,
       lateral app.slots(app.barbero_principal(b.id), p_servicio, p_fecha) s
  where b.slug = p_slug and b.activa
  order by s
$$;
revoke execute on function public.disponibilidad(text, uuid, date) from public;
grant execute on function public.disponibilidad(text, uuid, date) to anon, authenticated;

-- RPC pública: días de hoy a hoy + dias_adelante con al menos un horario libre.
create or replace function public.dias_disponibles(p_slug text, p_servicio uuid)
returns setof date
language sql stable security definer set search_path = public, app as $$
  -- Se suma i a la fecha local de la barbería: aritmética de fechas pura, sin pasar por
  -- timestamptz (donde la zona de la sesión o un cambio de horario podrían correr el día).
  select ((app.ahora() at time zone b.zona_horaria)::date + i) as d
  from public.barberias b,
       lateral generate_series(0, b.dias_adelante) i
  where b.slug = p_slug and b.activa
    and exists (select 1 from app.slots(app.barbero_principal(b.id), p_servicio,
                                        (app.ahora() at time zone b.zona_horaria)::date + i))
  order by d
$$;
revoke execute on function public.dias_disponibles(text, uuid) from public;
grant execute on function public.dias_disponibles(text, uuid) to anon, authenticated;
