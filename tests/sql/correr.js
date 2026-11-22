#!/usr/bin/env node
/*
 * Banco de pruebas SQL. Sin paquetes npm: usa initdb / pg_ctl / psql de Postgres 16.
 *
 * 1. Crea un cluster temporal (initdb) y lo levanta en un puerto libre.
 * 2. Arma una base "plantilla": stub_supabase.sql + cada migración en orden
 *    (salvo las que terminan en _remoto.sql, que solo valen en el Supabase real).
 * 3. Cada prueba (tests/sql/*.test.sql y *.test.js, en orden de nombre) corre en su
 *    PROPIA base, clonada de la plantilla. Así ninguna deja datos para la siguiente
 *    y las pruebas JS pueden hacer commit libremente.
 * 4. Apaga y borra el cluster. Sale 0 si pasó todo, 1 si algo falló.
 *
 * Uso: node tests/sql/correr.js [--solo <archivo>]
 *
 * Las pruebas .sql son scripts con bloques DO $$ ... $$ y ASSERT (psql con ON_ERROR_STOP).
 * Las pruebas .js exportan `async function (sql)`; sql(texto, params) devuelve las filas
 * (array de objetos) y las pruebas tiran una excepción si algo falla.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..');
const BIN = process.env.PG_BIN || '/usr/lib/postgresql/16/bin';
const ES_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

// initdb y postgres se niegan a correr como root: en ese caso (contenedores) se
// ejecuta todo como el usuario "postgres". Los archivos se pasan por stdin para no
// depender de que ese usuario pueda leer el repo.
function ejecutar(cmd, args, opciones) {
  opciones = opciones || {};
  let c = cmd, a = args;
  if (ES_ROOT) { c = 'runuser'; a = ['-u', 'postgres', '--', cmd].concat(args); }
  return spawnSync(c, a, { encoding: 'utf8', input: opciones.input, maxBuffer: 64 * 1024 * 1024 });
}

function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const s = net.createServer();
    s.on('error', rechazar);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolver(p)); });
  });
}

function leerArchivos(dir, filtro) {
  return fs.readdirSync(dir).filter(filtro).sort().map((n) => path.join(dir, n));
}

// Texto de un valor SQL: se arma como literal escapado porque psql no tiene parámetros
// reales. Comillas simples duplicadas; standard_conforming_strings está en on.
function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return "'" + v.toISOString() + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function conParametros(texto, params) {
  if (!params || !params.length) return texto;
  return texto.replace(/\$(\d+)/g, (m, n) => {
    const i = Number(n) - 1;
    if (i >= params.length) throw new Error('falta el parámetro ' + m);
    return literal(params[i]);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const iSolo = args.indexOf('--solo');
  const solo = iSolo >= 0 ? path.basename(args[iSolo + 1] || '') : null;

  const dirPruebas = __dirname;
  const dirMigraciones = path.join(RAIZ, 'supabase', 'migrations');
  const migraciones = fs.existsSync(dirMigraciones)
    ? leerArchivos(dirMigraciones, (n) => n.endsWith('.sql') && !n.endsWith('_remoto.sql'))
    : [];
  let pruebas = leerArchivos(dirPruebas, (n) => /\.test\.(sql|js)$/.test(n));
  if (solo) {
    pruebas = pruebas.filter((p) => path.basename(p) === solo);
    if (!pruebas.length) { console.error('No existe la prueba ' + solo); return 1; }
  }

  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'barber-pg-'));
  if (ES_ROOT) {
    const r = spawnSync('chown', ['postgres', datos]);
    if (r.status !== 0) { console.error('No pude dar el directorio a postgres'); return 1; }
  }
  const puerto = await puertoLibre();
  const dirDatos = path.join(datos, 'data');
  let levantado = false;
  let fallas = 0;

  const psql = (base, sqlTexto, extra) =>
    ejecutar(path.join(BIN, 'psql'),
      ['-X', '-q', '-h', '127.0.0.1', '-p', String(puerto), '-U', 'postgres',
       '-v', 'ON_ERROR_STOP=1', '-d', base].concat(extra || []).concat(['-f', '-']),
      { input: sqlTexto });

  try {
    let r = ejecutar(path.join(BIN, 'initdb'),
      ['-D', dirDatos, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-sync']);
    if (r.status !== 0) { console.error('initdb falló:\n' + r.stderr); return 1; }

    // Sin fsync (más rápido, es descartable), solo TCP local y sin socket Unix.
    r = ejecutar(path.join(BIN, 'pg_ctl'),
      ['-D', dirDatos, '-w', '-l', path.join(datos, 'pg.log'),
       '-o', `-p ${puerto} -h 127.0.0.1 -k ${datos} -F`, 'start']);
    if (r.status !== 0) {
      console.error('pg_ctl start falló:\n' + r.stderr + r.stdout);
      return 1;
    }
    levantado = true;

    // Plantilla: stub de Supabase + migraciones.
    r = ejecutar(path.join(BIN, 'createdb'),
      ['-h', '127.0.0.1', '-p', String(puerto), '-U', 'postgres', 'plantilla']);
    if (r.status !== 0) { console.error('createdb falló:\n' + r.stderr); return 1; }
    const preparacion = [path.join(dirPruebas, 'stub_supabase.sql')].concat(migraciones);
    for (const f of preparacion) {
      r = psql('plantilla', fs.readFileSync(f, 'utf8'));
      if (r.status !== 0) {
        console.error('Falló al aplicar ' + path.relative(RAIZ, f) + ':\n' + r.stderr);
        return 1;
      }
    }
    // Se desconecta todo de la plantilla para poder clonarla (CREATE DATABASE lo exige).
    ejecutar(path.join(BIN, 'psql'), ['-X', '-q', '-h', '127.0.0.1', '-p', String(puerto),
      '-U', 'postgres', '-d', 'postgres', '-c',
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'plantilla'"]);

    let n = 0;
    for (const archivo of pruebas) {
      const nombre = path.basename(archivo);
      const base = 'prueba_' + (++n);
      r = psql('postgres', `create database ${base} template plantilla`);
      if (r.status !== 0) { console.error('No pude clonar la base:\n' + r.stderr); fallas++; continue; }

      let error = null;
      if (nombre.endsWith('.sql')) {
        const res = psql(base, fs.readFileSync(archivo, 'utf8'));
        if (res.status !== 0) error = res.stderr.trim();
      } else {
        // Función sql(texto, params) -> filas. Los SELECT/WITH/VALUES se envuelven en
        // json_agg para recibir objetos; el resto (insert, set, etc.) devuelve [].
        const sql = (texto, params) => {
          const t = conParametros(texto, params).trim().replace(/;+\s*$/, '');
          const esConsulta = /^(select|with|values|table)\b/i.test(t);
          const q = esConsulta ? `select coalesce(json_agg(t), '[]'::json) from (${t}) t` : t;
          const res = ejecutar(path.join(BIN, 'psql'),
            ['-X', '-q', '-A', '-t', '-h', '127.0.0.1', '-p', String(puerto), '-U', 'postgres',
             '-v', 'ON_ERROR_STOP=1', '-d', base, '-f', '-'], { input: q + ';' });
          if (res.status !== 0) throw new Error(res.stderr.trim());
          return esConsulta ? JSON.parse(res.stdout.trim() || '[]') : [];
        };
        try {
          const prueba = require(archivo);
          await prueba(sql);
        } catch (e) {
          error = e && e.stack ? e.stack : String(e);
        }
      }
      if (error) { fallas++; console.log(nombre + ' FALLA\n' + error); }
      else console.log(nombre + ' ok');
    }
  } finally {
    if (levantado) ejecutar(path.join(BIN, 'pg_ctl'), ['-D', dirDatos, '-m', 'immediate', '-w', 'stop']);
    fs.rmSync(datos, { recursive: true, force: true });
  }
  console.log(fallas ? `\n${fallas} prueba(s) con fallas` : '\nTodas las pruebas SQL pasaron');
  return fallas ? 1 : 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
