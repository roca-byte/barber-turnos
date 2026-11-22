# barber-turnos — Diseño

Fecha: 2026-11-22. Estado: listo para aprobar.

## 1. Por qué existe

Un amigo barbero, que atiende solo, pierde clientes: le piden turno por WhatsApp o en
persona mientras está cortando, no puede atender, el cliente dice "después paso", vuelve,
lo encuentra ocupado otra vez y termina yendo a otro lado. Los turnos dependen de que él
esté libre para contestar.

La app saca ese cuello de botella: **el cliente reserva solo, a cualquier hora, viendo los
horarios libres**, y el barbero se entera con una notificación y mira su agenda cuando
puede.

Hay un segundo barbero (otro amigo, otro local, no se conocen) que vuelve a trabajar y
necesita algo sencillo. A largo plazo la idea es **crecer a otras barberías** y quizás
cobrar una mensualidad; hoy no se cobra nada. Los dos amigos son la validación: si después
de 2–3 meses dicen "esto lo pagaría", hay producto.

## 2. Objetivos, no-objetivos y anti-objetivos

**Objetivos (v1)**
- Página pública por barbería donde el cliente elige servicio, día y horario libre, y
  reserva con nombre + WhatsApp, sin crear cuenta. Confirmación automática.
- Panel del barbero (con login) para ver la agenda, cargar a mano los turnos que le
  piden por WhatsApp o en persona, bloquear horarios (almuerzo, trámites, días cerrados),
  configurar servicios y horario semanal, y marcar "no vino".
- Notificación push al celular del barbero cuando entra un turno nuevo o se cancela uno.
- El cliente puede cancelar desde el link que recibe al reservar, hasta X horas antes.
- Control de faltas: tras N faltas (por número de WhatsApp) el cliente ya no puede
  reservar online; tiene que escribirle al barbero.
- Varias barberías separadas en una misma app (multi-inquilino), cada una con su link y
  sus datos aislados.
- Imposible reservar dos turnos que se pisen en el mismo barbero, aunque dos clientes
  reserven en el mismo segundo.

**No-objetivos (v1, quedan para después según feedback)**
- Seña / pago anticipado con Mercado Pago.
- Recordatorios por WhatsApp o email al cliente.
- Registro libre de barberías, suscripciones, cobro, página de venta.
- Varios barberos por local en la pantalla (el modelo de datos sí lo soporta).
- Estadísticas, marca propia (logo/colores/dominio por barbería).
- Dominio propio (se pasa antes de sumar barberías ajenas).

**Anti-objetivos (aunque funcione, sería un fracaso si…)**
- …el cliente tiene que registrarse, o reservar le lleva más de un minuto.
- …el barbero tiene que aprobar cada turno (vuelve el cuello de botella).
- …un turno dado de palabra se pisa con uno online.
- …un barbero puede ver datos de otra barbería.
- …el código no lo entiende el dueño del proyecto (estudiante de 1er año de Desarrollo de
  Software que quiere entender cada línea).

## 3. Restricciones

- HTML, CSS y JavaScript puro en archivos separados, scripts clásicos (como `controlLinea`
  y `mash-check`): sin frameworks, sin npm en la app, sin build. La librería
  `supabase-js` se carga desde CDN con versión fija.
- Backend: Supabase (Postgres + Auth + Edge Functions), plan gratis. Ojo: el plan gratis
  pausa el proyecto tras 7 días sin actividad; se reactiva desde el panel.
- Hosting: GitHub Pages en `https://roca-byte.github.io/barber-turnos/` →
  **todas las rutas relativas**. Sin reescritura de URLs, por eso el link de cada
  barbería es `?b=<slug>` (ej. `?b=cortes-juan`).
- Mobile first: el cliente reserva desde el celular; el barbero usa el panel desde el
  celular entre corte y corte (botones grandes, mín. 48 px).
- Interfaz en español rioplatense (voseo). Comentarios del código en español explicando el
  porqué.
