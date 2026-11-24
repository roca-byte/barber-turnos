/* Datos de ejemplo y Supabase FALSO para la guía y los videos (tools/demo.js y tools/video.js).
 *
 * Todo es INVENTADO: la "Barbería El Molino", sus clientes y teléfonos (11 5555-xxxx) no son de
 * nadie. No es parte de la app: la app habla con Supabase, así que acá se intercepta cada pedido
 * a *.supabase.co con page.route y se contesta desde un estado en memoria (`crearEstado`).
 * Nunca sale un pedido a la base real: la config se reemplaza por una falsa, hay una red de
 * contención que contesta 404 a cualquier otra ruta de supabase.co, y `salidas` anota (y las
 * herramientas verifican al terminar) cualquier pedido a un host que no sea el local o el falso.
 *
 * El estado es compartido por todo lo que se abra con él: lo que el cliente reserva lo ve el
 * barbero en la agenda (así se arma el GIF), y lo que el barbero cambia se ve del lado cliente.
 *
 * Día de ejemplo: lunes 23/11/2026, 11:50 en Buenos Aires.
 */
const { json, falla, CORS, FALSO } = require('../tests/e2e-util');
const Fechas = require('../js/fechas.js');

const ZONA = 'America/Argentina/Buenos_Aires';
const HOY = '2026-11-23';                                    // lunes
const AHORA = new Date(HOY + 'T11:50:00-03:00');
const SLUG = 'el-molino';
const EMAIL = 'molino@ejemplo.com';
const CLAVE = 'demo1234';

// Lo que se escribe a mano en las grabaciones.
const CLIENTE_NUEVO = { nombre: 'Franco Delgado', telefono: '11 5555-0188' };
const TURNO_MANUAL = { nombre: 'Santiago Vega', telefono: '11 5555-0133' };
const BLOQUEO = { desde: HOY + 'T17:00', hasta: HOY + 'T18:30', motivo: 'Se corta la luz' };

const en = (fecha, hhmm) => Fechas.instante(fecha, hhmm, ZONA);
const sumarMin = (iso, min) => new Date(Date.parse(iso) + min * 60000).toISOString();

