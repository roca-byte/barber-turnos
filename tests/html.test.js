const test = require('node:test');
const assert = require('node:assert');
const Html = require('../js/html.js');

const CODIGOS = ['BARBERIA_NO_EXISTE', 'SERVICIO_NO_EXISTE', 'HORARIO_NO_DISPONIBLE', 'TELEFONO_INVALIDO',
  'NOMBRE_INVALIDO', 'CLIENTE_BLOQUEADO', 'LIMITE_TURNOS', 'LIMITE_HORA', 'TURNO_NO_EXISTE',
  'FUERA_DE_PLAZO', 'NO_AUTORIZADO', 'RANGO_INVALIDO', 'ESTADO_INVALIDO'];

test('esc escapa lo peligroso', () => {
  assert.strictEqual(Html.esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
  assert.strictEqual(Html.esc("it's"), 'it&#39;s');
  assert.strictEqual(Html.esc(null), '');
  assert.strictEqual(Html.esc(5), '5');
});

test('mensajeError tiene texto propio para cada código', () => {
  const generico = Html.mensajeError('XYZ');
  assert.strictEqual(generico, 'Algo salió mal. Probá de nuevo.');
  const vistos = new Set();
  for (const c of CODIGOS) {
    const m = Html.mensajeError(c);
    assert.notStrictEqual(m, generico, c);
    assert.ok(m.length > 10, c);
    vistos.add(m);
  }
  assert.strictEqual(vistos.size, CODIGOS.length);
  assert.strictEqual(Html.mensajeError('HORARIO_NO_DISPONIBLE'), 'Ese horario se acaba de ocupar. Elegí otro.');
  assert.strictEqual(Html.mensajeError('CLIENTE_BLOQUEADO'), 'No podés reservar online. Escribile a la barbería por WhatsApp.');
  assert.strictEqual(Html.mensajeError('LIMITE_HORA'), 'Hiciste muchas reservas seguidas. Probá en un rato.');
  assert.strictEqual(Html.mensajeError(undefined), generico);
});
