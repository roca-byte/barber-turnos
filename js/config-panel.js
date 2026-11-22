// config-panel.js — configuración del barbero (Servicios, Horario semanal, Ajustes, Mi link y
// el lugar para Notificaciones). Se abre desde el botón "Configuración" de la agenda y usa el
// mismo estado y el mismo manejo de sesión vencida que panel.js (Panel.ctx): no los duplica.
// Cada pantalla reemplaza el contenido de #vista; los clics van por delegación con data-act
// "cfg-*" (panel.js ignora los que no conoce). Todo texto del usuario pasa por Html.esc.
// Los límites numéricos son los mismos que los check de la base (migración 2026112205): si
// cambian allá, cambian acá, para avisar antes de mandar algo que la base va a rechazar.
const ConfigPanel = (() => {
  const vista = () => document.getElementById('vista');
  const esc = Html.esc;
  const ctx = () => Panel.ctx;
  const barberia = () => ctx().est.barberia;

  const nota = (msg, bueno) => (msg
    ? `<p class="${bueno ? 'exito' : 'error'}" role="${bueno ? 'status' : 'alert'}">${esc(msg)}</p>` : '');
  const cargando = () => ctx().cargando();

  // Un trabajo a la vez: un doble toque en "Guardar" no tiene que escribir dos veces.
  let ocupado = false;

  // Maneja el error de una llamada a Api. Devuelve true si la sesión se cayó (ya se mostró el
  // ingreso); si no, el llamador muestra su propio mensaje.
  async function sesionCaida(e) { return ctx().sesionCaida(e); }

  // Pantalla de error de carga: reintentar la pantalla en la que estaba, o volver al menú.
  let reintento = null;
  function pantallaErrorCarga(msg) {
    vista().innerHTML = `${nota(msg)}
      <button class="boton" type="button" data-act="reintentar-config">Reintentar</button>
      <button class="boton secundario" type="button" data-act="cfg-menu">Volver a configuración</button>`;
  }
  async function cargarCon(fn, msg) {
    reintento = fn;
    try { await fn(msg); } catch (e) { if (await sesionCaida(e)) return; pantallaErrorCarga(Html.mensajeError(e.codigo)); }
  }

  // ---------- Menú ----------
  function pantallaMenu(msg) {
    const entrada = (act, titulo, detalle) => `<button class="opcion" type="button" data-act="${act}">
      <span>${titulo}<br><small>${detalle}</small></span><span aria-hidden="true">›</span></button>`;
    vista().innerHTML = `<header class="barra"><h1>Configuración</h1>
        <button class="boton secundario chico" type="button" data-act="cfg-agenda">Volver</button></header>
      ${nota(msg, true)}
      <nav id="menu-config" aria-label="Configuración">
        ${entrada('cfg-servicios', 'Servicios', 'Qué ofrecés, cuánto dura y cuánto cuesta')}
        ${entrada('cfg-horario', 'Horario semanal', 'Los días y horas en que atendés')}
        ${entrada('cfg-ajustes', 'Ajustes', 'Datos de la barbería y reglas de reserva')}
        ${entrada('cfg-link', 'Mi link y QR', 'Para que tus clientes saquen turno')}
      </nav>
      <h2>Notificaciones</h2>
      <div id="notificaciones"></div>`;
    // Gancho para quien dibuje las notificaciones (se pasa el contenedor ya en pantalla).
    if (typeof api.alDibujarMenu === 'function') api.alDibujarMenu(document.getElementById('notificaciones'));
  }
  const menu = pantallaMenu;

  // ---------- Servicios ----------
  const cfg = { servicios: [], editando: null, franjas: [], original: [], barbero: null };

  const precioTexto = (p) => (p === null || p === undefined ? '' : ' · $' + Number(p).toLocaleString('es-AR'));

  function dibujarServicios(msg, bueno) {
    const l = cfg.servicios;
    const items = l.map((s, i) => `<div class="tarjeta servicio" data-servicio="${esc(s.id)}">
        <p><strong>${esc(s.nombre)}</strong>${s.activo ? '' : ' <span class="estado-cancelado">Oculto</span>'}<br>
          <small>${esc(s.duracion_min)} min${esc(precioTexto(s.precio))}</small></p>
        <div class="fila-botones">
          <button class="boton secundario" type="button" data-act="cfg-servicio-subir" data-id="${esc(s.id)}" aria-label="Subir ${esc(s.nombre)}"${i === 0 ? ' disabled' : ''}>↑</button>
          <button class="boton secundario" type="button" data-act="cfg-servicio-bajar" data-id="${esc(s.id)}" aria-label="Bajar ${esc(s.nombre)}"${i === l.length - 1 ? ' disabled' : ''}>↓</button>
          <button class="boton secundario" type="button" data-act="cfg-servicio-editar" data-id="${esc(s.id)}">Editar</button>
        </div></div>`).join('');
    vista().innerHTML = `<h1>Servicios</h1>
      <p class="sub">El orden de acá es el que ven tus clientes. Un servicio oculto no se puede reservar.</p>
      ${nota(msg, bueno)}${items || '<p class="sub">Todavía no cargaste servicios.</p>'}
      <button class="boton" type="button" data-act="cfg-servicio-nuevo">+ Servicio</button>
      <button class="boton secundario" type="button" data-act="cfg-menu">Volver a configuración</button>`;
  }

  async function pantallaServicios(msg, bueno) {
    cargando();
    cfg.servicios = await Api.servicios.listar(barberia().id);
    // + Turno de la agenda usa esta lista: que no quede con servicios viejos.
    ctx().est.servicios = cfg.servicios.filter((s) => s.activo);
    dibujarServicios(msg, bueno);
  }

  function formServicio(msg, d) {
    d = d || { nombre: '', duracion: '30', precio: '', activo: true };
    vista().innerHTML = `<h1>${d.id ? 'Editar servicio' : 'Nuevo servicio'}</h1>
      <form id="form-servicio" class="tarjeta" novalidate>
        ${nota(msg)}
        <div class="campo"><label for="nombre">Nombre</label>
          <input id="nombre" type="text" maxlength="60" autocomplete="off" value="${esc(d.nombre)}" required></div>
        <div class="campo"><label for="duracion">Duración (minutos)</label>
          <input id="duracion" type="number" inputmode="numeric" min="5" max="240" step="5" value="${esc(d.duracion)}" required>
          <p class="ayuda">De 5 en 5, entre 5 y 240.</p></div>
        <div class="campo"><label for="precio">Precio (opcional)</label>
          <input id="precio" type="text" inputmode="decimal" autocomplete="off" value="${esc(d.precio)}">
          <p class="ayuda">Es solo informativo: la app no cobra.</p></div>
        <div class="campo"><label><input id="activo" type="checkbox"${d.activo ? ' checked' : ''}> Se puede reservar</label>
          <p class="ayuda">Destildalo para ocultarlo sin perder su historial.</p></div>
        <button class="boton" id="btn-guardar-servicio" type="submit">Guardar</button>
        <button class="boton secundario" type="button" data-act="cfg-servicios">Cancelar</button>
      </form>`;
    cfg.editando = d.id || null;
  }

  async function guardarServicio(e) {
    e.preventDefault();
    if (ocupado) return;
    const d = {
      id: cfg.editando, nombre: document.getElementById('nombre').value.trim(), duracion: document.getElementById('duracion').value.trim(),
      precio: document.getElementById('precio').value.trim(), activo: document.getElementById('activo').checked
    };
    if (!d.nombre) return formServicio('Escribí el nombre del servicio.', d);
    const min = /^\d+$/.test(d.duracion) ? Number(d.duracion) : NaN;
    if (!(min >= 5 && min <= 240 && min % 5 === 0)) return formServicio('La duración tiene que ser en minutos, de 5 en 5, entre 5 y 240.', d);
    let precio = null;
    if (d.precio) {
      precio = Number(d.precio.replace(',', '.'));
      if (!/^\d+([.,]\d{1,2})?$/.test(d.precio) || precio > 99999999) return formServicio('El precio tiene que ser un número, por ejemplo 8000 o 8500,50. Podés dejarlo vacío.', d);
    }
    const datos = { nombre: d.nombre, duracion_min: min, precio, activo: d.activo };
    ocupado = true;
    document.getElementById('btn-guardar-servicio').disabled = true;
    try {
      if (d.id) await Api.servicios.actualizar(d.id, datos);
      else {
        const orden = cfg.servicios.reduce((m, s) => Math.max(m, s.orden + 1), 0);
        await Api.servicios.crear(Object.assign({ barberia_id: barberia().id, orden }, datos));
      }
    } catch (err) {
      ocupado = false;
      if (await sesionCaida(err)) return;
      return formServicio(Html.mensajeError(err.codigo), d);
    }
    ocupado = false;
    cargarCon(() => pantallaServicios('Servicio guardado.', true));
  }

  // Intercambia con el vecino y reescribe 0..n-1: así quedan órdenes únicas aunque vinieran
  // todos en 0 (el valor por defecto) y el resultado no depende del desempate por nombre.
  async function moverServicio(id, delta) {
    if (ocupado) return;
    const l = cfg.servicios.slice();
    const i = l.findIndex((s) => s.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    ocupado = true;
    try {
      for (let k = 0; k < l.length; k++) if (l[k].orden !== k) await Api.servicios.actualizar(l[k].id, { orden: k });
    } catch (err) {
      ocupado = false;
      if (await sesionCaida(err)) return;
      return cargarCon(() => pantallaServicios(Html.mensajeError(err.codigo)));
    }
    ocupado = false;
    cargarCon(() => pantallaServicios());
  }

  // ---------- Horario semanal ----------
  // Lunes primero (en la base 0 = domingo).
  const DIAS = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [0, 'Domingo']];
  const nombreDia = (n) => DIAS.find((d) => d[0] === n)[1];
  const hhmm = (t) => String(t).slice(0, 5); // la base devuelve 09:00:00

  async function pantallaHorario(msg, bueno) {
    cargando();
    cfg.barbero = await Api.barberoPrincipal(barberia().id);
    if (!cfg.barbero) {
      vista().innerHTML = `<h1>Horario semanal</h1><p class="error" role="alert">No hay ningún barbero activo en tu barbería.</p>
        <button class="boton secundario" type="button" data-act="cfg-menu">Volver a configuración</button>`;
      return;
    }
    const filas = (await Api.horariosSemana.listar(barberia().id)).filter((h) => h.barbero_id === cfg.barbero.id);
    cfg.original = filas.map((h) => ({ id: h.id, dia: h.dia_semana, desde: hhmm(h.desde), hasta: hhmm(h.hasta) }));
    cfg.franjas = cfg.original.map((f) => Object.assign({}, f));
    dibujarHorario(msg, bueno);
  }

  function dibujarHorario(msg, bueno) {
    const dias = DIAS.map(([n, nombre]) => {
      const filas = cfg.franjas.map((f, i) => ({ f, i })).filter((x) => x.f.dia === n).map(({ f, i }) => `
        <div class="franja" data-franja="${i}">
          <input type="time" data-campo="desde" aria-label="${esc(nombre)}: desde" value="${esc(f.desde)}">
          <span aria-hidden="true">a</span>
          <input type="time" data-campo="hasta" aria-label="${esc(nombre)}: hasta" value="${esc(f.hasta)}">
          <button class="boton secundario" type="button" data-act="cfg-franja-sacar" data-i="${i}" aria-label="Sacar esta franja de ${esc(nombre)}">✕</button>
        </div>`).join('');
      return `<div class="tarjeta" data-dia-card="${n}"><h2>${esc(nombre)}</h2>
        ${filas || '<p class="sub">No atendés este día.</p>'}
        <button class="boton secundario" type="button" data-act="cfg-franja-agregar" data-dia="${n}">+ Agregar franja</button></div>`;
    }).join('');
    vista().innerHTML = `<h1>Horario semanal</h1>
      <p class="sub">Podés poner más de una franja por día (por ejemplo 9 a 13 y 16 a 20). Los cambios valen para turnos nuevos.</p>
      ${nota(msg, bueno)}${dias}
      <button class="boton" id="btn-guardar-horario" type="button" data-act="cfg-horario-guardar">Guardar horario</button>
      <button class="boton secundario" type="button" data-act="cfg-menu">Volver a configuración</button>`;
  }

  // Pasa lo que hay en los campos al estado (antes de agregar, sacar, validar o guardar).
  function leerHorario() {
    document.querySelectorAll('[data-franja]').forEach((div) => {
      const f = cfg.franjas[Number(div.dataset.franja)];
      f.desde = div.querySelector('[data-campo="desde"]').value;
      f.hasta = div.querySelector('[data-campo="hasta"]').value;
    });
  }

  // Devuelve el texto del primer problema o '' si está todo bien.
  function problemaHorario() {
    for (const f of cfg.franjas) {
      if (!f.desde || !f.hasta) return `Completá desde y hasta en todas las franjas (${nombreDia(f.dia)}).`;
      if (f.hasta <= f.desde) return `${nombreDia(f.dia)}: la hora de cierre tiene que ser después de la de apertura.`;
    }
    for (const [n, nombre] of DIAS) {
      const del = cfg.franjas.filter((f) => f.dia === n).sort((a, b) => a.desde.localeCompare(b.desde));
      for (let k = 1; k < del.length; k++) if (del[k].desde < del[k - 1].hasta) return `${nombre}: dos franjas se pisan.`;
    }
    return '';
  }

  function agregarFranja(dia) {
    leerHorario();
    const hay = cfg.franjas.some((f) => f.dia === dia);
    cfg.franjas.push(hay ? { id: null, dia, desde: '16:00', hasta: '20:00' } : { id: null, dia, desde: '09:00', hasta: '13:00' });
    dibujarHorario();
  }
  function sacarFranja(i) {
    leerHorario();
    cfg.franjas.splice(i, 1);
    dibujarHorario();
  }

  // Compara con lo que vino de la base y manda solo la diferencia: nuevas, cambiadas, borradas.
  async function guardarHorario() {
    if (ocupado) return;
    leerHorario();
    const problema = problemaHorario();
    if (problema) return dibujarHorario(problema);
    ocupado = true;
    document.getElementById('btn-guardar-horario').disabled = true;
    const b = barberia().id;
    try {
      for (const f of cfg.franjas) {
        const viejo = f.id && cfg.original.find((o) => o.id === f.id);
        if (!f.id) await Api.horariosSemana.crear({ barberia_id: b, barbero_id: cfg.barbero.id, dia_semana: f.dia, desde: f.desde, hasta: f.hasta });
        else if (viejo.desde !== f.desde || viejo.hasta !== f.hasta) await Api.horariosSemana.actualizar(f.id, { desde: f.desde, hasta: f.hasta });
      }
      for (const o of cfg.original) if (!cfg.franjas.some((f) => f.id === o.id)) await Api.horariosSemana.borrar(o.id);
    } catch (err) {
      ocupado = false;
      if (await sesionCaida(err)) return;
      // Pudo quedar a medias: se recarga lo que realmente hay guardado.
      return cargarCon(() => pantallaHorario(Html.mensajeError(err.codigo)));
    }
    ocupado = false;
    cargarCon(() => pantallaHorario('Horario guardado.', true));
  }

  // ---------- Ajustes ----------
  // Rango [min, max]; max null = sin tope práctico (se corta en TOPE para no pasarse de int).
  const TOPE = 1000000;
  const AJUSTES = [
    { k: 'cancelacion_horas', t: 'Horas para cancelar', min: 0, max: null, ayuda: 'Hasta cuántas horas antes del turno puede cancelar el cliente solo. Con 0 puede hasta el último momento.' },
    { k: 'faltas_max', t: 'Faltas para bloquear', min: 1, max: null, ayuda: 'Con esta cantidad de "no vino" el cliente deja de poder reservar online.' },
    { k: 'dias_adelante', t: 'Días hacia adelante', min: 1, max: 90, ayuda: 'Con cuántos días de anticipación se puede reservar (de 1 a 90).' },
    { k: 'anticipacion_min', t: 'Anticipación mínima (minutos)', min: 0, max: null, ayuda: 'Cuánto antes del turno se cierra la reserva online. Con 0 se puede reservar hasta la hora.' },
    { k: 'paso_min', t: 'Paso de la grilla (minutos)', min: 5, max: 60, ayuda: 'Cada cuántos minutos se ofrece un horario (de 5 a 60).' },
    { k: 'turnos_futuros_max', t: 'Turnos pendientes por cliente', min: 1, max: null, ayuda: 'Cuántos turnos futuros puede tener a la vez la misma persona.' },
    { k: 'reservas_por_hora_ip', t: 'Reservas por hora por conexión', min: 1, max: null, ayuda: 'Tope para frenar abusos: reservas por hora desde una misma conexión.' }
  ];

  function campoAjuste(a, v) {
    return `<div class="campo"><label for="${a.k}">${esc(a.t)}</label>
      <input id="${a.k}" type="number" inputmode="numeric" min="${a.min}"${a.max ? ` max="${a.max}"` : ''} value="${esc(v)}" required>
      <p class="ayuda">${esc(a.ayuda)}</p></div>`;
  }

  function pantallaAjustes(msg, bueno, d) {
    const b = d || barberia();
    vista().innerHTML = `<h1>Ajustes</h1>
      <form id="form-ajustes" class="tarjeta" novalidate>
        ${nota(msg, bueno)}
        <h2>Datos de la barbería</h2>
        <div class="campo"><label for="nombre">Nombre</label>
          <input id="nombre" type="text" maxlength="60" autocomplete="off" value="${esc(b.nombre)}" required></div>
        <div class="campo"><label for="direccion">Dirección (opcional)</label>
          <input id="direccion" type="text" maxlength="120" autocomplete="off" value="${esc(b.direccion)}"></div>
        <div class="campo"><label for="whatsapp">WhatsApp de la barbería (opcional)</label>
          <input id="whatsapp" type="tel" inputmode="tel" autocomplete="off" value="${esc(b.whatsapp)}">
          <p class="ayuda">Es el número al que escriben los clientes cuando ya no pueden cancelar online.</p></div>
        <div class="campo"><label for="zona_horaria">Zona horaria</label>
          <input id="zona_horaria" type="text" list="zonas" autocomplete="off" value="${esc(b.zona_horaria)}" required>
          <datalist id="zonas"><option value="America/Argentina/Buenos_Aires"><option value="America/Argentina/Cordoba">
            <option value="America/Argentina/Mendoza"><option value="America/Montevideo"><option value="America/Santiago"></datalist>
          <p class="ayuda">Todas las horas se muestran en esta zona, esté donde esté el celular.</p></div>
        <h2>Reglas de reserva</h2>
        <div class="campo"><label for="codigo_area">Código de área</label>
          <input id="codigo_area" type="text" inputmode="numeric" maxlength="4" autocomplete="off" value="${esc(b.codigo_area)}" required>
          <p class="ayuda">Se le agrega a los teléfonos que tus clientes escriben sin código. Sin el 0 ni el 15 (por ejemplo 11).</p></div>
        ${AJUSTES.map((a) => campoAjuste(a, b[a.k])).join('')}
        <button class="boton" id="btn-guardar-ajustes" type="submit">Guardar ajustes</button>
        <button class="boton secundario" type="button" data-act="cfg-menu">Volver a configuración</button>
      </form>`;
  }

  const zonaValida = (z) => { try { new Intl.DateTimeFormat('es-AR', { timeZone: z }); return true; } catch (e) { return false; } };

  async function guardarAjustes(e) {
    e.preventDefault();
    if (ocupado) return;
    const v = (id) => document.getElementById(id).value.trim();
    const d = { nombre: v('nombre'), direccion: v('direccion'), whatsapp: v('whatsapp'), zona_horaria: v('zona_horaria'), codigo_area: v('codigo_area') };
    AJUSTES.forEach((a) => { d[a.k] = v(a.k); });
    const mal = (m) => pantallaAjustes(m, false, d);
    if (!d.nombre) return mal('Escribí el nombre de la barbería.');
    if (!zonaValida(d.zona_horaria)) return mal('La zona horaria no es válida. Elegí una de la lista, por ejemplo America/Argentina/Buenos_Aires.');
    if (!/^[1-9]\d{1,3}$/.test(d.codigo_area)) return mal('El código de área son de 2 a 4 números, sin el 0 inicial (por ejemplo 11).');
    const datos = { nombre: d.nombre, direccion: d.direccion || null, zona_horaria: d.zona_horaria, codigo_area: d.codigo_area, whatsapp: null };
    if (d.whatsapp) {
      datos.whatsapp = Telefono.normalizar(d.whatsapp, d.codigo_area);
      if (!datos.whatsapp) return mal(Html.mensajeError('TELEFONO_INVALIDO'));
    }
    for (const a of AJUSTES) {
      const n = /^\d+$/.test(d[a.k]) ? Number(d[a.k]) : NaN;
      const max = a.max || TOPE;
      if (!(n >= a.min && n <= max)) return mal(`${a.t}: poné un número entero ${a.max ? `entre ${a.min} y ${a.max}` : `de ${a.min} en adelante`}.`);
      datos[a.k] = n;
    }
    ocupado = true;
    document.getElementById('btn-guardar-ajustes').disabled = true;
    let fila;
    try { fila = await Api.ajustes.guardar(barberia().id, datos); } catch (err) {
      ocupado = false;
      if (await sesionCaida(err)) return;
      return mal(Html.mensajeError(err.codigo));
    }
    ocupado = false;
    ctx().est.barberia = fila; // la agenda y +Turno usan la zona y el código de área nuevos
    pantallaAjustes('Ajustes guardados.', true);
  }

  // ---------- Mi link y QR ----------
  // Absoluto y armado desde donde está la app (sirve en /barber-turnos/ de GitHub Pages y en
  // local): index.html vive al lado de panel.html.
  function enlaceBarberia() {
    const u = new URL('index.html', location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('b', barberia().slug);
    return u.href;
  }

  function qrSvg(texto) {
    const q = qrcode(0, 'M'); // versión automática, corrección media: aguanta una hoja arrugada
    q.addData(texto);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true, alt: 'Código QR con el link para sacar turno', title: 'QR' });
  }

  function pantallaLink() {
    const url = enlaceBarberia();
    let qr;
    try { qr = qrSvg(url); } catch (e) { qr = '<p class="error">No se pudo armar el QR.</p>'; }
    // #hoja-qr es lo único que sale al imprimir (ver @media print en styles.css).
    vista().innerHTML = `<div class="pantalla-link"><h1>Mi link y QR</h1>
      <p class="sub">Compartilo por WhatsApp o imprimí el QR y pegalo en el local.</p>
      <div class="tarjeta"><p class="enlace" id="link-texto">${esc(url)}</p>
        <button class="boton" type="button" data-act="cfg-copiar">Copiar link</button>
        <p class="exito oculto" id="copiado" role="status">Copiado</p></div>
      <div class="tarjeta hoja-qr" id="hoja-qr"><h2>${esc(barberia().nombre)}</h2>
        <div class="qr">${qr}</div><p class="hoja-texto">Sacá tu turno acá</p></div>
      <button class="boton" type="button" data-act="cfg-imprimir">Imprimir</button>
      <button class="boton secundario" type="button" data-act="cfg-menu">Volver a configuración</button></div>`;
  }

  // Portapapeles: la API moderna necesita https y permiso; si falla, el truco del textarea.
  async function copiar() {
    const texto = enlaceBarberia();
    let listo = false;
    try { await navigator.clipboard.writeText(texto); listo = true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      document.body.appendChild(ta);
      ta.select();
      try { listo = document.execCommand('copy'); } catch (x) { listo = false; }
      ta.remove();
    }
    const aviso = document.getElementById('copiado');
    aviso.textContent = listo ? 'Copiado' : 'No se pudo copiar. Mantené apretado el link y copialo a mano.';
    aviso.classList.remove('oculto');
  }

  // ---------- Entrada ----------
  const ACCIONES = {
    'cfg-menu': () => menu(),
    'cfg-agenda': () => ctx().volver(),
    'cfg-servicios': () => cargarCon(() => pantallaServicios()),
    'cfg-servicio-nuevo': () => formServicio(),
    'cfg-servicio-editar': (el) => {
      const s = cfg.servicios.find((x) => x.id === el.dataset.id);
      if (s) formServicio('', { id: s.id, nombre: s.nombre, duracion: String(s.duracion_min), precio: s.precio === null || s.precio === undefined ? '' : String(s.precio).replace('.', ','), activo: s.activo });
    },
    'cfg-servicio-subir': (el) => moverServicio(el.dataset.id, -1),
    'cfg-servicio-bajar': (el) => moverServicio(el.dataset.id, 1),
    'cfg-horario': () => cargarCon(() => pantallaHorario()),
    'cfg-franja-agregar': (el) => agregarFranja(Number(el.dataset.dia)),
    'cfg-franja-sacar': (el) => sacarFranja(Number(el.dataset.i)),
    'cfg-horario-guardar': guardarHorario,
    'cfg-ajustes': () => pantallaAjustes(),
    'cfg-link': pantallaLink,
    'cfg-copiar': copiar,
    'cfg-imprimir': () => window.print(),
    'reintentar-config': () => (reintento ? cargarCon(reintento) : menu())
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && Object.prototype.hasOwnProperty.call(ACCIONES, el.dataset.act)) ACCIONES[el.dataset.act](el);
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'form-servicio') guardarServicio(e);
    else if (e.target.id === 'form-ajustes') guardarAjustes(e);
  });

  const api = { abrir: () => menu(), alDibujarMenu: null };
  return api;
})();
