-- 栖境 · the learning backend (Supabase project `qijing-learning`)
--
-- What lives here: the guardians and their lessons (drafts made from the company's documents, reviewed and published by
-- an admin), the staff (name + 4-digit PIN), the screens allowed to show the lessons (a shared screen is registered once
-- with its own one-time code; staff phones and computers with a team code that several can use), and every employee's
-- learning record: progress, answers and badges.
--
-- How it is reached: the tables are in the schema `qj`, which the API does not expose at all. Screens and the admin page
-- call the functions in `public` below through PostgREST RPC, with the project's publishable key:
--   kiosk_*  a screen: its device token (given for a setup code or a team code), then an employee's session (name + PIN)
--   admin_*  the admin page: an admin's session (login + password; an admin account is made with a one-time invite)
-- Every function checks its token itself, runs as its owner with an empty search path, and answers
-- { ok: true, ... } or { ok: false, error: '<code>' }. Codes, tokens, PINs and passwords are stored only as hashes.

create schema if not exists qj;
revoke all on schema qj from public;

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */
create table qj.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  dept text not null default '' check (char_length(dept) <= 40),
  role text not null default '' check (char_length(role) <= 40),
  pin_hash text not null,
  active boolean not null default true,
  failed int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index employees_dept_name on qj.employees (dept, name);

