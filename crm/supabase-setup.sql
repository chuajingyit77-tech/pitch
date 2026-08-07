-- Prospek Cerah CRM cloud sync schema
-- Run once on the Supabase project (SQL editor or MCP apply_migration).

create table if not exists public.crm_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.crm_state enable row level security;

drop policy if exists "own state select" on public.crm_state;
create policy "own state select" on public.crm_state
  for select using (auth.uid() = user_id);

drop policy if exists "own state insert" on public.crm_state;
create policy "own state insert" on public.crm_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "own state update" on public.crm_state;
create policy "own state update" on public.crm_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
