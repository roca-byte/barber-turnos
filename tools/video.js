/* Graba los videos con carteles de docs/video/: cliente-reserva.mp4 y panel-barbero.mp4.
 *
 * Uso:  node tools/video.js
 * Necesita Playwright y ffmpeg. Recorre la app en un celular con los datos inventados de
 * tools/ejemplo.js (Supabase falso: la base real nunca se toca). Cada paso lleva un cartel que
 * lo explica y un círculo en cada toque; hay placas de apertura y cierre.
 * Volver a correrlo cada vez que cambie algo visible de la app.
 */
const { grabarVideo } = require('./grabador');
const Ejemplo = require('./ejemplo');

const C = Ejemplo.CLIENTE_NUEVO;

async function clienteReserva() {
  await grabarVideo('cliente-reserva.mp4', async (h) => {
    const { page, espera, cartel, placa, ver, tocar, tipear, reponer, titulo } = h;

    await placa(titulo + '<p>Sacá tu turno desde el celular, sin cuenta y sin llamar.</p><p><b>Barbería El Molino</b> (ejemplo)</p>', 5000);
    await placa('', 900);

    await cartel('1 · Abrí el link de la barbería', 'Te lo mandan por WhatsApp o lo escaneás desde el QR del local', 3200);
    await cartel('2 · Elegí el servicio', 'Con su duración y su precio', 600);
    await tocar('[data-servicio="s2"]', 1200);
    await cartel('3 · Elegí el día', 'Solo aparecen los días en que hay lugar', 2200);
    await tocar('[data-dia="2026-11-24"]', 1200);
    await cartel('4 · Elegí la hora', 'Las horas son las de la barbería, estés donde estés', 2600);
    await tocar('[data-hora]:text-is("10:30")', 1200);

    await cartel('5 · Escribí tu nombre y tu WhatsApp', 'Con o sin código de área', 600);
    await tipear('#nombre', C.nombre);
    await tipear('#telefono', C.telefono);
    await cartel('La pantalla te muestra con qué número te identifica', '', 2600);
    await tocar('#btn-reservar', 1500);

    await cartel('6 · ¡Listo! Tu turno quedó reservado', 'Guardá el link: es la forma de verlo o cancelarlo', 600);
    await ver('.enlace');
    await espera(3200);
    await cartel('Agregalo a tu calendario', 'Se descarga un archivo que el celular abre solo', 600);
    await tocar('#btn-calendario', 2200);
    await cartel('O mandate el link por WhatsApp', 'Así no se pierde', 600);
    await ver('#btn-whatsapp');
    await espera(2600);

    await cartel('7 · Ver o cancelar el turno', 'Abrí el link que te quedó', 600);
    await ver('.enlace a');
    await page.locator('.enlace a').click();
    await reponer('#btn-cancelar');
    await cartel('Ahí ves el estado, el día y la hora', 'Mientras falten más de 2 horas, podés cancelar', 3200);
    await tocar('#btn-cancelar', 1200);
    await cartel('Te pide confirmación', 'Para que no canceles sin querer', 2400);
    await tocar('#btn-cancelar-si', 1500);
    await cartel('Cancelado: el horario queda libre para otra persona', '', 3200);
    await cartel('', '', 300);

    await placa(titulo + '<p>Un link, cuatro toques y listo.</p>', 3800);
  }, { ruta: 'index.html?b=' + Ejemplo.SLUG, espera: '[data-servicio="s1"]' });
}

