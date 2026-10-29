-- 栖境 · a batch of learning events counts once: a screen that sent a batch but never heard back (the network dropped
-- after the database had it) sends the same batch again, with the same id, and it is not counted twice. The learning
-- record also carries the first-answer figures (answered, right: first answers in runs of a lesson, reviews apart), and
-- a personal screen's session in use stays alive (30 days from the last time it was heard from).

create table qj.batches (
  id text primary key check (char_length(id) between 8 and 64),
  employee_id uuid not null references qj.employees(id) on delete cascade,
  at timestamptz not null default now()
);
alter table qj.batches enable row level security;

create or replace function qj.archive(emp uuid) returns jsonb language sql stable set search_path = '' as $$
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
      where not m.correct), '[]'::jsonb),
    'answered', (select count(*) from qj.answers a where a.employee_id = emp and a.first_try and not a.review),
    'right', (select count(*) from qj.answers a where a.employee_id = emp and a.first_try and not a.review and a.correct))
$$;

-- a personal screen's session, heard from now: another 30 days (written at most once a day)
create function qj.touch(dev uuid, tok text) returns void language sql volatile set search_path = '' as $$
  update qj.sessions s set expires_at = now() + interval '30 days'
  where s.token_hash = qj.h(tok) and s.device_id = dev and s.expires_at > now() and s.expires_at < now() + interval '29 days'
    and exists (select 1 from qj.devices d where d.id = dev and d.personal)
$$;

create or replace function public.kiosk_archive(device_token text, session_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare dev uuid := qj.device(device_token); emp uuid;
begin
  if dev is null then return jsonb_build_object('ok', false, 'error', 'device'); end if;
  emp := qj.session(dev, session_token);
  if emp is null then return jsonb_build_object('ok', false, 'error', 'session'); end if;
  perform qj.touch(dev, session_token);
  return jsonb_build_object('ok', true, 'archive', qj.archive(emp));
end $$;

drop function public.kiosk_record(text, text, jsonb);

-- what happened in a lesson, in order (sent as it happens, or later from a screen that was offline):
--   { type: 'start' | 'step' | 'answer' | 'done', lesson, version, at, step?, choice?, correct?, first?, review?, stars?, badge? }
-- (review: an answer given in the wrong-answer review, outside a run of the lesson)
-- batch: the id the screen gave these events (8 to 64 characters); a batch already recorded is not recorded again.
-- A malformed event is skipped. Answers the updated learning record.
create function public.kiosk_record(device_token text, session_token text, events jsonb, batch text default null) returns jsonb
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
  perform qj.touch(dev, session_token);
  if batch is not null then
    if char_length(batch) not between 8 and 64 then return jsonb_build_object('ok', false, 'error', 'batch'); end if;
    if random() < 0.02 then delete from qj.batches b where b.at < now() - interval '30 days'; end if;
    insert into qj.batches (id, employee_id) values (batch, emp) on conflict (id) do nothing;
    if not found then return jsonb_build_object('ok', true, 'n', 0, 'again', true, 'archive', qj.archive(emp)); end if;
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

revoke execute on function qj.archive(uuid) from public;
revoke execute on function qj.touch(uuid, text) from public;
revoke execute on function public.kiosk_record(text, text, jsonb, text) from public, authenticated;
grant execute on function public.kiosk_record(text, text, jsonb, text) to anon;