-- a screen (the office iPad; a phone or computer of one's own): registered once with a code, then known by its token.
-- personal: registered with a team code, used by one person (signed in for 30 days, not signed out when idle)
create table qj.devices (
  id uuid primary key default gen_random_uuid(),
  label text not null default '' check (char_length(label) <= 40),
  personal boolean not null default false,
  setup_hash text unique,
  setup_expires_at timestamptz,
  token_hash text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  registered_at timestamptz,
  last_seen_at timestamptz
);

-- a team code: registers up to `uses_left` more phones or computers of the staff's own, until it expires
create table qj.join_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  label text not null default '' check (char_length(label) <= 40),
  uses_left int not null check (uses_left >= 0),
  used int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- an employee signed in on a screen (name + PIN): 12 hours on a shared screen, 30 days on a personal one, or until they
-- sign out
create table qj.sessions (
  token_hash text primary key,
  employee_id uuid not null references qj.employees(id) on delete cascade,
  device_id uuid not null references qj.devices(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_expires on qj.sessions (expires_at);

-- the animals that teach (id = the world's guardian id, e.g. scenes/koi.js 'heron'); lines: hello [{from,to,text}],
-- allDone, start, resume, later, bye, coming, returning, gift
create table qj.guardians (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{1,31}$'),
  world text not null,
  name text not null,
  title text not null default '',
  portrait text,
  lines jsonb not null default '{}'::jsonb,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);

-- steps: [{ say } | { ask, options: [{ text, ok?, reply? }] } | { card: { title, items: [[key, text]] } }]
create table qj.lessons (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  guardian_id text not null references qj.guardians(id),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version int not null default 1,
  title text not null default '',
  keys text not null default '',
  about text not null default '',
  minutes int not null default 3 check (minutes between 1 and 60),
  demo boolean not null default false,
  badge text,
  reward jsonb,
  steps jsonb not null default '[]'::jsonb,
  outro text not null default '',
  tags text[] not null default '{}',
  source jsonb,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

-- the learning record (学习档案). seconds: time spent on the runs that were finished (each counted up to two hours).
-- answers: first_try is the first answer to a question in a run, or in a wrong-answer review (review)
create table qj.progress (
  employee_id uuid not null references qj.employees(id) on delete cascade,
  lesson_id uuid not null references qj.lessons(id) on delete cascade,
  version int not null default 1,
  step int not null default 0,
  done boolean not null default false,
  stars int not null default 0 check (stars between 0 and 3),
  slips int not null default 0,
  runs int not null default 0,
  done_version int,
  first_done_at timestamptz,
  last_done_at timestamptz,
  started_at timestamptz,
  seconds int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (employee_id, lesson_id)
);
create table qj.answers (
  id bigint generated always as identity primary key,
  employee_id uuid not null references qj.employees(id) on delete cascade,
  lesson_id uuid not null references qj.lessons(id) on delete cascade,
  version int not null,
  step int not null,
  choice int not null,
  correct boolean not null,
  first_try boolean not null,
  review boolean not null default false,
  device_id uuid references qj.devices(id) on delete set null,
  at timestamptz not null default now()
);
create index answers_lesson on qj.answers (lesson_id, version, step);
create index answers_employee on qj.answers (employee_id, at);
create table qj.badges (
  employee_id uuid not null references qj.employees(id) on delete cascade,
  badge text not null,
  lesson_id uuid references qj.lessons(id) on delete set null,
  at timestamptz not null default now(),
  primary key (employee_id, badge)
);

-- documents a lesson draft was made from (e.g. a Google Drive file)
create table qj.sources (
  id text primary key,
  name text not null,
  url text,
  mime text,
  modified_at timestamptz,
  processed_at timestamptz,
  lesson_id uuid references qj.lessons(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'drafted', 'skipped', 'error')),
  note text
);

create table qj.admins (
  id uuid primary key default gen_random_uuid(),
  login text not null unique check (login ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  pw_hash text not null,
  active boolean not null default true,
  failed int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create table qj.admin_sessions (
  token_hash text primary key,
  admin_id uuid not null references qj.admins(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table qj.admin_invites (
  code_hash text primary key,
  note text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references qj.admins(id) on delete set null
);
-- failed code and password attempts, for throttling
create table qj.failures (
  id bigint generated always as identity primary key,
  kind text not null,
  at timestamptz not null default now()
);
create index failures_kind_at on qj.failures (kind, at);

-- defence in depth: row level security on and no policies, so nothing but the functions below (run as the tables'
-- owner) reads or writes a row, whatever grants the API roles might be given
alter table qj.employees enable row level security;
alter table qj.devices enable row level security;
alter table qj.join_codes enable row level security;
alter table qj.sessions enable row level security;
alter table qj.guardians enable row level security;
alter table qj.lessons enable row level security;
alter table qj.progress enable row level security;
alter table qj.answers enable row level security;
alter table qj.badges enable row level security;
alter table qj.sources enable row level security;
alter table qj.admins enable row level security;
alter table qj.admin_sessions enable row level security;
alter table qj.admin_invites enable row level security;
alter table qj.failures enable row level security;

/* ------------------------------------------------------------------ */
/* Helpers (schema qj: not callable through the API)                   */
/* ------------------------------------------------------------------ */
create function qj.h(t text) returns text language sql immutable strict set search_path = ''
as $$ select encode(extensions.digest(convert_to(t, 'UTF8'), 'sha256'), 'hex') $$;

create function qj.new_token() returns text language sql volatile set search_path = ''
as $$ select encode(extensions.gen_random_bytes(24), 'hex') $$;

-- a one-time code people type: 8 characters from 31 letters and digits that cannot be mistaken for one another (no 0/O,
-- 1/I/L), shown as XXXX-XXXX (31^8: about 850 billion)
create function qj.new_code() returns text language plpgsql volatile set search_path = '' as $$
declare
  a constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  s text := '';
  v int;
begin
  while char_length(s) < 8 loop
    v := get_byte(extensions.gen_random_bytes(1), 0);
    if v < 248 then s := s || substr(a, (v % 31) + 1, 1); end if; -- (248 = 8 x 31: no letter favoured)
  end loop;
  return substr(s, 1, 4) || '-' || substr(s, 5, 4);
end $$;
create function qj.norm_code(c text) returns text language sql immutable set search_path = ''
as $$ select upper(regexp_replace(coalesce(c, ''), '[^0-9A-Za-z]', '', 'g')) $$;

create function qj.throttled(k text, lim int, win interval) returns boolean language sql stable set search_path = ''
as $$ select count(*) >= lim from qj.failures f where f.kind = k and f.at > now() - win $$;
create function qj.fail(k text) returns void language sql volatile set search_path = ''
as $$ delete from qj.failures where at < now() - interval '1 day'; insert into qj.failures (kind) values (k) $$;

-- the screen behind a device token (and a note that it was seen), or null
create function qj.device(tok text) returns uuid language plpgsql volatile set search_path = '' as $$
declare r uuid;
begin
  if tok is null or char_length(tok) < 20 then return null; end if;
  select d.id into r from qj.devices d where d.token_hash = qj.h(tok) and d.active;
  if r is not null then
    update qj.devices d set last_seen_at = now() where d.id = r and (d.last_seen_at is null or d.last_seen_at < now() - interval '1 minute');
  end if;
  return r;
end $$;
-- the employee signed in with this session on this screen (grace: how long after it ended it still counts)
create function qj.session(dev uuid, tok text, grace interval default interval '0 seconds') returns uuid language sql stable set search_path = ''
as $$
  select s.employee_id from qj.sessions s join qj.employees e on e.id = s.employee_id
  where tok is not null and s.token_hash = qj.h(tok) and s.device_id = dev and s.expires_at > now() - grace and e.active
$$;
create function qj.admin(tok text) returns uuid language sql stable set search_path = ''
as $$
  select s.admin_id from qj.admin_sessions s join qj.admins a on a.id = s.admin_id
  where tok is not null and char_length(tok) >= 20 and s.token_hash = qj.h(tok) and s.expires_at > now() and a.active
$$;

create function qj.guardian_json(g qj.guardians) returns jsonb language sql stable set search_path = ''
as $$ select jsonb_build_object('id', g.id, 'world', g.world, 'name', g.name, 'title', g.title, 'portrait', g.portrait, 'lines', g.lines, 'sort', g.sort) $$;
create function qj.lesson_json(l qj.lessons) returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object('id', l.id, 'slug', l.slug, 'guardian', l.guardian_id, 'version', l.version, 'title', l.title,
    'keys', l.keys, 'about', l.about, 'minutes', l.minutes, 'demo', l.demo, 'badge', l.badge, 'reward', l.reward,
    'steps', l.steps, 'outro', l.outro, 'tags', to_jsonb(l.tags), 'sort', l.sort)
$$;

-- an employee's learning record: progress per lesson, badges, and the questions they got wrong the first time and have
-- not answered right first time since (in the lesson as it is now)
create function qj.archive(emp uuid) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'employee', (select jsonb_build_object('id', e.id, 'name', e.name, 'dept', e.dept, 'role', e.role) from qj.employees e where e.id = emp),
    'progress', coalesce((
      select jsonb_object_agg(p.lesson_id::text, jsonb_build_object('version', p.version, 'step', p.step, 'done', p.done,
        'stars', p.stars, 'slips', p.slips, 'runs', p.runs, 'doneVersion', p.done_version, 'firstDone', p.first_done_at,
        'seconds', p.seconds, 'at', p.updated_at))
      from qj.progress p where p.employee_id = emp), '{}'::jsonb),
    'badges', coalesce((select jsonb_agg(b.badge order by b.at) from qj.badges b where b.employee_id = emp), '[]'::jsonb),
    'misses', coalesce((
      select jsonb_agg(jsonb_build_object('lesson', m.lesson_id, 'step', m.step, 'choice', m.choice, 'at', m.at) order by m.at desc)
      from (select distinct on (a.lesson_id, a.step) a.lesson_id, a.version, a.step, a.choice, a.correct, a.at
            from qj.answers a where a.employee_id = emp and a.first_try order by a.lesson_id, a.step, a.at desc) m
      join qj.lessons l on l.id = m.lesson_id and l.version = m.version and l.status = 'published'
      where not m.correct), '[]'::jsonb))
$$;

-- what is wrong with a lesson before it may be published (in Chinese: the admin page shows these as they are)
create function qj.lesson_problems(l qj.lessons) returns text[] language plpgsql stable set search_path = '' as $$
declare
  p text[] := '{}';
  s jsonb; o jsonb;
  i int := 0; nok int; k int;
begin
  if btrim(l.title) = '' then p := p || '缺少课名'::text; end if;
  if jsonb_typeof(l.steps) is distinct from 'array' or jsonb_array_length(l.steps) = 0 then return p || '还没有内容'::text; end if;
  for s in select x from jsonb_array_elements(l.steps) t(x) loop
    i := i + 1;
    if jsonb_typeof(s) <> 'object' then p := p || format('第 %s 步：格式不对', i); continue; end if;
    k := (s ? 'say')::int + (s ? 'ask')::int + (s ? 'card')::int;
    if k <> 1 then p := p || format('第 %s 步：格式不对', i); continue; end if;
    if s ? 'say' then
      if jsonb_typeof(s->'say') <> 'string' or btrim(s->>'say') = '' then p := p || format('第 %s 步：这句话是空的', i); end if;
    elsif s ? 'ask' then
      if jsonb_typeof(s->'ask') <> 'string' or btrim(s->>'ask') = '' then p := p || format('第 %s 步：题目是空的', i); end if;
      if jsonb_typeof(s->'options') is distinct from 'array' or jsonb_array_length(s->'options') not between 2 and 4 then
        p := p || format('第 %s 步：要有 2 到 4 个选项', i);
      else
        nok := 0;
        for o in select x from jsonb_array_elements(s->'options') t(x) loop
          if jsonb_typeof(o) <> 'object' or coalesce(btrim(o->>'text'), '') = '' then p := p || format('第 %s 步：有空的选项', i); end if;
          if o->'ok' = 'true'::jsonb then nok := nok + 1; end if;
        end loop;
        if nok <> 1 then p := p || format('第 %s 步：正确答案要正好一个', i); end if;
      end if;
    else
      if jsonb_typeof(s->'card') is distinct from 'object' or jsonb_typeof(s->'card'->'items') is distinct from 'array'
         or jsonb_array_length(s->'card'->'items') = 0 then
        p := p || format('第 %s 步：要点卡没有内容', i);
      end if;
    end if;
  end loop;
  return p;
end $$;

-- a lesson draft from a document (used by the drafting job; also from SQL by hand)
create function qj.import_draft(lesson jsonb, src jsonb default null) returns uuid language plpgsql volatile set search_path = '' as $$
declare lid uuid;
begin
  insert into qj.lessons (guardian_id, status, title, keys, about, minutes, badge, reward, steps, outro, tags, source, sort)
  values (coalesce(lesson->>'guardian', 'heron'), 'draft', coalesce(lesson->>'title', ''), coalesce(lesson->>'keys', ''),
    coalesce(lesson->>'about', ''), coalesce((lesson->>'minutes')::int, 3), nullif(lesson->>'badge', ''), lesson->'reward',
    coalesce(lesson->'steps', '[]'::jsonb), coalesce(lesson->>'outro', ''),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(lesson->'tags', '[]'::jsonb)) t(x)), '{}'), src,
    coalesce((lesson->>'sort')::int, 100))
  returning id into lid;
  if src is not null and src ? 'id' then
    insert into qj.sources (id, name, url, mime, modified_at, processed_at, lesson_id, status)
    values (src->>'id', coalesce(src->>'name', ''), src->>'url', src->>'mime', (src->>'modified')::timestamptz, now(), lid, 'drafted')
    on conflict (id) do update set name = excluded.name, url = excluded.url, mime = excluded.mime, modified_at = excluded.modified_at,
      processed_at = excluded.processed_at, lesson_id = excluded.lesson_id, status = 'drafted', note = null;
  end if;
  return lid;
end $$;

-- a one-time invite for a new admin account (seven days)
create function qj.new_invite(note text default '') returns text language plpgsql volatile set search_path = '' as $$
declare c text := qj.new_code();
begin
  insert into qj.admin_invites (code_hash, note, expires_at) values (qj.h(qj.norm_code(c)), coalesce(note, ''), now() + interval '7 days');
  return c;
end $$;

/* ------------------------------------------------------------------ */
/* Screens                                                             */
/* ------------------------------------------------------------------ */
-- register a screen with the setup code an admin made for it, or a phone or computer with a team code; the answer's
-- token is all it needs from then on
create function public.kiosk_register(setup_code text, device_label text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d qj.devices;
  j qj.join_codes;
  tok text;
  hc text := qj.h(qj.norm_code(setup_code));
  lbl text := left(btrim(coalesce(device_label, '')), 40);
begin
  if qj.throttled('register', 40, interval '10 minutes') then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  select * into d from qj.devices x where x.setup_hash = hc and x.setup_expires_at > now() and x.active for update;
  if not found then
    select * into j from qj.join_codes x where x.code_hash = hc and x.expires_at > now() and x.uses_left > 0 for update;
    if not found then
      perform qj.fail('register');
      return jsonb_build_object('ok', false, 'error', 'code');
    end if;
    update qj.join_codes x set uses_left = x.uses_left - 1, used = x.used + 1 where x.id = j.id;
    insert into qj.devices (label, personal) values (left(coalesce(nullif(lbl, ''), nullif(j.label, ''), '个人设备') || ' ' || (j.used + 1), 40), true)
    returning * into d;
    lbl := '';
  end if;
  tok := qj.new_token();
  update qj.devices x set token_hash = qj.h(tok), setup_hash = null, setup_expires_at = null, registered_at = now(), last_seen_at = now(),
    label = case when lbl <> '' then lbl else x.label end
  where x.id = d.id
  returning * into d;
  return jsonb_build_object('ok', true, 'token', tok, 'device', jsonb_build_object('id', d.id, 'label', d.label, 'personal', d.personal));
end $$;

-- everything a screen shows: the guardians, the published lessons and the names of the staff who can sign in
create function public.kiosk_bootstrap(device_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare dev uuid := qj.device(device_token);
begin
  if dev is null then return jsonb_build_object('ok', false, 'error', 'device'); end if;
  return jsonb_build_object('ok', true, 'at', now(),
    'device', (select jsonb_build_object('id', d.id, 'label', d.label, 'personal', d.personal) from qj.devices d where d.id = dev),
    'guardians', coalesce((select jsonb_agg(qj.guardian_json(g) order by g.sort, g.id) from qj.guardians g), '[]'::jsonb),
    'lessons', coalesce((select jsonb_agg(qj.lesson_json(l) order by l.sort, l.published_at, l.created_at) from qj.lessons l where l.status = 'published'), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'dept', e.dept) order by e.dept, e.name) from qj.employees e where e.active), '[]'::jsonb));
end $$;

-- sign in with name + PIN: five wrong PINs in a row lock the name for 15 minutes, and thirty wrong PINs on one screen
-- in ten minutes stop that screen trying for a while
create function public.kiosk_login(device_token text, employee uuid, pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  dev uuid := qj.device(device_token);
  e qj.employees;
  tok text;
  n int;
begin
  if dev is null then return jsonb_build_object('ok', false, 'error', 'device'); end if;
  if qj.throttled('pin:' || dev::text, 30, interval '10 minutes') then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  select * into e from qj.employees x where x.id = employee and x.active for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'who'); end if;
  if e.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'wait', ceil(extract(epoch from e.locked_until - now()))::int);
  end if;
  if coalesce(pin, '') !~ '^[0-9]{4}$' or extensions.crypt(pin, e.pin_hash) <> e.pin_hash then
    perform qj.fail('pin:' || dev::text);
    n := e.failed + 1;
    if n >= 5 then
      update qj.employees x set failed = 0, locked_until = now() + interval '15 minutes' where x.id = e.id;
      return jsonb_build_object('ok', false, 'error', 'locked', 'wait', 900);
    end if;
    update qj.employees x set failed = n where x.id = e.id;
    return jsonb_build_object('ok', false, 'error', 'pin', 'left', 5 - n);
  end if;
  update qj.employees x set failed = 0, locked_until = null, last_login_at = now() where x.id = e.id;
  delete from qj.sessions s where s.expires_at < now() - interval '8 days';
  delete from qj.join_codes j where j.expires_at < now() - interval '30 days';
  tok := qj.new_token();
  insert into qj.sessions (token_hash, employee_id, device_id, expires_at)
  values (qj.h(tok), e.id, dev, now() + case when (select d.personal from qj.devices d where d.id = dev) then interval '30 days' else interval '12 hours' end);
  return jsonb_build_object('ok', true, 'session', tok, 'archive', qj.archive(e.id));
end $$;

create function public.kiosk_archive(device_token text, session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare dev uuid := qj.device(device_token); emp uuid;
begin
  if dev is null then return jsonb_build_object('ok', false, 'error', 'device'); end if;
  emp := qj.session(dev, session_token);
  if emp is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  return jsonb_build_object('ok', true, 'archive', qj.archive(emp));
end $$;

-- what happened in a lesson, in order (sent as it happens, or later from a screen that was offline):
--   { type: 'start' | 'step' | 'answer' | 'done', lesson, version, at, step?, choice?, correct?, first?, review?, stars?, badge? }
-- (review: an answer given in the wrong-answer review, outside a run of the lesson)
-- A malformed event is skipped. Answers the updated learning record.
create function public.kiosk_record(device_token text, session_token text, events jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  dev uuid := qj.device(device_token);
  emp uuid;
  ev jsonb;
  lid uuid; lv int; lbadge text;
  ver int; at_ timestamptz;
  n int := 0;
begin
  if dev is null then return jsonb_build_object('ok', false, 'error', 'device'); end if;
  -- (events kept while a screen was offline may arrive after the session ended: up to a week later they still count)
  emp := qj.session(dev, session_token, interval '7 days');
  if emp is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  if jsonb_typeof(events) is distinct from 'array' or jsonb_array_length(events) > 500 then
    return jsonb_build_object('ok', false, 'error', 'events');
  end if;
  for ev in select x from jsonb_array_elements(events) t(x) loop
    begin
      lid := (ev->>'lesson')::uuid;
      select l.version, l.badge into lv, lbadge from qj.lessons l where l.id = lid;
      if not found then continue; end if;
      ver := coalesce((ev->>'version')::int, lv);
      at_ := least(now(), greatest(now() - interval '30 days', coalesce((ev->>'at')::timestamptz, now())));
      case ev->>'type'
        when 'start' then
          insert into qj.progress as p (employee_id, lesson_id, version, step, slips, started_at, updated_at) values (emp, lid, ver, 0, 0, at_, at_)
          on conflict (employee_id, lesson_id) do update set version = excluded.version, step = 0, slips = 0, started_at = excluded.started_at,
            updated_at = greatest(p.updated_at, excluded.updated_at);
        when 'step' then
          insert into qj.progress as p (employee_id, lesson_id, version, step, updated_at)
          values (emp, lid, ver, greatest(0, least(500, (ev->>'step')::int)), at_)
          on conflict (employee_id, lesson_id) do update set version = excluded.version, step = excluded.step,
            updated_at = greatest(p.updated_at, excluded.updated_at);
        when 'answer' then
          insert into qj.answers (employee_id, lesson_id, version, step, choice, correct, first_try, review, device_id, at)
          values (emp, lid, ver, (ev->>'step')::int, (ev->>'choice')::int, (ev->>'correct')::boolean, (ev->>'first')::boolean,
            coalesce((ev->>'review')::boolean, false), dev, at_);
          if (ev->>'first')::boolean and not (ev->>'correct')::boolean and not coalesce((ev->>'review')::boolean, false) then
            insert into qj.progress as p (employee_id, lesson_id, version, slips, updated_at) values (emp, lid, ver, 1, at_)
            on conflict (employee_id, lesson_id) do update set slips = p.slips + 1, updated_at = greatest(p.updated_at, excluded.updated_at);
          end if;
        when 'done' then
          insert into qj.progress as p (employee_id, lesson_id, version, step, done, stars, slips, runs, done_version, first_done_at, last_done_at, updated_at)
          values (emp, lid, ver, 0, true, greatest(0, least(3, coalesce((ev->>'stars')::int, 0))), 0, 1, ver, at_, at_, at_)
          on conflict (employee_id, lesson_id) do update set done = true, stars = greatest(p.stars, excluded.stars), step = 0, slips = 0,
            runs = p.runs + 1, version = excluded.version, done_version = excluded.done_version,
            first_done_at = coalesce(p.first_done_at, excluded.first_done_at), last_done_at = excluded.last_done_at,
            seconds = p.seconds + coalesce(least(7200, greatest(0, extract(epoch from excluded.last_done_at - p.started_at)))::int, 0),
            started_at = null, updated_at = greatest(p.updated_at, excluded.updated_at);
          -- (the badge is the lesson's own, whatever the screen sent)
          if coalesce((ev->>'badge')::boolean, false) and coalesce(btrim(lbadge), '') <> '' then
            insert into qj.badges (employee_id, badge, lesson_id, at) values (emp, lbadge, lid, at_) on conflict do nothing;
          end if;
        else
          continue;
      end case;
      n := n + 1;
    exception when others then
      null;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'n', n, 'archive', qj.archive(emp));
end $$;

-- sign out (the session ends now; events from it still arriving later are kept, see kiosk_record)
create function public.kiosk_logout(device_token text, session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare dev uuid := qj.device(device_token);
begin
  if dev is null then return jsonb_build_object('ok', false, 'error', 'device'); end if;
  update qj.sessions s set expires_at = least(s.expires_at, now()) where s.token_hash = qj.h(session_token) and s.device_id = dev;
  return jsonb_build_object('ok', true);
end $$;

/* ------------------------------------------------------------------ */
/* The admin page                                                      */
/* ------------------------------------------------------------------ */
create function qj.admin_json(aid uuid) returns jsonb language sql stable set search_path = ''
as $$ select jsonb_build_object('id', a.id, 'login', a.login, 'name', a.name) from qj.admins a where a.id = aid $$;

-- make an admin account with a one-time invite code
create function public.admin_claim(invite_code text, login_name text, password text, display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  inv qj.admin_invites;
  aid uuid;
  tok text;
  lg text := lower(btrim(coalesce(login_name, '')));
begin
  if qj.throttled('admin', 30, interval '10 minutes') then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  select * into inv from qj.admin_invites i where i.code_hash = qj.h(qj.norm_code(invite_code)) and i.used_at is null and i.expires_at > now() for update;
  if not found then
    perform qj.fail('admin');
    return jsonb_build_object('ok', false, 'error', 'code');
  end if;
  if lg !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  if char_length(coalesce(password, '')) < 8 then return jsonb_build_object('ok', false, 'error', 'password'); end if;
  if exists (select 1 from qj.admins a where a.login = lg) then return jsonb_build_object('ok', false, 'error', 'taken'); end if;
  insert into qj.admins (login, name, pw_hash)
  values (lg, coalesce(nullif(left(btrim(coalesce(display_name, '')), 40), ''), lg), extensions.crypt(password, extensions.gen_salt('bf', 10)))
  returning id into aid;
  update qj.admin_invites i set used_at = now(), used_by = aid where i.code_hash = inv.code_hash;
  tok := qj.new_token();
  insert into qj.admin_sessions (token_hash, admin_id, expires_at) values (qj.h(tok), aid, now() + interval '12 hours');
  return jsonb_build_object('ok', true, 'session', tok, 'admin', qj.admin_json(aid));
end $$;

-- five wrong passwords in a row lock the account for 15 minutes
create function public.admin_login(login_name text, password text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  a qj.admins;
  tok text;
  n int;
begin
  if qj.throttled('admin', 30, interval '10 minutes') then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  select * into a from qj.admins x where x.login = lower(btrim(coalesce(login_name, ''))) and x.active for update;
  if not found then
    perform qj.fail('admin');
    return jsonb_build_object('ok', false, 'error', 'login');
  end if;
  if a.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'wait', ceil(extract(epoch from a.locked_until - now()))::int);
  end if;
  if extensions.crypt(coalesce(password, ''), a.pw_hash) <> a.pw_hash then
    perform qj.fail('admin');
    n := a.failed + 1;
    if n >= 5 then
      update qj.admins x set failed = 0, locked_until = now() + interval '15 minutes' where x.id = a.id;
      return jsonb_build_object('ok', false, 'error', 'locked', 'wait', 900);
    end if;
    update qj.admins x set failed = n where x.id = a.id;
    return jsonb_build_object('ok', false, 'error', 'login');
  end if;
  update qj.admins x set failed = 0, locked_until = null, last_login_at = now() where x.id = a.id;
  delete from qj.admin_sessions s where s.expires_at < now();
  tok := qj.new_token();
  insert into qj.admin_sessions (token_hash, admin_id, expires_at) values (qj.h(tok), a.id, now() + interval '12 hours');
  return jsonb_build_object('ok', true, 'session', tok, 'admin', qj.admin_json(a.id));
end $$;

create function public.admin_logout(token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  delete from qj.admin_sessions s where s.token_hash = qj.h(coalesce(token, ''));
  return jsonb_build_object('ok', true);
end $$;

create function public.admin_password(token text, old_password text, new_password text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare aid uuid := qj.admin(token); a qj.admins;
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  select * into a from qj.admins x where x.id = aid;
  if extensions.crypt(coalesce(old_password, ''), a.pw_hash) <> a.pw_hash then return jsonb_build_object('ok', false, 'error', 'old'); end if;
  if char_length(coalesce(new_password, '')) < 8 then return jsonb_build_object('ok', false, 'error', 'password'); end if;
  update qj.admins x set pw_hash = extensions.crypt(new_password, extensions.gen_salt('bf', 10)) where x.id = aid;
  return jsonb_build_object('ok', true);
end $$;

create function public.admin_new_invite(token text, note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare aid uuid := qj.admin(token);
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  return jsonb_build_object('ok', true, 'code', qj.new_invite(note));
end $$;

-- everything the admin page shows, with the learning figures worked out
create function public.admin_state(token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare aid uuid := qj.admin(token);
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  return jsonb_build_object('ok', true, 'at', now(), 'admin', qj.admin_json(aid),
    'guardians', coalesce((select jsonb_agg(qj.guardian_json(g) order by g.sort, g.id) from qj.guardians g), '[]'::jsonb),
    'lessons', coalesce((
      select jsonb_agg(qj.lesson_json(l) || jsonb_build_object('status', l.status, 'source', l.source, 'createdAt', l.created_at,
          'updatedAt', l.updated_at, 'publishedAt', l.published_at, 'problems', to_jsonb(qj.lesson_problems(l)),
          'started', (select count(*) from qj.progress p where p.lesson_id = l.id),
          'finished', (select count(*) from qj.progress p where p.lesson_id = l.id and p.done),
          'avgStars', (select round(avg(p.stars), 1) from qj.progress p where p.lesson_id = l.id and p.done),
          'avgSeconds', (select round(avg(p.seconds::numeric / p.runs)) from qj.progress p where p.lesson_id = l.id and p.done and p.runs > 0 and p.seconds > 0))
        order by l.status = 'archived', l.sort, l.created_at)
      from qj.lessons l), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'dept', e.dept, 'role', e.role, 'active', e.active,
          'locked', coalesce(e.locked_until > now(), false), 'lastLogin', e.last_login_at, 'createdAt', e.created_at,
          'finished', (select count(*) from qj.progress p join qj.lessons l on l.id = p.lesson_id where p.employee_id = e.id and p.done and l.status = 'published'),
          'stars', (select coalesce(sum(p.stars), 0) from qj.progress p where p.employee_id = e.id and p.done),
          'badges', (select count(*) from qj.badges b where b.employee_id = e.id),
          'answered', (select count(*) from qj.answers a where a.employee_id = e.id and a.first_try and not a.review),
          'right', (select count(*) from qj.answers a where a.employee_id = e.id and a.first_try and not a.review and a.correct),
          'seconds', (select coalesce(sum(p.seconds), 0) from qj.progress p where p.employee_id = e.id),
          'lastActive', (select max(p.updated_at) from qj.progress p where p.employee_id = e.id))
        order by e.active desc, e.dept, e.name)
      from qj.employees e), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'personal', d.personal, 'active', d.active, 'registered', d.token_hash is not null,
          'pending', d.setup_hash is not null and d.setup_expires_at > now(), 'codeExpires', d.setup_expires_at,
          'registeredAt', d.registered_at, 'lastSeen', d.last_seen_at, 'createdAt', d.created_at)
        order by d.active desc, d.created_at)
      from qj.devices d), '[]'::jsonb),
    'joinCodes', coalesce((
      select jsonb_agg(jsonb_build_object('id', j.id, 'label', j.label, 'left', j.uses_left, 'used', j.used, 'expires', j.expires_at,
          'live', j.uses_left > 0 and j.expires_at > now(), 'createdAt', j.created_at) order by j.created_at desc)
      from qj.join_codes j where j.expires_at > now() - interval '30 days'), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'url', s.url, 'status', s.status, 'lesson', s.lesson_id,
          'processedAt', s.processed_at, 'modifiedAt', s.modified_at, 'note', s.note) order by s.processed_at desc nulls last)
      from qj.sources s), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(q.r order by q.t desc) from (
        select jsonb_build_object('employee', e.name, 'dept', e.dept, 'lesson', l.title, 'stars', p.stars, 'at', p.last_done_at) r, p.last_done_at t
        from qj.progress p join qj.employees e on e.id = p.employee_id join qj.lessons l on l.id = p.lesson_id
        where p.done and p.last_done_at is not null order by p.last_done_at desc limit 30) q), '[]'::jsonb),
    'admins', coalesce((select jsonb_agg(jsonb_build_object('login', a.login, 'name', a.name, 'lastLogin', a.last_login_at) order by a.created_at) from qj.admins a where a.active), '[]'::jsonb));
