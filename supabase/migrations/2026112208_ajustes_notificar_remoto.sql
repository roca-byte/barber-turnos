-- 2026112208_ajustes_notificar_remoto.sql — la función `notificar` lee su configuración de la base.
-- SOLO PARA EL SUPABASE REAL (sufijo _remoto): depende de app.ajustes_privados, que crea
-- 2026112207_notificar_remoto.sql. Se aplica a mano en el SQL Editor, después de aquella.
--
-- Por qué: cargar secretos en la Edge Function obligaba a pegar la clave privada VAPID y el
-- secreto compartido en un chat o en un panel. En cambio se guardan en app.ajustes_privados
-- (RLS prendida, sin políticas, sin permisos para anon/authenticated) y la función los pide
-- con la clave de servicio a través de esta RPC.

-- security definer: lee app.ajustes_privados, que ni anon ni authenticated pueden tocar.
-- search_path vacío: todo calificado, nadie puede secuestrar la función con un objeto homónimo.
create function public.ajustes_notificar() returns json
language sql security definer set search_path = '' as $$
  select json_build_object(
    'secreto',        (select valor from app.ajustes_privados where clave = 'secreto_notificar'),
    'vapid_publica',  (select valor from app.ajustes_privados where clave = 'vapid_publica'),
    'vapid_privada',  (select valor from app.ajustes_privados where clave = 'vapid_privada'),
    'vapid_contacto', (select valor from app.ajustes_privados where clave = 'vapid_contacto'))
$$;

-- Está en public, así que PostgREST la expone: sin este revoke cualquiera con la clave
-- anónima podría leer la clave privada. Solo la clave de servicio (la Edge Function) la ejecuta.
revoke execute on function public.ajustes_notificar() from public, anon, authenticated;
grant execute on function public.ajustes_notificar() to service_role;

-- Filas a cargar (una sola vez, en el SQL Editor; nunca en el repo):
--   insert into app.ajustes_privados values
--     ('vapid_publica',  '<clave pública VAPID>'),
--     ('vapid_privada',  '<clave privada VAPID>'),
--     ('vapid_contacto', 'mailto:<contacto>');
-- (url_notificar y secreto_notificar ya se cargan según 2026112207.)
