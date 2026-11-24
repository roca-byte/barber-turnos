# barber-turnos

Reserva de turnos online para barberías. Cada barbería tiene su link
(`index.html?b=<slug>`): el cliente elige servicio, día y horario, y recibe un link para
ver o cancelar su turno. El barbero maneja la agenda desde `panel.html`.

Frontend en HTML, CSS y JavaScript puro (sin frameworks ni build) y backend en
Supabase (Postgres con RLS y funciones). Sin cuentas para el cliente.

## Direcciones

- Cliente: `https://roca-byte.github.io/barber-turnos/index.html?b=<slug>`
- Panel del barbero: `https://roca-byte.github.io/barber-turnos/panel.html`

## Documentación

- [`docs/GUIA.md`](docs/GUIA.md): guía de uso para el administrador (alta de barberías,
  publicar en GitHub Pages, qué hacer si Supabase pausa el proyecto), para el barbero y
  para el cliente.
- [`DESARROLLO.md`](DESARROLLO.md): cómo trabajar en el código y correr las pruebas.
- Diseño completo: `docs/superpowers/specs/2026-11-22-barber-turnos-design.md`.

## Licencia

[GNU AGPL-3.0 o posterior](LICENSE). Podés usar, estudiar, cambiar y compartir el código;
si lo ofrecés como servicio por internet (aunque sea modificado), tenés que publicar el
código completo de tu versión bajo la misma licencia. Por eso cada pantalla tiene un link
"Código fuente".

Las librerías de `vendor/` mantienen su propia licencia (MIT):
[supabase-js](https://github.com/supabase/supabase-js) y
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator).
