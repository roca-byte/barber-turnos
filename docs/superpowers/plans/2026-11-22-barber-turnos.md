# barber-turnos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App de turnos multi-barbería: el cliente reserva solo desde un link, el barbero
gestiona su agenda en un panel con login y recibe notificaciones push.

**Architecture:** Dos páginas estáticas (`index.html` cliente, `panel.html` barbero) en
JS puro sin build, publicadas en GitHub Pages. Toda la regla de negocio que tiene que ser
confiable (horarios libres, no superposición, faltas, límites) vive en Postgres (Supabase)
como funciones RPC y políticas RLS; el JS solo muestra. Una Edge Function manda el push.

**Tech Stack:** HTML/CSS/JS clásico (globals, sin módulos), `@supabase/supabase-js@2.49.4`
(UMD, copiado en `vendor/`), `qrcode-generator@1.4.4` (en `vendor/`), Postgres 16 +
`btree_gist`, Supabase Auth/Edge Functions (Deno, `npm:web-push@3.6.7`), pruebas con
`node --test` y SQL contra un Postgres 16 local.

**Spec:** `docs/superpowers/specs/2026-11-22-barber-turnos-design.md`

## Global Constraints

- Sin frameworks, sin npm en la app, sin build. Scripts clásicos, un objeto global por
  archivo, `if (typeof module !== 'undefined') module.exports = X;` al final de los puros.
- Todas las rutas relativas (`./x`), nunca `/x`. Base: `https://roca-byte.github.io/barber-turnos/`.
- Link de barbería: `index.html?b=<slug>`. Link del turno: `index.html?t=<token>`.
- Interfaz en español rioplatense (voseo). Comentarios en español explicando el porqué.
- Mobile first: botones de mínimo 48 px.
- Escapar todo texto del usuario con `Html.esc()` antes de `innerHTML`.
- Cada cambio en archivos de la app: subir `VERSION` en `sw.js`; archivo nuevo → sumarlo a `ARCHIVOS`.
- Zona horaria guardada por barbería, por defecto `America/Argentina/Buenos_Aires`. Toda
  hora que ve el usuario se muestra en la zona de la barbería, no la del dispositivo.
- Valores por defecto de ajustes: `cancelacion_horas=2`, `faltas_max=2`,
  `dias_adelante=21`, `anticipacion_min=30`, `paso_min=15`, `turnos_futuros_max=2`,
  `reservas_por_hora_ip=3`, `codigo_area='11'`, `plan='gratis'`.
- Nunca la clave de servicio ni la privada VAPID en el repo.
- Commits terminan con las líneas de atribución de la sesión.

## Review Focus

1. **Doble toque en "Reservar"** (dos pedidos casi juntos): queda un solo turno y el
   segundo pedido devuelve `HORARIO_NO_DISPONIBLE` o `LIMITE_TURNOS`; el botón se
   deshabilita mientras espera. → prueba en Task 5 y Task 8.
2. **Pantalla abierta con horarios viejos**: el horario ya lo tomó otro → mensaje claro y
   se recargan los horarios del día. → prueba en Task 8.
3. **Dispositivo en otra zona horaria** que la barbería: los horarios se muestran y
   reservan en hora de la barbería. → prueba en Task 7 (`Fechas`) y Task 4 (SQL).
4. **Servicio más largo que lo que queda de la franja / turno que cruza el fin de la
   franja**: no se ofrece. Franja con `hasta <= desde`: la base la rechaza. → Task 1 y Task 4.
5. **Link del turno abierto después** (ya pasó, ya cancelado, fuera del plazo de
   cancelación, token inválido): muestra el estado y no ofrece cancelar. → Task 5 y Task 8.

---

## Estructura de archivos

```
index.html, panel.html, manifest.json, sw.js, icons/
css/styles.css
vendor/supabase.js, vendor/qrcode.js
js/config.js     Global Config {url, clavePublica}
js/html.js       Global Html: esc(), $(), mostrar(), errores → texto
js/fechas.js     Global Fechas (puro): formato y aritmética en la zona de la barbería, .ics
js/telefono.js   Global Telefono (puro): normalizar(), mostrar()
js/agenda.js     Global Agenda (puro): huecos del día para el panel
js/api.js        Global Api: envuelve supabase-js (RPC y tablas)
js/reserva.js    Pantallas del cliente
js/panel.js      Pantallas del barbero (agenda, turno, manual, bloqueo)
js/config-panel.js  Configuración del barbero (servicios, horarios, ajustes, QR)
js/push.js       Global Push: suscribir/desuscribir
supabase/migrations/2026112201_esquema.sql
supabase/migrations/2026112202_telefono.sql
supabase/migrations/2026112203_seguridad.sql
supabase/migrations/2026112204_disponibilidad.sql
supabase/migrations/2026112205_reservas.sql
supabase/migrations/2026112206_panel.sql
supabase/migrations/2026112207_notificar_remoto.sql   (necesita pg_net; no corre local)
supabase/functions/notificar/index.ts, mensaje.js
tests/sql/stub_supabase.sql, tests/sql/correr.js, tests/sql/*.test.sql
tests/*.test.js
docs/alta-barberia.sql, docs/GUIA.md, DESARROLLO.md
```

