// config.js — datos públicos de conexión a Supabase. La clave "publicable" está pensada para
// ir en el navegador: lo que protege los datos son las políticas RLS y los permisos de la
// base, no esconder la clave. NUNCA poner acá la clave de servicio (service_role).
// Se completa con los valores reales al publicar (Task 12).
const Config = {
  url: '<SUPABASE_URL>',
  // La clave pública VAPID ya no está acá: la genera el servidor y se pide con Api.vapidPublica().
  clavePublica: '<PUBLISHABLE_KEY>'
};

if (typeof module !== 'undefined') module.exports = Config;
