-- Esquema de datos de barber-turnos (spec §7.2).
-- Todas las tablas hijas llevan barberia_id además de barbero_id: así las políticas RLS
-- (otra migración) comparan una sola columna contra `miembros` sin joins.

create extension if not exists btree_gist;  -- para excluir turnos que se pisan por barbero
create extension if not exists pgcrypto;    -- gen_random_bytes para el token del turno

create schema if not exists app;

-- Reloj de la aplicación. En producción es now(); las pruebas lo fijan con
-- `set app.ahora = '...'` para que "dentro de 30 minutos" no dependa de cuándo se corre.
create or replace function app.ahora() returns timestamptz
language sql stable as $$
  select coalesce(nullif(current_setting('app.ahora', true), '')::timestamptz, now())
$$;

create table barberias (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  nombre text not null,
  direccion text,
  whatsapp text,
  zona_horaria text not null default 'America/Argentina/Buenos_Aires',
  codigo_area text not null default '11',
  plan text not null default 'gratis',
  cancelacion_horas int not null default 2,
  faltas_max int not null default 2,
  dias_adelante int not null default 21,
  anticipacion_min int not null default 30,
  paso_min int not null default 15,
  turnos_futuros_max int not null default 2,
  reservas_por_hora_ip int not null default 3,
  activa boolean not null default true,
  creado timestamptz not null default now()
);

create table barberos (
  id uuid primary key default gen_random_uuid(),
  barberia_id uuid not null references barberias(id) on delete cascade,
  nombre text not null,
  activo boolean not null default true
);

-- Quién del login (auth.users) administra qué barbería.
create table miembros (
  user_id uuid not null references auth.users(id) on delete cascade,
  barberia_id uuid not null references barberias(id) on delete cascade,
  rol text not null default 'dueno' check (rol in ('dueno')),
  primary key (user_id, barberia_id)
);

create table servicios (
  id uuid primary key default gen_random_uuid(),
  barberia_id uuid not null references barberias(id) on delete cascade,
  nombre text not null,
  duracion_min int not null check (duracion_min > 0),
  precio numeric(10,2),  -- informativo, no se cobra por la app
  activo boolean not null default true,
  orden int not null default 0
);

-- Varias franjas por día (ej. 9-13 y 16-20) = varias filas. 0 = domingo.
create table horarios (
  id uuid primary key default gen_random_uuid(),
  barberia_id uuid not null references barberias(id) on delete cascade,
  barbero_id uuid not null references barberos(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6),
  desde time not null,
  hasta time not null,
  check (hasta > desde)
);

create table bloqueos (
  id uuid primary key default gen_random_uuid(),
  barberia_id uuid not null references barberias(id) on delete cascade,
  barbero_id uuid not null references barberos(id) on delete cascade,
  inicio timestamptz not null,
  fin timestamptz not null,
  motivo text,
  check (fin > inicio)
);

-- Sin columnas faltas/bloqueado: se calculan a partir de los turnos `no_vino`,
-- así no hay un contador que se desincronice. desbloqueado_en reinicia la cuenta.
create table clientes (
  id uuid primary key default gen_random_uuid(),
  barberia_id uuid not null references barberias(id) on delete cascade,
  telefono text not null,
  nombre text not null,
  desbloqueado_en timestamptz,
  unique (barberia_id, telefono)
);

create table turnos (
  id uuid primary key default gen_random_uuid(),
  barberia_id uuid not null references barberias(id) on delete cascade,
  barbero_id uuid not null references barberos(id) on delete cascade,
  servicio_id uuid not null references servicios(id),
  cliente_id uuid references clientes(id),  -- null en turnos manuales sin WhatsApp
  nombre_manual text,                        -- nombre del cliente cuando no hay cliente_id
  inicio timestamptz not null,
  fin timestamptz not null,
  estado text not null default 'confirmado'
    check (estado in ('confirmado', 'cancelado', 'no_vino', 'atendido')),
  origen text not null check (origen in ('online', 'manual')),
  token text not null unique default encode(gen_random_bytes(18), 'hex'),
  ip_origen text,  -- para limitar reservas por hora y por IP
  creado timestamptz not null default now(),
  check (fin > inicio),
  -- La carrera de dos reservas simultáneas la resuelve Postgres, no el código.
  -- Solo cuentan los confirmados: cancelar libera el hueco.
  exclude using gist (barbero_id with =, tstzrange(inicio, fin) with &&)
    where (estado = 'confirmado')
);

create table push_suscripciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  barberia_id uuid not null references barberias(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null
);

-- Índices para las consultas de agenda y disponibilidad.
create index turnos_barbero_inicio on turnos (barbero_id, inicio);
create index turnos_cliente on turnos (cliente_id);
create index bloqueos_barbero_inicio on bloqueos (barbero_id, inicio);
create index horarios_barbero_dia on horarios (barbero_id, dia_semana);