Cambio respecto del spec (decisión del plan): no hay `js/slots.js` duplicando el cálculo
de horarios libres. La única fuente es SQL (`disponibilidad`); el panel también la usa.
`js/agenda.js` solo resta intervalos para dibujar huecos.

---

### Task 1: Base del repo, banco de pruebas SQL y esquema

**Files:**
- Create: `README.md`, `DESARROLLO.md`, `.gitignore`, `tests/sql/stub_supabase.sql`,
  `tests/sql/correr.js`, `supabase/migrations/2026112201_esquema.sql`,
  `tests/sql/01_esquema.test.sql`

**Interfaces:**
- Produces: tablas del spec §7.2 con estos agregados/cambios:
  - Todas las tablas hijas llevan `barberia_id` (para RLS simple) además de `barbero_id`.
  - `barberias`: `id uuid pk, slug text unique check (slug ~ '^[a-z0-9-]{3,40}$'), nombre,
    direccion, whatsapp, zona_horaria text default 'America/Argentina/Buenos_Aires',
    codigo_area text default '11', plan text default 'gratis', cancelacion_horas int default 2,
    faltas_max int default 2, dias_adelante int default 21, anticipacion_min int default 30,
    paso_min int default 15, turnos_futuros_max int default 2, reservas_por_hora_ip int default 3,
    activa bool default true`.
  - `horarios`: `dia_semana int check 0..6 (0 = domingo), desde time, hasta time, check (hasta > desde)`.
  - `clientes`: `telefono text, unique (barberia_id, telefono), nombre, desbloqueado_en timestamptz null`.
    (Sin columnas `faltas`/`bloqueado`: se calculan, ver Task 6.)
  - `turnos`: `estado text check in ('confirmado','cancelado','no_vino','atendido')`,
    `origen check in ('online','manual')`, `token text unique default encode(gen_random_bytes(18),'hex')`,
    `ip_origen text null`, `cliente_id null` (turno manual sin WhatsApp guarda `nombre_manual`),
    `check (fin > inicio)`, y
    `exclude using gist (barbero_id with =, tstzrange(inicio, fin) with &&) where (estado = 'confirmado')`.
  - `bloqueos`: `inicio, fin timestamptz, check (fin > inicio), motivo text`.
  - `push_suscripciones`: `user_id uuid, barberia_id, endpoint text unique, p256dh, auth`.
  - `app.ahora() returns timestamptz`: `now()` salvo que `current_setting('app.ahora', true)`
    tenga valor (las pruebas fijan el reloj así).
- Produces: `node tests/sql/correr.js` crea un cluster temporal (`initdb` en un dir temporal,
  `pg_ctl` en un puerto libre), aplica `stub_supabase.sql`, luego cada migración en orden
  salvo las que terminan en `_remoto.sql`, luego cada `*.test.sql`; sale 0/1. Acepta
  `--solo <archivo>`.
- `stub_supabase.sql` imita lo mínimo de Supabase: roles `anon`, `authenticated`,
  `service_role`; esquema `auth` con tabla `auth.users(id uuid pk, email text)` y
  `auth.uid()` que lee `current_setting('request.jwt.claim.sub', true)::uuid`.

- [ ] **Step 1: Escribir `tests/sql/01_esquema.test.sql`** (bloques `DO $$ ... $$` con `ASSERT`;
  datos de prueba: una barbería `prueba`, un barbero, un servicio de 30 min):
  - insertar turno confirmado 10:00–10:30 y otro 10:15–10:45 → `exclusion_violation`.
  - el segundo con estado `cancelado` → se inserta.
  - turnos 10:00–10:30 y 10:30–11:00 (se tocan) → ambos se insertan.
  - horario con `hasta = desde` → `check_violation`.
  - turno con `fin = inicio` → `check_violation`.
  - `set app.ahora = '2026-12-01 12:00-03'` → `app.ahora() = '2026-12-01 15:00Z'`.
- [ ] **Step 2: Escribir `correr.js` y el stub; correr** `node tests/sql/correr.js` → FALLA (no hay migración).
- [ ] **Step 3: Escribir `2026112201_esquema.sql`** (`create extension if not exists btree_gist; pgcrypto`).
- [ ] **Step 4: Correr** `node tests/sql/correr.js` → `01_esquema.test.sql ok`, sale 0.
- [ ] **Step 5: Commit** `feat: esquema de datos y banco de pruebas SQL`.

`DESARROLLO.md` explica cómo correr las pruebas (`node --test tests/` y `node tests/sql/correr.js`).

---

### Task 2: Normalización de teléfonos (JS y SQL)

**Files:**
- Create: `js/telefono.js`, `tests/telefono.test.js`, `tests/casos-telefono.json`,
  `supabase/migrations/2026112202_telefono.sql`, `tests/sql/02_telefono.test.js`
  (el runner de Task 1 también corre `tests/sql/*.test.js` pasándoles una función `sql(texto, params)`).

**Interfaces:**
- Produces JS: `Telefono.normalizar(texto: string, codigoArea: string) -> string | null`
  (13 dígitos `549…` o `null`); `Telefono.mostrar(normalizado) -> string`
  (`5491112345678` → `+54 9 11 1234-5678`; área de 2 dígitos solo para `11`, si no 3 dígitos
  y número restante; formato visual, no se usa para comparar).
