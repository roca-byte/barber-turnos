// reserva.js — página pública del cliente (index.html). Una función por pantalla, que
// reemplaza el contenido de #vista; el estado de la reserva en curso vive en `est`.
// Hay dos entradas: ?b=<slug> (reservar) y ?t=<token> (ver / cancelar un turno).
// Toda hora se muestra en la zona de la barbería (Fechas), no la del dispositivo.
// Todo texto que viene de afuera pasa por Html.esc antes de innerHTML.
const Reserva = (() => {
  const vista = () => document.getElementById('vista');
  const esc = Html.esc;

  const est = { slug: null, barberia: null, servicio: null, dias: [], fecha: null, horarios: [], inicio: null, token: null };

  const soloDigitos = (t) => String(t || '').replace(/\D/g, '');
  const urlWa = (tel, texto) => 'https://wa.me/' + soloDigitos(tel) + (texto ? '?text=' + encodeURIComponent(texto) : '');
  const plata = (n) => '$ ' + Number(n).toLocaleString('es-AR');
  // El precio es opcional: sin precio no se muestra nada (un "$ 0" parecería gratis).
  const tienePrecio = (s) => s.precio !== null && s.precio !== undefined;
  // Sin WhatsApp cargado no hay a quién escribirle: wa.me/ vacío daría un link roto.
  const botonWa = (tel, texto) => (soloDigitos(tel)
    ? `<a class="boton secundario" href="${esc(urlWa(tel))}" target="_blank" rel="noopener">${esc(texto)}</a>` : '');
  const aviso = (msg) => (msg ? `<p class="error" role="alert">${esc(msg)}</p>` : '');
  const cargando = () => { vista().innerHTML = '<p class="sub">Cargando…</p>'; };

  // Link absoluto al turno. Se arma desde location para que ande bajo /barber-turnos/ en
  // GitHub Pages y también si la página se abrió como .../ (sin index.html).
  function linkTurno(token) {
    const base = location.origin + location.pathname.replace(/[^/]*$/, 'index.html');
    return base + '?t=' + token;
  }

  function cabecera(b) {
    return `<header class="tarjeta">
      <h1>${esc(b.nombre)}</h1>
      <p class="sub">${esc(b.direccion)}</p>
      ${botonWa(b.whatsapp, 'Escribir por WhatsApp')}
    </header>`;
  }

  function atras(act, texto) {
    return `<button class="boton secundario" type="button" data-act="${act}">${esc(texto || 'Volver')}</button>`;
  }

  // ---------- Pantallas ----------
  function pantallaNoEncontrada(que) {
    vista().innerHTML = `<h1>No encontramos ${que === 'turno' ? 'este turno' : 'esta barbería'}</h1>
      <p class="sub">Revisá que el link esté completo o pedile uno nuevo a la barbería.</p>`;
  }

  function pantallaError(msg) {
    vista().innerHTML = `${aviso(msg)}<button class="boton" type="button" data-act="reintentar">Reintentar</button>`;
  }

  // Barbería + servicios: es la primera pantalla de la reserva.
  function pantallaServicios() {
    const b = est.barberia;
    const items = b.servicios.map((s, i) => `<button class="opcion" type="button" data-act="servicio" data-i="${i}" data-servicio="${esc(s.id)}">
        <span>${esc(s.nombre)}<br><small>${esc(s.duracion_min)} min</small></span>${tienePrecio(s) ? `<strong>${esc(plata(s.precio))}</strong>` : ''}</button>`).join('');
    vista().innerHTML = `${cabecera(b)}<h2>¿Qué te querés hacer?</h2>
      ${items || '<p class="sub">Todavía no hay servicios cargados.</p>'}`;
  }

  async function pantallaDias(msg) {
    cargando();
    try { est.dias = await Api.dias(est.slug, est.servicio.id); } catch (e) { return pantallaError(Html.mensajeError(e.codigo)); }
    const botones = est.dias.map((d) => `<button class="opcion" type="button" data-act="dia" data-dia="${esc(d)}">${esc(Fechas.diaLargo(d))}</button>`).join('');
    vista().innerHTML = `${cabecera(est.barberia)}${aviso(msg)}<h2>${esc(est.servicio.nombre)}: ¿qué día?</h2>
      ${botones || '<p class="sub">No hay días con lugar por ahora. Escribile a la barbería por WhatsApp.</p>'}
      ${atras('a-servicios')}`;
  }

  async function pantallaHorarios(msg) {
    cargando();
    try { est.horarios = await Api.horarios(est.slug, est.servicio.id, est.fecha); } catch (e) { return pantallaError(Html.mensajeError(e.codigo)); }
    const zona = est.barberia.zona_horaria;
    const botones = est.horarios.map((h) => `<button class="chip" type="button" data-act="hora" data-hora="${esc(h)}">${esc(Fechas.hora(h, zona))}</button>`).join('');
    vista().innerHTML = `${cabecera(est.barberia)}${aviso(msg)}<h2>${esc(Fechas.diaLargo(est.fecha))}: ¿a qué hora?</h2>
      ${botones ? `<div class="grilla">${botones}</div>` : '<p class="sub">Ese día ya no queda lugar. Elegí otro.</p>'}
      ${atras('a-dias')}`;
  }

  function pantallaDatos(msg) {
    const zona = est.barberia.zona_horaria;
    vista().innerHTML = `${cabecera(est.barberia)}${aviso(msg)}
      <h2>${esc(est.servicio.nombre)}, ${esc(Fechas.diaLargo(est.fecha))} a las ${esc(Fechas.hora(est.inicio, zona))}</h2>
      <form id="form-datos" novalidate>
        <div class="campo"><label for="nombre">Tu nombre</label>
          <input id="nombre" name="nombre" autocomplete="name" maxlength="60" required></div>
        <div class="campo"><label for="telefono">Tu WhatsApp</label>
          <input id="telefono" name="telefono" type="tel" inputmode="tel" autocomplete="tel" placeholder="11 1234-5678" required>
          <div class="ayuda" id="vista-telefono"></div></div>
        <button class="boton" type="submit" id="btn-reservar">Reservar</button>
      </form>
      ${atras('a-horarios')}`;
  }

  function pantallaConfirmacion() {
    const zona = est.barberia.zona_horaria;
    const link = linkTurno(est.token);
    vista().innerHTML = `${cabecera(est.barberia)}
      <p class="exito">¡Listo, ${esc(est.nombre)}! Tu turno quedó reservado.</p>
      <div class="tarjeta">
        <p><strong>${esc(Fechas.diaLargo(est.fecha))}</strong> a las <strong>${esc(Fechas.hora(est.inicio, zona))}</strong></p>
        <p>${esc(est.servicio.nombre)} · ${esc(est.servicio.duracion_min)} min</p>
        <p class="sub">Guardá este link: con él podés ver o cancelar tu turno.</p>
        <p class="enlace"><a href="${esc(link)}">${esc(link)}</a></p>
      </div>
      <button class="boton" type="button" id="btn-calendario" data-act="calendario">Agregar a mi calendario</button>
      <a class="boton secundario" id="btn-whatsapp" href="${esc(urlWa(est.telefono, link))}" target="_blank" rel="noopener">Mandarme el link por WhatsApp</a>`;
  }

  // ?t=<token>: ver el turno y, si todavía se puede, cancelarlo.
  async function pantallaTurno(msg) {
    cargando();
    let t;
    try { t = await Api.verTurno(est.token); } catch (e) { return pantallaError(Html.mensajeError(e.codigo)); }
    if (!t) return pantallaNoEncontrada('turno');
    const zona = t.barberia.zona_horaria;
    const dia = Fechas.diaLargo(diaDe(t.inicio, zona));
    const ESTADOS = { confirmado: 'Confirmado', cancelado: 'Cancelado', atendido: 'Atendido', no_vino: 'No viniste' };
    let accion = '';
    if (t.puede_cancelar) {
      accion = '<button class="boton peligro" type="button" id="btn-cancelar" data-act="cancelar">Cancelar turno</button>';
    } else if (t.estado === 'confirmado') {
      accion = `<p class="sub">Ya no podés cancelar online. Si necesitás cambiarlo, escribile a la barbería.</p>
        ${botonWa(t.barberia.whatsapp, 'Escribir por WhatsApp')}`;
    }
    vista().innerHTML = `${cabecera(t.barberia)}${aviso(msg)}
      <div class="tarjeta">
        <p class="estado-${esc(t.estado)}"><strong>${esc(ESTADOS[t.estado] || t.estado)}</strong></p>
        <p>${esc(t.cliente_nombre)}</p>
        <p><strong>${esc(dia)}</strong> a las <strong>${esc(Fechas.hora(t.inicio, zona))}</strong></p>
        <p>${esc(t.servicio)}</p>
      </div>${accion}`;
  }

  function pantallaConfirmarCancelacion() {
    vista().insertAdjacentHTML('beforeend', `<div class="tarjeta" id="caja-cancelar">
      <p><strong>¿Seguro que querés cancelar el turno?</strong></p>
      <button class="boton peligro" type="button" id="btn-cancelar-si" data-act="cancelar-si">Sí, cancelar</button>
      <button class="boton secundario" type="button" data-act="cancelar-no">No, lo dejo</button></div>`);
    const b = document.getElementById('btn-cancelar');
    if (b) b.classList.add('oculto');
  }

  // Fecha de calendario (AAAA-MM-DD) del instante, en la zona de la barbería.
  function diaDe(iso, zona) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  }

  // ---------- Acciones ----------
  function descargarIcs() {
    const fin = new Date(Date.parse(est.inicio) + est.servicio.duracion_min * 60000).toISOString();
    const texto = Fechas.ics({
      inicio: est.inicio, fin, titulo: `${est.servicio.nombre} en ${est.barberia.nombre}`, lugar: est.barberia.direccion
    });
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'turno.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function actualizarTelefonoEnVivo() {
    const n = Telefono.normalizar(document.getElementById('telefono').value, est.barberia.codigo_area);
    document.getElementById('vista-telefono').textContent = n ? 'Te vamos a identificar con ' + Telefono.mostrar(n) : '';
  }

  let reservando = false; // un doble toque no tiene que crear dos turnos
  async function enviarReserva(e) {
    e.preventDefault();
    if (reservando) return;
    const nombre = document.getElementById('nombre').value.trim();
    const tel = Telefono.normalizar(document.getElementById('telefono').value, est.barberia.codigo_area);
    if (nombre.length < 2) return mostrarAvisoDatos(Html.mensajeError('NOMBRE_INVALIDO'));
    if (!tel) return mostrarAvisoDatos(Html.mensajeError('TELEFONO_INVALIDO'));
    reservando = true;
    const boton = document.getElementById('btn-reservar');
    boton.disabled = true;
    try {
      est.token = await Api.reservar(est.slug, est.servicio.id, est.inicio, nombre, tel);
      est.nombre = nombre; est.telefono = tel;
      pantallaConfirmacion();
    } catch (err) {
      // Otro cliente se llevó el horario: se vuelven a pedir los horarios del día.
      if (err.codigo === 'HORARIO_NO_DISPONIBLE') await pantallaHorarios(Html.mensajeError(err.codigo));
      // Cualquier otro error: se avisa sobre el mismo formulario para no perder lo que escribió.
      else { mostrarAvisoDatos(Html.mensajeError(err.codigo)); boton.disabled = false; }
    } finally { reservando = false; }
  }

  // Muestra el error sin rearmar la pantalla, así no se pierde lo que escribió.
  function mostrarAvisoDatos(msg) {
    const previo = document.getElementById('aviso-datos');
    if (previo) previo.remove();
    document.getElementById('form-datos').insertAdjacentHTML('afterbegin', `<p class="error" id="aviso-datos" role="alert">${esc(msg)}</p>`);
  }

  async function cancelar() {
    const boton = document.getElementById('btn-cancelar-si');
    if (boton) boton.disabled = true;
    try { await Api.cancelarTurno(est.token); } catch (e) { return pantallaTurno(Html.mensajeError(e.codigo)); }
    pantallaTurno();
  }

  const ACCIONES = {
    servicio: (el) => { est.servicio = est.barberia.servicios[+el.dataset.i]; pantallaDias(); },
    dia: (el) => { est.fecha = el.dataset.dia; pantallaHorarios(); },
    hora: (el) => { est.inicio = el.dataset.hora; pantallaDatos(); },
    'a-servicios': () => pantallaServicios(),
    'a-dias': () => pantallaDias(),
    'a-horarios': () => pantallaHorarios(),
    calendario: descargarIcs,
    cancelar: pantallaConfirmarCancelacion,
    'cancelar-si': cancelar,
    'cancelar-no': () => pantallaTurno(),
    reintentar: () => iniciar()
  };

  // ---------- Arranque ----------
  async function iniciar() {
    const q = new URLSearchParams(location.search);
    est.slug = q.get('b');
    est.token = q.get('t');
    cargando();
    if (est.token) return pantallaTurno();
    if (!est.slug) return pantallaNoEncontrada('barberia');
    try { est.barberia = await Api.barberia(est.slug); } catch (e) { return pantallaError(Html.mensajeError(e.codigo)); }
    if (!est.barberia) return pantallaNoEncontrada('barberia');
    document.title = est.barberia.nombre + ' · Reservá tu turno';
    pantallaServicios();
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && ACCIONES[el.dataset.act]) ACCIONES[el.dataset.act](el);
  });
  document.addEventListener('submit', (e) => { if (e.target.id === 'form-datos') enviarReserva(e); });
  document.addEventListener('input', (e) => { if (e.target.id === 'telefono') actualizarTelefonoEnVivo(); });

  Api.modoPublico(); // antes de cualquier llamada: esta página nunca usa la sesión del barbero
  iniciar();
  return { iniciar };
})();