// Estado inicial: la barbería, sus servicios y horarios, y un lunes con turnos de todo tipo.
function crearEstado() {
  const est = {
    barberia: {
      id: 'b1', slug: SLUG, nombre: 'Barbería El Molino', direccion: 'Av. del Molino 1234, Buenos Aires',
      whatsapp: '5491155550100', zona_horaria: ZONA, codigo_area: '11', plan: 'gratis', activa: true,
      cancelacion_horas: 2, faltas_max: 2, dias_adelante: 7, anticipacion_min: 30, paso_min: 30,
      turnos_futuros_max: 2, reservas_por_hora_ip: 3
    },
    servicios: [
      { id: 's1', barberia_id: 'b1', nombre: 'Corte', duracion_min: 30, precio: 8000, activo: true, orden: 0 },
      { id: 's2', barberia_id: 'b1', nombre: 'Corte y barba', duracion_min: 45, precio: 12000, activo: true, orden: 1 },
      { id: 's3', barberia_id: 'b1', nombre: 'Barba', duracion_min: 20, precio: 5000, activo: true, orden: 2 },
      { id: 's4', barberia_id: 'b1', nombre: 'Corte infantil', duracion_min: 30, precio: 6500, activo: true, orden: 3 },
      { id: 's5', barberia_id: 'b1', nombre: 'Color y decoloración', duracion_min: 90, precio: null, activo: false, orden: 4 }
    ],
    horarios: [],
    clientes: [
      { id: 'c1', nombre: 'Matías Ferreyra', telefono: '5491155550101', faltas: 0 },
      { id: 'c2', nombre: 'Lucas Benítez', telefono: '5491155550102', faltas: 0 },
      { id: 'c3', nombre: 'Nicolás Acosta', telefono: '5491155550103', faltas: 1 },
      { id: 'c4', nombre: 'Joaquín Molina', telefono: '5491155550104', faltas: 2 },
      { id: 'c5', nombre: 'Tomás Giménez', telefono: '5491155550105', faltas: 0 },
      { id: 'c6', nombre: 'Bruno Sosa', telefono: null, faltas: 0 },
      { id: 'c7', nombre: 'Federico Paz', telefono: '5491155550107', faltas: 1 }
    ],
    turnos: [],
    bloqueos: [],
    tokens: {},          // token -> id de turno
    suscripciones: [],
    salidas: [],         // pedidos a hosts no permitidos (tiene que quedar vacío)
    pedidos: 0
  };
  // Lunes a sábado, de 9 a 13 y de 16 a 20 (domingo cerrado).
  let n = 0;
  for (let dia = 1; dia <= 6; dia++) {
    [['09:00:00', '13:00:00'], ['16:00:00', '20:00:00']].forEach(([desde, hasta]) => {
      est.horarios.push({ id: 'h' + (++n), barberia_id: 'b1', barbero_id: 'br1', dia_semana: dia, desde, hasta });
    });
  }
  const t = (id, cli, serv, hora, estado, origen) => {
    const s = est.servicios.find((x) => x.id === serv);
    const inicio = en(HOY, hora);
    est.turnos.push({ id, cliente_id: cli, servicio_id: serv, inicio, fin: sumarMin(inicio, s.duracion_min), estado, origen: origen || 'online', token: null });
  };
  t('t1', 'c1', 's1', '09:00', 'atendido');
  t('t2', 'c2', 's2', '10:00', 'confirmado');
  t('t3', 'c3', 's1', '11:30', 'confirmado');
  t('t4', 'c4', 's3', '12:00', 'confirmado');
  t('t5', 'c5', 's1', '17:15', 'confirmado');
  t('t6', 'c6', 's1', '18:00', 'confirmado', 'manual');
  est.bloqueos.push({ id: 'bl1', inicio: en(HOY, '16:00'), fin: en(HOY, '17:00'), motivo: 'Trámite en el banco' });
  return est;
}

// ---------- Lógica de la "base" falsa ----------
const cliente = (est, id) => est.clientes.find((c) => c.id === id);
const servicio = (est, id) => est.servicios.find((s) => s.id === id);
const diaSemana = (fecha) => new Date(fecha + 'T00:00:00Z').getUTCDay();
const franjas = (est, fecha) => est.horarios.filter((h) => h.dia_semana === diaSemana(fecha))
  .map((h) => ({ desde: en(fecha, h.desde.slice(0, 5)), hasta: en(fecha, h.hasta.slice(0, 5)) }));
const ocupados = (est) => est.turnos.filter((t) => t.estado !== 'cancelado').concat(est.bloqueos)
  .map((o) => [Date.parse(o.inicio), Date.parse(o.fin)]);

// Horarios que se ofrecen: grilla desde el inicio de cada franja, sin pisar nada y con la
// anticipación mínima (igual que la función disponibilidad de la base).
function horariosLibres(est, servId, fecha) {
  const dur = servicio(est, servId).duracion_min * 60000;
  const paso = est.barberia.paso_min * 60000;
  const desdeMin = AHORA.getTime() + est.barberia.anticipacion_min * 60000;
  const oc = ocupados(est);
  const salida = [];
  franjas(est, fecha).forEach((f) => {
    for (let s = Date.parse(f.desde); s + dur <= Date.parse(f.hasta); s += paso) {
      if (s < desdeMin || oc.some(([a, b]) => s < b && s + dur > a)) continue;
      salida.push(new Date(s).toISOString());
    }
  });
  return salida;
}

function diasLibres(est, servId) {
  const dias = [];
  for (let i = 0; i <= est.barberia.dias_adelante; i++) {
    const f = Fechas.sumarDias(HOY, i);
    if (horariosLibres(est, servId, f).length) dias.push(f);
  }
  return dias;
}

function nuevoCliente(est, nombre, telefono) {
  let c = telefono && est.clientes.find((x) => x.telefono === telefono);
  if (!c) { c = { id: 'c' + (est.clientes.length + 1), nombre, telefono: telefono || null, faltas: 0 }; est.clientes.push(c); }
  return c;
}

