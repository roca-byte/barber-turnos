// Prueba de punta a punta de la página del cliente (index.html) en Chromium real.
//   node tests/e2e-cliente.js
// Levanta un servidor estático bajo /barber-turnos/ (como GitHub Pages) y simula Supabase
// con page.route sobre **/rest/v1/rpc/*: no hay red ni base. El reloj del navegador se
// fija en el 1/12/2026 08:00 de Buenos Aires y el navegador corre en Asia/Tokyo: si la
// pantalla muestra "10:00" y "martes 1 de diciembre", es porque usa la zona de la barbería.
const fs = require('fs');
const { chromium } = require('playwright');
const { PREFIJO, servidor, json, falla, pausa, verificador, abrir: abrirBase } = require('./e2e-util');

const TOKEN = 'a'.repeat(64);
const Html_mensaje = (c) => require('../js/html.js').mensajeError(c);
const V = verificador();
const ok = V.ok;

const BARBERIA = {
  id: 'b1', slug: 'lo-de-tito', nombre: 'Lo de Tito', direccion: 'Av. Siempre Viva 123',
  whatsapp: '5491155550000', zona_horaria: 'America/Argentina/Buenos_Aires', codigo_area: '11',
  servicios: [
    { id: 's1', nombre: 'Corte', duracion_min: 30, precio: 8000 },
    { id: 's2', nombre: 'Corte y barba', duracion_min: 45, precio: 12000 }
  ]
};
// 13:00Z = 10:00 en Buenos Aires = 22:00 en Tokyo.
const HORARIOS = ['2026-12-01T13:00:00Z', '2026-12-01T13:15:00Z'];

const abrir = abrirBase; // (browser, BASE, ruta, rpc)

