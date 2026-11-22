// Prueba de punta a punta del panel del barbero (panel.html) en Chromium real.
//   node tests/e2e-panel.js
// Mismo esquema que e2e-cliente.js (ver e2e-util.js): servidor estático bajo /barber-turnos/,
// Supabase simulado con page.route (rpc, tablas y auth), reloj fijo en el 1/12/2026 08:00 de
// Buenos Aires y navegador en Asia/Tokyo.
const { chromium } = require('playwright');
const { PREFIJO, AHORA, servidor, json, falla, pausa, verificador, abrir, CORS } = require('./e2e-util');

const V = verificador();
const ok = V.ok;

const BARBERIA = {
  id: 'b1', slug: 'lo-de-tito', nombre: 'Lo de Tito', zona_horaria: 'America/Argentina/Buenos_Aires',
  codigo_area: '11', whatsapp: '5491155550000'
};
const SERVICIOS = [
  { id: 's1', barberia_id: 'b1', nombre: 'Corte', duracion_min: 30, precio: 8000, activo: true, orden: 0 },
  { id: 's2', barberia_id: 'b1', nombre: 'Corte y barba', duracion_min: 45, precio: 12000, activo: true, orden: 1 }
];
// Instantes: 12:00Z = 09:00 en Buenos Aires (21:00 en Tokyo).
const AGENDA = {
  franjas: [{ desde: '2026-12-01T12:00:00Z', hasta: '2026-12-01T16:00:00Z' }],
  turnos: [{ id: 't1', inicio: '2026-12-01T13:00:00Z', fin: '2026-12-01T13:30:00Z', estado: 'confirmado',
    origen: 'online', servicio: 'Corte', nombre: 'Juan Pérez', telefono: '5491112345678', faltas: 2 }],
  bloqueos: []
};
const copia = (o) => JSON.parse(JSON.stringify(o));

// Simula supabase-js: login por contraseña y las lecturas de tablas que hace Api.
async function simular(page, { clave = 'secreta', agenda } = {}) {
  await page.route('**/auth/v1/token*', async r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const c = r.request().postDataJSON();
    page.logins = (page.logins || 0) + 1;
    if (c.password !== clave) return r.fulfill(json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400));
    r.fulfill(json({
      access_token: 'tok', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(AHORA.getTime() / 1000) + 3600, // el reloj del navegador está fijo: el de Node no sirve
      refresh_token: 'ref', user: { id: 'u1', email: c.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
    }));
  });
    await page.route('**/rest/v1/{barberias,servicios,miembros}*', async r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const t = new URL(r.request().url()).pathname.split('/').pop();
    r.fulfill(json(t === 'barberias' ? [BARBERIA] : t === 'servicios' ? SERVICIOS : [{ barberia_id: 'b1' }]));
  });
}

