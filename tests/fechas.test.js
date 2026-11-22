// Prueba de Fechas. Lo importante: ninguna función puede depender de la zona de la máquina
// (el celular del cliente puede estar en otra zona que la barbería). Por eso las mismas
// comprobaciones corren en subprocesos con TZ=UTC y TZ=Asia/Tokyo y se comparan.
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const Fechas = require('../js/fechas.js');

const BA = 'America/Argentina/Buenos_Aires';

test('hora muestra la hora de la zona de la barbería', () => {
  assert.strictEqual(Fechas.hora('2026-12-01T13:00:00Z', BA), '10:00');
  assert.strictEqual(Fechas.hora('2026-12-01T03:05:00Z', BA), '00:05'); // medianoche = 00, no 24
});

test('instante convierte fecha y hora local a UTC', () => {
  assert.strictEqual(Fechas.instante('2026-12-01', '09:00', BA), '2026-12-01T12:00:00.000Z');
  assert.strictEqual(Fechas.instante('2026-12-01', '23:30', BA), '2026-12-02T02:30:00.000Z');
  // Zona con horario de verano: el offset cambia según la fecha.
  assert.strictEqual(Fechas.instante('2026-01-15', '09:00', 'America/New_York'), '2026-01-15T14:00:00.000Z');
  assert.strictEqual(Fechas.instante('2026-07-15', '09:00', 'America/New_York'), '2026-07-15T13:00:00.000Z');
});

test('instante y hora son inversas', () => {
  const iso = Fechas.instante('2026-12-01', '17:45', BA);
  assert.strictEqual(Fechas.hora(iso, BA), '17:45');
});

test('diaLargo', () => {
  assert.strictEqual(Fechas.diaLargo('2026-12-01', BA), 'martes 1 de diciembre');
  assert.strictEqual(Fechas.diaLargo('2027-01-03', BA), 'domingo 3 de enero');
});

test('sumarDias cruza mes y año', () => {
  assert.strictEqual(Fechas.sumarDias('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(Fechas.sumarDias('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(Fechas.sumarDias('2026-12-01', 0), '2026-12-01');
});

test('hoy da la fecha en la zona pedida, no en la de la máquina', () => {
  // Ya existe el día siguiente en Tokio pero no en Buenos Aires: dos zonas, dos fechas.
  const real = Date;
  const fijo = new real('2026-12-01T20:00:00Z').getTime();
  global.Date = class extends real {
    constructor(...a) { super(...(a.length ? a : [fijo])); }
    static now() { return fijo; }
  };
  try {
    assert.strictEqual(Fechas.hoy(BA), '2026-12-01');
    assert.strictEqual(Fechas.hoy('Asia/Tokyo'), '2026-12-02');
  } finally { global.Date = real; }
});

test('ics arma un VCALENDAR con horas en UTC', () => {
  const s = Fechas.ics({
    inicio: '2026-12-01T13:00:00Z', fin: '2026-12-01T13:30:00Z',
    titulo: 'Corte, barba; "VIP"', lugar: 'Calle 123'
  });
  assert.match(s, /^BEGIN:VCALENDAR/);
  assert.match(s, /DTSTART:20261201T130000Z/);
  assert.match(s, /DTEND:20261201T133000Z/);
  assert.match(s, /SUMMARY:Corte\\, barba\\; "VIP"/); // coma y punto y coma se escapan en ICS
  assert.match(s, /LOCATION:Calle 123/);
  assert.match(s, /END:VCALENDAR/);
  assert.ok(s.includes('\r\n'));
});

test('el resultado no depende de la zona de la máquina (TZ=UTC y TZ=Asia/Tokyo)', () => {
  const script = `
    const F = require(${JSON.stringify(path.join(__dirname, '../js/fechas.js'))});
    const z = 'America/Argentina/Buenos_Aires';
    console.log(JSON.stringify([
      F.hora('2026-12-01T13:00:00Z', z),
      F.instante('2026-12-01', '09:00', z),
      F.diaLargo('2026-12-01', z),
      F.sumarDias('2026-12-31', 1),
      F.ics({ inicio: '2026-12-01T13:00:00Z', fin: '2026-12-01T13:30:00Z', titulo: 'x', lugar: 'y' })
    ]));`;
  const salidas = ['UTC', 'Asia/Tokyo'].map((tz) => {
    const r = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.trim();
  });
  assert.strictEqual(salidas[0], salidas[1]);
  const [h, i, d, s] = JSON.parse(salidas[0]);
  assert.deepStrictEqual([h, i, d, s], ['10:00', '2026-12-01T12:00:00.000Z', 'martes 1 de diciembre', '2027-01-01']);
});

test('fecha: el día de calendario de un instante en la zona dada', () => {
  // 02:30Z del 2/12 sigue siendo el 1/12 en Buenos Aires (23:30) y ya es 2/12 en Tokyo.
  assert.strictEqual(Fechas.fecha('2026-12-02T02:30:00Z', 'America/Argentina/Buenos_Aires'), '2026-12-01');
  assert.strictEqual(Fechas.fecha('2026-12-02T02:30:00Z', 'Asia/Tokyo'), '2026-12-02');
});
