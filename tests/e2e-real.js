// Prueba de punta a punta contra el Supabase REAL de js/config.js. Es el único lugar que
// usa la red de verdad: no corre con las demás pruebas ni en CI, se lanza a mano.
//   node tests/e2e-real.js <slug> [carpeta-de-capturas]
// <slug> es una barbería de prueba que ya tiene un servicio y horarios (ver docs/alta-barberia.sql).
// No necesita ninguna clave ni login: hace lo mismo que un cliente. Deja un turno creado y
// cancelado; el token se imprime para poder borrarlo por SQL.
const fs = require('fs');
const { chromium } = require('playwright');
const { PREFIJO, servidor } = require('./e2e-util');

const slug = process.argv[2];
const carpeta = process.argv[3];
if (!slug) { console.error('Uso: node tests/e2e-real.js <slug> [carpeta-de-capturas]'); process.exit(1); }
if (carpeta) fs.mkdirSync(carpeta, { recursive: true });

// Un celular de 8 dígitos con área 11 (el primero no es 0 ni 1, como un número real).
const telefono = '11' + (2 + Math.floor(Math.random() * 8)) + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');

(async () => {
  const srv = await servidor();
  const BASE = `http://127.0.0.1:${srv.address().port}${PREFIJO}`;
  const browser = await chromium.launch();
  let token = null;
  let page;
  const captura = (n) => carpeta ? page.screenshot({ path: `${carpeta}/${n}.png`, fullPage: true }) : null;
  const exige = (cond, msg) => { if (!cond) throw new Error(msg); console.log('  ✔ ' + msg); };

  try {
    // Sin mocks de red; el service worker se bloquea para no cachear nada entre corridas.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'es-AR' });
    page = await ctx.newPage();
    const errores = [];
    page.on('pageerror', (e) => errores.push(e.message));

    console.log('Reserva en ' + slug);
    await page.goto(BASE + 'index.html?b=' + encodeURIComponent(slug));
    await page.waitForSelector('[data-servicio]', { timeout: 15000 });
    await captura('1-servicios');
    await page.locator('[data-servicio]').first().click();
    await page.waitForSelector('[data-dia]', { timeout: 15000 });
    await page.locator('[data-dia]').first().click();
    await page.waitForSelector('[data-hora]', { timeout: 15000 });
    await page.locator('[data-hora]').first().click();
    await page.fill('#nombre', 'Prueba E2E');
    await page.fill('#telefono', telefono);
    await captura('2-datos');
    await page.click('#btn-reservar');
    await page.waitForSelector('#btn-calendario', { timeout: 15000 });
    const enlace = await page.locator('#vista a[href*="?t="]').first().getAttribute('href');
    token = new URL(enlace).searchParams.get('t');
    exige(/^[0-9a-f]{20,}$/.test(token || ''), 'la confirmación trae el link con el token');
    console.log('  token: ' + token);
    await captura('3-confirmacion');

    console.log('Ver y cancelar el turno');
    await page.goto(BASE + 'index.html?t=' + token);
    await page.waitForSelector('.estado-confirmado', { timeout: 15000 });
    exige((await page.textContent('#vista')).includes('Confirmado'), 'el turno figura como confirmado');
    await captura('4-turno');
    if (await page.locator('#btn-cancelar').count()) {
      await page.click('#btn-cancelar');
      await page.click('#btn-cancelar-si');
      await page.waitForSelector('.estado-cancelado', { timeout: 15000 });
      exige((await page.textContent('#vista')).includes('Cancelado'), 'tras cancelar figura como cancelado');
      await captura('5-cancelado');
    } else {
      // Si faltan menos de cancelacion_horas, la app no deja cancelar online: es lo esperado.
      console.log('  (el horario cae dentro de la ventana de cancelación: no hay botón; el turno queda confirmado)');
    }
    exige(errores.length === 0, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
    console.log('Todo bien');
  } catch (e) {
    console.error('FALLÓ: ' + e.message);
    if (page) await captura('error').catch(() => {});
    if (token) console.error('Token del turno creado: ' + token);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
  }
})();
