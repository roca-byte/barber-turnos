/* Servidor local para tools/demo.js y tools/video.js.
 *
 * Reusa el de las pruebas (tests/e2e-util.js): sirve la app tal cual bajo /barber-turnos/,
 * como GitHub Pages, así las rutas relativas y el link del turno se arman igual que en
 * producción. No hay nada que mantener por duplicado.
 */
const { servidor, PREFIJO, RAIZ } = require('../tests/e2e-util');

// Devuelve { srv, base }: el servidor ya escuchando en un puerto libre y la URL de la app.
async function levantar() {
  const srv = await servidor();
  return { srv, base: 'http://127.0.0.1:' + srv.address().port + PREFIJO };
}

module.exports = { levantar, RAIZ };