- Produces SQL: `app.normalizar_telefono(texto text, codigo_area text) returns text` (null si inválido).
- Algoritmo (idéntico en ambos):
  1. Dejar solo dígitos. Si empieza con `00`, sacarlo.
  2. Si empieza con `54`: sacar `54`; si lo que queda empieza con `9`, sacar el `9`.
     Si no empieza con `54`: si empieza con `0`, sacar el `0`.
  3. Si quedan 12 dígitos: el área es de 2 si empieza con `11`; si no, probar 3 y después 4;
     si en esa posición hay `15`, sacarlo (la primera que deje 10 dígitos).
  4. Si empieza con `15` (ningún código de área empieza así), sacar el `15`. Si quedan menos de 10 y `largo(codigo_area) + largo == 10`, anteponer `codigo_area`.
  5. Si quedan exactamente 10 dígitos y no empieza con `0` ni `1` salvo `11` → `'549' + resto`. Si no, `null`.

- [ ] **Step 1: Escribir `tests/casos-telefono.json`** (`[entrada, codigoArea, esperado]`):
  ```json
  [["011 15 1234-5678","11","5491112345678"],
   ["+54 9 11 1234 5678","11","5491112345678"],
   ["11 1234 5678","11","5491112345678"],
   ["15 1234 5678","11","5491112345678"],
   ["1234-5678","11","5491112345678"],
   ["0351 15 123-4567","351","5493511234567"],
   ["351 1234567","11","5493511234567"],
   ["0294 15 412-3456","294","5492944123456"],
   ["549 2944 12-3456","11","5492944123456"],
   ["0054 9 11 1234 5678","11","5491112345678"],
   ["12345","11",null], ["","11",null], ["hola","11",null]]
  ```
- [ ] **Step 2: `tests/telefono.test.js`** recorre los casos con `Telefono.normalizar`; más
  `Telefono.mostrar('5491112345678') === '+54 9 11 1234-5678'`. `tests/sql/02_telefono.test.js`
  recorre los mismos casos con `select app.normalizar_telefono($1,$2)`.
- [ ] **Step 3: Correr ambos** → FALLAN.
- [ ] **Step 4: Implementar** `js/telefono.js` y la migración.
- [ ] **Step 5: Correr** `node --test tests/` y `node tests/sql/correr.js` → PASAN.
- [ ] **Step 6: Commit** `feat: normalizar teléfonos argentinos al formato de WhatsApp`.

---

### Task 3: Seguridad (RLS) y datos públicos de la barbería

**Files:**
- Create: `supabase/migrations/2026112203_seguridad.sql`, `tests/sql/03_seguridad.test.sql`

**Interfaces:**
- Produces: `app.es_miembro(p_barberia uuid) returns bool` (security definer, `auth.uid()` en `miembros`).
- RLS activado en **todas** las tablas. Políticas solo para `authenticated`:
  `select/insert/update/delete using (app.es_miembro(barberia_id))` en `servicios`,
  `horarios`, `turnos`, `clientes`, `bloqueos`, `barberos`, `push_suscripciones`
  (esta además `user_id = auth.uid()`); `barberias`: select y update si es miembro
  (sin insert/delete); `miembros`: select propio. `anon`: ninguna política sobre tablas.
- Produces RPC pública: `public.barberia_publica(p_slug text) returns json`
  `{id, slug, nombre, direccion, whatsapp, zona_horaria, codigo_area, servicios: [{id, nombre, duracion_min, precio}]}`
  (solo activa y servicios activos ordenados por `orden`); `null` si no existe o inactiva.
  `grant execute` a `anon, authenticated`.
- Todas las funciones RPC de este plan viven en `public` (las expone la API), son
  `security definer`, `set search_path = public, app`, y las internas viven en `app`
  (no expuesto).

- [ ] **Step 1: Escribir pruebas** (cambian de rol con `set local role anon/authenticated` y
  `set local request.jwt.claim.sub = '<uuid>'`; dos barberías A y B, usuario uA miembro de A):
  - como `anon`: `select count(*) from turnos` → error de permisos o 0 filas; `barberia_publica('a')` devuelve nombre y 1 servicio activo (el inactivo no aparece).
  - como uA: ve turnos de A, `count(*)` de turnos de B = 0; `update turnos ... where barberia_id = B` afecta 0 filas; `insert` en servicios de B → `insufficient_privilege`/violación de RLS.
  - `barberia_publica('no-existe')` → `null`.
- [ ] **Step 2: Correr** → FALLAN. **Step 3: Implementar.** **Step 4: Correr** → PASAN.
- [ ] **Step 5: Commit** `feat: aislamiento por barbería con RLS`.

---

### Task 4: Horarios libres (`disponibilidad`, `dias_disponibles`)

**Files:**
- Create: `supabase/migrations/2026112204_disponibilidad.sql`, `tests/sql/04_disponibilidad.test.sql`

