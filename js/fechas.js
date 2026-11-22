// fechas.js — fechas y horas en la zona de la BARBERÍA, no en la del dispositivo.
// Un cliente de viaje tiene que ver "10:00" si el turno es a las 10 en la barbería.
// Todo sale de Intl.DateTimeFormat con timeZone explícita; nunca de getHours() ni de
// toISOString() para fechas locales (UTC corre el día a la noche). Funciones puras.
const Fechas = (() => {
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const formateadores = {}; // crear un Intl.DateTimeFormat es caro: uno por zona
  function partes(ms, zona) {
    if (!formateadores[zona]) {
      formateadores[zona] = new Intl.DateTimeFormat('en-US', {
        timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    const p = {};
    for (const x of formateadores[zona].formatToParts(new Date(ms))) p[x.type] = x.value;
    return { a: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
  }

  const dos = (n) => String(n).padStart(2, '0');

  function hora(isoInstante, zona) {
    const p = partes(Date.parse(isoInstante), zona);
    return `${dos(p.h)}:${dos(p.mi)}`;
  }

  function hoy(zona) {
    const p = partes(Date.now(), zona);
    return `${p.a}-${dos(p.m)}-${dos(p.d)}`;
  }

  // La fecha es de calendario (sin zona): se arma en UTC solo para hacer la cuenta.
  function aUtc(fechaISO) {
    const [a, m, d] = fechaISO.split('-').map(Number);
    return Date.UTC(a, m - 1, d);
  }

  function sumarDias(fechaISO, n) {
    const f = new Date(aUtc(fechaISO) + n * 86400000);
    return `${f.getUTCFullYear()}-${dos(f.getUTCMonth() + 1)}-${dos(f.getUTCDate())}`;
  }

  function diaLargo(fechaISO) {
    const f = new Date(aUtc(fechaISO));
    return `${DIAS[f.getUTCDay()]} ${f.getUTCDate()} de ${MESES[f.getUTCMonth()]}`;
  }

  // Hora de pared de la zona -> instante. Se parte de "como si fuera UTC" y se corrige
  // con el desfase que tiene la zona en ese momento; dos pasadas cubren los cambios de
  // horario de verano.
  function instante(fechaISO, hhmm, zona) {
    const [a, m, d] = fechaISO.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    const pared = Date.UTC(a, m - 1, d, h, mi);
    let ms = pared;
    for (let i = 0; i < 2; i++) {
      const p = partes(ms, zona);
      ms += pared - Date.UTC(p.a, p.m - 1, p.d, p.h, p.mi, p.s);
    }
    return new Date(ms).toISOString();
  }

  const utcIcs = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escIcs = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n');

  // Archivo .ics para "agregar al calendario". Horas en UTC (Z): el calendario del
  // celular las pasa solo a la zona de quien lo abre.
  function ics({ inicio, fin, titulo, lugar }) {
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//barber-turnos//ES', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${utcIcs(inicio)}-${Math.abs(hash(titulo + inicio))}@barber-turnos`,
      `DTSTAMP:${utcIcs(inicio)}`, // = inicio: así el archivo es siempre igual para el mismo turno
      `DTSTART:${utcIcs(inicio)}`, `DTEND:${utcIcs(fin)}`,
      `SUMMARY:${escIcs(titulo)}`, `LOCATION:${escIcs(lugar)}`,
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n') + '\r\n';
  }

  function hash(t) {
    let h = 0;
    for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) | 0;
    return h;
  }

  return { hora, hoy, sumarDias, diaLargo, instante, ics };
})();

if (typeof module !== 'undefined') module.exports = Fechas;
