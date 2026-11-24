// html.js — escape de texto del usuario y mensajes de error en castellano rioplatense.
// Todo texto que viene de afuera (nombres, motivos, direcciones) pasa por esc() antes de
// ir a innerHTML: es la defensa contra XSS en una app sin framework.
const Html = (() => {
  const ENTIDADES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(texto) {
    return String(texto === null || texto === undefined ? '' : texto)
      .replace(/[&<>"']/g, (c) => ENTIDADES[c]);
  }

  // Un mensaje por cada código que levantan las RPC (raise exception '<CODIGO>').
  const MENSAJES = {
    BARBERIA_NO_EXISTE: 'No encontramos esa barbería. Revisá el link.',
    SERVICIO_NO_EXISTE: 'Ese servicio ya no está disponible. Elegí otro.',
    HORARIO_NO_DISPONIBLE: 'Ese horario se acaba de ocupar. Elegí otro.',
    TELEFONO_INVALIDO: 'Revisá el número de WhatsApp: no parece válido.',
    NOMBRE_INVALIDO: 'Escribí tu nombre (entre 2 y 60 letras).',
    CLIENTE_BLOQUEADO: 'No podés reservar online. Escribile a la barbería por WhatsApp.',
    LIMITE_TURNOS: 'Ya tenés los turnos futuros máximos. Cancelá uno o esperá a que pase.',
    LIMITE_HORA: 'Hiciste muchas reservas seguidas. Probá en un rato.',
    TURNO_NO_EXISTE: 'No encontramos ese turno. Revisá el link.',
    FUERA_DE_PLAZO: 'Ya no se puede cancelar online. Escribile a la barbería por WhatsApp.',
    NO_AUTORIZADO: 'No tenés permiso para hacer eso. Volvé a ingresar.',
    RANGO_INVALIDO: 'El rango de fechas no es válido: el fin tiene que ser después del inicio.',
    ESTADO_INVALIDO: 'Ese estado no es válido para el turno.',
    PUSH_NO_LISTO: 'Las notificaciones todavía no están listas en el servidor. Probá más tarde.'
  };
  const GENERICO = 'Algo salió mal. Probá de nuevo.';

  function mensajeError(codigo) {
    return Object.prototype.hasOwnProperty.call(MENSAJES, codigo) ? MENSAJES[codigo] : GENERICO;
  }

  return { esc, mensajeError };
})();

if (typeof module !== 'undefined') module.exports = Html;
