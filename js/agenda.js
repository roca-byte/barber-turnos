// agenda.js — resta intervalos: de las franjas de atención saca lo ocupado (turnos y
// bloqueos) y devuelve los huecos libres. Trabaja con instantes ISO (comparables como
// números), así que no hay zonas horarias de por medio. Función pura, sin DOM.
const Agenda = (() => {
  const MIN_MS = 60 * 1000; // un hueco de menos de 1 minuto no sirve para nada

  function huecos(franjas, ocupados) {
    // Ordenados por inicio, se recorre una sola vez moviendo un "cursor" a la derecha.
    const bloques = (ocupados || [])
      .map((o) => ({ ini: Date.parse(o.inicio), fin: Date.parse(o.fin) }))
      .sort((a, b) => a.ini - b.ini);
    const salida = [];
    for (const f of franjas || []) {
      let cursor = Date.parse(f.desde);
      const fin = Date.parse(f.hasta);
      for (const b of bloques) {
        if (b.fin <= cursor || b.ini >= fin) continue; // fuera de lo que queda de la franja
        if (b.ini - cursor >= MIN_MS) salida.push([cursor, b.ini]);
        if (b.fin > cursor) cursor = b.fin; // un ocupado que se pasa de la franja deja cursor >= fin
      }
      if (fin - cursor >= MIN_MS) salida.push([cursor, fin]);
    }
    return salida.map(([a, b]) => ({ desde: new Date(a).toISOString(), hasta: new Date(b).toISOString() }));
  }

  return { huecos };
})();

if (typeof module !== 'undefined') module.exports = Agenda;
