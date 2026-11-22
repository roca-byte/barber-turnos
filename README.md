# barber-turnos

Reserva de turnos online para barberías. Cada barbería tiene su link
(`index.html?b=<slug>`): el cliente elige servicio, día y horario, y recibe un link para
ver o cancelar su turno. El barbero maneja la agenda desde `panel.html`.

Frontend en HTML, CSS y JavaScript puro (sin frameworks ni build) y backend en
Supabase (Postgres con RLS y funciones). Sin cuentas para el cliente.

Diseño completo: `docs/superpowers/specs/2026-11-22-barber-turnos-design.md`.
Cómo trabajar en el código y correr las pruebas: `DESARROLLO.md`.
