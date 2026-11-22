// Prueba de Telefono (JS). Los casos viven en casos-telefono.json y los comparte con la
// prueba SQL: así las dos implementaciones no pueden divergir sin que salte una prueba.
const test = require('node:test');
const assert = require('node:assert');
const Telefono = require('../js/telefono.js');
const casos = require('./casos-telefono.json');

for (const [entrada, area, esperado] of casos) {
  test(`normalizar(${JSON.stringify(entrada)}, ${area}) -> ${esperado}`, () => {
    assert.strictEqual(Telefono.normalizar(entrada, area), esperado);
  });
}

test('mostrar da formato visual', () => {
  assert.strictEqual(Telefono.mostrar('5491112345678'), '+54 9 11 1234-5678');
  assert.strictEqual(Telefono.mostrar('5493511234567'), '+54 9 351 123-4567');
});
