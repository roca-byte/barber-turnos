// mensaje.js — arma el aviso push para el barbero a partir del cambio en la tabla turnos.
// Es un módulo ESM puro: lo importa la función de Deno (index.ts) y las pruebas de Node.
// No usa js/fechas.js a propósito: la función corre en otro entorno y no comparte archivos
// con la app. La hora sale de Intl con la zona de la barbería (nunca la del servidor, que es UTC).
//
// Entrada: { tipo: 'INSERT' | 'UPDATE', nuevo, viejo, zona, servicio, nombre }
//   nuevo / viejo: filas de turnos (viejo es null en INSERT).
//   servicio / nombre: textos ya resueltos por index.ts (el trigger solo manda la fila, con ids).
// Salida: { titulo, cuerpo, url } o null si no hay nada que avisar.

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function partesEnZona(iso, zona) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const p = {};
  for (const x of f.formatToParts(new Date(iso))) p[x.type] = x.value;
  // Día de la semana a partir de la fecha local (no del instante UTC).
  const dia = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay();
  return { a: +p.year, m: +p.month, d: +p.day, h: p.hour, mi: p.minute, dia };
}

const dos = (n) => String(n).padStart(2, '0');

export function armarMensaje({ tipo, nuevo, viejo, zona, servicio, nombre }) {
  if (!nuevo || nuevo.origen === 'manual') return null; // lo cargó el propio barbero

  let titulo;
  if (tipo === 'INSERT' && nuevo.estado === 'confirmado') titulo = 'Nuevo turno';
  else if (tipo === 'UPDATE' && nuevo.estado === 'cancelado' && viejo && viejo.estado === 'confirmado') titulo = 'Turno cancelado';
  else return null;

  const p = partesEnZona(nuevo.inicio, zona);
  const cuando = `${DIAS[p.dia]} ${p.d}/${p.m} ${p.h}:${p.mi}`;
  return {
    titulo,
    cuerpo: `${nombre} · ${servicio} · ${cuando}`,
    url: `./panel.html?d=${p.a}-${dos(p.m)}-${dos(p.d)}`
  };
}
