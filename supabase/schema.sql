-- Pitch Engine schema. Apply with the Supabase SQL editor or `supabase db push`.
-- Every run is immutable: a pivot or re-test is a new run row, never an update.

create extension if not exists pgcrypto;

create table if not exists ideas (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid references auth.users(id) on delete cascade,
  title       text not null,
  description text not null,
  market      text,                 -- e.g. "MY", "SG", "online"
  currency    text default 'RM',
  language    text default 'en',    -- pitch language: en, zh, both
  created_at  timestamptz default now()
);

create table if not exists runs (
  id          uuid primary key default gen_random_uuid(),
  idea_id     uuid not null references ideas(id) on delete cascade,
  version     int  not null,        -- 1, 2, 3 ... per idea
  parent_run  uuid references runs(id),
  label       text,                 -- "first pass", "after pricing pivot"
  status      text not null default 'running' check (status in ('running','done','failed')),
  started_at  timestamptz default now(),
  finished_at timestamptz,
  unique (idea_id, version)
);

-- One row per agent per run: what it concluded, and the raw JSON it produced.
create table if not exists agent_outputs (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references runs(id) on delete cascade,
  agent      text not null,         -- board, scout, competitors, panel_sim, panel_real, pricing, offer, cfo, marketing, brand, ops_launch, plan
  headline   text,
  score      int check (score between 0 and 10),
  summary    text,
  output     jsonb not null,
  created_at timestamptz default now(),
  unique (run_id, agent)
);

-- Evidence ledger, mirrors engine/ledger.py records.
create table if not exists evidence (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references runs(id) on delete cascade,
  agent       text not null,
  kind        text not null check (kind in ('price','review','market','regulation','customer','competitor','other')),
  method      text not null check (method in ('firecrawl','perplexity','search','manual','model','panel','posthog','clay')),
  claim       text not null,
  quote       text,
  source_url  text,
  fetched_at  date,
  confidence  numeric(3,2) not null check (confidence between 0 and 1),
  created_at  timestamptz default now(),
  constraint model_is_capped check (method <> 'model' or confidence <= 0.3),
  constraint sourced_has_url check (method = 'model' or source_url is not null)
);

-- Board output, tracked for the life of the idea.
create table if not exists kill_criteria (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references runs(id) on delete cascade,
  code       text not null,         -- K1, K2 ...
  text       text not null,
  measure    text,                  -- how it is tested
  status     text not null default 'untested' check (status in ('pass','fail','untested')),
  tested_by  text,                  -- agent or event that settled it
  unique (run_id, code)
);

-- Simulated and real panel members and their answers.
create table if not exists personas (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references runs(id) on delete cascade,
  kind       text not null check (kind in ('simulated','real')),
  seq        int,
  segment    text,
  card       jsonb not null,        -- income, habits, objection ... or the Clay record for a real prospect
  contact    jsonb                  -- real only: name, email; never shown in exports
);

create table if not exists panel_answers (
  id            uuid primary key default gen_random_uuid(),
  persona_id    uuid not null references personas(id) on delete cascade,
  wave          int default 1,      -- 1 = first pitch, 2 = after the offer
  buys          boolean,
  reason        text,
  would_flip    text,
  too_cheap     numeric, bargain numeric, expensive numeric, too_expensive numeric,
  answered_at   timestamptz default now()
);

-- CFO inputs and outputs, so a verdict can be recomputed later.
create table if not exists numbers (
  run_id     uuid primary key references runs(id) on delete cascade,
  inputs     jsonb not null,        -- numbers.json
  result     jsonb not null,        -- economics.py output
  created_at timestamptz default now()
);

create table if not exists verdicts (
  run_id      uuid primary key references runs(id) on delete cascade,
  verdict     text not null check (verdict in ('GO','PIVOT','NO-GO','INCOMPLETE')),
  probability numeric(4,3),
  confidence  text,
  inputs      jsonb not null,       -- verdict.py input
  result      jsonb not null,       -- verdict.py output
  created_at  timestamptz default now()
);

-- Live pitch telemetry, pulled from PostHog (or written by the pitch page's waitlist form).
create table if not exists pitch_events (
  id         bigserial primary key,
  idea_id    uuid not null references ideas(id) on delete cascade,
  event      text not null,         -- view, section, cta_click, signup
  props      jsonb,
  occurred_at timestamptz default now()
);

create table if not exists waitlist (
  id         uuid primary key default gen_random_uuid(),
  idea_id    uuid not null references ideas(id) on delete cascade,
  email      text not null,
  note       text,
  created_at timestamptz default now()
);

create index if not exists evidence_run_agent on evidence(run_id, agent);
create index if not exists pitch_events_idea_time on pitch_events(idea_id, occurred_at);

-- Row-level security: owners see their own ideas and everything under them.
alter table ideas enable row level security;
alter table runs enable row level security;
alter table agent_outputs enable row level security;
alter table evidence enable row level security;
alter table kill_criteria enable row level security;
alter table personas enable row level security;
alter table panel_answers enable row level security;
alter table numbers enable row level security;
alter table verdicts enable row level security;
alter table pitch_events enable row level security;
alter table waitlist enable row level security;

create policy ideas_owner on ideas for all using (owner = auth.uid()) with check (owner = auth.uid());
create policy runs_owner on runs for all using (exists (select 1 from ideas i where i.id = idea_id and i.owner = auth.uid()));
create policy agent_outputs_owner on agent_outputs for all using (exists (select 1 from runs r join ideas i on i.id = r.idea_id where r.id = run_id and i.owner = auth.uid()));
create policy evidence_owner on evidence for all using (exists (select 1 from runs r join ideas i on i.id = r.idea_id where r.id = run_id and i.owner = auth.uid()));
create policy kill_criteria_owner on kill_criteria for all using (exists (select 1 from runs r join ideas i on i.id = r.idea_id where r.id = run_id and i.owner = auth.uid()));
create policy personas_owner on personas for all using (exists (select 1 from runs r join ideas i on i.id = r.idea_id where r.id = run_id and i.owner = auth.uid()));
create policy panel_answers_owner on panel_answers for all using (exists (select 1 from personas p join runs r on r.id = p.run_id join ideas i on i.id = r.idea_id where p.id = persona_id and i.owner = auth.uid()));
create policy numbers_owner on numbers for all using (exists (select 1 from runs r join ideas i on i.id = r.idea_id where r.id = run_id and i.owner = auth.uid()));
create policy verdicts_owner on verdicts for all using (exists (select 1 from runs r join ideas i on i.id = r.idea_id where r.id = run_id and i.owner = auth.uid()));
create policy pitch_events_owner_read on pitch_events for select using (exists (select 1 from ideas i where i.id = idea_id and i.owner = auth.uid()));
create policy waitlist_owner_read on waitlist for select using (exists (select 1 from ideas i where i.id = idea_id and i.owner = auth.uid()));
-- Anonymous visitors of a pitch page may insert events and waitlist rows, nothing else.
create policy pitch_events_public_insert on pitch_events for insert to anon with check (true);
create policy waitlist_public_insert on waitlist for insert to anon with check (true);
