-- 栖境 · taking off the list someone added by mistake (only while they have no learning record: anyone who has
-- learned is deactivated instead)

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

revoke execute on function public.admin_delete_employee(text, uuid) from public, authenticated;
grant execute on function public.admin_delete_employee(text, uuid) to anon;
