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
  id: 'b1', slug: 'prueba', nombre: 'Lo de Tito', zona_horaria: 'America/Argentina/Buenos_Aires',
  codigo_area: '11', whatsapp: '5491155550000', direccion: 'Calle 1', plan: 'gratis',
  cancelacion_horas: 2, faltas_max: 2, dias_adelante: 21, anticipacion_min: 30, paso_min: 15,
  turnos_futuros_max: 2, reservas_por_hora_ip: 3
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
  // Estado de las tablas de esta página: lo que se lee y lo que se escribe (pedidos).
  page.tablas = { servicios: copia(SERVICIOS), horarios: [], barberia: copia(BARBERIA), pedidos: [], demora: 0 };
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
  await page.route('**/rest/v1/{barberias,servicios,miembros,horarios,barberos}*', async r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const req = r.request();
    const t = new URL(req.url()).pathname.split('/').pop();
    const metodo = req.method();
    const st = page.tablas;
    if (metodo === 'GET') {
      return r.fulfill(json(t === 'barberias' ? [st.barberia] : t === 'servicios' ? st.servicios.slice().sort((a, b) => a.orden - b.orden) : t === 'horarios' ? st.horarios
        : t === 'barberos' ? [{ id: 'br1' }] : [{ barberia_id: 'b1' }]));
    }
    // Escrituras: se anotan (y se pueden demorar) y se contesta como PostgREST con .select().single().
    const cuerpo = metodo === 'DELETE' ? null : req.postDataJSON();
    const q = new URL(req.url()).search;
    st.pedidos.push({ metodo, tabla: t, q, cuerpo });
    if (st.demora) await pausa(st.demora);
    if (metodo === 'DELETE') {
      const l = t === 'servicios' ? st.servicios : st.horarios;
      const i = l.findIndex(x => x.id === (q.match(/id=eq\.([^&]+)/) || [])[1]);
      if (i >= 0) l.splice(i, 1);
      return r.fulfill({ status: 204, headers: CORS });
    }
    const id = (q.match(/id=eq\.([^&]+)/) || [])[1] || 'nuevo' + st.pedidos.length;
    const lista = t === 'servicios' ? st.servicios : st.horarios;
    const previa = (t === 'barberias' ? st.barberia : lista.find(x => x.id === id)) || {};
    const fila = Object.assign({}, previa, cuerpo, { id });
    // La "base" recuerda lo escrito, así una recarga de la pantalla ve el cambio.
    if (t === 'barberias') st.barberia = fila;
    else if (metodo === 'POST') lista.push(fila);
    else if (metodo === 'PATCH') lista[lista.findIndex(x => x.id === id)] = fila;
    r.fulfill(json(fila));
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
  async function logueado(ruta, rpc, opciones, despues) {
    const page = await abrir(browser, BASE, ruta, rpc, async (p) => { await simular(p, opciones); if (despues) await despues(p); });
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

  const mensajeLogin = 'Tu sesión se cerró. Entrá de nuevo.';
  page = await logueado('panel.html', rpcBase({ marcar_turno: () => falla('NO_AUTORIZADO') }));
  await page.click('[data-turno="t1"]');
  await page.click('[data-act="marcar"][data-estado="atendido"]');
  await page.waitForSelector('#btn-entrar');
  ok((await vista(page)).includes(mensajeLogin), 'marcar_turno NO_AUTORIZADO: vuelve al ingreso con "Tu sesión se cerró"');
  await page.context().close();

  console.log('Sesión vencida');
  page = await abrir(browser, BASE, 'panel.html', rpcBase({ agenda_dia: () => falla('NO_AUTORIZADO') }), (p) => simular(p));
  await page.fill('#email', 'tito@ejemplo.com');
  await page.fill('#clave', 'secreta');
  await page.click('#btn-entrar');
  await page.waitForSelector('#btn-entrar:not([disabled])');
  await page.waitForFunction(() => document.getElementById('vista').textContent.includes('Tu sesión se cerró'));
  ok(true, 'agenda_dia NO_AUTORIZADO: pantalla de ingreso con el mensaje');
  await page.context().close();

  page = await abrir(browser, BASE, 'panel.html', rpcBase({ agenda_dia: () => json({ code: 'PGRST301', message: 'JWT expired', details: null, hint: null }, 401) }), (p) => simular(p));
  await page.fill('#email', 'tito@ejemplo.com');
  await page.fill('#clave', 'secreta');
  await page.click('#btn-entrar');
  await page.waitForFunction(() => document.getElementById('vista').textContent.includes('Tu sesión se cerró'));
  ok(await page.locator('#btn-entrar').count() === 1, 'agenda_dia 401 "JWT expired": también vuelve al ingreso (no queda en Reintentar)');
  await page.context().close();

  page = await abrir(browser, BASE, 'panel.html', rpcBase({ agenda_dia: () => json({ message: 'boom' }, 500) }), (p) => simular(p));
  await page.fill('#email', 'tito@ejemplo.com');
  await page.fill('#clave', 'secreta');
  await page.click('#btn-entrar');
  await page.waitForSelector('[data-act="reintentar"]');
  ok(await page.locator('[data-act="salir"]').count() === 1, 'la pantalla de error de carga tiene "Salir"');
  await page.context().close();

  // ════ Quitar bloqueo ════
  console.log('Quitar bloqueo');
  const borrados = [];
  page = await abrir(browser, BASE, 'panel.html', rpcBase({
    agenda_dia: () => { const a = copia(AGENDA); a.bloqueos = [{ id: 'bl1', inicio: '2026-12-01T14:00:00Z', fin: '2026-12-01T15:00:00Z', motivo: 'Médico' }]; return json(a); }
  }), async (p) => {
    await simular(p);
    await p.route('**/rest/v1/bloqueos*', r => {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
      borrados.push(r.request().method() + ' ' + new URL(r.request().url()).search);
      r.fulfill({ status: 204, headers: CORS });
    });
  });
  await page.fill('#email', 'tito@ejemplo.com');
  await page.fill('#clave', 'secreta');
  await page.click('#btn-entrar');
  await page.waitForSelector('[data-bloqueo="bl1"]');
  await page.click('[data-bloqueo="bl1"] [data-act="quitar-bloqueo"]');
  await page.waitForFunction(() => true);
  await pausa(300);
  ok(page.confirmaciones.length === 1 && borrados.length === 1 && borrados[0] === 'DELETE ?id=eq.bl1', '"Quitar bloqueo" confirma y borra el bloqueo con su id: ' + borrados.join(','));
  ok(page.llamadas.agenda_dia.length === 2, 'después de quitarlo se vuelve a pedir la agenda');
  await page.context().close();


  // ════ Configuración ════
  const pedidos = (p, tabla, metodo) => p.tablas.pedidos.filter(x => x.tabla === tabla && (!metodo || x.metodo === metodo));
  async function configuracion(opciones, despues) {
    const p = await logueado('panel.html', rpcBase(), opciones, despues);
    await p.click('[data-act="config"]');
    await p.waitForSelector('#menu-config');
    return p;
  }
  const mensaje = (p, texto) => p.waitForFunction((x) => document.getElementById('vista').textContent.includes(x), texto);

  console.log('Configuración: menú');
  page = await configuracion();
  t = await vista(page);
  ok(['Servicios', 'Horario semanal', 'Ajustes', 'Mi link', 'Notificaciones'].every(x => t.includes(x)), 'el menú ofrece Servicios, Horario semanal, Ajustes, Mi link y Notificaciones');
  ok(await page.locator('#notificaciones').count() === 1, 'hay un contenedor #notificaciones para el aviso de la tarea siguiente');
  const bajos = await page.$$eval('#vista button, #vista a.boton', (els) => els.filter(e => e.getBoundingClientRect().height < 47.5).map(e => e.textContent.trim()));
  ok(bajos.length === 0, 'todos los botones del menú miden 48 px o más: ' + bajos.join(','));
  await page.click('[data-act="cfg-agenda"]');
  await page.waitForSelector('#agenda');
  ok(true, '"Volver" regresa a la agenda');
  ok(page.errores.length === 0, 'sin errores de JavaScript: ' + page.errores.join(' | '));
  await page.context().close();

  console.log('Configuración: servicios');
  page = await configuracion();
  await page.click('[data-act="cfg-servicios"]');
  await page.waitForSelector('[data-servicio="s1"]');
  ok((await vista(page)).includes('Corte y barba') && (await vista(page)).includes('45 min'), 'lista los servicios con su duración');
  await page.click('[data-act="cfg-servicio-nuevo"]');
  await page.fill('#nombre', 'Perfilado');
  await page.fill('#duracion', '0');
  await page.click('#btn-guardar-servicio');
  await mensaje(page, 'de 5 en 5');
  ok(pedidos(page, 'servicios').length === 0 && await page.inputValue('#nombre') === 'Perfilado', 'servicio con 0 minutos: avisa, no guarda y conserva lo escrito');
  await page.fill('#duracion', '17');
  await page.click('#btn-guardar-servicio');
  await pausa(100);
  ok(pedidos(page, 'servicios').length === 0, 'servicio con 17 minutos (no múltiplo de 5): no guarda');
  await page.fill('#duracion', '245');
  await page.click('#btn-guardar-servicio');
  await pausa(100);
  ok(pedidos(page, 'servicios').length === 0, 'servicio de más de 240 minutos: no guarda');
  await page.fill('#duracion', '20');
  await page.fill('#precio', 'mucho');
  await page.click('#btn-guardar-servicio');
  await pausa(100);
  ok(pedidos(page, 'servicios').length === 0, 'precio que no es número: no guarda');
  await page.fill('#precio', '3500,50');
  await page.dblclick('#btn-guardar-servicio');
  await page.waitForSelector('[data-servicio="nuevo1"]');
  const crear = pedidos(page, 'servicios', 'POST');
  ok(crear.length === 1 && crear[0].cuerpo.nombre === 'Perfilado' && crear[0].cuerpo.duracion_min === 20 && crear[0].cuerpo.precio === 3500.5
    && crear[0].cuerpo.barberia_id === 'b1' && crear[0].cuerpo.activo === true && crear[0].cuerpo.orden === 2,
    'servicio válido: un solo POST (el doble toque no duplica) con barbería, duración, precio y orden al final: ' + JSON.stringify(crear.map(c => c.cuerpo)));
  // Editar: sin precio y oculto.
  await page.click('[data-servicio="s1"] [data-act="cfg-servicio-editar"]');
  await page.waitForSelector('#form-servicio');
  ok(await page.inputValue('#nombre') === 'Corte' && await page.inputValue('#duracion') === '30', 'editar abre el formulario con los datos del servicio');
  await page.fill('#precio', '');
  await page.uncheck('#activo');
  await page.click('#btn-guardar-servicio');
  await page.waitForSelector('[data-servicio="s1"]');
  const edit = pedidos(page, 'servicios', 'PATCH')[0];
  ok(edit.q.includes('id=eq.s1') && edit.cuerpo.precio === null && edit.cuerpo.activo === false && edit.cuerpo.duracion_min === 30,
    'editar hace PATCH del servicio: precio vacío = null y activo = false');
  ok((await page.textContent('[data-servicio="s1"]')).includes('Oculto'), 'un servicio inactivo se marca como oculto');
  // Orden con flechas.
  const antes = pedidos(page, 'servicios').length;
  await page.click('[data-servicio="s2"] [data-act="cfg-servicio-subir"]');
  await page.waitForFunction(() => document.querySelector('[data-servicio]').dataset.servicio === 's2');
  const mov = pedidos(page, 'servicios', 'PATCH').slice(antes - 1);
  ok(mov.some(x => x.q.includes('id=eq.s2') && x.cuerpo.orden === 0) && mov.some(x => x.q.includes('id=eq.s1') && x.cuerpo.orden === 1),
    'subir un servicio intercambia los órdenes con el de arriba');
  ok(await page.locator('[data-servicio]:first-of-type [data-act="cfg-servicio-subir"][disabled]').count() === 1, 'el primero no puede subir');
  ok(page.errores.length === 0, 'sin errores de JavaScript: ' + page.errores.join(' | '));
  await page.context().close();

  console.log('Configuración: servicio con texto raro');
  page = await configuracion();
  page.tablas.servicios[0].nombre = feo;
  await page.click('[data-act="cfg-servicios"]');
  await page.waitForSelector('[data-servicio="s1"]');
  await page.click('[data-servicio="s1"] [data-act="cfg-servicio-editar"]');
  await pausa(200);
  ok(await page.locator('#vista img').count() === 0 && page.alertas.length === 0 && await page.inputValue('#nombre') === feo, 'el nombre del servicio se escapa en la lista y en el formulario');
  await page.context().close();

  console.log('Configuración: horario semanal');
  page = await configuracion();
  page.tablas.horarios = [{ id: 'h1', barberia_id: 'b1', barbero_id: 'br1', dia_semana: 1, desde: '09:00:00', hasta: '13:00:00' }];
  await page.click('[data-act="cfg-horario"]');
  await page.waitForSelector('[data-franja]');
  ok(await page.locator('[data-franja]').count() === 1 && await page.inputValue('[data-franja] [data-campo="desde"]') === '09:00', 'muestra las franjas guardadas (09:00 sin segundos)');
  ok((await page.textContent('#vista')).indexOf('Lunes') < (await page.textContent('#vista')).indexOf('Domingo'), 'la semana empieza el lunes y termina el domingo');
  await page.click('[data-act="cfg-franja-agregar"][data-dia="2"]');
  await page.fill('[data-dia-card="2"] [data-campo="desde"]', '13:00');
  await page.fill('[data-dia-card="2"] [data-campo="hasta"]', '09:00');
  await page.click('#btn-guardar-horario');
  await mensaje(page, 'después');
  ok(pedidos(page, 'horarios').length === 0, 'franja 13:00–09:00: avisa y no guarda nada');
  ok(await page.inputValue('[data-dia-card="2"] [data-campo="desde"]') === '13:00', 'el aviso no borra lo que escribiste');
  await page.fill('[data-dia-card="2"] [data-campo="desde"]', '09:00');
  await page.fill('[data-dia-card="2"] [data-campo="hasta"]', '13:00');
  await page.click('[data-act="cfg-franja-agregar"][data-dia="2"]');
  await page.locator('[data-dia-card="2"] [data-campo="desde"]').nth(1).fill('12:00');
  await page.locator('[data-dia-card="2"] [data-campo="hasta"]').nth(1).fill('15:00');
  await page.click('#btn-guardar-horario');
  await mensaje(page, 'se pisan');
  ok(pedidos(page, 'horarios').length === 0, 'dos franjas que se pisan el mismo día: avisa y no guarda');
  await page.locator('[data-dia-card="2"] [data-campo="desde"]').nth(1).fill('');
  await page.click('#btn-guardar-horario');
  await mensaje(page, 'Completá');
  ok(pedidos(page, 'horarios').length === 0, 'franja con una hora vacía: avisa y no guarda');
  // Válido: 2 de 9 a 13 y de 16 a 20; el lunes se saca.
  await page.locator('[data-dia-card="2"] [data-campo="desde"]').nth(1).fill('16:00');
  await page.locator('[data-dia-card="2"] [data-campo="hasta"]').nth(1).fill('20:00');
  await page.click('[data-dia-card="1"] [data-act="cfg-franja-sacar"]');
  await page.dblclick('#btn-guardar-horario');
  await mensaje(page, 'Horario guardado');
  const hp = pedidos(page, 'horarios');
  const post = hp.filter(x => x.metodo === 'POST').map(x => x.cuerpo);
  ok(post.length === 2 && post.every(c => c.barberia_id === 'b1' && c.barbero_id === 'br1' && c.dia_semana === 2) && post[0].desde === '09:00' && post[1].hasta === '20:00',
    'guarda las franjas nuevas con barberia_id y barbero_id del barbero principal (una sola vez): ' + JSON.stringify(post));
  ok(hp.filter(x => x.metodo === 'DELETE').length === 1 && hp.find(x => x.metodo === 'DELETE').q.includes('id=eq.h1'), 'la franja que sacaste se borra');
  ok(await page.locator('[data-franja]').count() === 2, 'después de guardar se recarga con lo guardado');
  ok(page.errores.length === 0, 'sin errores de JavaScript: ' + page.errores.join(' | '));
  await page.context().close();

  console.log('Configuración: ajustes');
  page = await configuracion();
  await page.click('[data-act="cfg-ajustes"]');
  await page.waitForSelector('#form-ajustes');
  ok(await page.locator('#form-ajustes .ayuda').count() >= 8 && await page.inputValue('#paso_min') === '15' && await page.inputValue('#nombre') === 'Lo de Tito',
    'muestra los ajustes actuales, cada uno con su explicación');
  ok(await page.locator('#plan, [name="plan"]').count() === 0, 'el plan no se puede editar');
  await page.fill('#paso_min', '3');
  await page.click('#btn-guardar-ajustes');
  await mensaje(page, 'Paso de la grilla');
  ok(pedidos(page, 'barberias').length === 0, 'paso de 3 minutos (fuera de 5 a 60): avisa y no guarda');
  const malos = { dias_adelante: '0', faltas_max: '0', turnos_futuros_max: '0', reservas_por_hora_ip: '0', cancelacion_horas: '-1', anticipacion_min: '-5', codigo_area: '0', paso_min: '61' };
  await page.fill('#paso_min', '15');
  for (const [campo, valor] of Object.entries(malos)) {
    await page.fill('#' + campo, valor);
    await page.click('#btn-guardar-ajustes');
    await pausa(60);
    ok(pedidos(page, 'barberias').length === 0, `${campo} = ${valor} no guarda`);
    await page.fill('#' + campo, campo === 'codigo_area' ? '11' : '2');
  }
  await page.fill('#whatsapp', '12');
  await page.click('#btn-guardar-ajustes');
  await mensaje(page, 'Revisá el número de WhatsApp');
  await page.fill('#whatsapp', '011 15 5555-1234');
  await page.fill('#zona_horaria', 'Marte/Olimpo');
  await page.click('#btn-guardar-ajustes');
  await mensaje(page, 'zona horaria');
  ok(pedidos(page, 'barberias').length === 0, 'WhatsApp o zona horaria inválidos: no guardan');
  await page.fill('#zona_horaria', 'America/Argentina/Cordoba');
  await page.fill('#nombre', 'Tito Barber');
  await page.fill('#paso_min', '30');
  await page.fill('#direccion', '');
  await page.dblclick('#btn-guardar-ajustes');
  await mensaje(page, 'Ajustes guardados');
  const pb = pedidos(page, 'barberias');
  const cb = pb[0].cuerpo;
  ok(pb.length === 1 && pb[0].q.includes('id=eq.b1') && cb.nombre === 'Tito Barber' && cb.paso_min === 30 && cb.direccion === null
    && cb.whatsapp === '5491155551234' && cb.zona_horaria === 'America/Argentina/Cordoba' && cb.codigo_area === '11' && cb.dias_adelante === 2,
    'guarda una sola vez, con números y el WhatsApp normalizado: ' + JSON.stringify(cb));
  const permitidas = ['nombre', 'direccion', 'whatsapp', 'zona_horaria', 'codigo_area', 'cancelacion_horas', 'faltas_max', 'dias_adelante', 'anticipacion_min', 'paso_min', 'turnos_futuros_max', 'reservas_por_hora_ip'];
  ok(Object.keys(cb).every(k => permitidas.includes(k)) && Object.keys(cb).length === permitidas.length, 'solo manda columnas que la base deja editar (sin plan, slug ni id)');
  await page.context().close();

  console.log('Configuración: mi link y QR');
  const copiados = [];
  page = await configuracion(undefined, async (p) => {
    await p.addInitScript(() => { window.__copiado = []; window.__impreso = 0; window.print = () => { window.__impreso++; };
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: (x) => { window.__copiado.push(x); return Promise.resolve(); } }, configurable: true }); });
  });
  await page.click('[data-act="cfg-link"]');
  await page.waitForSelector('#hoja-qr');
  const enlace = `http://127.0.0.1:${srv.address().port}${PREFIJO}index.html?b=prueba`;
  ok((await page.textContent('#link-texto')).trim() === enlace, 'muestra el link absoluto de la barbería (index.html?b=prueba): ' + (await page.textContent('#link-texto')).trim());
  ok(await page.locator('#hoja-qr svg, #hoja-qr canvas, #hoja-qr img').count() === 1, 'dibuja el QR');
  ok(await page.locator('#hoja-qr svg path').count() === 1 && (await page.getAttribute('#hoja-qr svg path', 'd')).length > 500, 'el QR tiene módulos dibujados');
  await page.click('[data-act="cfg-copiar"]');
  await mensaje(page, 'Copiado');
  ok((await page.evaluate(() => window.__copiado))[0] === enlace, '"Copiar" pone el link en el portapapeles');
  await page.click('[data-act="cfg-imprimir"]');
  ok(await page.evaluate(() => window.__impreso) === 1, '"Imprimir" abre el diálogo de impresión');
  await page.emulateMedia({ media: 'print' });
  const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; }, sel);
  ok(await visible('#hoja-qr') && await visible('#hoja-qr svg') && !(await visible('#link-texto')) && !(await visible('[data-act="cfg-imprimir"]')) && !(await visible('h1')),
    'al imprimir queda solo la hoja con el QR (sin botones, título ni link)');
  const hoja = await page.textContent('#hoja-qr');
  ok(hoja.includes('Lo de Tito') && hoja.includes('Sacá tu turno acá'), 'la hoja dice el nombre de la barbería y "Sacá tu turno acá"');
  await page.emulateMedia({ media: 'screen' });
  ok(page.errores.length === 0, 'sin errores de JavaScript: ' + page.errores.join(' | '));
  await page.context().close();

  console.log('Configuración: sesión vencida y errores');
  page = await configuracion();
  await page.route('**/rest/v1/servicios*', r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: CORS })
    : r.fulfill(json({ code: 'PGRST301', message: 'JWT expired', details: null, hint: null }, 401)));
  await page.click('[data-act="cfg-servicios"]');
  await page.waitForSelector('#btn-entrar');
  ok((await vista(page)).includes('Tu sesión se cerró'), 'sesión vencida en una pantalla de configuración: vuelve al ingreso');
  await page.context().close();

  page = await configuracion();
  await page.route('**/rest/v1/horarios*', r => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: CORS }) : r.fulfill(json({ message: 'boom' }, 500)));
  await page.click('[data-act="cfg-horario"]');
  await page.waitForSelector('[data-act="reintentar-config"]');
  ok(await page.locator('[data-act="cfg-menu"]').count() === 1, 'un error al cargar muestra Reintentar y volver al menú');
  await page.context().close();

  await browser.close();
  srv.close();
  console.log(V.fallas ? `\n${V.fallas} falla(s)` : '\nTodo bien');
  process.exit(V.fallas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
