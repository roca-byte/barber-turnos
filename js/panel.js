// panel.js — panel del barbero (panel.html). Una función por pantalla que reemplaza el
// contenido de #vista; el estado vive en `est`. Los clics se resuelven por delegación con
// data-act (como en reserva.js). Toda hora se muestra en la zona de la barbería (Fechas).
// Todo texto que viene de afuera (nombres, motivos) pasa por Html.esc antes de innerHTML.
// ?d=AAAA-MM-DD abre ese día: es el destino del link de la notificación.
const Panel = (() => {
  const vista = () => document.getElementById('vista');
  const esc = Html.esc;

  const est = { barberia: null, servicios: [], fecha: null, agenda: null, abierto: null, aviso: '', horaSugerida: null };

  const zona = () => est.barberia.zona_horaria;
  const soloDigitos = (t) => String(t || '').replace(/\D/g, '');
  const urlWa = (tel, texto) => 'https://wa.me/' + soloDigitos(tel) + (texto ? '?text=' + encodeURIComponent(texto) : '');
  const aviso = (msg) => (msg ? `<p class="error" role="alert">${esc(msg)}</p>` : '');
  const cargando = () => { vista().innerHTML = '<p class="sub">Cargando…</p>'; };
  const hora = (iso) => Fechas.hora(iso, zona());
  const faltasTexto = (n) => `${n} ${n === 1 ? 'falta' : 'faltas'}`;
  const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;

  // Manejador único de errores de Api. Si la sesión ya no vale (el servidor dice NO_AUTORIZADO,
  // o el token venció y no hay sesión) se vuelve al ingreso: reintentar no arregla nada.
  // Devuelve true si ya mostró el login; si no, el llamador muestra su propio error.
  async function sesionCaida(e) {
    let cayo = e && e.codigo === 'NO_AUTORIZADO';
    if (!cayo) { try { cayo = !(await Api.sesion()); } catch (x) { cayo = false; } }
    if (!cayo) return false;
    est.barberia = null;
    pantallaLogin('Tu sesión se cerró. Entrá de nuevo.');
    return true;
  }

  // ---------- Ingreso ----------
  function pantallaLogin(msg, email) {
    vista().innerHTML = `<h1>Panel del barbero</h1><p class="sub">Ingresá con tu cuenta.</p>${aviso(msg)}
      <form id="form-login" class="tarjeta" novalidate>
        <div class="campo"><label for="email">Email</label>
          <input id="email" type="email" autocomplete="username" inputmode="email" value="${esc(email || '')}" required></div>
        <div class="campo"><label for="clave">Contraseña</label>
          <input id="clave" type="password" autocomplete="current-password" required></div>
        <button class="boton" id="btn-entrar" type="submit">Entrar</button>
      </form>`;
  }

  let entrando = false;
  async function enviarLogin(e) {
    e.preventDefault();
    if (entrando) return;
    const email = document.getElementById('email').value.trim();
    const clave = document.getElementById('clave').value;
    if (!email || !clave) return pantallaLogin('Escribí tu email y tu contraseña.', email);
    entrando = true;
    const boton = document.getElementById('btn-entrar');
    boton.disabled = true;
    try {
      await Api.entrar(email, clave);
    } catch (err) {
      entrando = false;
      // supabase-js dice "Invalid login credentials" con 400; sin red es otro mensaje.
      return pantallaLogin(/invalid|credentials/i.test(err.message) ? 'Email o contraseña incorrectos' : 'No pudimos conectar. Revisá tu conexión y probá de nuevo.', email);
    }
    entrando = false;
    iniciar();
  }

  // ---------- Agenda ----------
  // Lista por hora que mezcla turnos, bloqueos y huecos libres. Un turno cancelado se
  // muestra pero no ocupa lugar: su horario cuenta como libre.
  function renglones(a) {
    const ocupan = a.turnos.filter((t) => t.estado !== 'cancelado').concat(a.bloqueos);
    const lista = [];
    a.turnos.forEach((t) => lista.push({ ini: Date.parse(t.inicio), tipo: 'turno', dato: t }));
    a.bloqueos.forEach((b) => lista.push({ ini: Date.parse(b.inicio), tipo: 'bloqueo', dato: b }));
    Agenda.huecos(a.franjas, ocupan).forEach((h) => lista.push({ ini: Date.parse(h.desde), tipo: 'hueco', dato: h }));
    return lista.sort((x, y) => x.ini - y.ini);
  }

  function htmlTurno(t) {
    const abierto = est.abierto === t.id;
    const faltas = t.faltas > 0 ? `<span class="faltas">⚠ ${esc(faltasTexto(t.faltas))}</span>` : '';
    const estado = t.estado === 'confirmado' ? '' : ` <span class="estado-${esc(t.estado)}">${esc(t.estado.replace('_', ' '))}</span>`;
    let acciones = '';
    if (abierto) {
      const contacto = t.telefono
        ? `<a class="boton secundario" data-act="llamar" href="tel:+${esc(soloDigitos(t.telefono))}">Llamar</a>
           <a class="boton secundario" data-act="wa-cliente" href="${esc(urlWa(t.telefono))}" target="_blank" rel="noopener">WhatsApp</a>`
        : '';
      const botones = t.estado === 'confirmado'
        ? `<button class="boton" type="button" data-act="marcar" data-estado="atendido" data-id="${esc(t.id)}">Atendido</button>
           <button class="boton secundario" type="button" data-act="marcar" data-estado="no_vino" data-id="${esc(t.id)}">No vino</button>
           <button class="boton peligro" type="button" data-act="marcar" data-estado="cancelado" data-id="${esc(t.id)}">Cancelar</button>`
        : `<button class="boton secundario" type="button" data-act="deshacer" data-id="${esc(t.id)}">Deshacer</button>`;
      acciones = `<div class="acciones">${contacto}${botones}</div>`;
    }
    return `<div class="tarjeta turno${abierto ? ' abierto' : ''}">
      <button class="opcion" type="button" data-act="abrir" data-turno="${esc(t.id)}" aria-expanded="${abierto}">
        <span><strong>${esc(hora(t.inicio))}</strong> ${esc(t.nombre)}${estado}<br>
          <small>${esc(t.servicio)} · ${esc(hora(t.inicio))}–${esc(hora(t.fin))}${t.origen === 'manual' ? ' · cargado por vos' : ''}</small></span>
        ${faltas}</button>${acciones}</div>`;
  }

  function htmlRenglon(r) {
    if (r.tipo === 'turno') return htmlTurno(r.dato);
    if (r.tipo === 'bloqueo') {
      const b = r.dato;
      return `<div class="tarjeta bloqueo" data-bloqueo="${esc(b.id)}">
        <span><strong>${esc(hora(b.inicio))}–${esc(hora(b.fin))}</strong> Bloqueado${b.motivo ? ': ' + esc(b.motivo) : ''}</span>
        <button class="boton secundario" type="button" data-act="quitar-bloqueo" data-id="${esc(b.id)}">Quitar bloqueo</button></div>`;
    }
    const h = r.dato;
    return `<button class="opcion hueco" type="button" data-act="turno-en" data-hueco="${esc(h.desde)}" data-desde="${esc(h.desde)}">
      <span>Libre ${esc(hora(h.desde))}–${esc(hora(h.hasta))}</span><small>+ Turno</small></button>`;
  }

  function pantallaAgenda() {
    const a = est.agenda;
    const items = renglones(a).map(htmlRenglon).join('');
    vista().innerHTML = `<header class="barra">
        <h1>${esc(est.barberia.nombre)}</h1>
        <button class="boton secundario chico" type="button" data-act="salir">Salir</button>
      </header>
      ${aviso(est.aviso)}
      <nav class="dias" aria-label="Día">
        <button class="boton secundario" type="button" data-act="dia-ant" aria-label="Día anterior">‹</button>
        <button class="boton secundario" type="button" data-act="hoy">Hoy</button>
        <button class="boton secundario" type="button" data-act="dia-sig" aria-label="Día siguiente">›</button>
      </nav>
      <h2 class="dia-titulo">${esc(Fechas.diaLargo(est.fecha))}</h2>
      <div class="herramientas">
        <button class="boton" type="button" data-act="nuevo-turno">+ Turno</button>
        <button class="boton secundario" type="button" data-act="bloquear">Bloquear</button>
        <button class="boton secundario" type="button" data-act="faltas">Clientes con faltas</button>
        <button class="boton secundario" type="button" data-act="config">Configuración</button>
      </div>
      <div id="agenda">${items || '<p class="sub">No hay nada cargado para este día.</p>'}</div>`;
    est.aviso = '';
  }

  // Pide la agenda del día y la dibuja. Si el servidor dice NO_AUTORIZADO, la sesión ya no vale.
  async function cargarAgenda(msg) {
    est.aviso = msg || '';
    cargando();
    try {
      est.agenda = await Api.agendaDia(est.barberia.id, est.fecha);
    } catch (e) {
      if (await sesionCaida(e)) return;
      return pantallaErrorCarga(Html.mensajeError(e.codigo));
    }
    pantallaAgenda();
  }

  function pantallaErrorCarga(msg) {
    vista().innerHTML = `${aviso(msg)}<button class="boton" type="button" data-act="reintentar">Reintentar</button>
      <button class="boton secundario" type="button" data-act="salir">Salir</button>`;
  }

  // ---------- Acciones sobre turnos ----------
  async function marcar(id, estado) {
    try { await Api.marcarTurno(id, estado); } catch (e) { if (await sesionCaida(e)) return; return cargarAgenda(Html.mensajeError(e.codigo)); }
    cargarAgenda();
  }

  function marcarDesdeBoton(el) {
    const estado = el.dataset.estado;
    // Cancelar no se puede deshacer del todo (el horario puede ocuparse): se confirma.
    if (estado === 'cancelado' && !confirm('¿Cancelar este turno?')) return;
    marcar(el.dataset.id, estado);
  }

  async function quitarBloqueo(id) {
    if (!confirm('¿Quitar este bloqueo? Esas horas vuelven a quedar libres para reservar.')) return;
    try { await Api.borrarBloqueo(id); } catch (e) { if (await sesionCaida(e)) return; return cargarAgenda(Html.mensajeError(e.codigo)); }
    cargarAgenda();
  }

  // ---------- + Turno ----------
  function pantallaTurnoNuevo(msg, datos) {
    const d = datos || {};
    const opciones = est.servicios.map((s) => `<option value="${esc(s.id)}"${s.id === d.servicio ? ' selected' : ''}>${esc(s.nombre)} (${esc(s.duracion_min)} min)</option>`).join('');
    vista().innerHTML = `<h1>+ Turno</h1><p class="sub">${esc(Fechas.diaLargo(est.fecha))}</p>
      <form id="form-turno" class="tarjeta" novalidate>
        ${aviso(msg)}
        <div class="campo"><label for="servicio">Servicio</label><select id="servicio">${opciones}</select></div>
        <div class="campo"><label for="hora">Hora</label>
          <input id="hora" type="time" value="${esc(d.hora || '')}" required></div>
        <div class="campo"><label for="nombre">Nombre</label>
          <input id="nombre" type="text" maxlength="60" autocomplete="off" value="${esc(d.nombre || '')}" required></div>
        <div class="campo"><label for="telefono">WhatsApp (opcional)</label>
          <input id="telefono" type="tel" inputmode="tel" autocomplete="off" value="${esc(d.telefono || '')}">
          <p class="ayuda">Sin número no se pueden mandar avisos a este cliente.</p></div>
        <button class="boton" id="btn-guardar-turno" type="submit">Guardar turno</button>
        <button class="boton secundario" type="button" data-act="volver">Volver</button>
      </form>`;
  }

  let guardando = false; // un doble toque no tiene que crear dos turnos
  async function guardarTurno(e) {
    e.preventDefault();
    if (guardando) return;
    const datos = {
      servicio: document.getElementById('servicio').value, hora: document.getElementById('hora').value,
      nombre: document.getElementById('nombre').value.trim(), telefono: document.getElementById('telefono').value.trim()
    };
    if (!datos.hora) return pantallaTurnoNuevo('Elegí la hora del turno.', datos);
    if (datos.nombre.length < 2) return pantallaTurnoNuevo(Html.mensajeError('NOMBRE_INVALIDO'), datos);
    let tel = null;
    if (datos.telefono) {
      tel = Telefono.normalizar(datos.telefono, est.barberia.codigo_area);
      if (!tel) return pantallaTurnoNuevo(Html.mensajeError('TELEFONO_INVALIDO'), datos);
    }
    guardando = true;
    document.getElementById('btn-guardar-turno').disabled = true;
    try {
      await Api.turnoManual(est.barberia.id, datos.servicio, Fechas.instante(est.fecha, datos.hora, zona()), datos.nombre, tel);
    } catch (err) {
      guardando = false;
      if (await sesionCaida(err)) return;
      return pantallaTurnoNuevo(Html.mensajeError(err.codigo), datos);
    }
    guardando = false;
    cargarAgenda();
  }

  // ---------- Bloquear ----------
  function pantallaBloqueo(msg, datos) {
    const d = datos || { desde: est.fecha + 'T12:00', hasta: est.fecha + 'T13:00', motivo: '' };
    vista().innerHTML = `<h1>Bloquear horario</h1>
      <p class="sub">Los clientes no van a poder reservar en ese rango. Los turnos que ya haya no se cancelan solos.</p>
      <form id="form-bloqueo" class="tarjeta" novalidate>
        ${aviso(msg)}
        <div class="campo"><label for="desde">Desde</label><input id="desde" type="datetime-local" value="${esc(d.desde)}" required></div>
        <div class="campo"><label for="hasta">Hasta</label><input id="hasta" type="datetime-local" value="${esc(d.hasta)}" required></div>
        <div class="campo"><label for="motivo">Motivo (opcional)</label>
          <input id="motivo" type="text" maxlength="80" autocomplete="off" value="${esc(d.motivo)}"></div>
        <button class="boton" id="btn-guardar-bloqueo" type="submit">Bloquear</button>
        <button class="boton secundario" type="button" data-act="volver">Volver</button>
      </form>`;
  }

  // "2026-12-01T10:00" (hora de pared de la barbería) -> instante.
  const instanteDeCampo = (v) => { const [f, h] = v.split('T'); return Fechas.instante(f, h, zona()); };

  let bloqueando = false;
  async function guardarBloqueo(e) {
    e.preventDefault();
    if (bloqueando) return;
    const datos = { desde: document.getElementById('desde').value, hasta: document.getElementById('hasta').value, motivo: document.getElementById('motivo').value.trim() };
    if (!datos.desde || !datos.hasta) return pantallaBloqueo('Completá desde cuándo y hasta cuándo.', datos);
    bloqueando = true;
    document.getElementById('btn-guardar-bloqueo').disabled = true;
    let r;
    try {
      r = await Api.bloquear(est.barberia.id, instanteDeCampo(datos.desde), instanteDeCampo(datos.hasta), datos.motivo);
    } catch (err) {
      bloqueando = false;
      if (await sesionCaida(err)) return;
      return pantallaBloqueo(Html.mensajeError(err.codigo), datos);
    }
    bloqueando = false;
    est.afectados = (r && r.afectados) || [];
    if (!est.afectados.length) return cargarAgenda();
    pantallaAfectados();
  }

  // Turnos confirmados que quedaron dentro del bloqueo: el barbero decide a quién avisar.
  function pantallaAfectados(msg) {
    const items = est.afectados.map((a) => {
      const dia = Fechas.diaLargo(Fechas.fecha(a.inicio, zona()));
      const texto = `Hola ${a.nombre}, tuve un imprevisto y no voy a poder atenderte el ${dia} a las ${hora(a.inicio)}. ¿Lo pasamos a otro horario?`;
      const wa = a.telefono
        ? `<a class="boton" data-act="wa-afectado" href="${esc(urlWa(a.telefono, texto))}" target="_blank" rel="noopener">Avisar por WhatsApp</a>`
        : '<p class="sub">Sin WhatsApp: avisale en persona o por otro medio.</p>';
      return `<div class="tarjeta" data-afectado="${esc(a.turno_id)}">
        <p><strong>${esc(a.nombre)}</strong><br><small>${esc(dia)} · ${esc(hora(a.inicio))}</small></p>
        ${wa}
        <button class="boton peligro" type="button" data-act="cancelar-afectado" data-id="${esc(a.turno_id)}">Cancelar este turno</button>
      </div>`;
    }).join('');
    vista().innerHTML = `<h1>Bloqueo guardado</h1>${aviso(msg)}
      <p class="sub">Estos turnos caen dentro del bloqueo. Avisales y cancelalos si hace falta.</p>
      ${items || '<p class="exito">No queda ningún turno por resolver.</p>'}
      <button class="boton secundario" type="button" data-act="volver">Volver a la agenda</button>`;
  }

  async function cancelarAfectado(id) {
    if (!confirm('¿Cancelar este turno?')) return;
    try { await Api.marcarTurno(id, 'cancelado'); } catch (e) { if (await sesionCaida(e)) return; return pantallaAfectados(Html.mensajeError(e.codigo)); }
    est.afectados = est.afectados.filter((a) => a.turno_id !== id);
    pantallaAfectados();
  }

  // ---------- Clientes con faltas ----------
  async function pantallaFaltas(msg) {
    cargando();
    let lista;
    try { lista = await Api.clientesConFaltas(est.barberia.id); } catch (e) { if (await sesionCaida(e)) return; return pantallaErrorCarga(Html.mensajeError(e.codigo)); }
    const items = (lista || []).map((c) => `<div class="tarjeta" data-cliente="${esc(c.id)}">
        <p><strong>${esc(c.nombre)}</strong>${c.bloqueado ? ' <span class="estado-no_vino">Bloqueado</span>' : ''}<br>
          <small>${esc(faltasTexto(c.faltas))}</small></p>
        ${c.bloqueado ? `<button class="boton secundario" type="button" data-act="desbloquear" data-id="${esc(c.id)}">Desbloquear</button>` : ''}
      </div>`).join('');
    vista().innerHTML = `<h1>Clientes con faltas</h1>${aviso(msg)}
      ${items || '<p class="sub">Nadie tiene faltas.</p>'}
      <button class="boton secundario" type="button" data-act="volver">Volver a la agenda</button>`;
  }

  async function desbloquear(id) {
    try { await Api.desbloquear(id); } catch (e) { if (await sesionCaida(e)) return; return pantallaFaltas(Html.mensajeError(e.codigo)); }
    pantallaFaltas();
  }

  async function salir() {
    try { await Api.salir(); } catch (e) { /* sin red igual se vuelve al ingreso */ }
    est.barberia = null;
    pantallaLogin();
  }

  const irA = (fecha) => { est.fecha = fecha; est.abierto = null; cargarAgenda(); };

  const ACCIONES = {
    'dia-ant': () => irA(Fechas.sumarDias(est.fecha, -1)),
    'dia-sig': () => irA(Fechas.sumarDias(est.fecha, 1)),
    hoy: () => irA(Fechas.hoy(zona())),
    abrir: (el) => { est.abierto = est.abierto === el.dataset.turno ? null : el.dataset.turno; pantallaAgenda(); },
    marcar: marcarDesdeBoton,
    deshacer: (el) => marcar(el.dataset.id, 'confirmado'),
    'nuevo-turno': () => pantallaTurnoNuevo(),
    'turno-en': (el) => pantallaTurnoNuevo('', { hora: Fechas.hora(el.dataset.desde, zona()) }),
    bloquear: () => pantallaBloqueo(),
    'quitar-bloqueo': (el) => quitarBloqueo(el.dataset.id),
    'cancelar-afectado': (el) => cancelarAfectado(el.dataset.id),
    faltas: () => pantallaFaltas(),
    config: () => ConfigPanel.abrir(),
    desbloquear: (el) => desbloquear(el.dataset.id),
    volver: () => cargarAgenda(),
    salir,
    reintentar: () => (est.barberia ? cargarAgenda() : iniciar())
  };

  // ---------- Arranque ----------
  async function iniciar() {
    cargando();
    let sesion;
    try { sesion = await Api.sesion(); } catch (e) { if (await sesionCaida(e)) return; return pantallaErrorCarga(Html.mensajeError(e.codigo)); }
    if (!sesion) return pantallaLogin();
    try { est.barberia = await Api.miBarberia(); } catch (e) { if (await sesionCaida(e)) return; return pantallaErrorCarga(Html.mensajeError(e.codigo)); }
    if (!est.barberia) {
      vista().innerHTML = `<h1>Sin barbería</h1><p class="sub">Tu usuario todavía no tiene una barbería asignada.</p>
        <button class="boton secundario" type="button" data-act="salir">Salir</button>`;
      return;
    }
    try { est.servicios = (await Api.servicios.listar(est.barberia.id)).filter((s) => s.activo); } catch (e) { if (await sesionCaida(e)) return; return pantallaErrorCarga(Html.mensajeError(e.codigo)); }
    const d = new URLSearchParams(location.search).get('d');
    est.fecha = d && FECHA_OK.test(d) ? d : Fechas.hoy(zona());
    cargarAgenda();
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && ACCIONES[el.dataset.act]) ACCIONES[el.dataset.act](el);
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'form-login') enviarLogin(e);
    else if (e.target.id === 'form-turno') guardarTurno(e);
    else if (e.target.id === 'form-bloqueo') guardarBloqueo(e);
  });

  iniciar();
  // Lo que necesita config-panel.js (otro script): el estado, el manejo de sesión vencida y
  // cómo volver a la agenda. Se comparte en vez de duplicar sesionCaida.
  return { iniciar, ctx: { est, sesionCaida, aviso, cargando, volver: () => cargarAgenda() } };
})();