function nuevoTurno(est, servId, inicio, nombre, telefono, origen) {
  const c = nuevoCliente(est, nombre, telefono);
  const id = 't' + (est.turnos.length + 1);
  est.turnos.push({ id, cliente_id: c.id, servicio_id: servId, inicio, fin: sumarMin(inicio, servicio(est, servId).duracion_min), estado: 'confirmado', origen, token: null });
  return est.turnos[est.turnos.length - 1];
}

const vistaTurno = (est, t) => {
  const c = cliente(est, t.cliente_id);
  return { id: t.id, inicio: t.inicio, fin: t.fin, estado: t.estado, origen: t.origen, servicio: servicio(est, t.servicio_id).nombre,
    nombre: c.nombre, telefono: c.telefono, faltas: c.faltas };
};

// Respuestas de cada RPC. Cada una recibe el cuerpo del pedido y devuelve una respuesta HTTP.
function rpcs(est) {
  const b = est.barberia;
  return {
    barberia_publica: () => json({
      id: b.id, slug: b.slug, nombre: b.nombre, direccion: b.direccion, whatsapp: b.whatsapp, zona_horaria: b.zona_horaria,
      codigo_area: b.codigo_area, servicios: est.servicios.filter((s) => s.activo).map(({ id, nombre, duracion_min, precio }) => ({ id, nombre, duracion_min, precio }))
    }),
    dias_disponibles: (p) => json(diasLibres(est, p.p_servicio)),
    disponibilidad: (p) => json(horariosLibres(est, p.p_servicio, p.p_fecha)),
    reservar: (p) => {
      if (!horariosLibres(est, p.p_servicio, Fechas.fecha(p.p_inicio, ZONA)).includes(p.p_inicio)) return falla('HORARIO_NO_DISPONIBLE');
      const t = nuevoTurno(est, p.p_servicio, p.p_inicio, p.p_nombre, p.p_telefono, 'online');
      t.token = require('crypto').createHash('sha256').update('demo-' + t.id + p.p_inicio).digest('hex');
      est.tokens[t.token] = t.id;
      return json(t.token);
    },
    ver_turno: (p) => {
      const t = est.turnos.find((x) => x.id === est.tokens[p.p_token]);
      if (!t) return json(null);
      const limite = Date.parse(t.inicio) - b.cancelacion_horas * 3600000;
      return json({
        estado: t.estado, cliente_nombre: cliente(est, t.cliente_id).nombre, inicio: t.inicio, servicio: servicio(est, t.servicio_id).nombre,
        puede_cancelar: t.estado === 'confirmado' && AHORA.getTime() < limite,
        barberia: { nombre: b.nombre, direccion: b.direccion, whatsapp: b.whatsapp, zona_horaria: b.zona_horaria }
      });
    },
    cancelar_turno: (p) => {
      const t = est.turnos.find((x) => x.id === est.tokens[p.p_token]);
      if (!t) return falla('TURNO_NO_EXISTE');
      t.estado = 'cancelado';
      return json(null);
    },
    agenda_dia: (p) => json({
      franjas: franjas(est, p.p_fecha),
      turnos: est.turnos.filter((t) => Fechas.fecha(t.inicio, ZONA) === p.p_fecha).sort((x, y) => Date.parse(x.inicio) - Date.parse(y.inicio)).map((t) => vistaTurno(est, t)),
      bloqueos: est.bloqueos.filter((x) => Fechas.fecha(x.inicio, ZONA) === p.p_fecha).map(({ id, inicio, fin, motivo }) => ({ id, inicio, fin, motivo }))
    }),
    marcar_turno: (p) => {
      const t = est.turnos.find((x) => x.id === p.p_turno);
      if (!t) return falla('TURNO_NO_EXISTE');
      const c = cliente(est, t.cliente_id);
      // Cada "no vino" suma una falta; deshacerlo la devuelve.
      if (p.p_estado === 'no_vino' && t.estado !== 'no_vino') c.faltas++;
      if (t.estado === 'no_vino' && p.p_estado !== 'no_vino') c.faltas = Math.max(0, c.faltas - 1);
      t.estado = p.p_estado;
      return json(null);
    },
    crear_turno_manual: (p) => json({ id: nuevoTurno(est, p.p_servicio, p.p_inicio, p.p_nombre, p.p_telefono, 'manual').id }),
    crear_bloqueo: (p) => {
      const id = 'bl' + (est.bloqueos.length + 1);
      est.bloqueos.push({ id, inicio: p.p_inicio, fin: p.p_fin, motivo: p.p_motivo });
      const a = Date.parse(p.p_inicio), z = Date.parse(p.p_fin);
      const afectados = est.turnos.filter((t) => t.estado === 'confirmado' && Date.parse(t.inicio) < z && Date.parse(t.fin) > a)
        .map((t) => ({ turno_id: t.id, nombre: cliente(est, t.cliente_id).nombre, telefono: cliente(est, t.cliente_id).telefono, inicio: t.inicio }));
      return json({ id, afectados });
    },
    clientes_con_faltas: () => json(est.clientes.filter((c) => c.faltas > 0)
      .sort((x, y) => y.faltas - x.faltas || x.nombre.localeCompare(y.nombre))
      .map((c) => ({ id: c.id, nombre: c.nombre, telefono: c.telefono, faltas: c.faltas, bloqueado: c.faltas >= b.faltas_max }))),
    desbloquear_cliente: (p) => { cliente(est, p.p_cliente).faltas = 0; return json(null); },
    // Clave pública VAPID inventada: el navegador de la grabación no la usa de verdad (ver pushFalso).
    vapid_publica: () => json('BPublicaInventadaSoloParaLaDemo')
  };
}

