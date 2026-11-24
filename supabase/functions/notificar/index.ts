// notificar — Edge Function de Supabase (Deno). La llama el trigger app.avisar_turno con
// {tipo, nuevo, viejo} y manda una push a todos los dispositivos de la barbería.
// Configuración: no hay secretos de Edge Function (pegar la clave privada VAPID en un chat o
// panel era el problema). La función los lee de app.ajustes_privados con la RPC
// ajustes_notificar(), que solo ejecuta service_role (migración 2026112208). Se guarda en
// memoria 5 minutos para no ir a la base en cada push. SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { armarMensaje } from './mensaje.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const VIGENCIA_MS = 5 * 60 * 1000;
let config: { secreto: string; vapid_publica: string; vapid_privada: string; vapid_contacto: string } | null = null;
let cargadaEn = 0;

// Devuelve la configuración completa o null si no se pudo cargar o falta algún campo.
// Si falla no se usa una copia vencida: ante la duda, se rechaza (falla cerrada).
async function cargarConfig() {
  if (config && Date.now() - cargadaEn < VIGENCIA_MS) return config;
  config = null;
  const { data, error } = await db.rpc('ajustes_notificar');
  if (error) { console.error('ajustes_notificar', error); return null; }
  const faltan = ['secreto', 'vapid_publica', 'vapid_privada', 'vapid_contacto'].filter((k) => !data?.[k]);
  if (faltan.length) { console.error('ajustes_notificar: faltan', faltan.join(', ')); return null; }
  // Se registra una vez por carga, no por pedido.
  webpush.setVapidDetails(data.vapid_contacto, data.vapid_publica, data.vapid_privada);
  config = data;
  cargadaEn = Date.now();
  return config;
}

Deno.serve(async (req) => {
  // La función es pública en internet: solo el trigger conoce el secreto. Si la configuración
  // no se puede cargar, nunca se acepta el pedido (500, no 200): no hay con qué comparar.
  const cfg = await cargarConfig();
  if (!cfg) return new Response('configuración no disponible', { status: 500 });
  if (req.headers.get('x-notificar-secreto') !== cfg.secreto) {
    return new Response('no autorizado', { status: 401 });
  }
  let cuerpo;
  try { cuerpo = await req.json(); } catch (_) { return new Response('json inválido', { status: 400 }); }
  const { tipo, nuevo: aviso, viejo } = cuerpo ?? {};
  if (!aviso?.id) return new Response('sin turno', { status: 400 });

  // No se confía en el payload: se relee el turno con la clave de servicio. Del payload
  // solo se usa la transición (tipo y estado anterior).
  const { data: nuevo, error: errTurno } = await db.from('turnos')
    .select('estado, origen, barberia_id, servicio_id, cliente_id, nombre_manual, inicio').eq('id', aviso.id).maybeSingle();
  if (errTurno) { console.error('turno', errTurno); return new Response('error', { status: 500 }); }
  if (!nuevo) return new Response('turno inexistente'); // 200: nada para avisar

  const [serv, barb, cli] = await Promise.all([
    db.from('servicios').select('nombre').eq('id', nuevo.servicio_id).maybeSingle(),
    db.from('barberias').select('zona_horaria').eq('id', nuevo.barberia_id).maybeSingle(),
    nuevo.cliente_id ? db.from('clientes').select('nombre').eq('id', nuevo.cliente_id).maybeSingle() : Promise.resolve({ data: null, error: null })
  ]);
  for (const r of [serv, barb, cli]) if (r.error) console.error('datos del aviso', r.error);
  const mensaje = armarMensaje({
    tipo, nuevo, viejo,
    servicio: serv.data?.nombre ?? 'Turno',
    nombre: cli.data?.nombre ?? nuevo.nombre_manual ?? 'Cliente',
    zona: barb.data?.zona_horaria ?? 'America/Argentina/Buenos_Aires'
  });
  if (!mensaje) return new Response('nada para avisar');

  const { data: subs, error: errSubs } = await db.from('push_suscripciones').select('id, endpoint, p256dh, auth').eq('barberia_id', nuevo.barberia_id);
  if (errSubs) { console.error('suscripciones', errSubs); return new Response('error', { status: 500 }); }
  const muertas: string[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(mensaje));
    } catch (e) {
      // 404/410: el dispositivo ya no existe (desinstalaron o revocaron): se limpia la fila.
      if (e.statusCode === 404 || e.statusCode === 410) muertas.push(s.id);
      else console.error('push falló', s.endpoint, e.statusCode, e.message);
    }
  }));
  if (muertas.length) {
    const { error } = await db.from('push_suscripciones').delete().in('id', muertas);
    if (error) console.error('limpieza de suscripciones', error);
  }
  return new Response('ok');
});
