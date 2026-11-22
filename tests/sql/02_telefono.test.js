// Mismos casos que tests/telefono.test.js: JS y SQL tienen que dar lo mismo.
const casos = require('../casos-telefono.json');

module.exports = async function (sql) {
  for (const [entrada, area, esperado] of casos) {
    const filas = sql('select app.normalizar_telefono($1, $2) as tel', [entrada, area]);
    const obtenido = filas[0].tel;
    if (obtenido !== esperado) {
      throw new Error(`normalizar_telefono(${JSON.stringify(entrada)}, ${area}): esperado ${esperado}, obtenido ${obtenido}`);
    }
  }
};
