// config.js — datos públicos de conexión a Supabase. La clave "publicable" está pensada para
// ir en el navegador: lo que protege los datos son las políticas RLS y los permisos de la
// base, no esconder la clave. NUNCA poner acá la clave de servicio (service_role).
const Config = {
  url: 'https://jrfhjjesnhgogbjmxkid.supabase.co',
  // La clave pública VAPID ya no está acá: la genera el servidor y se pide con Api.vapidPublica().
  clavePublica: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyZmhqamVzbmhnb2diam14a2lkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU0NzQ5NzcsImV4cCI6MjExMTA1MDk3N30.3mWdd4G2OQng_2yhxmqRzfXcZCvqwQjhWCnyHKpFgbw'
};

if (typeof module !== 'undefined') module.exports = Config;
