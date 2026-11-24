# Desarrollo

## Pruebas

```
node --test tests/*.test.js   # reglas puras en JS
node tests/sql/correr.js    # base de datos (esquema, funciones, RLS)
node tests/sql/correr.js --solo 01_esquema.test.sql   # una sola prueba SQL
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
memoria. Se cargan en el SQL Editor del Supabase real, una sola vez y nunca en el repo,
después de aplicar `2026112207` y `2026112208` (ambas `_remoto`):

```
insert into app.ajustes_privados values
  ('url_notificar',     'https://<proyecto>.supabase.co/functions/v1/notificar'),
  ('secreto_notificar', '<secreto compartido, uno largo y al azar>'),
  ('vapid_publica',     '<clave pública VAPID>'),
  ('vapid_privada',     '<clave privada VAPID>'),
  ('vapid_contacto',    'mailto:<contacto>');
```

Si falta alguna fila la función responde 500 y no manda nada. Para rotar un valor, un
`update` y esperar hasta 5 minutos (o redesplegar la función).