**Interfaces:**
- Produces: `app.barbero_principal(p_barberia uuid) returns uuid` (primer barbero activo por `creado`).
- Produces: `app.slots(p_barbero uuid, p_servicio uuid, p_fecha date, p_ignorar_reglas bool default false) returns setof timestamptz`.
  Para la fecha en la zona de la barbería: por cada franja de `horarios` de ese
  `dia_semana`, inicios `fecha + desde` (en la zona) cada `paso_min` mientras
  `inicio + duracion <= fecha + hasta`; descarta los que pisan un turno `confirmado` o un
  bloqueo; si no `p_ignorar_reglas`, descarta `inicio < app.ahora() + anticipacion_min` y
  fechas fuera de `[hoy, hoy + dias_adelante]` (hoy en la zona de la barbería).
- Produces RPC: `public.disponibilidad(p_slug text, p_servicio uuid, p_fecha date) returns setof timestamptz`
  y `public.dias_disponibles(p_slug text, p_servicio uuid) returns setof date` (días de
  hoy a hoy+dias_adelante con al menos un slot). Ambas para `anon, authenticated`.

- [ ] **Step 1: Pruebas** (reloj `app.ahora = '2026-12-01 08:00-03'` = martes; franjas martes 09:00–13:00 y 16:00–18:00; servicio 30 min; paso 15):
  - `disponibilidad(..., '2026-12-01')` → primero `09:00-03`, último `17:30-03`, sin `12:45` ni `13:00`, total 22 (15 de mañana + 7 de tarde).
  - con turno confirmado 10:00–10:30 → no aparecen `09:45`, `10:00`, `10:15`; aparece `10:30`. Con ese turno cancelado → aparecen.
  - bloqueo 16:00–18:00 → ningún slot de la tarde.
  - servicio de 60 min → último de la mañana `12:00`.
  - con reloj `'2026-12-01 09:20-03'` → el primero es `10:00` (anticipación 30).
  - `'2026-12-23'` (más de 21 días) → vacío; `'2026-11-30'` (pasado) → vacío.
  - domingo sin franjas → vacío. `dias_disponibles` no incluye domingos.
  - con `set timezone = 'Asia/Tokyo'` en la sesión, los resultados son los mismos instantes.
- [ ] **Step 2–4:** correr (falla), implementar, correr (pasa).
- [ ] **Step 5: Commit** `feat: cálculo de horarios libres en la base`.

---

### Task 5: Reservar, ver y cancelar (cliente)

**Files:**
- Create: `supabase/migrations/2026112205_reservas.sql`, `tests/sql/05_reservas.test.sql`

**Interfaces:**
- Errores: toda RPC falla con `raise exception '<CODIGO>'` usando uno de:
  `BARBERIA_NO_EXISTE`, `SERVICIO_NO_EXISTE`, `HORARIO_NO_DISPONIBLE`, `TELEFONO_INVALIDO`,
  `NOMBRE_INVALIDO`, `CLIENTE_BLOQUEADO`, `LIMITE_TURNOS`, `LIMITE_HORA`,
  `TURNO_NO_EXISTE`, `FUERA_DE_PLAZO`, `NO_AUTORIZADO`. (Task 7 los traduce.)
- Produces: `app.faltas(p_cliente uuid) returns int` = turnos `no_vino` con
  `inicio > coalesce(desbloqueado_en, '-infinity')`. Bloqueado ⇔ `faltas >= faltas_max`.
- Produces RPC (`anon, authenticated`):
  - `public.reservar(p_slug text, p_servicio uuid, p_inicio timestamptz, p_nombre text, p_telefono text) returns text` (token).
    Orden: barbería/servicio válidos; nombre `trim` de 2 a 60 caracteres; teléfono
    normalizado; `select ... from barberos where id = barbero for update` (serializa contra
    `crear_bloqueo`); `p_inicio` ∈ `app.slots(...)` si no `HORARIO_NO_DISPONIBLE`;
    upsert cliente por `(barberia_id, telefono)` actualizando nombre; bloqueado →
    `CLIENTE_BLOQUEADO`; turnos `confirmado` futuros del cliente `>= turnos_futuros_max`
    → `LIMITE_TURNOS`; turnos `online` creados en la última hora con el mismo `ip_origen`
    `>= reservas_por_hora_ip` → `LIMITE_HORA`; insertar con `origen='online'`; si salta
    `exclusion_violation` → `HORARIO_NO_DISPONIBLE`.
    IP: primer elemento de `current_setting('request.headers', true)::json->>'x-forwarded-for'`, o `'desconocida'`.
  - `public.ver_turno(p_token text) returns json`
    `{estado, inicio, fin, servicio, barberia: {nombre, direccion, whatsapp, zona_horaria, slug}, cliente_nombre, puede_cancelar}`;
    `puede_cancelar = estado='confirmado' and app.ahora() < inicio - cancelacion_horas`. Token inválido → `null`.
  - `public.cancelar_turno(p_token text) returns void`: no existe → `TURNO_NO_EXISTE`;
    no `puede_cancelar` → `FUERA_DE_PLAZO`; pone `cancelado`.

