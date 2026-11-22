// telefono.js — normaliza teléfonos argentinos al formato de WhatsApp (549 + área + número).
// Es lo que se guarda y se compara: así "011 15 1234-5678" y "+54 9 11 1234 5678" son la
// misma persona. Misma lógica que app.normalizar_telefono en SQL (los dos leen
// tests/casos-telefono.json). Funciones puras, sin DOM.
const Telefono = (() => {
  // Si en la posición del área hay un "15" (prefijo de celular viejo), lo saca.
  // Área de 2 dígitos solo para 11; si no, se prueba con 3 y después con 4.
  function sacarQuince12(d) {
    const largos = d.startsWith('11') ? [2] : [3, 4];
    for (const n of largos) {
      if (d.slice(n, n + 2) === '15') return d.slice(0, n) + d.slice(n + 2);
    }
    return d;
  }

  function normalizar(texto, codigoArea) {
    let d = String(texto || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('54')) {
      d = d.slice(2);
      if (d.startsWith('9')) d = d.slice(1);
    } else if (d.startsWith('0')) {
      d = d.slice(1);
    }
    if (d.length === 12) d = sacarQuince12(d);
    // Ningún código de área empieza con 15, así que es el prefijo de celular.
    if (d.startsWith('15')) d = d.slice(2);
    const area = String(codigoArea || '').replace(/\D/g, '');
    // Número local sin área (ej. 1234-5678): se completa solo si cierra en 10 dígitos.
    if (d.length < 10 && area.length + d.length === 10) d = area + d;
    // 10 dígitos; el primero 2-9, o "11" (Buenos Aires). Un 0 o 1 suelto es basura.
    if (d.length === 10 && (/^[2-9]/.test(d) || d.startsWith('11'))) return '549' + d;
    return null;
  }

  // Solo para mostrar; no se usa para comparar.
  function mostrar(normalizado) {
    const m = /^549(\d{10})$/.exec(String(normalizado || ''));
    if (!m) return String(normalizado || '');
    const d = m[1];
    const n = d.startsWith('11') ? 2 : 3;
    const resto = d.slice(n);
    const corte = resto.length - 4;
    return `+54 9 ${d.slice(0, n)} ${resto.slice(0, corte)}-${resto.slice(corte)}`;
  }

  return { normalizar, mostrar };
})();

if (typeof module !== 'undefined') module.exports = Telefono;
