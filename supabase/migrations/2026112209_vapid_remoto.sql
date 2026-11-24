-- 2026112209_vapid_remoto.sql — las claves VAPID las genera el servidor, no una persona.
-- SOLO PARA EL SUPABASE REAL (sufijo _remoto): depende de app.ajustes_privados, que crea
-- 2026112207_notificar_remoto.sql. Se aplica a mano en el SQL Editor, después de 2207 y 2208.
--
-- Por qué: ninguna clave privada ni secreto tiene que pasar por una persona ni por un chat.
-- La función `notificar` genera el par VAPID la primera vez que carga su configuración y lo
-- guarda acá con guardar_vapid(); el navegador pide solo la clave PÚBLICA con vapid_publica().

-- security definer: escribe en app.ajustes_privados, que ni anon ni authenticated tocan.
-- search_path vacío: todo calificado, nadie puede secuestrar la función con un objeto homónimo.
create function public.guardar_vapid(p_publica text, p_privada text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pub int;
  v_priv int;
begin
  -- Dos instancias de la función pueden arrancar a la vez: gana la primera y la otra se
  -- queda con lo guardado (por eso `on conflict do nothing` y no `update`). Nunca se pisa
  -- una clave existente: eso dejaría sin efecto todas las suscripciones ya hechas.
  insert into app.ajustes_privados (clave, valor) values ('vapid_publica', p_publica)
    on conflict (clave) do nothing;
  get diagnostics v_pub = row_count;
  insert into app.ajustes_privados (clave, valor) values ('vapid_privada', p_privada)
    on conflict (clave) do nothing;
  get diagnostics v_priv = row_count;
  -- Una sola de las dos ya existía: el par quedó mezclado e inservible. Se aborta la
  -- transacción (deshace también el insert de arriba) y se avisa en vez de seguir.
  if v_pub <> v_priv then
    raise exception 'VAPID_INCOMPLETO';
  end if;
  insert into app.ajustes_privados (clave, valor)
    values ('vapid_contacto', 'https://roca-byte.github.io/barber-turnos/')
    on conflict (clave) do nothing;
end $$;

-- Está en public, así que PostgREST la expone: solo la clave de servicio (la Edge Function).
revoke execute on function public.guardar_vapid(text, text) from public, anon, authenticated;
grant execute on function public.guardar_vapid(text, text) to service_role;

-- La clave pública es pública por diseño (va en el navegador): la puede leer cualquiera.
-- Devuelve null mientras la función todavía no generó el par.
create function public.vapid_publica() returns text
language sql stable security definer set search_path = '' as $$
  select valor from app.ajustes_privados where clave = 'vapid_publica'
$$;

revoke execute on function public.vapid_publica() from public;
grant execute on function public.vapid_publica() to anon, authenticated;
