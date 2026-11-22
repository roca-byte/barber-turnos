// api.js — capa fina sobre supabase-js. No tiene reglas de negocio: llama a las RPC y a las
// tablas, y convierte cualquier error en un Error con `.codigo`, que es el mensaje que
// levantó Postgres (raise exception 'CODIGO'). Html.mensajeError(codigo) lo traduce.
// Necesita cargados antes: vendor/supabase.js (global `supabase`) y js/config.js.
const Api = (() => {
  const CODIGOS = ['BARBERIA_NO_EXISTE', 'SERVICIO_NO_EXISTE', 'HORARIO_NO_DISPONIBLE', 'TELEFONO_INVALIDO',
    'NOMBRE_INVALIDO', 'CLIENTE_BLOQUEADO', 'LIMITE_TURNOS', 'LIMITE_HORA', 'TURNO_NO_EXISTE',
    'FUERA_DE_PLAZO', 'NO_AUTORIZADO', 'RANGO_INVALIDO', 'ESTADO_INVALIDO'];

  let cliente = null;
  // Se crea al primer uso: así las páginas que no llaman a Api no pagan la conexión.
  function db() {
    if (!cliente) {
      cliente = supabase.createClient(Config.url, Config.clavePublica, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    }
    return cliente;
  }

  function aError(e) {
    const msg = (e && e.message) || '';
    const err = new Error(msg || 'DESCONOCIDO');
    err.codigo = CODIGOS.includes(msg.trim()) ? msg.trim() : 'DESCONOCIDO';
    return err;
  }

  // Resuelve la respuesta { data, error } de supabase-js: devuelve data o lanza.
  async function ok(promesa) {
    let r;
    try { r = await promesa; } catch (e) { throw aError(e); } // sin red: fetch tira TypeError
    if (r.error) throw aError(r.error);
    return r.data;
  }

  const rpc = (nombre, params) => ok(db().rpc(nombre, params));

  // ---------- Público (sin sesión) ----------
  const barberia = (slug) => rpc('barberia_publica', { p_slug: slug });
  const dias = (slug, servicioId) => rpc('dias_disponibles', { p_slug: slug, p_servicio: servicioId });
  const horarios = (slug, servicioId, fecha) =>
    rpc('disponibilidad', { p_slug: slug, p_servicio: servicioId, p_fecha: fecha });
  const reservar = (slug, servicioId, inicio, nombre, telefono) =>
    rpc('reservar', { p_slug: slug, p_servicio: servicioId, p_inicio: inicio, p_nombre: nombre, p_telefono: telefono });
  const verTurno = (token) => rpc('ver_turno', { p_token: token });
  const cancelarTurno = (token) => rpc('cancelar_turno', { p_token: token });

  // ---------- Sesión del barbero ----------
  async function entrar(email, clave) {
    return ok(db().auth.signInWithPassword({ email, password: clave }));
  }
  async function salir() {
    await ok(db().auth.signOut());
  }
  // Devuelve la sesión actual o null (no lanza si no hay).
  async function sesion() {
    const data = await ok(db().auth.getSession());
    return data.session;
  }
  // La barbería del usuario logueado (la política RLS solo deja ver la propia).
  async function miBarberia() {
    const filas = await ok(db().from('barberias').select('*').limit(1));
    return filas[0] || null;
  }

  // ---------- Panel ----------
  const agendaDia = (barberiaId, fecha) => rpc('agenda_dia', { p_barberia: barberiaId, p_fecha: fecha });
  const turnoManual = (barberiaId, servicioId, inicio, nombre, telefono) =>
    rpc('crear_turno_manual', {
      p_barberia: barberiaId, p_servicio: servicioId, p_inicio: inicio, p_nombre: nombre, p_telefono: telefono || null
    });
  const bloquear = (barberiaId, inicio, fin, motivo) =>
    rpc('crear_bloqueo', { p_barberia: barberiaId, p_inicio: inicio, p_fin: fin, p_motivo: motivo || null });
  // No hay RPC: bloqueos tiene política "todo" para miembros, se borra directo.
  const borrarBloqueo = (id) => ok(db().from('bloqueos').delete().eq('id', id));
  const marcarTurno = (id, estado) => rpc('marcar_turno', { p_turno: id, p_estado: estado });
  const clientesConFaltas = (barberiaId) => rpc('clientes_con_faltas', { p_barberia: barberiaId });
  const desbloquear = (clienteId) => rpc('desbloquear_cliente', { p_cliente: clienteId });

  // ---------- Servicios, horarios y ajustes (tablas) ----------
  const servicios = {
    listar: (barberiaId) => ok(db().from('servicios').select('*').eq('barberia_id', barberiaId)
      .order('orden').order('nombre')),
    crear: (datos) => ok(db().from('servicios').insert(datos).select().single()),
    actualizar: (id, datos) => ok(db().from('servicios').update(datos).eq('id', id).select().single()),
    borrar: (id) => ok(db().from('servicios').delete().eq('id', id))
  };
  const horariosSemana = {
    listar: (barberiaId) => ok(db().from('horarios').select('*').eq('barberia_id', barberiaId)
      .order('dia_semana').order('desde')),
    crear: (datos) => ok(db().from('horarios').insert(datos).select().single()),
    actualizar: (id, datos) => ok(db().from('horarios').update(datos).eq('id', id).select().single()),
    borrar: (id) => ok(db().from('horarios').delete().eq('id', id))
  };
  // Ajustes = columnas editables de barberias (el plan y el slug no se tocan desde acá).
  const ajustes = {
    ver: miBarberia,
    guardar: (barberiaId, datos) => ok(db().from('barberias').update(datos).eq('id', barberiaId).select().single())
  };

  return {
    barberia, dias, horarios, reservar, verTurno, cancelarTurno,
    entrar, salir, sesion, miBarberia,
    agendaDia, turnoManual, bloquear, borrarBloqueo, marcarTurno, clientesConFaltas, desbloquear,
    servicios, horariosSemana, ajustes,
    _aError: aError // expuesto solo para poder probar la conversión de errores
  };
})();

if (typeof module !== 'undefined') module.exports = Api;
