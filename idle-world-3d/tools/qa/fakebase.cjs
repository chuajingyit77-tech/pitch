#!/usr/bin/env node
// A stand-in for the learning backend (Supabase), for tests that cannot or should not reach the real one: a fresh
// database on a local PostgreSQL 16 with backend/*.sql applied, behind a small HTTP server that answers the way
// Supabase's API (PostgREST) answers the calls the app and the admin page make: POST /rest/v1/rpc/<function>, run as
// the role `anon`, arguments checked against the function's own (an unknown or missing one is a 404, as there).
//
// Once per machine:  node idle-world-3d/tools/qa/fakebase.cjs --init   (a cluster in /var/lib/postgresql/qjtest, port 54329)
// Serve one:         node idle-world-3d/tools/qa/fakebase.cjs [--port 54330]   (prints its URL; Ctrl-C drops the database)
// From a test:       const fb = await require('./fakebase.cjs').start(); ... fb.url, await fb.sql('select ...'), await fb.stop()
// Env: QJ_PGPORT (54329), QJ_PGHOST (localhost).
const http = require('http'), fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const { Client } = require('pg');
const ROOT = path.resolve(__dirname, '..', '..');
const PGPORT = +(process.env.QJ_PGPORT || 54329), PGHOST = process.env.QJ_PGHOST || 'localhost';
const CLUSTER = '/var/lib/postgresql/qjtest';

// what a new Supabase project has that the migrations use
const STUB = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

function init() {
  const sh = s => execFileSync('su', ['postgres', '-s', '/bin/bash', '-c', s], { stdio: 'inherit' });
  if (!fs.existsSync(path.join(CLUSTER, 'data', 'PG_VERSION'))) {
    sh(`mkdir -p ${CLUSTER} && /usr/lib/postgresql/16/bin/initdb -D ${CLUSTER}/data -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >${CLUSTER}/initdb.log`);
  }
  try { execFileSync('pg_isready', ['-h', PGHOST, '-p', String(PGPORT)], { stdio: 'ignore' }); return; } catch (e) {}
  sh(`/usr/lib/postgresql/16/bin/pg_ctl -D ${CLUSTER}/data -o "-k ${CLUSTER} -p ${PGPORT} -c listen_addresses=localhost" -l ${CLUSTER}/pg.log -w start`);
}

async function start({ port = 0, seed = true, log = false } = {}) {
  const admin = new Client({ host: PGHOST, port: PGPORT, user: 'postgres', database: 'postgres' });
  await admin.connect();
  const db = `qj_test_${process.pid}_${Date.now() % 1e6}`;
  await admin.query(`create database ${db}`);
  const pool = [];
  const connect = async () => { const c = new Client({ host: PGHOST, port: PGPORT, user: 'postgres', database: db }); await c.connect(); return c; };
  const main = await connect();
  await main.query(STUB);
  const files = fs.readdirSync(path.join(ROOT, 'backend')).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    if (!seed && /seed/.test(f)) continue;
    await main.query(fs.readFileSync(path.join(ROOT, 'backend', f), 'utf8'));
  }
  const calls = [];
  // one call: arguments checked and typed as PostgREST does, run as anon in its own transaction
  async function rpc(fn, body) {
    const c = pool.pop() || await connect();
    try {
      const { rows } = await c.query(`select p.proargnames as names, p.pronargdefaults as ndef,
          array(select format_type(t, null) from unnest(p.proargtypes) t) as types
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]);
      if (rows.length !== 1) return [404, { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` }];
      const { names = [], ndef, types } = rows[0];
      const keys = Object.keys(body);
      const required = names.slice(0, names.length - ndef);
      if (keys.some(k => !names.includes(k)) || required.some(k => !keys.includes(k))) {
        return [404, { code: 'PGRST202', message: `Could not find the function public.${fn}(${keys.join(', ')}) in the schema cache` }];
      }
      const args = keys.map((k, i) => `"${k}" => $${i + 1}::${types[names.indexOf(k)]}`);
      const vals = keys.map(k => { const v = body[k]; return v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v); });
      await c.query('begin');
      try {
        await c.query('set local role anon');
        const r = await c.query(`select public."${fn}"(${args.join(', ')}) as r`, vals);
        await c.query('commit');
        return [200, r.rows[0].r];
      } catch (e) {
        await c.query('rollback');
        return [e.code === '42501' ? 401 : 400, { code: e.code, message: e.message, details: e.detail || null, hint: e.hint || null }];
      }
    } finally { pool.push(c); }
  }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'apikey, authorization, content-type, x-client-info, prefer, accept-profile, content-profile', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(200, cors); res.end(); return; }
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(req.url.split('?')[0]);
    const reply = (st, obj) => { res.writeHead(st, Object.assign({ 'content-type': 'application/json; charset=utf-8' }, cors)); res.end(JSON.stringify(obj)); };
    if (!req.headers.apikey) return reply(401, { message: 'No API key found in request' });
    if (!m || req.method !== 'POST') return reply(404, { message: 'not here' });
    let raw = '';
    req.on('data', d => raw += d);
    req.on('end', async () => {
      let body;
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) { return reply(400, { code: 'PGRST102', message: 'Empty or invalid json' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { code: 'PGRST102', message: 'Empty or invalid json' });
      const [st, out] = await rpc(m[1], body).catch(e => [500, { message: e.message }]);
      calls.push({ fn: m[1], status: st, ok: out && out.ok, error: out && out.error });
      if (log) console.log(m[1], st, JSON.stringify(out).slice(0, 160));
      reply(st, out);
    });
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, db, calls, rpc,
    // SQL as the database owner (setup and checks in tests)
    sql: async (q, v) => (await main.query(q, v)).rows,
    stop: async () => {
      await new Promise(r => server.close(r));
      for (const c of pool) await c.end();
      await main.end();
      await admin.query(`drop database if exists ${db} with (force)`);
      await admin.end();
    },
  };
}

module.exports = { start, init };

if (require.main === module) {
  const a = process.argv.slice(2);
  if (a.includes('--init')) { init(); console.log(`PostgreSQL 16 on ${PGHOST}:${PGPORT}`); process.exit(0); }
  const port = a.includes('--port') ? +a[a.indexOf('--port') + 1] : 54330;
  start({ port, log: true }).then(fb => {
    console.log(`fake backend ${fb.url} (database ${fb.db}); Ctrl-C to stop`);
    process.on('SIGINT', () => fb.stop().then(() => process.exit(0)));
  }).catch(e => { console.error(e.message); process.exit(1); });
}
