/* Genera las capturas de la guía (docs/img/*.png) y el recorrido animado (docs/img/demo.gif).
 *
 * Uso:  node tools/demo.js
 * Necesita Playwright y ffmpeg. Abre la app (index.html y panel.html) en un celular simulado
 * con la "Barbería El Molino" de tools/ejemplo.js: todo inventado, y Supabase falso (la base
 * real nunca se toca). Volver a correrlo cada vez que cambie algo visible de la app.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { levantar, RAIZ } = require('./servidor');
const Ejemplo = require('./ejemplo');

const SALIDA = path.join(RAIZ, 'docs', 'img');
const ANCHO = 390;
const capturas = [];
const errores = [];

// Pantalla visible; con "alto", la página entera recortada a esa altura (arriba); con "desde",
// el recorte arranca en ese elemento (así una pantalla larga muestra justo la parte que importa).
async function foto(page, nombre, { alto, desde } = {}) {
  await page.waitForTimeout(400);
  const destino = path.join(SALIDA, nombre + '.png');
  if (!alto) await page.screenshot({ path: destino });
  else {
    const y0 = desde ? await page.locator(desde).first().evaluate((e) => Math.max(0, e.getBoundingClientRect().top + scrollY - 12)) : 0;
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.screenshot({ path: destino, fullPage: true, clip: { x: 0, y: y0, width: ANCHO, height: Math.min(alto, total - y0) } });
  }
  capturas.push(nombre);
}

async function abrirPagina(browser, base, est, opciones) {
  const ctx = await Ejemplo.contexto(browser, est, opciones, base);
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errores.push(e.message));
  return { ctx, page };
}

const esperar = (page, texto) => page.waitForFunction((t) => document.getElementById('vista').textContent.includes(t), texto);

(async () => {
  for (const f of fs.readdirSync(SALIDA)) if (f.endsWith('.png')) fs.rmSync(path.join(SALIDA, f)); // las viejas no se mezclan
  const { srv, base } = await levantar();
  const browser = await chromium.launch({ args: ['--lang=es-AR'] });
  let est = Ejemplo.crearEstado();
  const estados = [est];

  // ── Cliente ──
  let { ctx, page } = await abrirPagina(browser, base, est);
  await page.goto(Ejemplo.PUBLICA + 'index.html?b=' + Ejemplo.SLUG);
  await page.waitForSelector('[data-servicio="s1"]');
  await foto(page, 'cliente-1-servicios');
  await page.click('[data-servicio="s2"]');
  await page.waitForSelector('[data-dia]');
  await foto(page, 'cliente-2-dia');
  await page.click('[data-dia="2026-11-24"]');
  await page.waitForSelector('[data-hora]');
  await foto(page, 'cliente-3-horario');
  await page.click('[data-hora]:text-is("10:30")');
  await page.fill('#nombre', Ejemplo.CLIENTE_NUEVO.nombre);
  await page.fill('#telefono', Ejemplo.CLIENTE_NUEVO.telefono);
  await foto(page, 'cliente-4-datos');
  await page.click('#btn-reservar');
  await page.waitForSelector('#btn-calendario');
  await foto(page, 'cliente-5-confirmacion');
  await page.click('.enlace a');                       // el link del turno, como lo abriría el cliente
  await page.waitForSelector('#btn-cancelar');
  await foto(page, 'cliente-6-turno');
  await page.click('#btn-cancelar');
  await page.waitForSelector('#btn-cancelar-si');
  await foto(page, 'cliente-7-cancelar');
  await ctx.close();

  // ── Panel ──
  ({ ctx, page } = await abrirPagina(browser, base, est));
  await page.goto(Ejemplo.PUBLICA + 'panel.html');
  await page.waitForSelector('#btn-entrar');
  await foto(page, 'panel-1-ingreso');
  await page.fill('#email', Ejemplo.EMAIL);
  await page.fill('#clave', Ejemplo.CLAVE);
  await page.click('#btn-entrar');
  await page.waitForSelector('#agenda');
  await foto(page, 'panel-2-agenda', { alto: 1380 });
  await page.click('[data-turno="t2"]');
  await foto(page, 'panel-3-turno', { alto: 760, desde: '.dia-titulo' });
  await page.click('[data-turno="t2"]');                                    // se cierra
  await page.click('[data-act="turno-en"]:has-text("12:20")');
  await page.fill('#nombre', Ejemplo.TURNO_MANUAL.nombre);
  await page.fill('#telefono', Ejemplo.TURNO_MANUAL.telefono);
  await foto(page, 'panel-4-turno-manual');
  await page.click('#btn-guardar-turno');
  await page.waitForSelector('#agenda');
  await page.click('[data-act="bloquear"]');
  await page.fill('#desde', Ejemplo.BLOQUEO.desde);
  await page.fill('#hasta', Ejemplo.BLOQUEO.hasta);
  await page.fill('#motivo', Ejemplo.BLOQUEO.motivo);
  await foto(page, 'panel-5-bloquear');
  await page.click('#btn-guardar-bloqueo');
  await page.waitForSelector('[data-afectado]');
  await foto(page, 'panel-6-afectados', { alto: 900 });
  await page.click('[data-afectado="t6"] [data-act="cancelar-afectado"]');
  await page.waitForSelector('[data-afectado="t5"]');
  await page.click('[data-act="volver"]');
  await page.waitForSelector('#agenda');
  await page.click('[data-act="faltas"]');
  await page.waitForSelector('[data-cliente]');
  await foto(page, 'panel-7-faltas');
  await page.click('[data-act="volver"]');
  await page.waitForSelector('#agenda');
  await page.click('[data-act="config"]');
  await page.waitForSelector('#notif-boton');
  await foto(page, 'panel-8-configuracion');
  await page.click('#notif-boton');
  await page.waitForFunction(() => document.getElementById('notif-texto').textContent.includes('activadas'));
  await foto(page, 'panel-13-notificaciones', { alto: 330, desde: '#vista h2' });
  await page.click('[data-act="cfg-servicios"]');
  await page.waitForSelector('[data-servicio="s1"]');
  await foto(page, 'panel-9-servicios', { alto: 1100 });
  await page.click('[data-act="cfg-menu"]');
  await page.click('[data-act="cfg-horario"]');
  await page.waitForSelector('[data-franja]');
  await foto(page, 'panel-10-horario', { alto: 1250 });
  await page.click('[data-act="cfg-menu"]');
  await page.click('[data-act="cfg-ajustes"]');
  await page.waitForSelector('#form-ajustes');
  await foto(page, 'panel-11-ajustes', { alto: 1500 });
  await page.click('[data-act="cfg-menu"]');
  await page.click('[data-act="cfg-link"]');
  await page.waitForSelector('#hoja-qr svg');
  await foto(page, 'panel-12-qr', { alto: 1000 });
  await ctx.close();

  // ── Recorrido animado: el cliente reserva y el barbero lo ve en su agenda ──
  est = Ejemplo.crearEstado();
  estados.push(est);
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'barber-gif-'));
  ({ ctx, page } = await abrirPagina(browser, base, est, { deviceScaleFactor: 1, recordVideo: { dir: carpeta, size: { width: ANCHO, height: 844 } } }));
  await page.goto(Ejemplo.PUBLICA + 'index.html?b=' + Ejemplo.SLUG);
  await page.waitForSelector('[data-servicio="s1"]');
  await page.waitForTimeout(1100);
  await page.click('[data-servicio="s1"]');
  await page.waitForSelector('[data-dia]');
  await page.waitForTimeout(900);
  await page.click('[data-dia="' + Ejemplo.HOY + '"]');
  await page.waitForSelector('[data-hora]');
  await page.waitForTimeout(900);
  await page.click('[data-hora]:text-is("12:30")');
  await page.waitForTimeout(500);
  await page.locator('#nombre').pressSequentially(Ejemplo.CLIENTE_NUEVO.nombre, { delay: 45 });
  await page.locator('#telefono').pressSequentially(Ejemplo.CLIENTE_NUEVO.telefono, { delay: 45 });
  await page.waitForTimeout(500);
  await page.click('#btn-reservar');
  await page.waitForSelector('#btn-calendario');
  await page.waitForTimeout(2200);
  await page.goto(Ejemplo.PUBLICA + 'panel.html');
  await page.waitForSelector('#btn-entrar');
  await page.waitForTimeout(500);
  await page.fill('#email', Ejemplo.EMAIL);
  await page.fill('#clave', Ejemplo.CLAVE);
  await page.waitForTimeout(400);
  await page.click('#btn-entrar');
  await page.waitForSelector('#agenda');
  await page.waitForTimeout(900);
  const nuevo = page.locator('.turno:has-text("' + Ejemplo.CLIENTE_NUEVO.nombre + '")');
  await nuevo.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await nuevo.locator('[data-act="abrir"]').click();
  await page.waitForTimeout(2600);
  const video = await page.video().path();
  await ctx.close();
  await browser.close();
  srv.close();

  // webm -> GIF liviano (6 cuadros por segundo, 300 px; solo se guarda lo que cambia).
  const gif = path.join(SALIDA, 'demo.gif');
  const filtro = 'fps=6,scale=300:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', filtro, gif]);
  fs.rmSync(carpeta, { recursive: true, force: true });

  if (errores.length) throw new Error('Errores de JavaScript en la app: ' + errores.join(' | '));
  const salidas = [].concat(...estados.map((e) => e.salidas));
  if (salidas.length) throw new Error('Pedidos a hosts no permitidos: ' + salidas.join(', '));
  console.log('Capturas (' + capturas.length + '):', capturas.join(', '));
  console.log('GIF:', path.relative(RAIZ, gif), Math.round(fs.statSync(gif).size / 1024) + ' KB');
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