- Zona horaria: `America/Argentina/Buenos_Aires` (sin horario de verano). Se guarda en la
  barbería para no asumirla en el código.
- Escapar todo texto del usuario antes de ir a `innerHTML`.
- PWA con service worker y `VERSION`; subirla en cada cambio.

## 4. Enfoques considerados

| Enfoque | A favor | En contra |
|---|---|---|
| **A. HTML/CSS/JS puro + Supabase + GitHub Pages** (elegido) | Mismo modelo que sus otras apps; entendible línea por línea; hosting gratis; la base y la seguridad (lo difícil) viven en Postgres y se conservan si algún día se migra. | Algunas cosas se hacen a mano (navegación entre pantallas, links por `?b=`). |
| B. Next.js + Supabase en Vercel | Mejor SEO, URLs prolijas, escala de producto. | npm, build, React, servidor: demasiado para 1er año y para validar con dos barberías. |
| C. Google Calendar "agendas de citas" | Gratis, en una tarde, sin código. | Sin faltas, sin turnos manuales mezclados, sin bloqueo de clientes, sin crecer a producto. |

También se evaluó partir de un repositorio público: Easy!Appointments (PHP+MySQL, requiere
servidor pago), facuperezm/barberia (sin licencia → no se puede reutilizar; SaaS en
Next.js+Neon), openfront-barbershop (KeystoneJS/GraphQL, enorme, incompleto). Adaptar
cualquiera costaba más que hacerlo a medida. Se toma de ellos solo el modelo conceptual
(servicios con duración + horario semanal → slots libres).

**Elegido: A**, por el usuario.

## 5. Lo que se decidió (con el usuario)

- Los clientes sacan el turno solos; el barbero lo ve y gestiona.
- Avisos al barbero: **notificación push** al celular (opción 2).
- Sin pago anticipado al arrancar; se decide integrar seña según feedback de los barberos.
- Faltas: cancelación libre hasta X horas antes + marcar "no vino" + bloqueo tras N
  faltas (opción 2 de las presentadas).
- Una sola app multi-inquilino; los dos barberos están en locales distintos y no se
  conocen.
- Las barberías las da de alta el dueño del proyecto (sin registro libre por ahora).
- Pensado para crecer a producto: cada barbería tiene un `plan` y las funciones futuras
  se prenden/apagan por plan (todos en `gratis` hoy).
- Dirección inicial: GitHub Pages de `roca-byte/barber-turnos`; dominio propio más
  adelante.

## 6. Decisiones del diseñador (propuestas, corregibles)

- **Confirmación automática**: si el horario está libre, el turno queda tomado.
- **Cliente sin cuenta**: nombre + WhatsApp (obligatorios). El número es la identidad del
  cliente dentro de cada barbería, así que se normaliza al formato de WhatsApp argentino
  `549<área><número>` (13 dígitos): se quitan espacios y signos, el `+`, el `0` de larga
  distancia y el `15` de celular; se agrega `54` y `9` si faltan (`011 15 1234-5678` y
  `+54 9 11 1234 5678` → `5491112345678`). Si no queda un número válido, se pide de nuevo.
  La misma función se usa en reservas online y manuales, con pruebas de los formatos
  comunes. Se muestra al cliente el número interpretado antes de confirmar.
- **Turnos manuales**: el barbero carga los turnos pedidos por WhatsApp/en persona en el
  panel (nombre y horario; WhatsApp opcional). Así la agenda es la única fuente de verdad.
- **QR en el local**: el panel muestra/imprime un QR con el link de la barbería.
- **Link del turno**: al reservar, el cliente ve una pantalla de confirmación con un link
  único (token secreto) para ver/cancelar su turno, botón "Agregar a mi calendario"
  (archivo `.ics`) y botón "Mandarme el link por WhatsApp" (`wa.me` a su propio número,
  lo envía él). Esto reemplaza al recordatorio en v1.