(async () => {
  const srv = await servidor();
  const BASE = `http://127.0.0.1:${srv.address().port}${PREFIJO}`;
  const browser = await chromium.launch();
  const vista = (p) => p.textContent('#vista');

  const rpcBase = (extra = {}) => ({
    agenda_dia: () => json(copia(AGENDA)),
    marcar_turno: () => json(null),
    clientes_con_faltas: () => json([]),
    ...extra
  });
  // Abre el panel ya logueado.
  async function logueado(ruta, rpc, opciones) {
    const page = await abrir(browser, BASE, ruta, rpc, (p) => simular(p, opciones));
    await page.fill('#email', 'tito@ejemplo.com');
    await page.fill('#clave', 'secreta');
    await page.click('#btn-entrar');
    await page.waitForSelector('#agenda');
    return page;
  }

  // ════ Login ════
  console.log('Login');
  let page = await abrir(browser, BASE, 'panel.html', rpcBase(), (p) => simular(p));
  await page.waitForSelector('#btn-entrar');
  await page.fill('#email', 'tito@ejemplo.com');
  await page.fill('#clave', 'mala');
  await page.click('#btn-entrar');
  await page.waitForFunction(() => document.getElementById('vista').textContent.includes('Email o contraseña incorrectos'));
  ok(!page.llamadas.agenda_dia, 'login incorrecto: "Email o contraseña incorrectos" y no se pide la agenda');
  await page.fill('#clave', 'secreta');
  await page.click('#btn-entrar');
  await page.waitForSelector('#agenda');
  let t = await vista(page);
  ok(t.includes('Lo de Tito') && t.includes('martes 1 de diciembre'), 'login correcto: agenda de hoy con el nombre de la barbería');
  ok(page.llamadas.agenda_dia[0].p_barberia === 'b1' && page.llamadas.agenda_dia[0].p_fecha === '2026-12-01',
    'pide agenda_dia de hoy en la zona de la barbería (no la de Tokyo)');
  ok(await page.locator('[data-turno="t1"]').count() === 1 && t.includes('Juan Pérez') && t.includes('Corte'), 'muestra el turno con cliente y servicio');
  ok((await page.textContent('[data-turno="t1"]')).includes('10:00'), 'la hora sale en la zona de la barbería (10:00)');
  ok(await page.locator('[data-hueco]').count() === 2, 'muestra los 2 huecos libres (9:00-10:00 y 10:30-13:00)');
  ok(t.includes('⚠ 2 faltas'), 'un cliente con faltas muestra "⚠ 2 faltas"');
  ok(page.errores.length === 0, 'sin errores de JavaScript: ' + page.errores.join(' | '));
  await page.context().close();

  // ════ Sesión guardada ════
  console.log('Sesión guardada');
  page = await logueado('panel.html', rpcBase());
  const logins = page.logins;
  await page.reload();
  await page.waitForSelector('#agenda');
  ok(page.logins === logins, 'al recargar sigue adentro sin volver a pedir la contraseña');
  await page.context().close();

  // ════ Acciones sobre el turno ════
  console.log('Acciones sobre el turno');
  let estado = 'confirmado';
  page = await logueado('panel.html', rpcBase({
    agenda_dia: () => { const a = copia(AGENDA); a.turnos[0].estado = estado; return json(a); },
    marcar_turno: (c) => { estado = c.p_estado; return json(null); }
  }));
  await page.click('[data-turno="t1"]');
  ok(await page.getAttribute('a[data-act="llamar"]', 'href') === 'tel:+5491112345678', 'llamar apunta a tel: con el número');
  ok(await page.getAttribute('a[data-act="wa-cliente"]', 'href') === 'https://wa.me/5491112345678', 'WhatsApp apunta a wa.me con solo dígitos');
  ok(await page.locator('[data-act="deshacer"]').count() === 0, 'un turno confirmado no ofrece "Deshacer"');
  await page.click('[data-act="marcar"][data-estado="no_vino"]');
  await page.waitForSelector('[data-act="deshacer"]');
  ok(page.llamadas.marcar_turno.length === 1 && page.llamadas.marcar_turno[0].p_turno === 't1' && page.llamadas.marcar_turno[0].p_estado === 'no_vino',
    '"No vino" llama a marcar_turno con no_vino');
  ok(page.llamadas.agenda_dia.length === 2, 'después de marcar se vuelve a pedir la agenda');
  await page.click('[data-act="deshacer"]');
  await page.waitForFunction(() => !document.querySelector('[data-act="deshacer"]'));
  ok(page.llamadas.marcar_turno[1].p_estado === 'confirmado', '"Deshacer" vuelve el turno a confirmado');
  // Cancelar pide confirmación (el turno sigue abierto: así "Deshacer" queda a mano).
  page.aceptarConfirm = false;
  await page.click('[data-act="marcar"][data-estado="cancelado"]');
  ok(page.confirmaciones.length === 1 && page.llamadas.marcar_turno.length === 2, 'cancelar pide confirmación y si decís que no, no llama');
  page.aceptarConfirm = true;
  await page.click('[data-act="marcar"][data-estado="cancelado"]');
  await page.waitForFunction(() => document.querySelector('[data-turno="t1"]').textContent.includes('cancelado'));
  ok(page.llamadas.marcar_turno[2].p_estado === 'cancelado', 'confirmando, cancela el turno');
  ok(await page.locator('[data-hueco]').count() === 1 && (await vista(page)).includes('Libre 09:00–13:00'), 'un turno cancelado deja libre su horario (un solo hueco de 9 a 13)');
  await page.context().close();

  // ════ Turno manual sin teléfono, nombres raros ════
  console.log('Turno sin teléfono y texto del usuario');
  const feo = '<img src=x onerror=alert(1)>';
  page = await logueado('panel.html', rpcBase({
    agenda_dia: () => { const a = copia(AGENDA); Object.assign(a.turnos[0], { telefono: null, faltas: 0, origen: 'manual', nombre: feo }); return json(a); }
  }));
  await page.click('[data-turno="t1"]');
  ok(await page.locator('a[data-act="llamar"], a[data-act="wa-cliente"]').count() === 0, 'sin teléfono no hay botones de llamar ni WhatsApp');
  ok(!(await vista(page)).includes('⚠') && (await vista(page)).includes(feo) && await page.locator('#vista img').count() === 0, 'sin faltas no hay aviso y el nombre se escapa');
  await pausa(200);
  ok(page.alertas.length === 0, 'no se ejecutó el script');
  await page.context().close();

  // ════ Navegar días ════
  console.log('Días');
  page = await logueado('panel.html', rpcBase());
  await page.click('[data-act="dia-sig"]');
  await page.waitForFunction(() => document.getElementById('vista').textContent.includes('miércoles 2 de diciembre'));
  ok(page.llamadas.agenda_dia[1].p_fecha === '2026-12-02', 'la flecha siguiente pide el día 2');
  await page.click('[data-act="dia-ant"]');
  await page.click('[data-act="dia-ant"]');
  await page.waitForFunction(() => document.getElementById('vista').textContent.includes('lunes 30 de noviembre'));
  ok(page.llamadas.agenda_dia.at(-1).p_fecha === '2026-11-30', 'la flecha anterior cruza el cambio de mes');
  await page.click('[data-act="hoy"]');
  await page.waitForFunction(() => document.getElementById('vista').textContent.includes('martes 1 de diciembre'));
  ok(page.llamadas.agenda_dia.at(-1).p_fecha === '2026-12-01', '"Hoy" vuelve al día de hoy');
  await page.context().close();

  console.log('?d= (link de la notificación)');
  page = await logueado('panel.html?d=2026-12-03', rpcBase());
  ok(page.llamadas.agenda_dia[0].p_fecha === '2026-12-03' && (await vista(page)).includes('jueves 3 de diciembre'), '?d=2026-12-03 abre ese día');
  await page.context().close();
  page = await logueado('panel.html?d=basura', rpcBase());
  ok(page.llamadas.agenda_dia[0].p_fecha === '2026-12-01', 'un ?d= inválido se ignora y abre hoy');
  await page.context().close();

  // ════ + Turno ════
  console.log('+ Turno');
  page = await logueado('panel.html', rpcBase({ crear_turno_manual: () => json('t9') }));
  await page.click('[data-act="nuevo-turno"]');
  await page.waitForSelector('#form-turno');
  ok(await page.locator('#servicio option').count() === 2, 'el formulario lista los servicios de la barbería');
  await page.selectOption('#servicio', 's2');
  await page.fill('#hora', '11:00');
  await page.fill('#nombre', 'Pedro');
  await page.fill('#telefono', '011 15 5555-1234');
  await page.click('#btn-guardar-turno');
  await page.waitForSelector('#agenda');
  const m = page.llamadas.crear_turno_manual[0];
  ok(m.p_barberia === 'b1' && m.p_servicio === 's2' && m.p_inicio === '2026-12-01T14:00:00.000Z' && m.p_nombre === 'Pedro' && m.p_telefono === '5491155551234',
    '+ Turno llama a crear_turno_manual con el instante de las 11:00 de Buenos Aires y el teléfono normalizado');
  await page.click('[data-act="nuevo-turno"]');
  await page.fill('#hora', '12:00');
  await page.fill('#nombre', 'Luis');
  await page.click('#btn-guardar-turno');
  await page.waitForSelector('#agenda');
  ok(page.llamadas.crear_turno_manual[1].p_telefono === null || page.llamadas.crear_turno_manual[1].p_telefono === undefined, 'el WhatsApp es opcional');
  await page.click('[data-act="nuevo-turno"]');
  await page.fill('#hora', '12:00');
  await page.fill('#nombre', 'Luis');
  await page.fill('#telefono', '123');
  await page.click('#btn-guardar-turno');
  await pausa(100);
  ok((await vista(page)).includes('Revisá el número de WhatsApp') && page.llamadas.crear_turno_manual.length === 2, 'teléfono inválido se avisa sin llamar al servidor');
  await page.context().close();

  page = await logueado('panel.html', rpcBase({ crear_turno_manual: () => falla('HORARIO_NO_DISPONIBLE') }));
  await page.click('[data-hueco]');
  ok(await page.inputValue('#hora') === '09:00', 'tocar un hueco libre abre "+ Turno" con la hora del hueco');
  await page.fill('#nombre', 'Pedro');
  await page.click('#btn-guardar-turno');
  await page.waitForFunction(() => document.getElementById('vista').textContent.includes('Ese horario se acaba de ocupar'));
  ok(await page.inputValue('#nombre') === 'Pedro', 'un error del servidor no borra lo que escribiste');
  await page.context().close();

  // ════ Bloquear ════
  console.log('Bloquear');
  const afectado = { turno_id: 't1', inicio: '2026-12-01T13:00:00Z', nombre: 'Juan Pérez', telefono: '5491112345678' };
  const manual = { turno_id: 't2', inicio: '2026-12-01T14:00:00Z', nombre: 'Luis', telefono: null };
  let confirmado = true;
  page = await logueado('panel.html', rpcBase({
    crear_bloqueo: () => json({ id: 'bl1', afectados: [afectado, manual] }),
    agenda_dia: () => { const a = copia(AGENDA); if (!confirmado) a.turnos[0].estado = 'cancelado'; return json(a); },
    marcar_turno: () => { confirmado = false; return json(null); }
  }));
  await page.click('[data-act="bloquear"]');
  await page.waitForSelector('#form-bloqueo');
  await page.fill('#desde', '2026-12-01T10:00');
  await page.fill('#hasta', '2026-12-01T12:00');
  await page.fill('#motivo', 'Médico');
  await page.click('#btn-guardar-bloqueo');
  await page.waitForSelector('[data-afectado]');
  const b = page.llamadas.crear_bloqueo[0];
  ok(b.p_barberia === 'b1' && b.p_inicio === '2026-12-01T13:00:00.000Z' && b.p_fin === '2026-12-01T15:00:00.000Z' && b.p_motivo === 'Médico',
    'bloquear llama a crear_bloqueo con instantes de la zona de la barbería y el motivo');
  const texto = 'Hola Juan Pérez, tuve un imprevisto y no voy a poder atenderte el martes 1 de diciembre a las 10:00. ¿Lo pasamos a otro horario?';
  ok(await page.getAttribute('[data-afectado="t1"] a[data-act="wa-afectado"]', 'href') === 'https://wa.me/5491112345678?text=' + encodeURIComponent(texto),
    'cada afectado con teléfono tiene WhatsApp con el mensaje prellenado');
  ok(await page.locator('[data-afectado="t2"] a[data-act="wa-afectado"]').count() === 0 && await page.locator('[data-afectado="t2"] [data-act="cancelar-afectado"]').count() === 1,
    'el afectado sin teléfono no tiene WhatsApp pero sí "Cancelar este turno"');
  await page.click('[data-afectado="t1"] [data-act="cancelar-afectado"]');
  await page.waitForFunction(() => !document.querySelector('[data-afectado="t1"]'));
  ok(page.confirmaciones.length === 1 && page.llamadas.marcar_turno[0].p_turno === 't1' && page.llamadas.marcar_turno[0].p_estado === 'cancelado',
    '"Cancelar este turno" confirma y cancela ese turno');
  ok(await page.locator('[data-afectado="t2"]').count() === 1, 'los demás afectados siguen en la lista');
  await page.click('[data-act="volver"]');
  await page.waitForSelector('#agenda');
  await page.context().close();

  page = await logueado('panel.html', rpcBase({ crear_bloqueo: () => falla('RANGO_INVALIDO') }));
  await page.click('[data-act="bloquear"]');
  await page.fill('#desde', '2026-12-01T12:00');
  await page.fill('#hasta', '2026-12-01T10:00');
  await page.click('#btn-guardar-bloqueo');
  await page.waitForFunction(() => document.getElementById('vista').textContent.includes('el fin tiene que ser después del inicio'));
  ok(true, 'rango inválido: muestra el mensaje del servidor');
  await page.context().close();

  page = await logueado('panel.html', rpcBase({
    agenda_dia: () => { const a = copia(AGENDA); a.bloqueos = [{ id: 'bl1', inicio: '2026-12-01T14:00:00Z', fin: '2026-12-01T15:00:00Z', motivo: 'Médico' }]; return json(a); }
  }));
  ok((await page.textContent('[data-bloqueo="bl1"]')).includes('Médico') && (await page.textContent('[data-bloqueo="bl1"]')).includes('11:00'),
    'los bloqueos del día aparecen en la agenda con su motivo');
  ok(await page.locator('[data-hueco]').count() === 3, 'un bloqueo parte los huecos libres');
  await page.context().close();

  // ════ Clientes con faltas ════
  console.log('Clientes con faltas');
  let lista = [
    { id: 'c1', nombre: 'Juan Pérez', telefono: '5491112345678', faltas: 3, bloqueado: true },
    { id: 'c2', nombre: 'Ana', telefono: '5491122223333', faltas: 1, bloqueado: false }
  ];
  page = await logueado('panel.html', rpcBase({
    clientes_con_faltas: () => json(lista),
    desbloquear_cliente: (c) => { lista = lista.filter(x => x.id !== c.p_cliente); return json(null); }
  }));
  await page.click('[data-act="faltas"]');
  await page.waitForSelector('[data-cliente="c1"]');
  t = await vista(page);
  ok(page.llamadas.clientes_con_faltas[0].p_barberia === 'b1' && t.includes('3 faltas') && t.includes('1 falta') && t.includes('Bloqueado'), 'lista los clientes con sus faltas y quién está bloqueado');
  ok(await page.locator('[data-cliente="c2"] [data-act="desbloquear"]').count() === 0, 'solo los bloqueados tienen "Desbloquear"');
  await page.click('[data-cliente="c1"] [data-act="desbloquear"]');
  await page.waitForFunction(() => !document.querySelector('[data-cliente="c1"]'));
  ok(page.llamadas.desbloquear_cliente[0].p_cliente === 'c1', '"Desbloquear" llama a desbloquear_cliente');
  await page.click('[data-act="volver"]');
  await page.waitForSelector('#agenda');
  await page.context().close();

  // ════ Salir y sesión vencida ════
  console.log('Salir y permisos');
  page = await logueado('panel.html', rpcBase());
  await page.route('**/auth/v1/logout*', r => r.fulfill(r.request().method() === 'OPTIONS' ? { status: 204, headers: CORS } : { status: 204, headers: CORS }));
  await page.click('[data-act="salir"]');
  await page.waitForSelector('#btn-entrar');
  ok(true, '"Salir" vuelve a la pantalla de ingreso');
  await page.context().close();

  page = await logueado('panel.html', rpcBase({ marcar_turno: () => falla('NO_AUTORIZADO') }));
  await page.click('[data-turno="t1"]');
  await page.click('[data-act="marcar"][data-estado="atendido"]');
  await page.waitForFunction(() => document.getElementById('vista').textContent.includes('No tenés permiso'));
  ok(true, 'un error del servidor se muestra en castellano sin perder la agenda');
  await page.context().close();

  await browser.close();
  srv.close();
  console.log(V.fallas ? `\n${V.fallas} falla(s)` : '\nTodo bien');
  process.exit(V.fallas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
