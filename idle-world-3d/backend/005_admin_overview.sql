-- 栖境 · the admin page's overview figures (the last 7 days, first answers overall), and taking off the list someone
-- added by mistake (only while they have no learning record: anyone who has learned is deactivated instead)

create or replace function public.admin_overview(token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare aid uuid := qj.admin(token);
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  return jsonb_build_object('ok', true,
    'done7', (select count(*) from qj.progress p where p.last_done_at > now() - interval '7 days'),
    'learners7', (select count(distinct p.employee_id) from qj.progress p where p.updated_at > now() - interval '7 days'),
    'seconds7', (select coalesce(sum(p.seconds), 0) from qj.progress p where p.last_done_at > now() - interval '7 days'),
    'answered', (select count(*) from qj.answers a where a.first_try and not a.review),
    'right', (select count(*) from qj.answers a where a.first_try and not a.review and a.correct),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'done', d.n) order by d.day)
      from (select (p.last_done_at at time zone 'Asia/Singapore')::date as day, count(*) n from qj.progress p
            where p.last_done_at > now() - interval '14 days' group by 1) d), '[]'::jsonb));
end $$;

create or replace function public.admin_delete_employee(token text, employee uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare aid uuid := qj.admin(token);
begin
  if aid is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if exists (select 1 from qj.progress p where p.employee_id = employee) or exists (select 1 from qj.answers a where a.employee_id = employee) then
    return jsonb_build_object('ok', false, 'error', 'records');
  end if;
  delete from qj.employees e where e.id = employee;
  if not found then return jsonb_build_object('ok', false, 'error', 'missing'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.admin_overview(text) from public, authenticated;
revoke execute on function public.admin_delete_employee(text, uuid) from public, authenticated;
grant execute on function public.admin_overview(text) to anon;
grant execute on function public.admin_delete_employee(text, uuid) to anon;