- **Valores por defecto por barbería** (editables en el panel):
  cancelación libre hasta **2 h** antes; bloqueo tras **2** faltas; se reserva hasta
  **21 días** adelante; no se reserva con menos de **30 min** de anticipación; los slots
  se ofrecen cada **15 min**; máximo **2 turnos futuros** por número (anti-spam).
- **Reservas falsas (decidido con el usuario: límites simples)**: máximo de turnos
  futuros por número (2) + tope de **3 reservas online por hora por conexión** (IP tomada
  de `x-forwarded-for` en `request.headers` dentro de `reservar`, guardada en una tabla
  chica de intentos). Si alguien molesta igual, el barbero cancela a mano. Sin captcha en
  v1; Cloudflare Turnstile se suma antes de abrir a barberías desconocidas.
- **Faltas**: el barbero las marca a mano ("no vino") desde la agenda, también en turnos
  manuales que tengan WhatsApp (sin WhatsApp no hay cliente al que contarle). Se pueden
  deshacer. El conteo se calcula desde los turnos `no_vino` posteriores al último
  desbloqueo (`clientes.desbloqueado_en`): desbloquear vuelve el contador a cero sin
  borrar la historia. Las faltas no vencen solas.
- **Cambios sobre turnos ya tomados**: si el barbero bloquea un horario, cambia su horario
  semanal o desactiva/cambia la duración de un servicio, los turnos confirmados **no se
  tocan solos**. Al bloquear, el panel avisa qué turnos quedan adentro y ofrece
  cancelarlos uno por uno con botón de WhatsApp para avisar al cliente. Crear un bloqueo
  y reservar usan la misma restricción de no-superposición (bloqueos y turnos comparten
  la tabla de ocupación o se verifican con bloqueo de fila del barbero), así no se cruzan
  al mismo tiempo.
- **Login del barbero**: Supabase Auth con email y contraseña. El dueño del proyecto crea
  el usuario desde el panel de Supabase y lo vincula a la barbería (script SQL documentado).
- **Push**: Web Push estándar (VAPID). Android: permitir notificaciones. iPhone: agregar
  a pantalla de inicio primero (iOS 16.4+); la guía lo explica.

## 7. Diseño técnico

### 7.1 Archivos

```
index.html          Página pública de reservas (?b=slug) y vista del turno (?t=token)
panel.html          Panel del barbero (login + agenda + configuración)
css/styles.css      Estilos mobile first compartidos
js/config.js        URL y clave publicable de Supabase (públicas por diseño)
js/fechas.js        Funciones puras de fecha/hora en la zona de la barbería
js/slots.js         Regla pura: horario semanal + bloqueos + turnos → slots libres
js/api.js           Llamadas a Supabase (global Api)
js/reserva.js       Pantallas del cliente
js/panel.js         Pantallas del barbero
js/push.js          Suscripción a notificaciones
sw.js               Service worker: caché offline del panel + recibir push. VERSION
manifest.json       Instalación (rutas relativas)
icons/
supabase/migrations/   SQL versionado (tablas, RLS, funciones)
supabase/functions/notificar/   Edge Function que envía el push
tests/              node --test para js/fechas.js y js/slots.js
docs/GUIA.md        Guía para el barbero y para dar de alta una barbería
```

### 7.2 Datos (Postgres)

- `barberias`: id, slug (único), nombre, direccion, whatsapp, zona_horaria, plan,
  ajustes (cancelacion_horas, faltas_max, dias_adelante, anticipacion_min, paso_min,
  turnos_futuros_max), activa.
- `barberos`: id, barberia_id, nombre, activo. (Hoy uno por barbería; listo para varios.)
- `miembros`: user_id (auth) ↔ barberia_id, rol (`dueno`). Define quién ve qué.
- `servicios`: id, barberia_id, nombre, duracion_min, precio (informativo), activo, orden.
- `horarios`: barbero_id, dia_semana (0–6), desde, hasta. Varias franjas por día
  (ej. 9–13 y 16–20).
