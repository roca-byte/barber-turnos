/* Lo común a los videos de docs/video/ (tools/video.js).
 *
 * Abre la app en un celular simulado con la "Barbería El Molino" de tools/ejemplo.js (todo
 * inventado, Supabase falso: la base real nunca se toca), graba la pantalla con capturas
 * seguidas mientras corre el "guion" de cada video y arma el MP4. Le da al guion: carteles
 * que explican cada paso, placas de apertura y cierre y un círculo en cada toque.
 * Necesita Playwright y ffmpeg.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { levantar, RAIZ } = require('./servidor');
const Ejemplo = require('./ejemplo');

const SALIDA = path.join(RAIZ, 'docs', 'video');
const ANCHO = 390, ALTO = 844;

// Se inyecta en la página: carteles, placas y marca de toques. Vive fuera de #vista
// (que la app redibuja entero), así sobrevive a cada pantalla nueva. El cartel va ARRIBA porque
// lo que se toca se centra en la pantalla y la barra de Guardar ocupa el pie.
// #v-marca: un cuadradito fijo de 3 px arriba a la izquierda, del color de la barra. Si una
// captura sale corrida en medio de un scroll, la marca no está en su lugar y el cuadro se descarta.
function preparar() {
  if (document.getElementById('v-marca')) return;
  const css = document.createElement('style');
  css.textContent = `
    #v-marca { position: fixed; left: 0; top: 0; width: 3px; height: 3px; z-index: 101; background: #14181f; pointer-events: none; }
    #v-cartel { position: fixed; left: 12px; right: 12px; top: 12px; z-index: 99; padding: 12px 16px; pointer-events: none;
      background: rgba(20, 24, 31, .94); color: #fff; border-radius: 14px; font: 600 17px/1.35 "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 6px 24px rgba(0,0,0,.25); transition: opacity .35s, transform .35s; }
    #v-cartel.oculto { opacity: 0; transform: translateY(-14px); }
    #v-cartel small { display: block; font-weight: 400; font-size: 14px; opacity: .85; margin-top: 2px; }
    #v-placa { position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 14px; text-align: center; padding: 24px; background: #14181f; color: #fff;
      font-family: "Segoe UI", Roboto, sans-serif; transition: opacity .6s; }
    #v-placa.oculto { opacity: 0; pointer-events: none; }
    #v-placa img { width: 112px; height: 112px; }
    #v-placa h1 { margin: 0; font-size: 34px; line-height: 1.15; } #v-placa h1 span { color: #f2b84b; }
    #v-placa p { margin: 0; font-size: 18px; opacity: .9; max-width: 310px; line-height: 1.4; }
    #v-placa b { color: #f2b84b; }
    .v-toque { position: fixed; z-index: 98; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
      background: rgba(242, 184, 75, .4); border: 3px solid #f2b84b; pointer-events: none; animation: v-toque .6s ease-out forwards; }
    @keyframes v-toque { from { transform: scale(.4); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }`;
  document.head.appendChild(css);
  const crear = (id, clase) => { const e = document.createElement('div'); e.id = id; e.className = clase === undefined ? 'oculto' : clase; document.body.appendChild(e); return e; };
  crear('v-marca', '');
  const cartel = crear('v-cartel'), placa = crear('v-placa');
  document.addEventListener('pointerdown', e => {
    const t = document.createElement('div');
    t.className = 'v-toque'; t.style.left = e.clientX + 'px'; t.style.top = e.clientY + 'px';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 700);
  }, true);
  window.vCartel = (titulo, detalle) => {
    cartel.innerHTML = titulo ? titulo + (detalle ? '<small>' + detalle + '</small>' : '') : '';
    cartel.className = titulo ? '' : 'oculto';
  };
  window.vPlaca = html => { if (html) placa.innerHTML = html; placa.className = html ? '' : 'oculto'; };
  // Scroll animado a mano (paso a paso desde JS): con el scroll suave del navegador, algunas
  // capturas salían con las capas corridas.
  window.vScroll = (destino, ms, caja) => new Promise(ok => {
    const el = caja || document.scrollingElement, desde = el.scrollTop, t0 = performance.now();
    const paso = ahora => {
      const k = Math.min(1, (ahora - t0) / ms), suave = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      el.scrollTop = desde + (destino - desde) * suave;
      if (k < 1) requestAnimationFrame(paso); else ok();
    };
    requestAnimationFrame(paso);
  });
}

// Graba el video docs/video/<nombre>. guion(h) recibe la página y las ayudas para moverse.
// opciones.ruta: página donde arranca ('index.html?b=el-molino' o 'panel.html').
async function grabarVideo(nombre, guion, opciones) {
  fs.mkdirSync(SALIDA, { recursive: true });
  const { srv, base } = await levantar();
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'barber-video-'));
  const browser = await chromium.launch({ args: ['--lang=es-AR'] });
  const est = Ejemplo.crearEstado();
  const ctx = await Ejemplo.contexto(browser, est, {}, base);
  const url = Ejemplo.PUBLICA;
  const page = await ctx.newPage();

  // Grabación: capturas de pantalla seguidas a resolución doble, cada una con su hora.
  // (La grabación propia de Playwright da cuadros de 390 px, que en un celular se ven borrosos.)
  const cuadros = [];
  let grabando = false;
  async function grabar() {
    while (grabando) {
      const t = Date.now() / 1000;
      const archivo = path.join(carpeta, 'c' + String(cuadros.length).padStart(5, '0') + '.jpg');
      try {
        await page.screenshot({ path: archivo, type: 'jpeg', quality: 88, animations: 'allow', caret: 'initial' });
        cuadros.push({ archivo, t });
      } catch (e) { /* la página se está redibujando: se saltea el cuadro */ }
    }
  }
  page.on('dialog', d => d.accept());
  // Si algo no aparece, que falle enseguida (si no, el video queda con la pantalla quieta).
  page.setDefaultTimeout(5000);
  page.on('pageerror', e => { throw e; });

  await page.goto(url + opciones.ruta);
  await page.waitForSelector(opciones.espera);
  await page.evaluate(preparar);

  const espera = ms => page.waitForTimeout(ms);
  const cartel = async (t, d, ms) => { await page.evaluate(([a, b]) => window.vCartel(a, b), [t, d || '']); await espera(ms || 3000); };
  const placa = async (html, ms) => { await page.evaluate(h => window.vPlaca(h), html); await espera(ms); };
  // Lleva el elemento al centro (o arriba) con el scroll animado a mano
  const ver = async (sel, bloque) => {
    await page.locator(sel).first().evaluate(async (e, b) => {
      const r = e.getBoundingClientRect(), y = scrollY + r.top - (b === 'start' ? 90 : (innerHeight - r.height) / 2);
      await window.vScroll(Math.max(0, y), 650);
    }, bloque);
    await espera(250);
  };
  const tocar = async (sel, ms) => { await ver(sel); await page.locator(sel).first().click(); await espera(ms || 1000); };
  const tipear = async (sel, txt) => { await ver(sel); await page.locator(sel).first().click(); await page.keyboard.type(txt, { delay: 70 }); await espera(400); };
  // El desplegable nativo no se ve en la grabación: se elige directo.
  const elegir = async (sel, valor) => { await ver(sel); await page.selectOption(sel, valor); await espera(800); };
  const arriba = async () => { await page.evaluate(() => window.vScroll(0, 600)); await espera(300); };
  // Después de un toque que cambia de página (el link del turno): se vuelve a poner lo que se inyecta.
  const reponer = async (sel) => { await page.waitForSelector(sel); await page.evaluate(preparar); };

  const logo = await page.evaluate(() => new URL('icons/icon.svg', location.href).href);
  const titulo = '<img src="' + logo + '" alt=""><h1>Barber-<span>Turnos</span></h1>';

  grabando = true;
  const grabacion = grabar();
  await espera(300);

  await guion({ page, ctx, url, est, carpeta, espera, cartel, placa, ver, tocar, tipear, elegir, arriba, reponer, titulo });

  grabando = false;
  await grabacion;
  const fin = Date.now() / 1000;
  await ctx.close();
  await browser.close();
  srv.close();
  if (est.salidas.length) throw new Error('Pedidos a hosts no permitidos: ' + est.salidas.join(', '));

  // Cuadros fallados: si la marca de la esquina no es oscura, la captura salió corrida y se
  // descarta (el cuadro anterior queda un poco más). La placa y el visor también son oscuros.
  const luz = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', path.join(carpeta, 'c%05d.jpg'), '-vf',
    'crop=4:4:1:1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-']).toString()
    .split('\n').filter(l => l.includes('YAVG=')).map(l => +l.split('=')[1]);
  const sanos = cuadros.filter((c, i) => !(luz[i] > 120));
  console.log('Cuadros fallados descartados:', cuadros.length - sanos.length);

  // Lista de cuadros con cuánto dura cada uno en pantalla (hasta que llega el siguiente).
  const lista = path.join(carpeta, 'lista.txt');
  fs.writeFileSync(lista, sanos.map((c, i) => {
    const hasta = i + 1 < sanos.length ? sanos[i + 1].t : fin;
    return "file '" + c.archivo + "'\nduration " + Math.max(0.04, hasta - c.t).toFixed(3);
  }).join('\n') + "\nfile '" + sanos[sanos.length - 1].archivo + "'\n");

  // Cuadros → MP4 (H.264) a 25 cuadros por segundo: se reproduce en celulares, WhatsApp,
  // LinkedIn y YouTube. El ancho y el alto tienen que ser pares para H.264.
  const mp4 = path.join(SALIDA, nombre);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lista,
    '-vf', 'fps=25,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23',
    '-movflags', '+faststart', '-an', mp4]);
  fs.rmSync(carpeta, { recursive: true, force: true });
  const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString().trim();
  console.log('Cuadros:', sanos.length);
  console.log('Video:', path.relative(RAIZ, mp4), Math.round(fs.statSync(mp4).size / 1024) + ' KB,', Math.round(dur) + ' s');
}

module.exports = { grabarVideo };
