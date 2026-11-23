-- 2026112207_notificar_remoto.sql — avisa a la función `notificar` cuando entra o se cancela un turno.
-- SOLO PARA EL SUPABASE REAL (sufijo _remoto): usa pg_net, que no existe en el Postgres local,
-- así que tests/sql/correr.js no la corre. Se aplica a mano en el SQL Editor (Task 12).
--
-- Antes de usarla hay que cargar dos filas en app.ajustes_privados (ver README / DESARROLLO):
--   insert into app.ajustes_privados values
--     ('url_notificar',    'https://<proyecto>.supabase.co/functions/v1/notificar'),
--     ('secreto_notificar', '<el mismo valor que NOTIFICAR_SECRETO>');

create extension if not exists pg_net;

-- Ajustes del servidor que no puede ver nadie desde la app (el secreto es uno de ellos).
-- RLS prendida y sin una sola política: ni anon ni authenticated leen ni escriben.
-- Se quitan además los permisos de tabla (cinturón y tirantes, como en 2026112203).
create table app.ajustes_privados (
  clave text primary key,
  valor text not null
);
alter table app.ajustes_privados enable row level security;
revoke all on app.ajustes_privados from anon, authenticated, public;

-- Se dispara desde un trigger de turnos, que corre con el rol de quien reserva (anon/authenticated).
-- Por eso es security definer: corre con el rol que aplica la migración, que sí puede leer
-- ajustes_privados y llamar a net.http_post. Sin eso, el revoke global de execute a public
-- (2026112203) y la RLS de la tabla le cerrarían el paso. search_path vacío: todo calificado.
create function app.avisar_turno() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secreto text;
begin
  select valor into v_url from app.ajustes_privados where clave = 'url_notificar';
  select valor into v_secreto from app.ajustes_privados where clave = 'secreto_notificar';
  -- Sin configurar: no se avisa, pero tampoco se rompe la reserva.
  if v_url is null or v_secreto is null then return new; end if;

  -- Solo importan altas y cambios de estado; la función decide si hay algo que avisar.
  if tg_op = 'UPDATE' and new.estado is not distinct from old.estado then return new; end if;

  -- http_post es asíncrono (encola el pedido): no demora ni hace fallar la transacción del turno.
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'tipo', tg_op,
      'nuevo', to_jsonb(new),
      'viejo', case when tg_op = 'UPDATE' then to_jsonb(old) else null end),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notificar-secreto', v_secreto)
  );
  return new;
exception when others then
  -- Un aviso que falla nunca tiene que impedir que alguien reserve.
  return new;
end $$;

-- Solo la dispara el trigger: nadie la llama directo.
revoke execute on function app.avisar_turno() from public, anon, authenticated;

create trigger turnos_avisar
  after insert or update of estado on public.turnos
  for each row execute function app.avisar_turno();