- `bloqueos`: barbero_id, inicio, fin (timestamptz), motivo.
- `clientes`: id, barberia_id, telefono (normalizado, único por barbería), nombre,
  faltas, bloqueado.
- `turnos`: id, barberia_id, barbero_id, servicio_id, cliente_id, inicio, fin
  (timestamptz), estado (`confirmado` | `cancelado` | `no_vino` | `atendido`), origen
  (`online` | `manual`), token (secreto, para el link del cliente), creado.
  **Restricción de exclusión** (`btree_gist`) sobre `(barbero_id, tstzrange(inicio, fin))`
  solo para turnos `confirmado`: Postgres rechaza dos turnos que se pisen aunque lleguen
  al mismo tiempo.
- `push_suscripciones`: user_id, barberia_id, endpoint, claves.

### 7.3 Seguridad

- RLS activado en todas las tablas.
- El barbero logueado lee y escribe solo filas de las barberías donde es `miembro`.
- El visitante anónimo **no lee tablas directamente** salvo datos públicos
  (`barberias` activas: nombre/dirección/slug; `servicios` activos). Todo lo demás va por
  funciones `security definer` con parámetros validados:
  - `disponibilidad(slug, servicio_id, fecha)` → lista de horarios libres (sin exponer
    nombres de otros clientes).
  - `reservar(slug, servicio_id, inicio, nombre, telefono)` → token. Valida: horario
    dentro de franjas, no bloqueado, anticipación mínima, días adelante, cliente no
    bloqueado, máximo de turnos futuros; la restricción de exclusión cubre la carrera.
  - `ver_turno(token)` y `cancelar_turno(token)` (respeta el límite de horas).
- La clave publicable va en el código (es pública por diseño); la clave de servicio y la
  privada VAPID solo como secretos de la Edge Function.

### 7.4 Notificaciones

Webhook de base de datos en `turnos` (insert y cambio a `cancelado`) → Edge Function
`notificar` → busca las suscripciones de la barbería → envía Web Push. El service worker
muestra la notificación; al tocarla abre `panel.html` en el día del turno. Suscripciones
vencidas (410) se borran.

### 7.5 Cálculo de horarios libres

Regla pura en `js/slots.js` (probada con `node --test`) y su equivalente en SQL dentro de
`disponibilidad` y `reservar`. La fuente de verdad es la base: el JS sirve para el panel
(vista de huecos) y como especificación probada. Un slot es válido si
`[inicio, inicio + duración)` cae entero dentro de una franja, no toca bloqueos ni turnos
confirmados, respeta anticipación mínima y días adelante. Se ofrecen cada `paso_min`.

### 7.6 Pantallas

**Cliente (`index.html?b=slug`)**: barbería (nombre, dirección, botón WhatsApp) →
elegir servicio (nombre, duración, precio) → elegir día (próximos días con lugar) →
elegir horario → nombre + WhatsApp → confirmación con link del turno, `.ics`, y
"mandarme el link". Vista `?t=token`: datos del turno y botón Cancelar (o aviso de que ya
no se puede y el WhatsApp del barbero).

**Barbero (`panel.html`)**: login → agenda del día (lista por hora: turnos y huecos;
flechas de día) → tocar turno: llamar/WhatsApp al cliente, marcar atendido / no vino,
cancelar → "+ Turno" manual → "Bloquear" horario → Configuración: servicios, horario
semanal, ajustes, QR y link de la barbería, activar notificaciones.

## 8. Lo que queda para quien construye

- Diseño visual (paleta, tipografía), siempre mobile first y con botones grandes.
- Detalles de navegación interna de cada página.
- Estructura exacta de las migraciones y nombres de columnas menores.
- Cómo se generan y guardan las claves VAPID (documentarlo en la guía).
- Contenido de `docs/GUIA.md`: alta de barbería (paso a paso SQL/panel de Supabase),
  instalar el panel en Android e iPhone, activar notificaciones, imprimir el QR.
