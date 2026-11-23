// Pruebas de armarMensaje (supabase/functions/notificar/mensaje.js): qué aviso recibe el barbero.
// El módulo es ESM (lo importa Deno), por eso se carga con import() dinámico.
const test = require('node:test');
const assert = require('node:assert');

const ZONA = 'America/Argentina/Buenos_Aires';
// 10:00 en Buenos Aires (UTC-3) = 13:00 UTC; el 1/12/2026 es martes.
const turno = { estado: 'confirmado', origen: 'online', inicio: '2026-12-01T13:00:00Z' };
const base = { zona: ZONA, servicio: 'Corte', nombre: 'Juan' };

async function armar(entrada) {
  const { armarMensaje } = await import('../supabase/functions/notificar/mensaje.js');
  return armarMensaje(entrada);
}

test('turno online nuevo: avisa con nombre, servicio y hora de la barbería', async () => {
  const m = await armar({ ...base, tipo: 'INSERT', nuevo: turno, viejo: null });
  assert.deepStrictEqual(m, { titulo: 'Nuevo turno', cuerpo: 'Juan · Corte · mar 1/12 10:00', url: './panel.html?d=2026-12-01' });
});

test('cancelación de un turno confirmado: avisa "Turno cancelado"', async () => {
  const m = await armar({ ...base, tipo: 'UPDATE', nuevo: { ...turno, estado: 'cancelado' }, viejo: turno });
  assert.strictEqual(m.titulo, 'Turno cancelado');
  assert.strictEqual(m.cuerpo, 'Juan · Corte · mar 1/12 10:00');
});

test('turno manual: no avisa (lo cargó el barbero)', async () => {
  assert.strictEqual(await armar({ ...base, tipo: 'INSERT', nuevo: { ...turno, origen: 'manual' }, viejo: null }), null);
});

test('cualquier otro cambio no avisa', async () => {
  assert.strictEqual(await armar({ ...base, tipo: 'UPDATE', nuevo: { ...turno, estado: 'atendido' }, viejo: turno }), null);
  assert.strictEqual(await armar({ ...base, tipo: 'UPDATE', nuevo: { ...turno, estado: 'no_vino' }, viejo: turno }), null);
});

test('la fecha de la url sale en la zona de la barbería, no en UTC', async () => {
  // 23:30 en Buenos Aires del 1/12 = 02:30 UTC del 2/12.
  const tarde = { ...turno, inicio: '2026-12-02T02:30:00Z' };
  const m = await armar({ ...base, tipo: 'INSERT', nuevo: tarde, viejo: null });
  assert.strictEqual(m.url, './panel.html?d=2026-12-01');
  assert.strictEqual(m.cuerpo, 'Juan · Corte · mar 1/12 23:30');
});
