-- 栖境 · the API functions are called with the publishable key only (role anon): no Supabase Auth sign-ins are used,
-- so the role `authenticated` (given every new function in public by Supabase's default privileges) does not need them.
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'kiosk\_%' or p.proname like 'admin\_%') loop
    execute format('revoke execute on function %s from authenticated', f);
  end loop;
end $$;