- [ ] **Step 1: Pruebas** (reloj y franjas de Task 4; fijar `request.headers` con distintas IP):
  - reservar 10:00 con `'011 15 1234-5678'` → token de 36 caracteres; turno `confirmado`, `online`, cliente con `5491112345678`.
  - segunda reserva 10:00 por otro número → `HORARIO_NO_DISPONIBLE`. Reserva 10:07 (no es slot) → `HORARIO_NO_DISPONIBLE`.
  - mismo número, 3ª reserva futura (desde otra IP) → `LIMITE_TURNOS`.
  - 4ª reserva en la hora desde la misma IP con números distintos → `LIMITE_HORA`.
  - teléfono `'123'` → `TELEFONO_INVALIDO`; nombre `' '` → `NOMBRE_INVALIDO`.
  - cliente con 2 `no_vino` → `CLIENTE_BLOQUEADO`; tras `desbloqueado_en = ahora` → puede.
  - `ver_turno(token)` → `puede_cancelar = true`; con reloj a 1 h del turno → `false` y `cancelar_turno` → `FUERA_DE_PLAZO`.
  - `cancelar_turno` dentro del plazo → estado `cancelado` y el horario vuelve a `disponibilidad`; cancelar de nuevo → `FUERA_DE_PLAZO`.
  - `ver_turno('xxx')` → `null`; `cancelar_turno('xxx')` → `TURNO_NO_EXISTE`.
  - como `anon`, `ver_turno` no expone el teléfono del cliente (la clave no está en el json).
- [ ] **Step 2–4:** correr (falla), implementar, correr (pasa).
- [ ] **Step 5: Commit** `feat: reservar, ver y cancelar turnos`.

---

### Task 6: Operaciones del panel

**Files:**
- Create: `supabase/migrations/2026112206_panel.sql`, `tests/sql/06_panel.test.sql`

**Interfaces (solo `authenticated`, todas verifican `app.es_miembro` o `NO_AUTORIZADO`):**
- `public.crear_turno_manual(p_barberia uuid, p_servicio uuid, p_inicio timestamptz, p_nombre text, p_telefono text default null) returns uuid`.
  Sin validar franjas ni anticipación (el barbero puede atender fuera de horario);
  sí no-superposición (`HORARIO_NO_DISPONIBLE`). Con teléfono → upsert cliente; sin
  teléfono → `nombre_manual`. `origen='manual'`.
- `public.crear_bloqueo(p_barberia uuid, p_inicio timestamptz, p_fin timestamptz, p_motivo text) returns json`
  → `{id, afectados: [{turno_id, inicio, nombre, telefono}]}` (turnos `confirmado` que
  pisa). Toma el mismo `for update` sobre el barbero que `reservar`. No cancela nada.
- `public.agenda_dia(p_barberia uuid, p_fecha date) returns json`
  → `{franjas: [{desde, hasta}] (timestamptz), turnos: [{id, inicio, fin, estado, origen, servicio, nombre, telefono, faltas}], bloqueos: [{id, inicio, fin, motivo}]}`.
- `public.marcar_turno(p_turno uuid, p_estado text) returns void` (`atendido`, `no_vino`,
  `cancelado`, `confirmado` para deshacer; volver a `confirmado` respeta la exclusión).
- `public.clientes_con_faltas(p_barberia uuid) returns json` → `[{id, nombre, telefono, faltas, bloqueado}]` con faltas > 0.
- `public.desbloquear_cliente(p_cliente uuid) returns void` → `desbloqueado_en = app.ahora()`.
- Servicios, horarios, ajustes de `barberias` y borrar bloqueos: directo por tabla con RLS (Task 3).

- [ ] **Step 1: Pruebas:**
  - uB (miembro de B) llama a cada RPC con la barbería A → `NO_AUTORIZADO`.
  - turno manual 20:00 (fuera de franja) → se crea; otro manual que lo pisa → `HORARIO_NO_DISPONIBLE`; manual sin teléfono → `cliente_id is null`, `nombre_manual` guardado.
  - bloqueo 10:00–12:00 con un turno confirmado 10:30 → `afectados` tiene ese turno; el turno sigue `confirmado`; `disponibilidad` ya no ofrece 11:00.
  - `marcar_turno(no_vino)` dos veces en turnos distintos del mismo cliente → `clientes_con_faltas` muestra `faltas=2, bloqueado=true`; `marcar_turno(t, 'atendido')` → `faltas=1`.
  - `desbloquear_cliente` → `bloqueado=false`, `faltas=0`.
  - `agenda_dia` del martes → 2 franjas, los turnos del día con nombre, el bloqueo.
- [ ] **Step 2–4:** correr (falla), implementar, correr (pasa).
- [ ] **Step 5: Commit** `feat: operaciones del panel del barbero`.

---

### Task 7: Base del frontend (utilidades puras, Api, PWA)

**Files:**
- Create: `js/config.js`, `js/html.js`, `js/fechas.js`, `js/agenda.js`, `js/api.js`,
  `css/styles.css`, `manifest.json`, `sw.js`, `icons/icon.svg`, `icons/icon-192.png`,
  `icons/icon-512.png`, `vendor/supabase.js`, `vendor/qrcode.js`,
  `tests/fechas.test.js`, `tests/agenda.test.js`, `tests/html.test.js`