end $$;

-- add or change an employee: { id?, name, dept, role, active?, pin? } (a new employee needs a PIN)
create function public.admin_save_employee(token text, employee jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  aid uuid := qj.admin(token);
  eid uuid;
  nm text := btrim(coalesce(employee->>'name', ''));
  pin text := employee->>'pin';
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if nm = '' or char_length(nm) > 40 then return jsonb_build_object('ok', false, 'error', 'name'); end if;
  if pin is not null and pin !~ '^[0-9]{4}$' then return jsonb_build_object('ok', false, 'error', 'pin'); end if;
  if coalesce(employee->>'id', '') = '' then
    if pin is null then return jsonb_build_object('ok', false, 'error', 'pin'); end if;
    begin
      insert into qj.employees (name, dept, role, pin_hash)
      values (nm, left(btrim(coalesce(employee->>'dept', '')), 40), left(btrim(coalesce(employee->>'role', '')), 40), extensions.crypt(pin, extensions.gen_salt('bf', 8)))
      returning id into eid;
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'taken');
    end;
  else
    eid := (employee->>'id')::uuid;
    begin
      update qj.employees x set name = nm, dept = left(btrim(coalesce(employee->>'dept', x.dept)), 40), role = left(btrim(coalesce(employee->>'role', x.role)), 40),
        active = coalesce((employee->>'active')::boolean, x.active),
        pin_hash = case when pin is not null then extensions.crypt(pin, extensions.gen_salt('bf', 8)) else x.pin_hash end,
        failed = case when pin is not null then 0 else x.failed end,
        locked_until = case when pin is not null then null else x.locked_until end
      where x.id = eid;
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'taken');
    end;
    if not found then return jsonb_build_object('ok', false, 'error', 'missing'); end if;
    -- a deactivated employee is signed out everywhere
    if not coalesce((employee->>'active')::boolean, true) then delete from qj.sessions s where s.employee_id = eid; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', eid);