// Tablas que lee y escribe la app con supabase-js (servicios, horarios, ajustes, bloqueos, push).
function tabla(est, r) {
  const req = r.request();
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
  const t = new URL(req.url()).pathname.split('/').pop();
  const q = new URL(req.url()).search;
  const id = (q.match(/id=eq\.([^&]+)/) || [])[1];
  const metodo = req.method();
  const lista = { servicios: est.servicios, horarios: est.horarios, bloqueos: est.bloqueos, push_suscripciones: est.suscripciones }[t];
  if (metodo === 'GET') {
    if (t === 'barberias') return r.fulfill(json([est.barberia]));
    if (t === 'barberos') return r.fulfill(json([{ id: 'br1' }]));
    if (t === 'miembros') return r.fulfill(json([{ barberia_id: 'b1' }]));
    return r.fulfill(json(t === 'servicios' ? lista.slice().sort((a, b) => a.orden - b.orden) : lista));
  }
  if (metodo === 'DELETE') {
    const i = lista.findIndex((x) => x.id === id);
    if (i >= 0) lista.splice(i, 1);
    return r.fulfill({ status: 204, headers: CORS });
  }
  const cuerpo = req.postDataJSON();
  if (t === 'push_suscripciones') { est.suscripciones.push(cuerpo); return r.fulfill({ status: 201, headers: CORS }); }
  if (t === 'barberias') { Object.assign(est.barberia, cuerpo); return r.fulfill(json(est.barberia)); }
  if (metodo === 'POST') {
    const fila = Object.assign({ id: 'n' + (++est.pedidos) }, cuerpo);
    lista.push(fila);
    return r.fulfill(json(fila));
  }
  const fila = lista.find((x) => x.id === id);
  Object.assign(fila, cuerpo);
  return r.fulfill(json(fila));
}

// La app se ve en una dirección inventada (no en 127.0.0.1:<puerto>) para que el link del
// turno de las capturas se lea bien; los pedidos a ese host se contestan con el servidor local.
const PUBLICA = 'https://turnos.ejemplo.test/barber-turnos/';
const ANFITRIONES = ['127.0.0.1', 'falso.supabase.co', 'wa.me', 'turnos.ejemplo.test'];