(async () => {
  const srv = await servidor();
  const BASE = `http://127.0.0.1:${srv.address().port}${PREFIJO}`;
  const browser = await chromium.launch();

  const rpcBase = {
    barberia_publica: () => json(BARBERIA),
    dias_disponibles: () => json(['2026-12-01', '2026-12-02']),
    disponibilidad: () => json(HORARIOS),
    reservar: () => json(TOKEN)
  };
  const vista = (p) => p.textContent('#vista');

  // Recorre servicio -> día -> horario -> datos hasta apretar "Reservar".
  async function recorrer(page, nombre, telefono, reservar = true) {
    await page.click('[data-servicio="s1"]');
    await page.click('[data-dia="2026-12-01"]');
    await page.click('[data-hora="' + HORARIOS[0] + '"]');
    await page.fill('#nombre', nombre);
    await page.fill('#telefono', telefono);
    if (reservar) await page.click('#btn-reservar');
  }

  // ════ Recorrido completo ════
  console.log('Recorrido completo');
  let page = await abrir(browser, BASE, '?b=lo-de-tito', rpcBase);
  await page.waitForSelector('[data-servicio="s1"]');
  let t = await vista(page);
  ok(t.includes('Lo de Tito') && t.includes('Av. Siempre Viva 123'), 'muestra nombre y dirección de la barbería');
  ok((await page.textContent('header.marca')).trim() === 'Barber-Turnos' && await page.getAttribute('header.marca img', 'src') === './icons/icon.svg', 'muestra el logo y el nombre Barber-Turnos');
  ok(await page.locator('a[href^="https://wa.me/5491155550000"]').count() > 0, 'tiene botón de WhatsApp de la barbería');
  ok(t.includes('Corte y barba') && t.includes('45 min'), 'lista los servicios con su duración');
  await page.click('[data-servicio="s1"]');
  await page.waitForSelector('[data-dia]');
  ok((await vista(page)).includes('martes 1 de diciembre'), 'lista los días con nombre largo');
  await page.click('[data-dia="2026-12-01"]');
  await page.waitForSelector('[data-hora]');
  ok(await page.locator('[data-hora]').first().textContent() === '10:00', 'los horarios salen en la zona de la barbería (10:00), no la del navegador (Tokyo)');
  await page.click('[data-hora="' + HORARIOS[0] + '"]');
  await page.fill('#nombre', 'Juan Pérez');
  await page.fill('#telefono', '011 15 1234-5678');
  ok((await page.textContent('#vista-telefono')).includes('+54 9 11 1234-5678'), 'muestra en vivo cómo se identifica el WhatsApp');
  await page.click('#btn-reservar');
  await page.waitForSelector('#btn-calendario');
  t = await vista(page);
  ok(t.includes('martes 1 de diciembre') && t.includes('10:00'), 'la confirmación muestra "martes 1 de diciembre" y "10:00"');
  const res = page.llamadas.reservar[0];
  ok(res.p_slug === 'lo-de-tito' && res.p_servicio === 's1' && res.p_inicio === HORARIOS[0] && res.p_nombre === 'Juan Pérez' && res.p_telefono === '5491112345678',
    'reservar recibe slug, servicio, instante, nombre y teléfono normalizado');
  const enlace = `http://127.0.0.1:${srv.address().port}${PREFIJO}index.html?t=${TOKEN}`;
  ok((await vista(page)).includes(enlace), 'el link del turno es absoluto y respeta el subdirectorio');
  const wa = await page.getAttribute('#btn-whatsapp', 'href');
  ok(wa === 'https://wa.me/5491112345678?text=' + encodeURIComponent(enlace), '"Mandarme el link por WhatsApp" apunta a wa.me con el link del turno');
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#btn-calendario')]);
  const ics = fs.readFileSync(await descarga.path(), 'utf8');
  ok(ics.includes('DTSTART:20261201T130000Z') && ics.includes('DTEND:20261201T133000Z') && ics.includes('Corte'), '"Agregar a mi calendario" baja un .ics con el turno');
  ok(page.errores.length === 0, 'sin errores de JavaScript: ' + page.errores.join(' | '));
  await page.context().close();

  // ════ Horario ocupado ════
  console.log('Horario ocupado');
  page = await abrir(browser, BASE, '?b=lo-de-tito', { ...rpcBase, reservar: () => falla('HORARIO_NO_DISPONIBLE') });
  await page.waitForSelector('[data-servicio="s1"]');
  await recorrer(page, 'Ana', '1155551234');
  await page.waitForSelector('[data-hora]');
  ok((await vista(page)).includes('Ese horario se acaba de ocupar'), 'muestra el mensaje de horario ocupado');
  ok(page.llamadas.disponibilidad.length === 2, 'vuelve a pedir la disponibilidad del día');
  await page.context().close();

  // ════ Doble clic ════
  console.log('Doble clic en Reservar');
  page = await abrir(browser, BASE, '?b=lo-de-tito', { ...rpcBase, reservar: async () => { await pausa(400); return json(TOKEN); } });
  await page.waitForSelector('[data-servicio="s1"]');
  await recorrer(page, 'Ana', '1155551234', false);
  await page.dblclick('#btn-reservar');
  await page.waitForSelector('#btn-calendario');
  ok(page.llamadas.reservar.length === 1, 'una sola llamada a reservar');
  await page.context().close();

  // ════ XSS ════
  console.log('Texto del usuario');
  const feo = '<img src=x onerror=alert(1)>';
  page = await abrir(browser, BASE, '?b=lo-de-tito', rpcBase);
  await page.waitForSelector('[data-servicio="s1"]');
  await recorrer(page, feo, '1155551234');
  await page.waitForSelector('#btn-calendario');
  ok((await vista(page)).includes(feo) && await page.locator('#vista img').count() === 0, 'el nombre se muestra como texto, no como HTML');
  await pausa(200);
  ok(page.alertas.length === 0, 'no se ejecutó el script');
  await page.context().close();

  // ════ Teléfono inválido ════
  console.log('Validaciones');
  page = await abrir(browser, BASE, '?b=lo-de-tito', rpcBase);
  await page.waitForSelector('[data-servicio="s1"]');
  await recorrer(page, 'Ana', '123');
  await pausa(100);
  ok((await vista(page)).includes('Revisá el número de WhatsApp') && !page.llamadas.reservar, 'un teléfono inválido se avisa sin llamar al servidor');
  await page.context().close();

  // ════ Error de reserva que no es de horario ════
  console.log('Error al reservar (límite por hora)');
  page = await abrir(browser, BASE, '?b=lo-de-tito', { ...rpcBase, reservar: () => falla('LIMITE_HORA') });
  await page.waitForSelector('[data-servicio="s1"]');
  await recorrer(page, 'Ana Gómez', '1155551234');
  await page.waitForSelector('#aviso-datos');
  ok((await page.textContent('#aviso-datos')).includes(Html_mensaje('LIMITE_HORA')), 'LIMITE_HORA muestra su mensaje sobre el formulario');
  ok(await page.inputValue('#nombre') === 'Ana Gómez' && await page.inputValue('#telefono') === '1155551234', 'el nombre y el teléfono siguen escritos');
  ok(await page.isEnabled('#btn-reservar'), 'el botón Reservar vuelve a estar habilitado');
  await page.context().close();

  // ════ Link largo, precio opcional y WhatsApp vacío ════
  console.log('Detalles de la pantalla');
  page = await abrir(browser, BASE, '?b=lo-de-tito', rpcBase);
  await page.waitForSelector('[data-servicio="s1"]');
  await recorrer(page, 'Juan', '1155551234');
  await page.waitForSelector('#btn-calendario');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'el link del turno no hace desbordar la pantalla');
  ok(await page.locator('.tarjeta .enlace a').count() === 1, 'el link usa la clase .enlace (corta en cualquier lado)');
  await page.context().close();

  const sinExtras = { ...BARBERIA, whatsapp: '', servicios: [
    { id: 's1', nombre: 'Corte', duracion_min: 30, precio: null },
    { id: 's2', nombre: 'Barba', duracion_min: 20, precio: 0 }
  ] };
  page = await abrir(browser, BASE, '?b=lo-de-tito', { ...rpcBase, barberia_publica: () => json(sinExtras) });
  await page.waitForSelector('[data-servicio="s1"]');
  ok(!(await page.textContent('[data-servicio="s1"]')).includes('$'), 'servicio con precio null: no muestra "$"');
  ok((await page.textContent('[data-servicio="s2"]')).includes('$ 0'), 'un precio 0 cargado a propósito sí se muestra');
  ok(await page.locator('a[href^="https://wa.me/"]').count() === 0, 'sin WhatsApp de la barbería no hay botones wa.me');
  await page.context().close();

  // ════ Sesión del barbero en el mismo celular ════
  console.log('Sesión del barbero guardada');
  const authHeaders = [];
  page = await abrir(browser, BASE, '?b=lo-de-tito', rpcBase, async (p, ctx) => {
    // Sesión de panel vigente en localStorage (misma clave que usa supabase-js para esta url).
    await ctx.addInitScript(() => {
      localStorage.setItem('sb-falso-auth-token', JSON.stringify({
        access_token: 'JWT-DEL-BARBERO', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'tito@ejemplo.com' }
      }));
    });
    p.on('request', (r) => { if (r.url().includes('/rest/v1/rpc/')) authHeaders.push(r.headers()['authorization']); });
  });
  await page.waitForSelector('[data-servicio="s1"]');
  await recorrer(page, 'Ana', '1155551234');
  await page.waitForSelector('#btn-calendario');
  ok(authHeaders.length >= 4 && authHeaders.every((h) => h === 'Bearer clave-falsa'),
    'las RPC públicas van con la clave anon aunque haya sesión de panel: ' + [...new Set(authHeaders)].join(', '));
  await page.context().close();

  // ════ Ver turno ════
  console.log('Ver turno');
  const turno = (extra) => ({
    estado: 'confirmado', inicio: HORARIOS[0], fin: '2026-12-01T13:30:00Z', servicio: 'Corte',
    barberia: { nombre: 'Lo de Tito', direccion: 'Av. Siempre Viva 123', whatsapp: '5491155550000', zona_horaria: BARBERIA.zona_horaria, slug: 'lo-de-tito' },
    cliente_nombre: 'Juan', puede_cancelar: true, ...extra
  });
  let actual = turno();
  page = await abrir(browser, BASE, '?t=' + TOKEN, {
    ver_turno: () => json(actual),
    cancelar_turno: () => { actual = turno({ estado: 'cancelado', puede_cancelar: false }); return json(null); }
  });
  await page.waitForSelector('#btn-cancelar');
  t = await vista(page);
  ok(t.includes('martes 1 de diciembre') && t.includes('10:00') && t.includes('Corte'), 'muestra el turno en la zona de la barbería');
  ok(page.llamadas.ver_turno[0].p_token === TOKEN, 'pide el turno con el token del link');
  await page.click('#btn-cancelar');
  ok(!page.llamadas.cancelar_turno, 'cancelar pide confirmación antes de llamar');
  await page.click('#btn-cancelar-si');
  await page.waitForFunction(() => document.getElementById('vista').textContent.includes('Cancelado'));
  ok(page.llamadas.cancelar_turno.length === 1 && await page.locator('#btn-cancelar').count() === 0, 'cancelar con confirmación deja el turno cancelado');
  await page.context().close();

  page = await abrir(browser, BASE, '?t=' + TOKEN, { ver_turno: () => json(turno({ puede_cancelar: false, cliente_nombre: feo })) });
  await page.waitForSelector('#vista a[href^="https://wa.me/5491155550000"]');
  t = await vista(page);
  ok(await page.locator('#btn-cancelar').count() === 0 && !t.includes('Cancelar turno'), 'sin puede_cancelar no hay botón "Cancelar turno"');
  ok(t.includes('Ya no podés cancelar online'), 'avisa que ya no se puede cancelar y ofrece el WhatsApp');
  ok(await page.locator('#vista img').count() === 0, 'el nombre del turno también se escapa');
  await page.context().close();

  page = await abrir(browser, BASE, '?t=' + TOKEN, { ver_turno: () => json(null) });
  await page.waitForFunction(() => document.getElementById('vista').textContent.includes('No encontramos este turno'));
  ok(true, 'token desconocido: "No encontramos este turno"');
  await page.context().close();

  // ════ Barbería inexistente ════
  console.log('Barbería inexistente');
  page = await abrir(browser, BASE, '?b=nada', { barberia_publica: () => json(null) });
  await page.waitForFunction(() => document.getElementById('vista').textContent.includes('No encontramos esta barbería'));
  ok(true, '?b= inexistente: "No encontramos esta barbería"');
  await page.context().close();
  page = await abrir(browser, BASE, '', {});
  await page.waitForFunction(() => document.getElementById('vista').textContent.includes('No encontramos esta barbería'));
  ok(true, 'sin parámetros: "No encontramos esta barbería"');
  await page.context().close();

  await browser.close();
  srv.close();
  console.log(V.fallas ? `\n${V.fallas} falla(s)` : '\nTodo bien');
  process.exit(V.fallas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