end $$;

create function public.admin_unlock(token text, employee uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare aid uuid := qj.admin(token);
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  update qj.employees x set failed = 0, locked_until = null where x.id = employee;
  return jsonb_build_object('ok', true);
end $$;

-- a new screen, or a new setup code for one (its old registration stops working): the code is shown once, for 7 days
create function public.admin_device(token text, device uuid default null, device_label text default null, active boolean default null,
  new_code boolean default false, personal boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  aid uuid := qj.admin(token);
  did uuid := device;
  c text;
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if did is null then
    insert into qj.devices (label, personal) values (left(btrim(coalesce(device_label, '')), 40), coalesce(admin_device.personal, false)) returning id into did;
    new_code := true;
  else
    update qj.devices d set label = coalesce(left(btrim(device_label), 40), d.label), active = coalesce(admin_device.active, d.active),
      personal = coalesce(admin_device.personal, d.personal)
    where d.id = did;
    if not found then return jsonb_build_object('ok', false, 'error', 'missing'); end if;
    if admin_device.active is false then delete from qj.sessions s where s.device_id = did; end if;
  end if;
  if new_code then
    c := qj.new_code();
    update qj.devices d set setup_hash = qj.h(qj.norm_code(c)), setup_expires_at = now() + interval '7 days', token_hash = null where d.id = did;
  end if;
  return jsonb_build_object('ok', true, 'id', did, 'code', c);
end $$;

-- a team code for the staff's own phones and computers (uses: how many, days: for how long), or stop one
create function public.admin_join_code(token text, code_label text default '', uses int default 30, days int default 7, stop uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  aid uuid := qj.admin(token);
  c text;
  jid uuid;
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if stop is not null then
    update qj.join_codes j set uses_left = 0 where j.id = stop;
    return jsonb_build_object('ok', true);
  end if;
  c := qj.new_code();
  insert into qj.join_codes (code_hash, label, uses_left, expires_at)
  values (qj.h(qj.norm_code(c)), left(btrim(coalesce(code_label, '')), 30), greatest(1, least(500, coalesce(uses, 30))),
    now() + make_interval(days => greatest(1, least(90, coalesce(days, 7)))))
  returning id into jid;
  return jsonb_build_object('ok', true, 'id', jid, 'code', c);
end $$;

-- add or change a lesson: { id?, guardian, title, keys, about, minutes, badge, reward, steps, outro, tags, sort }.
-- A published lesson that is changed is checked first, and its version goes up (screens restart it from the beginning).
create function public.admin_save_lesson(token text, lesson jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  aid uuid := qj.admin(token);
  was qj.lessons;
  nw qj.lessons;
  probs text[];
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if lesson ? 'guardian' and not exists (select 1 from qj.guardians g where g.id = lesson->>'guardian') then
    return jsonb_build_object('ok', false, 'error', 'guardian');
  end if;
  if coalesce(lesson->>'id', '') = '' then
    insert into qj.lessons (guardian_id, title) values (coalesce(lesson->>'guardian', 'heron'), '') returning * into was;
  else
    select * into was from qj.lessons l where l.id = (lesson->>'id')::uuid for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'missing'); end if;
  end if;
  nw := was;
  nw.guardian_id := coalesce(lesson->>'guardian', was.guardian_id);
  nw.title := left(btrim(coalesce(lesson->>'title', was.title)), 80);
  nw.keys := left(btrim(coalesce(lesson->>'keys', was.keys)), 80);
  nw.about := left(btrim(coalesce(lesson->>'about', was.about)), 400);
  nw.minutes := greatest(1, least(60, coalesce((lesson->>'minutes')::int, was.minutes)));
  nw.badge := case when lesson ? 'badge' then nullif(left(btrim(coalesce(lesson->>'badge', '')), 40), '') else was.badge end;
  nw.reward := case when lesson ? 'reward' then case when jsonb_typeof(lesson->'reward') = 'object' then lesson->'reward' else null end else was.reward end;
  nw.steps := case when jsonb_typeof(lesson->'steps') = 'array' then lesson->'steps' else was.steps end;
  nw.outro := left(coalesce(lesson->>'outro', was.outro), 400);
  nw.tags := case when lesson ? 'tags' then coalesce((select array_agg(left(btrim(x), 30)) from jsonb_array_elements_text(lesson->'tags') t(x) where btrim(x) <> ''), '{}') else was.tags end;
  nw.sort := coalesce((lesson->>'sort')::int, was.sort);
  if was.status = 'published' then
    probs := qj.lesson_problems(nw);
    if array_length(probs, 1) > 0 then return jsonb_build_object('ok', false, 'error', 'problems', 'problems', to_jsonb(probs)); end if;
    if nw.steps is distinct from was.steps or nw.title is distinct from was.title then nw.version := was.version + 1; end if;
  end if;
  update qj.lessons l set guardian_id = nw.guardian_id, title = nw.title, keys = nw.keys, about = nw.about, minutes = nw.minutes, badge = nw.badge,
    reward = nw.reward, steps = nw.steps, outro = nw.outro, tags = nw.tags, sort = nw.sort, version = nw.version, updated_at = now()
  where l.id = was.id;
  return jsonb_build_object('ok', true, 'id', was.id, 'version', nw.version, 'problems', to_jsonb(qj.lesson_problems(nw)));
end $$;

-- publish (checked first), take back to draft, or archive a lesson; or delete one that is not published
create function public.admin_lesson_status(token text, lesson uuid, status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  aid uuid := qj.admin(token);
  l qj.lessons;
  probs text[];
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  select * into l from qj.lessons x where x.id = lesson for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'missing'); end if;
  if admin_lesson_status.status = 'delete' then
    if l.status = 'published' then return jsonb_build_object('ok', false, 'error', 'published'); end if;
    delete from qj.lessons x where x.id = l.id;
    return jsonb_build_object('ok', true);
  end if;
  if admin_lesson_status.status not in ('draft', 'published', 'archived') then return jsonb_build_object('ok', false, 'error', 'status'); end if;
  if admin_lesson_status.status = 'published' then
    probs := qj.lesson_problems(l);
    if array_length(probs, 1) > 0 then return jsonb_build_object('ok', false, 'error', 'problems', 'problems', to_jsonb(probs)); end if;
  end if;
  update qj.lessons x set status = admin_lesson_status.status, updated_at = now(),
    published_at = case when admin_lesson_status.status = 'published' then now() else x.published_at end
  where x.id = l.id;
  return jsonb_build_object('ok', true);
end $$;

-- how a lesson goes: who started and finished it, and for each question how people answered the first time
create function public.admin_lesson_report(token text, lesson uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare aid uuid := qj.admin(token); l qj.lessons;
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  select * into l from qj.lessons x where x.id = lesson;
  if not found then return jsonb_build_object('ok', false, 'error', 'missing'); end if;
  return jsonb_build_object('ok', true, 'lesson', qj.lesson_json(l),
    'learners', coalesce((
      select jsonb_agg(jsonb_build_object('employee', e.name, 'dept', e.dept, 'done', p.done, 'stars', p.stars, 'step', p.step,
          'runs', p.runs, 'seconds', p.seconds, 'at', p.updated_at, 'doneAt', p.last_done_at, 'current', p.version = l.version) order by p.updated_at desc)
      from qj.progress p join qj.employees e on e.id = p.employee_id where p.lesson_id = l.id), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('step', q.step, 'answers', q.n, 'right', q.r, 'choices', q.picks) order by q.step)
      from (select a.step, count(*) n, count(*) filter (where a.correct) r,
                   (select jsonb_object_agg(ch.choice::text, ch.k) from (select a2.choice, count(*) k from qj.answers a2
                     where a2.lesson_id = l.id and a2.version = l.version and a2.step = a.step and a2.first_try and not a2.review group by a2.choice) ch) picks
            from qj.answers a where a.lesson_id = l.id and a.version = l.version and a.first_try and not a.review group by a.step) q), '[]'::jsonb));
end $$;

-- one employee's learning record, with every answer they gave
create function public.admin_employee_report(token text, employee uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare aid uuid := qj.admin(token);
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if not exists (select 1 from qj.employees e where e.id = employee) then return jsonb_build_object('ok', false, 'error', 'missing'); end if;
  return jsonb_build_object('ok', true, 'archive', qj.archive(employee),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object('lesson', a.lesson_id, 'title', l.title, 'version', a.version, 'step', a.step, 'choice', a.choice,
          'correct', a.correct, 'first', a.first_try, 'review', a.review, 'at', a.at) order by a.at desc)
      from (select * from qj.answers x where x.employee_id = employee order by x.at desc limit 300) a join qj.lessons l on l.id = a.lesson_id), '[]'::jsonb));
end $$;

-- a guardian's name, title and lines
create function public.admin_save_guardian(token text, guardian jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare aid uuid := qj.admin(token);
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  update qj.guardians g set name = coalesce(nullif(left(btrim(guardian->>'name'), 20), ''), g.name),
    title = coalesce(left(btrim(guardian->>'title'), 40), g.title),
    lines = case when jsonb_typeof(guardian->'lines') = 'object' then guardian->'lines' else g.lines end, updated_at = now()
  where g.id = guardian->>'id';
  if not found then return jsonb_build_object('ok', false, 'error', 'missing'); end if;
  return jsonb_build_object('ok', true);
end $$;

/* ------------------------------------------------------------------ */
/* Who may call what                                                   */
/* ------------------------------------------------------------------ */
revoke execute on all functions in schema qj from public;
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'kiosk\_%' or p.proname like 'admin\_%') loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