// Conecta un contexto de Playwright con el estado: config falsa, RPC, tablas y auth.
async function instalar(ctx, est) {
  const respuestas = rpcs(est);
  // Red de contención: lo que no tenga ruta propia recibe 404 (nunca llega a internet).
  await ctx.route('**/*supabase.co/**', (r) => (r.request().method() === 'OPTIONS'
    ? r.fulfill({ status: 204, headers: CORS }) : r.fulfill(json({ message: 'no simulado' }, 404))));
  // El config.js real trae la URL de la base verdadera: se reemplaza por una falsa.
  await ctx.route('**/js/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `const Config = { url: '${FALSO}', clavePublica: 'clave-falsa' };` }));
  await ctx.route('**/rest/v1/rpc/*', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const nombre = new URL(r.request().url()).pathname.split('/').pop();
    const f = respuestas[nombre];
    r.fulfill(f ? f(r.request().postDataJSON() || {}) : falla('DESCONOCIDO'));
  });
  await ctx.route(/\/rest\/v1\/(barberias|servicios|miembros|horarios|barberos|bloqueos|push_suscripciones)(\?|$)/, (r) => tabla(est, r));
  await ctx.route('**/auth/v1/token*', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const c = r.request().postDataJSON();
    if (c.password !== CLAVE) return r.fulfill(json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400));
    r.fulfill(json({
      access_token: 'tok', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(AHORA.getTime() / 1000) + 3600, refresh_token: 'ref',
      user: { id: 'u1', email: c.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
    }));
  });
  await ctx.route('**/auth/v1/logout*', (r) => r.fulfill({ status: 204, headers: CORS }));
  // WhatsApp: se corta, la grabación no abre sitios de afuera.
  await ctx.route('https://wa.me/**', (r) => r.abort());
  ctx.on('request', (req) => {
    const u = new URL(req.url());
    if (u.protocol.startsWith('http') && !ANFITRIONES.includes(u.hostname)) est.salidas.push(req.url());
  });
}

// Se corre dentro de la página del panel ANTES de que cargue: simula un navegador que sí
// soporta notificaciones (sin service worker real, bloqueado en la grabación), así el botón
// "Activar notificaciones" se puede mostrar funcionando sin pedirle nada a un servidor push.
function pushFalso() {
  let sub = null, permiso = 'default';
  const falsa = {
    endpoint: 'https://push.ejemplo.invalid/s/demo', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p256dh-demo', auth: 'auth-demo' } }; },
    unsubscribe: async () => { sub = null; return true; }
  };
  const reg = { pushManager: { getSubscription: async () => sub, subscribe: async () => { sub = falsa; return sub; } } };
  Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(reg) });
  Object.defineProperty(Notification, 'permission', { get: () => permiso });
  Notification.requestPermission = async () => { permiso = 'granted'; return permiso; };
}

// Contexto de navegador listo para grabar: celular de 390x844 con pantalla doble, español de
// Argentina, hora de Buenos Aires, reloj congelado en AHORA, sin service workers (cachearían
// archivos de una grabación a otra) y con la base falsa conectada a `est`.
async function contexto(browser, est, opciones, local) {
  const ctx = await browser.newContext(Object.assign({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light',
    locale: 'es-AR', timezoneId: ZONA, serviceWorkers: 'block', acceptDownloads: true
  }, opciones || {}));
  await ctx.clock.setFixedTime(AHORA);
  await ctx.addInitScript(pushFalso);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  // Primero el servidor de archivos: las rutas que se agregan después (config falsa) tienen prioridad.
  if (local) {
    await ctx.route('https://turnos.ejemplo.test/**', async (r) => {
      const u = new URL(r.request().url());
      r.fulfill({ response: await r.fetch({ url: local + u.pathname.slice('/barber-turnos/'.length) + u.search }) });
    });
  }
  await instalar(ctx, est);
  return ctx;
}

module.exports = { PUBLICA, contexto, ZONA, HOY, AHORA, SLUG, EMAIL, CLAVE, CLIENTE_NUEVO, TURNO_MANUAL, BLOQUEO, crearEstado, instalar, pushFalso };
