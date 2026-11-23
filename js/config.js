// config.js — datos públicos de conexión a Supabase. La clave "publicable" está pensada para
// ir en el navegador: lo que protege los datos son las políticas RLS y los permisos de la
// base, no esconder la clave. NUNCA poner acá la clave de servicio (service_role).
// Se completa con los valores reales al publicar (Task 12).
const Config = {
  url: '<SUPABASE_URL>',
  clavePublica: '<PUBLISHABLE_KEY>',
  // Clave PÚBLICA VAPID de las notificaciones push (la privada vive solo como secreto de la función).
  clavePublicaVapid: '<VAPID_PUBLICA>'
};

if (typeof module !== 'undefined') module.exports = Config;
