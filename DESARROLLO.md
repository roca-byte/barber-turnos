# Desarrollo

## Pruebas

```
node --test tests/*.test.js   # reglas puras en JS
node tests/sql/correr.js    # base de datos (esquema, funciones, RLS)
node tests/sql/correr.js --solo 01_esquema.test.sql   # una sola prueba SQL
node tests/e2e-cliente.js   # página del cliente en Chromium, Supabase simulado
node tests/e2e-panel.js     # panel del barbero en Chromium, Supabase simulado
node tests/e2e-real.js <slug>   # MANUAL, usa la red: ver "Prueba contra el Supabase real"
```

### Banco de pruebas SQL

No hace falta Supabase ni Docker: `correr.js` usa los binarios de Postgres 16
(`/usr/lib/postgresql/16/bin`, o `PG_BIN=...`) y no instala nada.

1. Crea un cluster temporal con `initdb` y lo levanta en un puerto libre. Si corre como
   root (contenedores) ejecuta Postgres como el usuario `postgres`.
2. Arma una base plantilla: `tests/sql/stub_supabase.sql` (imita solo los roles y
   `auth.users`/`auth.uid()` de Supabase) y cada migración de `supabase/migrations/` en
   orden. Las que terminan en `_remoto.sql` se saltean: solo valen en el Supabase real.
3. Cada prueba corre en su propia base, clonada de la plantilla: ninguna deja datos
   para la siguiente. Se ejecutan en orden de nombre.
4. Apaga y borra el cluster. Sale con 0 si pasó todo y 1 si falló algo.

Dos tipos de prueba en `tests/sql/`:

- `*.test.sql`: script con bloques `DO $$ ... $$` y `ASSERT`; corre con `ON_ERROR_STOP`,
  así que el primer error la hace fallar. Para probar que algo se rechaza, atrapá la
  excepción esperada dentro del bloque y poné `assert false` justo después del insert.
- `*.test.js`: `module.exports = async function (sql) {...}`. `sql(texto, params)` ejecuta
  la consulta (parámetros `$1`, `$2`...) y devuelve las filas como objetos; la prueba
  tira una excepción si algo está mal. Sirve para probar funciones con varios roles.

El reloj de las pruebas se fija con `set app.ahora = '2026-12-01 12:00-03'`;
las funciones usan `app.ahora()` en vez de `now()`.

## Configuración de la función `notificar`

La Edge Function no usa secretos propios: lee su configuración de `app.ajustes_privados`
con `public.ajustes_notificar()` (solo `service_role` la ejecuta) y la guarda 5 minutos en
memoria. Se aplican `2026112207`, `2026112208` y `2026112209` (las tres `_remoto`) en el SQL
Editor del Supabase real. A mano se cargan solo DOS filas, una sola vez y nunca en el repo; el
secreto se genera en SQL, no se escribe ni se pega en ningún lado:

```
insert into app.ajustes_privados values
  ('url_notificar',     'https://<proyecto>.supabase.co/functions/v1/notificar'),
  ('secreto_notificar', encode(gen_random_bytes(32), 'hex'));
```

Las claves VAPID las genera la propia función la primera vez que recibe un pedido (cualquiera,
aunque sea rechazado) y las guarda con `guardar_vapid()`, junto con `vapid_contacto`. El
navegador pide la clave pública con `vapid_publica()` (`Api.vapidPublica()`); mientras no
exista, "Activar notificaciones" avisa que todavía no está lista. Si un día se rotan las
claves, hay que borrar las filas `vapid_*` y todas las suscripciones, porque quedan inválidas, y desactivar y volver a activar las notificaciones en cada celular.

Desplegar con `supabase functions deploy notificar`: `supabase/config.toml` ya trae
`verify_jwt = false` (la llama el trigger de la base con su secreto, no un JWT de usuario).

Si falta el secreto o la url la función responde 500 y no manda nada. Para rotar un valor, un
`update` y esperar hasta 5 minutos (o redesplegar la función).

## Alta de una barbería

1. En Supabase: Authentication -> Users -> "Add user" (email y contraseña, "Auto confirm").
2. Abrí `docs/alta-barberia.sql`, editá las cuatro variables del principio (slug, nombre,
   whatsapp, email del usuario) y pegalo en el SQL Editor. Crea la barbería, su barbero, la
   membresía, el servicio "Corte" (30 min) y los horarios de lunes a sábado. Al final avisa
   el link público. El archivo trae también cómo pausar una barbería (`activa = false`).

## Prueba contra el Supabase real

```
node tests/e2e-real.js <slug> [carpeta-de-capturas]
```

Es la única prueba que usa la red de verdad (la base de `js/config.js`); nunca corre sola.
`<slug>` tiene que ser una barbería de prueba con servicio y horarios (la del alta sirve).
Reserva, abre el link del turno y lo cancela, sin claves ni login. Imprime `Todo bien` o sale
con 1, y siempre muestra el token: si algo falla a mitad de camino, el turno queda
confirmado y se borra por SQL (`delete from turnos where token = '<token>'`). El cliente
"Prueba E2E" también queda en `clientes`; se borra a mano si molesta.