async function panelBarbero() {
  await grabarVideo('panel-barbero.mp4', async (h) => {
    const { page, espera, cartel, placa, ver, tocar, tipear, arriba, titulo } = h;
    const vuelve = async (sel) => { await page.waitForSelector(sel); await espera(500); };

    await placa(titulo + '<p>El panel del barbero: la agenda del día, los turnos y los avisos, desde el celular.</p>', 5200);
    await placa('', 900);

    // ── Ingresar ──
    await cartel('1 · Ingresá con tu cuenta', 'Email y contraseña que te dio quien armó la barbería', 600);
    await tipear('#email', Ejemplo.EMAIL);
    await tipear('#clave', Ejemplo.CLAVE);
    await tocar('#btn-entrar', 1500);
    await vuelve('#agenda');

    // ── Agenda ──
    await cartel('2 · Tu día de un vistazo', 'Turnos, bloqueos y huecos libres, ordenados por hora', 600);
    await ver('.dia-titulo', 'start');
    await espera(2400);
    await ver('[data-turno="t4"]');
    await cartel('El ⚠ avisa si el cliente tiene faltas', 'Cuántas veces no vino', 3000);
    await ver('.bloqueo');
    await cartel('Lo que bloqueaste aparece con su motivo', '', 2600);
    await arriba();
    await cartel('‹ Hoy › cambia de día', '', 2200);

    // ── Atendido / No vino ──
    await cartel('3 · Tocá un turno para abrirlo', 'Llamar, WhatsApp, Atendido, No vino o Cancelar', 600);
    await tocar('[data-turno="t2"]', 1200);
    await espera(1600);
    await tocar('[data-id="t2"][data-estado="atendido"]', 1500);
    await vuelve('#agenda');
    await cartel('Si el cliente no vino, tocá "No vino"', 'Le suma una falta', 600);
    await tocar('[data-turno="t3"]', 1200);
    await tocar('[data-id="t3"][data-estado="no_vino"]', 1500);
    await vuelve('#agenda');
    await ver('[data-turno="t3"]');
    await cartel('Un toque en "Deshacer" corrige cualquier error', '', 2800);

    // ── Turno manual ──
    await cartel('4 · ¿Te escribió alguien por WhatsApp?', 'Tocá un horario libre para cargarle el turno', 600);
    await tocar('[data-act="turno-en"]:has-text("12:20")', 1200);
    await cartel('La hora ya viene puesta', 'Elegís el servicio y escribís el nombre', 1800);
    await tipear('#nombre', Ejemplo.TURNO_MANUAL.nombre);
    await tipear('#telefono', Ejemplo.TURNO_MANUAL.telefono);
    await tocar('#btn-guardar-turno', 1500);
    await vuelve('#agenda');
    await ver('[data-turno="t7"]');
    await cartel('Queda marcado como "cargado por vos"', '', 2600);

    // ── Bloquear ──
    await arriba();
    await cartel('5 · Bloqueá horas cuando no atendés', 'Un trámite, vacaciones, un imprevisto', 600);
    await tocar('[data-act="bloquear"]', 1200);
    await ver('#desde');
    await page.fill('#desde', Ejemplo.BLOQUEO.desde);
    await espera(700);
    await page.fill('#hasta', Ejemplo.BLOQUEO.hasta);
    await espera(900);
    await tipear('#motivo', Ejemplo.BLOQUEO.motivo);
    await tocar('#btn-guardar-bloqueo', 1500);
    await cartel('Te muestra los turnos que quedaron adentro', 'No se cancelan solos: vos decidís', 3000);
    await ver('[data-afectado="t5"] [data-act="wa-afectado"]');
    await cartel('"Avisar por WhatsApp" te arma el mensaje', '', 2800);
    await tocar('[data-afectado="t6"] [data-act="cancelar-afectado"]', 1500);
    await cartel('Y cancelás el que no puede venir', 'Este cliente no dejó WhatsApp', 2600);
    await tocar('[data-act="volver"]', 1500);
    await vuelve('#agenda');

    // ── Faltas ──
    await arriba();
    await cartel('6 · Clientes con faltas', 'Con 2 faltas ya no pueden reservar online', 600);
    await tocar('[data-act="faltas"]', 1500);
    await espera(2400);
    await cartel('Los perdonás con "Desbloquear"', '', 600);
    await tocar('[data-cliente="c4"] [data-act="desbloquear"]', 1500);
    await espera(1400);
    await tocar('[data-act="volver"]', 1200);
    await vuelve('#agenda');

    // ── Configuración ──
    await arriba();
    await cartel('7 · Configuración', 'Servicios, horario, ajustes, link y notificaciones', 600);
    await tocar('[data-act="config"]', 1500);
    await cartel('Activá las notificaciones en este celular', 'Te avisan cuando alguien reserva o cancela', 600);
    await tocar('#notif-boton', 1800);
    await ver('#notif-texto');
    await espera(2400);
    await arriba();
    await cartel('Servicios', 'Nombre, duración, precio y orden', 600);
    await tocar('[data-act="cfg-servicios"]', 1500);
    await ver('[data-servicio="s3"]');
    await espera(1800);
    await tocar('[data-act="cfg-servicio-editar"][data-id="s1"]', 1500);
    await cartel('Destildá "Se puede reservar" para ocultarlo', 'Sin perder su historial', 600);
    await ver('#activo');
    await espera(2400);
    await tocar('[data-act="cfg-servicios"]', 1200);
    await tocar('[data-act="cfg-menu"]', 1200);
    await cartel('Horario semanal', 'Más de una franja por día, si cortás al mediodía', 600);
    await tocar('[data-act="cfg-horario"]', 1500);
    await espera(1800);
    await ver('[data-dia-card="3"]');
    await espera(1800);
    await tocar('[data-act="cfg-menu"]', 1200);
    await cartel('Ajustes', 'Datos de la barbería y reglas de reserva', 600);
    await tocar('[data-act="cfg-ajustes"]', 1500);
    await ver('#cancelacion_horas');
    await espera(2200);
    await ver('#paso_min');
    await espera(1800);
    await tocar('[data-act="cfg-menu"]', 1200);

    // ── Link y QR ──
    await cartel('8 · Tu link y tu QR', 'Para WhatsApp, Instagram o pegado en el local', 600);
    await tocar('[data-act="cfg-link"]', 1500);
    await tocar('[data-act="cfg-copiar"]', 1500);
    await ver('#hoja-qr');
    await espera(3200);
    await cartel('"Imprimir" saca una hoja con el QR', 'Pegala en el espejo', 2800);
    await cartel('', '', 300);

    await placa(titulo + '<p>Tu agenda, siempre en el bolsillo.</p>', 4000);
  }, { ruta: 'panel.html', espera: '#btn-entrar' });
}

(async () => {
  await clienteReserva();
  await panelBarbero();
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