**Interfaces:**
- `Config = { url: '<SUPABASE_URL>', clavePublica: '<PUBLISHABLE_KEY>' }` (se completa en Task 12).
- `Html.esc(texto) -> string`; `Html.mensajeError(codigo) -> string` con el texto en voseo para cada código de Task 5
  (p. ej. `HORARIO_NO_DISPONIBLE` → "Ese horario se acaba de ocupar. Elegí otro.";
  `CLIENTE_BLOQUEADO` → "No podés reservar online. Escribile a la barbería por WhatsApp.";
  `LIMITE_HORA` → "Hiciste muchas reservas seguidas. Probá en un rato."; desconocido → "Algo salió mal. Probá de nuevo.").
- `Fechas` (todas reciben la zona IANA; usan `Intl.DateTimeFormat`, nunca `toISOString` para fechas locales):
  `hora(isoInstante, zona) -> 'HH:MM'`, `diaLargo(fechaISO, zona) -> 'martes 1 de diciembre'`,
  `hoy(zona) -> 'AAAA-MM-DD'`, `sumarDias(fechaISO, n) -> 'AAAA-MM-DD'`,
  `instante(fechaISO, 'HH:MM', zona) -> isoInstante`, `ics({inicio, fin, titulo, lugar}) -> string` (VCALENDAR con DTSTART/DTEND en UTC `Z`).
- `Agenda.huecos(franjas: [{desde, hasta}], ocupados: [{inicio, fin}]) -> [{desde, hasta}]` (instantes ISO; resta intervalos; descarta huecos < 1 min).
- `Api` (async, devuelve datos o lanza `Error` con `.codigo` = código SQL): `barberia(slug)`,
  `dias(slug, servicioId)`, `horarios(slug, servicioId, fecha)`,
  `reservar(slug, servicioId, inicio, nombre, telefono)`, `verTurno(token)`, `cancelarTurno(token)`,
  `entrar(email, clave)`, `salir()`, `sesion()`, `miBarberia()`, `agendaDia(barberiaId, fecha)`,
  `turnoManual(...)`, `bloquear(...)`, `borrarBloqueo(id)`, `marcarTurno(id, estado)`,
  `clientesConFaltas(barberiaId)`, `desbloquear(clienteId)`, y CRUD
  `servicios/horarios/ajustes` sobre tablas.
- `sw.js`: `VERSION = 'barber-turnos-v1'`, `ARCHIVOS` con todo lo estático, red primero
  con caché de respaldo (como mash-check), borra solo cachés `barber-turnos-*` viejas.
  Nunca cachea llamadas a Supabase.

- [ ] **Step 1: Pruebas puras:**
  - `Fechas.hora('2026-12-01T13:00:00Z', 'America/Argentina/Buenos_Aires') === '10:00'` (corriendo con `TZ=Asia/Tokyo` y `TZ=UTC`: el script de prueba se lanza dos veces vía `process.env.TZ` en un subproceso o se verifica que no use la zona local).
  - `Fechas.instante('2026-12-01', '09:00', 'America/Argentina/Buenos_Aires') === '2026-12-01T12:00:00.000Z'`.
  - `Fechas.diaLargo('2026-12-01', ...) === 'martes 1 de diciembre'`; `Fechas.sumarDias('2026-12-31', 1) === '2027-01-01'`.
  - `Fechas.ics(...)` contiene `DTSTART:20261201T130000Z` y `END:VCALENDAR`.
  - `Agenda.huecos([{09:00–13:00}], [{10:00–10:30},{12:30–13:00}])` → `[09:00–10:00, 10:30–12:30]`; ocupado que excede la franja no rompe.
  - `Html.esc('<b>&"')  === '&lt;b&gt;&amp;&quot;'`; `Html.mensajeError('XYZ')` = texto genérico.
- [ ] **Step 2–4:** correr `node --test tests/` (falla), implementar, correr (pasa).
- [ ] **Step 5:** Bajar `vendor/` con versión fija: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js` y `https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js`.
- [ ] **Step 6: Commit** `feat: utilidades, Api y PWA base`.

---

### Task 8: Página del cliente

**Files:**
- Create: `index.html`, `js/reserva.js`, `tests/e2e-cliente.js`
- Modify: `sw.js` (VERSION, ARCHIVOS)

**Interfaces:** consume `Api`, `Fechas`, `Telefono`, `Html`.

Pantallas (spec §7.6), una a la vez dentro de `<main id="vista">`:
barbería (nombre, dirección, botón WhatsApp) → servicio → día (`Api.dias`, botones con
`Fechas.diaLargo`) → horario (`Api.horarios`, botones `Fechas.hora`) → datos (nombre,
WhatsApp; debajo "Te vamos a identificar con +54 9 11 1234-5678" en vivo con
`Telefono.mostrar`) → confirmación (día, hora, servicio, botón "Agregar a mi calendario"
que descarga `Fechas.ics`, botón "Mandarme el link por WhatsApp" →
`https://wa.me/<tel>?text=<link ?t=token>`, link del turno). `?t=token`: `Api.verTurno`;
muestra estado; botón "Cancelar turno" solo si `puede_cancelar`, con confirmación; si no,
"Ya no podés cancelar online" + WhatsApp de la barbería. `?b=` inexistente o sin
parámetro: "No encontramos esta barbería".

