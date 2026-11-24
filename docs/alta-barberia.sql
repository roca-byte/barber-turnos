-- Alta de una barbería nueva. Se pega en el SQL Editor de Supabase (corre como postgres,
-- así que se saltea RLS: por eso esto lo hace el admin y nunca la app).
--
-- Paso 0 (a mano, antes de correr esto): en Authentication -> Users -> "Add user" creá el
-- usuario del barbero con email y contraseña, y tildá "Auto confirm user". Ese email es
-- el que va en la variable v_email de abajo; con él se lo vincula a la barbería.
--
-- Paso 1: editá las cuatro variables y corré el bloque entero. Si algo falla (email
-- inexistente, slug repetido) el bloque se deshace completo y no queda nada a medias.

do $$
declare
  -- ===== EDITAR SOLO ESTAS CUATRO =====
  v_slug     text := 'mi-barberia';          -- 3 a 40 caracteres: minúsculas, números y guiones
  v_nombre   text := 'Mi Barbería';
  v_whatsapp text := '5491112345678';        -- con código de país, sin + ni espacios
  v_email    text := 'barbero@ejemplo.com';  -- el del usuario creado en el paso 0
  -- =====================================
  v_user     uuid;
  v_barberia uuid;
  v_barbero  uuid;
begin
  -- Se busca el usuario primero para fallar antes de insertar nada y con un mensaje claro.
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then
    raise exception 'No existe ningún usuario con el email %. Crealo primero en Authentication -> Users (paso 0).', v_email;
  end if;

  -- El resto de los ajustes (zona horaria, cancelación, días adelante...) usa los valores
  -- por defecto de la tabla; se cambian después con un update si hace falta.
  insert into barberias (slug, nombre, whatsapp)
  values (v_slug, v_nombre, v_whatsapp)
  returning id into v_barberia;

  -- Un solo barbero que se llama como la barbería: alcanza para una barbería de una persona.
  insert into barberos (barberia_id, nombre)
  values (v_barberia, v_nombre)
  returning id into v_barbero;

  insert into miembros (user_id, barberia_id) values (v_user, v_barberia);

  insert into servicios (barberia_id, nombre, duracion_min, orden)
  values (v_barberia, 'Corte', 30, 1);

  -- Lunes a sábado (1..6) en dos franjas; el domingo (0) queda cerrado.
  insert into horarios (barberia_id, barbero_id, dia_semana, desde, hasta)
  select v_barberia, v_barbero, d, f.desde, f.hasta
  from generate_series(1, 6) as d,
       (values ('09:00'::time, '13:00'::time), ('16:00'::time, '20:00'::time)) as f(desde, hasta);

  raise notice 'Listo. Link público para pasarle al barbero: https://roca-byte.github.io/barber-turnos/index.html?b=%', v_slug;
end $$;

-- ---------------------------------------------------------------------------
-- Dar de baja / pausar (descomentá y corré por separado). Con activa = false la barbería
-- deja de aparecer para los clientes, pero se conserva todo; para reactivarla, true.
--
-- update barberias set activa = false where slug = 'mi-barberia';
