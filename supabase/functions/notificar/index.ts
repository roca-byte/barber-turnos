// notificar — Edge Function de Supabase (Deno). La llama el trigger app.avisar_turno con
// {tipo, nuevo, viejo} y manda una push a todos los dispositivos de la barbería.
// Secretos: NOTIFICAR_SECRETO, VAPID_PUBLICA, VAPID_PRIVADA, VAPID_CONTACTO (mailto:...).
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { armarMensaje } from './mensaje.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails(Deno.env.get('VAPID_CONTACTO')!, Deno.env.get('VAPID_PUBLICA')!, Deno.env.get('VAPID_PRIVADA')!);

Deno.serve(async (req) => {
  // La función es pública en internet: solo el trigger conoce el secreto.
  if (req.headers.get('x-notificar-secreto') !== Deno.env.get('NOTIFICAR_SECRETO')) {
    return new Response('no autorizado', { status: 401 });
  }
  const { tipo, nuevo, viejo } = await req.json();
  if (!nuevo) return new Response('sin turno', { status: 400 });

  // El trigger manda solo la fila (con ids): se buscan los textos que muestra el aviso.
  const [serv, barb, cli] = await Promise.all([
    db.from('servicios').select('nombre').eq('id', nuevo.servicio_id).maybeSingle(),
    db.from('barberias').select('zona_horaria').eq('id', nuevo.barberia_id).maybeSingle(),
    nuevo.cliente_id ? db.from('clientes').select('nombre').eq('id', nuevo.cliente_id).maybeSingle() : Promise.resolve({ data: null })
  ]);
  const mensaje = armarMensaje({
    tipo, nuevo, viejo,
    servicio: serv.data?.nombre ?? 'Turno',
    nombre: cli.data?.nombre ?? nuevo.nombre_manual ?? 'Cliente',
    zona: barb.data?.zona_horaria ?? 'America/Argentina/Buenos_Aires'
  });
  if (!mensaje) return new Response('nada para avisar');

  const { data: subs } = await db.from('push_suscripciones').select('id, endpoint, p256dh, auth').eq('barberia_id', nuevo.barberia_id);
  const muertas: string[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(mensaje));
    } catch (e) {
      // 404/410: el dispositivo ya no existe (desinstalaron o revocaron): se limpia la fila.
      if (e.statusCode === 404 || e.statusCode === 410) muertas.push(s.id);
    }
  }));
  if (muertas.length) await db.from('push_suscripciones').delete().in('id', muertas);
  return new Response('ok');
});