- [ ] **Step 1: `tests/e2e-cliente.js`** (Playwright, servidor local estático como en
  `calidad-no-conformidades/tests/e2e.js`, Supabase **simulado** con `page.route` sobre
  `**/rest/v1/rpc/*` devolviendo respuestas fijas; reloj del navegador fijo en
  `2026-12-01T08:00-03:00` y `timezoneId: 'Asia/Tokyo'`). Casos:
  - recorrido completo → la confirmación muestra "martes 1 de diciembre" y "10:00".
  - `reservar` responde error `HORARIO_NO_DISPONIBLE` → se ve el texto de `Html.mensajeError` y se vuelve a pedir `disponibilidad` del día.
  - doble clic en "Reservar" → una sola llamada a `rpc/reservar` (botón deshabilitado).
  - nombre `<img src=x onerror=alert(1)>` → se muestra como texto.
  - `?t=` con `puede_cancelar=false` → no hay botón "Cancelar turno"; con `null` → "No encontramos este turno".
  - `?b=` inexistente (`barberia_publica` → `null`) → "No encontramos esta barbería".
- [ ] **Step 2–4:** correr `node tests/e2e-cliente.js` (falla), implementar, correr (pasa).
- [ ] **Step 5: Commit** `feat: página pública de reservas`.

---

### Task 9: Panel — login y agenda

**Files:**
- Create: `panel.html`, `js/panel.js`, `tests/e2e-panel.js`
- Modify: `sw.js`

