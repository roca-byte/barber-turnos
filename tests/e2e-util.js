// Utilidades compartidas por las pruebas de punta a punta (e2e-cliente.js, e2e-panel.js).
// Levantan un servidor estático bajo /barber-turnos/ (como GitHub Pages), abren Chromium
// en Asia/Tokyo con el reloj fijo y simulan Supabase con page.route: no hay red ni base.
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PREFIJO = '/barber-turnos/';
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const AHORA = new Date('2026-12-01T08:00:00-03:00'); // 1/12/2026 08:00 en Buenos Aires
const FALSO = 'https://falso.supabase.co';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

function servidor() {
  return new Promise(res => {
    const s = http.createServer((req, resp) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (!url.startsWith(PREFIJO)) { resp.writeHead(404); return resp.end(); }
      let f = path.join(RAIZ, url.slice(PREFIJO.length) || 'index.html');
      if (!f.startsWith(RAIZ)) { resp.writeHead(403); return resp.end(); }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!fs.existsSync(f)) { resp.writeHead(404); return resp.end(); }
      resp.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(resp);
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

const json = (cuerpo, status = 200) => ({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(cuerpo) });
const falla = (codigo) => json({ code: 'P0001', message: codigo, details: null, hint: null }, 400);
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

// Contador de verificaciones: cada archivo e2e tiene el suyo.
function verificador() {
  const v = { fallas: 0, ok(cond, msg) { console.log((cond ? '  ✔ ' : '  ✘ ') + msg); if (!cond) v.fallas++; } };
  return v;
}

// Abre una página con Supabase simulado. `rpc` mapea nombre -> función(cuerpo, n) que
// devuelve la respuesta (o una promesa). `antes(page, ctx)` permite sumar más rutas
// (auth, tablas) antes de navegar. Devuelve las llamadas hechas a cada RPC en page.llamadas.
async function abrir(browser, BASE, ruta, rpc, antes) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true,
    timezoneId: 'Asia/Tokyo', locale: 'es-AR', serviceWorkers: 'block'
  });
  await ctx.clock.install({ time: AHORA });
  const page = await ctx.newPage();
  page.errores = [];
  page.alertas = [];
  page.confirmaciones = [];
  page.aceptarConfirm = true;
  page.on('pageerror', e => page.errores.push(e.message));
  page.on('dialog', d => {
    if (d.type() === 'confirm') { page.confirmaciones.push(d.message()); return page.aceptarConfirm ? d.accept() : d.dismiss(); }
    page.alertas.push(d.message()); d.dismiss();
  });
  page.llamadas = {};
  // Config falsa: el config.js real trae marcadores de posición.
  await page.route('**/js/config.js', r => r.fulfill({
    contentType: 'text/javascript',
    body: `const Config = { url: '${FALSO}', clavePublica: 'clave-falsa' };`
  }));
  await page.route('**/rest/v1/rpc/*', async r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const nombre = new URL(r.request().url()).pathname.split('/').pop();
    const cuerpo = r.request().postDataJSON();
    (page.llamadas[nombre] = page.llamadas[nombre] || []).push(cuerpo);
    const f = rpc[nombre];
    if (!f) return r.fulfill(falla('DESCONOCIDO'));
    r.fulfill(await f(cuerpo, page.llamadas[nombre].length));
  });
  if (antes) await antes(page, ctx);
  await page.goto(BASE + ruta);
  return page;
}

module.exports = { RAIZ, PREFIJO, AHORA, FALSO, CORS, servidor, json, falla, pausa, verificador, abrir };
