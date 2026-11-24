// push.js — activar o apagar los avisos de turnos nuevos/cancelados en ESTE dispositivo.
// Necesita: js/api.js (Api.push y Api.vapidPublica), js/html.js y config-panel.js
// (se engancha en ConfigPanel.alDibujarMenu para llenar el bloque "Notificaciones").
// El envío real lo hace la función de Supabase `notificar`; acá solo se guarda la suscripción.
const Push = (() => {
  const TEXTOS = {
    'no-soportado': 'Este navegador no permite notificaciones.',
    'requiere-instalar': 'En iPhone primero agregá esta página a la pantalla de inicio: Compartir → Agregar a inicio.',
    'bloqueado': 'Bloqueaste las notificaciones de esta página. Habilitalas desde los ajustes del navegador.',
    'activo': 'Las notificaciones están activadas en este dispositivo.',
    'inactivo': 'Activalas para enterarte al instante cuando alguien reserva o cancela.'
  };

  // 'inactivo' vs 'activo' depende de la suscripción (asíncrona): estadoSync lo resuelve con
  // lo que ya se sabe y estado() consulta al pushManager.
  function previo() {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    if (!('serviceWorker' in nav) || typeof window === 'undefined' || !('PushManager' in window) || !('Notification' in window)) {
      // iPhone en Safari normal no expone PushManager: ahí lo que falta es instalar la app.
      const iphone = /iphone|ipad|ipod/i.test(nav.userAgent || '');
      return iphone && !nav.standalone ? 'requiere-instalar' : 'no-soportado';
    }
    if (/iphone|ipad|ipod/i.test(nav.userAgent || '') && !nav.standalone) return 'requiere-instalar';
    if (Notification.permission === 'denied') return 'bloqueado';
    return null;
  }

  async function suscripcion() {
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function estado() {
    const p = previo();
    if (p) return p;
    try { return (await suscripcion()) && Notification.permission === 'granted' ? 'activo' : 'inactivo'; } catch (_) { return 'inactivo'; }
  }

  // La clave VAPID viaja en base64url; pushManager.subscribe la pide como bytes.
  function urlBase64ToUint8Array(b64) {
    const relleno = '='.repeat((4 - (b64.length % 4)) % 4);
    const crudo = atob((b64 + relleno).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(crudo, (c) => c.charCodeAt(0));
  }

  async function activar(barberiaId) {
    if (previo() && previo() !== 'bloqueado') throw new Error('NO_SOPORTADO');
    // La clave pública la genera el servidor la primera vez que la función corre: si todavía
    // no existe se avisa antes de pedir permiso, para no gastar el permiso del usuario en vano.
    const clave = await Api.vapidPublica();
    if (!clave) {
      const e = new Error('PUSH_NO_LISTO');
      e.codigo = 'PUSH_NO_LISTO';
      throw e;
    }
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') throw new Error('PERMISO_DENEGADO');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({
      userVisibleOnly: true, // obligatorio: cada push tiene que mostrar una notificación
      applicationServerKey: urlBase64ToUint8Array(clave)
    });
    try {
      await Api.push.guardar(barberiaId, sub);
    } catch (e) {
      // Sin fila en el servidor no llegaría ningún aviso: se deshace para no mostrar "activo" de mentira.
      await sub.unsubscribe().catch(() => {});
      throw e;
    }
  }

  async function desactivar() {
    const sub = await suscripcion();
    if (!sub) return;
    await Api.push.borrar(sub.endpoint); // primero la fila: si falla, la suscripción sigue y se puede reintentar
    await sub.unsubscribe();
  }

  // ---------- Pantalla (bloque dentro del menú de configuración) ----------
  async function dibujar(cont) {
    if (!cont) return;
    const est = await estado();
    if (!cont.isConnected) return; // el usuario ya salió del menú
    // Ya suscripto: se vuelve a guardar. Repara filas borradas por la limpieza de la función
    // (404/410) o endpoints rotados. Si falla no cambia la pantalla, solo queda en la consola.
    if (est === 'activo') {
      suscripcion().then((sub) => sub && Api.push.guardar(Panel.ctx.est.barberia.id, sub))
        .catch((e) => console.error('push: no se pudo renovar la suscripción', e));
    }
    const hayBoton = est === 'activo' || est === 'inactivo';
    cont.innerHTML = `<p id="notif-texto">${Html.esc(TEXTOS[est])}</p>
      <p class="error" id="notif-error" role="alert" hidden></p>
      ${hayBoton ? `<button class="boton ${est === 'activo' ? 'secundario' : ''}" type="button" id="notif-boton">${est === 'activo' ? 'Desactivar notificaciones' : 'Activar notificaciones'}</button>` : ''}`;
    const b = cont.querySelector('#notif-boton');
    if (!b) return;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        if (est === 'activo') await desactivar();
        else await activar(Panel.ctx.est.barberia.id);
      } catch (e) {
        const msg = cont.querySelector('#notif-error');
        msg.textContent = e.message === 'PERMISO_DENEGADO'
          ? 'No diste permiso para las notificaciones.'
          : e.codigo === 'PUSH_NO_LISTO' ? Html.mensajeError('PUSH_NO_LISTO')
          : 'No pudimos cambiar las notificaciones. Probá de nuevo.';
        msg.hidden = false;
        b.disabled = false;
        if (e.message !== 'PERMISO_DENEGADO') return;
      }
      dibujar(cont);
    });
  }

  if (typeof ConfigPanel !== 'undefined') ConfigPanel.alDibujarMenu = dibujar;

  return { estado, activar, desactivar, TEXTOS, _urlBase64ToUint8Array: urlBase64ToUint8Array };
})();

if (typeof module !== 'undefined') module.exports = Push;