Pantallas: login (email, contraseña; error "Email o contraseña incorrectos") → agenda del
día (`Api.agendaDia`): lista por hora mezclando turnos, bloqueos y huecos
(`Agenda.huecos`), flechas día anterior/siguiente y "Hoy". Turno con faltas > 0 muestra
"⚠ N faltas". Tocar un turno: llamar (`tel:`), WhatsApp (`wa.me`), "Atendido",
"No vino", "Cancelar" (con confirmación), "Deshacer" si no es `confirmado`. Botón
"+ Turno" (servicio, hora, nombre, WhatsApp opcional → `Api.turnoManual`). Botón
"Bloquear" (desde, hasta, motivo → `Api.bloquear`; si hay `afectados`, lista con botón
WhatsApp prellenado "Hola <nombre>, tuve un imprevisto y no voy a poder atenderte el
<día> a las <hora>. ¿Lo pasamos a otro horario?" y botón "Cancelar este turno").
Pantalla "Clientes con faltas" con "Desbloquear". `panel.html?d=AAAA-MM-DD` abre ese día
(lo usa la notificación).

- [ ] **Step 1: `tests/e2e-panel.js`** (mismo esquema simulado; `auth/v1/token` simulado):
  - login correcto → agenda de hoy con 1 turno y huecos; login incorrecto → mensaje.
  - "No vino" → llama `rpc/marcar_turno` con `no_vino`.
  - bloqueo con 1 afectado → aparece el botón WhatsApp con el texto prellenado.
  - `?d=2026-12-03` → pide `agenda_dia` con esa fecha.
- [ ] **Step 2–4:** correr (falla), implementar, correr (pasa).
- [ ] **Step 5: Commit** `feat: panel del barbero con agenda`.

---

### Task 10: Panel — configuración y QR

**Files:**
- Create: `js/config-panel.js`
- Modify: `panel.html`, `sw.js`, `tests/e2e-panel.js`

Pantallas: Servicios (lista, agregar/editar nombre, duración en minutos múltiplo de 5
entre 5 y 240, precio opcional, activo, orden con flechas) · Horario semanal (por día,
franjas desde/hasta, agregar/sacar; valida `hasta > desde` y que no se pisen antes de
guardar) · Ajustes (los 8 valores de Global Constraints salvo `plan`, con su explicación
en una línea) · Mi link (link `index.html?b=slug` absoluto, botón copiar, QR con
`vendor/qrcode.js`, botón "Imprimir" con `@media print` que deja solo nombre + QR + "Sacá
tu turno acá") · Notificaciones (botón de Task 11).

- [ ] **Step 1: Agregar casos a `tests/e2e-panel.js`:** servicio con 0 minutos → mensaje y no guarda; franja 13:00–09:00 → mensaje y no guarda; "Mi link" muestra un `<canvas>`/`<img>` del QR y el texto del link con `?b=prueba`.
- [ ] **Step 2–4:** correr (falla), implementar, correr (pasa).
- [ ] **Step 5: Commit** `feat: configuración del barbero y QR`.

---

### Task 11: Notificaciones push

**Files:**
- Create: `js/push.js`, `supabase/functions/notificar/index.ts`,
  `supabase/functions/notificar/mensaje.js`, `tests/mensaje.test.js`,
  `supabase/migrations/2026112207_notificar_remoto.sql`
- Modify: `sw.js` (eventos `push` y `notificationclick`), `js/config.js` (`clavePublicaVapid`), `panel.html`, `js/config-panel.js`

**Interfaces:**
- `Push.estado() -> 'no-soportado' | 'requiere-instalar' | 'bloqueado' | 'activo' | 'inactivo'`
  (`requiere-instalar` en iPhone sin `navigator.standalone`); `Push.activar(barberiaId)`
  (pide permiso, `pushManager.subscribe` con `Config.clavePublicaVapid`, guarda en
  `push_suscripciones`); `Push.desactivar()`.
- `mensaje.js` (ESM, puro, lo importan Deno y Node): `armarMensaje({tipo: 'INSERT' | 'UPDATE', nuevo, viejo, zona, servicio}) -> {titulo, cuerpo, url} | null`.
  Insert confirmado → `{titulo: 'Nuevo turno', cuerpo: 'Juan · Corte · mar 1/12 10:00', url: './panel.html?d=2026-12-01'}`;
  update a `cancelado` desde `confirmado` → título `'Turno cancelado'`; turno `manual` → `null`
  (lo cargó él); cualquier otro cambio → `null`.
- `index.ts`: valida header `x-notificar-secreto` contra el secreto `NOTIFICAR_SECRETO`,
  lee el turno con la clave de servicio, arma el mensaje, envía a todas las
  `push_suscripciones` de la barbería con `npm:web-push@3.6.7` (`VAPID_PUBLICA`,
  `VAPID_PRIVADA`, `VAPID_CONTACTO`), borra las que responden 404/410.
- `_remoto.sql`: `create extension pg_net`; tabla `app.ajustes_privados(clave text pk, valor text)` sin políticas;
  trigger `after insert or update of estado on turnos` → `net.http_post` a
  `ajustes_privados['url_notificar']` con `{tipo, nuevo, viejo}` y el header del secreto.
- `sw.js`: `push` → `showNotification(titulo, {body, data: {url}, icon})`; `notificationclick` → abre/enfoca `url`.

- [ ] **Step 1: `tests/mensaje.test.js`** con los cuatro casos de arriba (zona Buenos Aires).
- [ ] **Step 2–4:** correr (falla), implementar `mensaje.js`, correr (pasa).
- [ ] **Step 5:** implementar `push.js`, `sw.js`, `index.ts`, migración remota; botón en Notificaciones
  con texto por estado (`requiere-instalar`: "En iPhone primero agregá esta página a la pantalla de inicio: Compartir → Agregar a inicio.").
- [ ] **Step 6: Commit** `feat: notificaciones push al barbero`.

---

### Task 12: Puesta en marcha en Supabase y prueba real

**Requiere confirmación del usuario antes de cada paso que crea o cambia algo remoto.**

**Files:**
- Create: `docs/alta-barberia.sql`, `tests/e2e-real.js`
- Modify: `js/config.js`, `sw.js`

- [ ] **Step 1:** Con el MCP de Supabase: `list_organizations`, y con el OK del usuario
  `create_project` (nombre `barber-turnos`, región `sa-east-1`).
- [ ] **Step 2:** `apply_migration` de cada archivo en orden (incluida `_remoto`).
  `get_advisors` (security) → sin avisos de RLS faltante.
- [ ] **Step 3:** Generar claves VAPID (`npx web-push generate-vapid-keys` fuera del repo),
  `create_edge_function_secret` para `NOTIFICAR_SECRETO`, `VAPID_PUBLICA`, `VAPID_PRIVADA`,
  `VAPID_CONTACTO`; `deploy_edge_function notificar` (verify_jwt false: lo protege el secreto);
  cargar `url_notificar` y el secreto en `app.ajustes_privados` con `execute_sql`.
- [ ] **Step 4:** Completar `js/config.js` con `get_project_url`, `get_publishable_keys` y la VAPID pública.
- [ ] **Step 5:** `docs/alta-barberia.sql`: plantilla comentada que, dado slug, nombre,
  WhatsApp y el email del usuario ya creado en Auth, inserta barbería, barbero, miembro,
  servicio "Corte" de 30 min y horario lun–sáb 9–13 y 16–20.
- [ ] **Step 6:** Alta de una barbería `prueba` con un usuario de prueba. `tests/e2e-real.js`
  recorre: reservar online → aparece en el panel → cancelar desde el link → desaparece;
  al final borra lo que creó. Correr → PASA.
- [ ] **Step 7: Commit** `chore: configuración de Supabase y alta de barberías`.

---

### Task 13: Guía y publicación

**Files:**
- Create: `docs/GUIA.md`
- Modify: `README.md`

- [ ] **Step 1:** `docs/GUIA.md` en voseo, tres partes: **Para vos (administrador)**: dar de
  alta una barbería (crear usuario en Auth → correr `alta-barberia.sql`), qué hacer si
  Supabase pausa el proyecto. **Para el barbero**: entrar al panel, instalarlo en Android
  e iPhone, activar notificaciones, cargar servicios y horarios, turnos manuales,
  bloquear, faltas, imprimir el QR, poner el link en el perfil de WhatsApp/Instagram.
  **Para el cliente** (lo que ve): cómo reservar y cancelar.
- [ ] **Step 2:** Revisar que la guía diga lo que hace la app (recorriendo el sitio servido con `python3 -m http.server`).
- [ ] **Step 3:** Publicar: GitHub Pages sirve desde `main`; mergear la rama y activar Pages
  (Settings → Pages → `main` / root) lo decide el usuario.
- [ ] **Step 4: Commit** `docs: guía de uso y alta`.
