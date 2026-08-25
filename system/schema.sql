-- ═══════════════════════════════════════════════════════════════════════════
-- JY 集团运营系统 — 数据库 Schema (Supabase / PostgreSQL)
-- v0.1 · 2026-08-24
--
-- 设计原则：主对象是「交付 deliverable」，不是「项目」。
-- 每一条交付强制挂在一条收入线上 —— 这是把「管人」和「要钱」缝成同一件事的地方。
--
-- 执行方式：Supabase Dashboard → SQL Editor → 粘贴执行；或 supabase db push
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 枚举 ──────────────────────────────────────────────────────────────────
create type deliverable_status as enum ('todo','submitted','accepted','rejected');
create type money_direction    as enum ('in','out');
create type evidence_grade     as enum ('V','S','C','M');  -- 已验证/有书面支持/仅口头声称/缺失
create type project_stage      as enum ('lead','proposal','gate','contracted','delivering','stopped','shelved');
create type app_role           as enum ('owner','member');

comment on type evidence_grade is
  'V=有合同/付款/官方批准/实测；S=有可靠书面支持但未成交；C=管理层或合作方声称；M=缺失、冲突或过期';

-- ─── 1. person ────────────────────────────────────────────────────────────
create table person (
  id          uuid primary key default gen_random_uuid(),
  auth_uid    uuid unique references auth.users(id) on delete set null,
  name        text not null,
  short_name  text not null unique,          -- JY / Shermyn / Hanif / Liong / Papu
  role_desc   text,                          -- 「HDJ 与 IIUM 协调」
  app_role    app_role not null default 'member',
  is_core     boolean not null default true, -- v1 只有 5 人为 true
  color       text default '#1D4ED8',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ─── 2. entity ────────────────────────────────────────────────────────────
-- 个人与公司必须分账（档案待补事项第 2 条）。不分账，现金屏就是假的。
create table entity (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,          -- Prospek Cerah / HDJ Drone / Burger Blek / 个人
  is_personal boolean not null default false,
  ssm_no      text,                          -- 待补：注册号
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ─── 3. revenue_line ──────────────────────────────────────────────────────
-- 固定 4 条，来自档案第 10 节。不要让它变成可无限新增的表。
create table revenue_line (
  id            text primary key,            -- blek / hdj / fac / big
  name          text not null,
  min_entry     text not null,               -- 最小可收费入口
  precondition  text not null,               -- 先决条件
  target_30d    text not null,               -- 30 天结果
  owner_id      uuid references person(id),
  sort_order    int not null default 0
);

-- ─── 4. project ───────────────────────────────────────────────────────────
create table project (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references entity(id),
  revenue_line_id text not null references revenue_line(id),
  name            text not null,
  stage           project_stage not null default 'lead',
  value_note      text,                       -- 「RM85,000,000」或「待定」

  -- ★ 四个强制字段。缺任一 → has_payment_path = false → 自动标灰
  payer           text,                       -- 谁付款
  budget_source   text,                       -- 预算来源
  next_paid_step  text,                       -- 下一个收钱动作
  next_gate_date  date,                       -- Gate 日期

  grade           evidence_grade not null default 'M',
  owner_id        uuid references person(id),
  is_dead         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- 生成列：付款路径是否完整。数据库层强制，不靠前端记得检查。
  has_payment_path boolean generated always as (
    payer is not null and budget_source is not null and next_gate_date is not null
  ) stored
);
create index on project (revenue_line_id);
create index on project (has_payment_path) where is_dead = false;

-- ─── 5. deliverable ───────────────────────────────────────────────────────
-- 系统心脏。acceptance_criteria 不可为空 —— 这是治「员工依赖指示」的药：
-- 不是给指示，是给验收标准。
create table deliverable (
  id                  uuid primary key default gen_random_uuid(),
  person_id           uuid not null references person(id),
  project_id          uuid references project(id),
  revenue_line_id     text not null references revenue_line(id),
  title               text not null,
  acceptance_criteria text not null check (length(trim(acceptance_criteria)) >= 10),
  due_date            date not null,
  status              deliverable_status not null default 'todo',
  submitted_note      text,
  submitted_at        timestamptz,
  reviewed_by         uuid references person(id),
  reviewed_at         timestamptz,
  review_note         text,                   -- 打回原因
  week_of             date not null,          -- 周一日期，用于「本周 vs 上周」对比
  created_at          timestamptz not null default now()
);
create index on deliverable (person_id, week_of);
create index on deliverable (status) where status = 'submitted';

-- ─── 6. decision ──────────────────────────────────────────────────────────
-- 48 小时 SLA。解决「所有决定回到我身上」的方法不是减少决策，
-- 而是让决策排队、计时、带建议选项。
create table decision (
  id           uuid primary key default gen_random_uuid(),
  question     text not null,
  amount_rm    numeric(14,2),                 -- 可空：不是每个决策都涉及金额
  raised_by    uuid not null references person(id),
  project_id   uuid references project(id),
  options      jsonb not null,                -- [{k:'A',text:'...',recommended:true}, ...]
  chosen       text,                          -- 'A' / 'B' / 'C'
  decided_by   uuid references person(id),
  decided_at   timestamptz,
  raised_at    timestamptz not null default now(),
  due_at       timestamptz generated always as (raised_at + interval '48 hours') stored
);
create index on decision (decided_at) where decided_at is null;

-- ─── 7. money ─────────────────────────────────────────────────────────────
-- 现金与跑道的唯一来源。没有证据的进出账不算数。
create table money (
  id          uuid primary key default gen_random_uuid(),
  direction   money_direction not null,
  entity_id   uuid not null references entity(id),
  project_id  uuid references project(id),
  amount_rm   numeric(14,2) not null check (amount_rm > 0),
  occurred_on date not null,
  memo        text,
  created_by  uuid references person(id),
  created_at  timestamptz not null default now()
);
create index on money (occurred_on desc);
create index on money (direction, entity_id);

-- ─── 8. evidence ──────────────────────────────────────────────────────────
-- 不是独立模块，是可挂在任何对象上的附件。
-- 员工在提交交付时顺手上传，不需要「去证据室」—— 证据室只是聚合视图。
create table evidence (
  id          uuid primary key default gen_random_uuid(),
  storage_path text not null,                 -- Supabase Storage bucket 'evidence'
  filename    text not null,
  mime_type   text,
  size_bytes  bigint,
  folder      text not null,                  -- 01 Corporate … 08 People（档案第 13 节）
  -- 多态关联：恰好挂在一个对象上
  project_id     uuid references project(id) on delete cascade,
  deliverable_id uuid references deliverable(id) on delete cascade,
  money_id       uuid references money(id) on delete cascade,
  uploaded_by uuid references person(id),
  created_at  timestamptz not null default now(),
  constraint evidence_exactly_one_parent check (
    (project_id is not null)::int + (deliverable_id is not null)::int + (money_id is not null)::int = 1
  )
);
create index on evidence (deliverable_id);
create index on evidence (project_id);

-- ─── 9. 集团设置（单行） ──────────────────────────────────────────────────
create table group_settings (
  id                 int primary key default 1 check (id = 1),
  cash_line_rm       numeric(14,2) not null default 1000000,
  burn_low_rm        numeric(14,2) not null default 40000,
  burn_high_rm       numeric(14,2) not null default 60000,
  max_monthly_top_up numeric(14,2) not null default 50000,
  stale_project_days int not null default 21,   -- Kill Rule 阈值
  updated_at         timestamptz not null default now()
);
insert into group_settings (id) values (1);

-- ═══════════════════════════════════════════════════════════════════════════
-- 视图 —— 前端只读这些，不直接算
-- ═══════════════════════════════════════════════════════════════════════════

-- 现金与跑道：档案里有 cash 也有 burn，但从没连成一个数字。这就是那个数字。
create view v_runway as
select
  (select coalesce(sum(case when direction='in' then amount_rm else -amount_rm end),0) from money) as net_flow_rm,
  s.cash_line_rm,
  (s.burn_low_rm + s.burn_high_rm)/2 as burn_avg_rm,
  s.burn_low_rm, s.burn_high_rm
from group_settings s;

-- Kill Rule：项目超过 N 天没有 Gate 或缺付款路径 → 自动建议暂停。
-- 规则是 JY 自己的，但必须由系统自动执行，否则永远不会执行。
create view v_project_health as
select p.*,
  case
    when p.is_dead then 'stopped'
    when not p.has_payment_path then 'no_payment_path'
    when p.next_gate_date < current_date then 'gate_overdue'
    when p.updated_at < now() - (s.stale_project_days || ' days')::interval then 'stale'
    else 'ok'
  end as health
from project p cross join group_settings s;

-- 每周六问 · 第 5 题：每名员工交出了什么可验收成果
create view v_weekly_delivery as
select d.week_of, pe.short_name, d.title, d.status, d.acceptance_criteria,
       (select count(*) from evidence e where e.deliverable_id = d.id) as evidence_count
from deliverable d join person pe on pe.id = d.person_id;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS —— v1 只有两种角色：owner(JY) 全部；member 只看自己那一栏
-- 「每人只看自己那一栏」是刻意的产品设计，不是权限出错。
-- ═══════════════════════════════════════════════════════════════════════════
alter table person       enable row level security;
alter table entity       enable row level security;
alter table revenue_line enable row level security;
alter table project      enable row level security;
alter table deliverable  enable row level security;
alter table decision     enable row level security;
alter table money        enable row level security;
alter table evidence     enable row level security;
alter table group_settings enable row level security;

create or replace function is_owner() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from person where auth_uid = auth.uid() and app_role = 'owner' and active);
$$;

create or replace function me() returns uuid language sql stable security definer set search_path = public as $$
  select id from person where auth_uid = auth.uid() and active limit 1;
$$;

-- owner 全权
create policy owner_all on person       for all using (is_owner()) with check (is_owner());
create policy owner_all on entity       for all using (is_owner()) with check (is_owner());
create policy owner_all on revenue_line for all using (is_owner()) with check (is_owner());
create policy owner_all on project      for all using (is_owner()) with check (is_owner());
create policy owner_all on deliverable  for all using (is_owner()) with check (is_owner());
create policy owner_all on decision     for all using (is_owner()) with check (is_owner());
create policy owner_all on money        for all using (is_owner()) with check (is_owner());
create policy owner_all on evidence     for all using (is_owner()) with check (is_owner());
create policy owner_all on group_settings for all using (is_owner()) with check (is_owner());

-- member：只读自己 + 收入线只读；只能提交自己的交付；不得见 money 与 group_settings
create policy member_self     on person      for select using (id = me());
create policy member_lines    on revenue_line for select using (true);
create policy member_projects on project     for select using (owner_id = me());

create policy member_read_own_deliv   on deliverable for select using (person_id = me());
create policy member_update_own_deliv on deliverable for update
  using (person_id = me() and status in ('todo','rejected'))
  with check (person_id = me() and status = 'submitted');   -- 只能提交，不能自我验收

create policy member_raise_decision on decision for insert with check (raised_by = me());
create policy member_read_decision  on decision for select using (raised_by = me());

create policy member_evidence_read on evidence for select
  using (deliverable_id in (select id from deliverable where person_id = me()));
create policy member_evidence_add on evidence for insert
  with check (deliverable_id in (select id from deliverable where person_id = me()));

-- ═══════════════════════════════════════════════════════════════════════════
-- 种子数据 —— 全部来自 JY 档案（资料截止 2026-08-24）
-- ═══════════════════════════════════════════════════════════════════════════
insert into entity (name, is_personal) values
  ('Prospek Cerah', false), ('HDJ Drone', false), ('Burger Blek', false),
  ('Dusari', false), ('Digital Ringgit', false), ('Luvia', false), ('Afriva', false),
  ('个人 JY', true);

insert into person (name, short_name, role_desc, app_role, color) values
  ('蔡景昱 Chua Jing Yit', 'JY',      'CEO · 唯一决策人',        'owner',  '#1D4ED8'),
  ('Shermyn',              'Shermyn', 'HDJ 与 IIUM 协调',        'member', '#0D8F84'),
  ('Hanif',                'Hanif',   'Robotics · 无人机技术支持','member', '#7C3AED'),
  ('Liong',                'Liong',   'Blek 撤退 · 资产变现',    'member', '#B45309'),
  ('Papu',                 'Papu',    'Software Engineer',       'member', '#BE185D');

insert into revenue_line (id, name, min_entry, precondition, target_30d, sort_order) values
  ('blek','Blek 资产止血','租金、押金、设备出租/出售或受保护的设备入股','资产清单、估值、合同','减少每月现金流出',1),
  ('hdj','HDJ 无人机','付费勘查、测绘交付、培训订金、出口服务费或 Demo 费','设备来源、合规路径、固定交付','至少 1 个付费小单或订金',2),
  ('fac','工厂数字化','诊断费或 30 天 POC 订金','选定场景、固定 SKU、Demo 和价格','1 个付费诊断 / POC',3),
  ('big','大型项目','前期策划费、可行性资料费、项目管理费或成功费保护','付款人、授权、合同和项目 Gate','至少取得一份正式 Mandate / LOI / 付费 Scope',4);

update revenue_line set owner_id = (select id from person where short_name='Liong')   where id='blek';
update revenue_line set owner_id = (select id from person where short_name='Shermyn') where id='hdj';
update revenue_line set owner_id = (select id from person where short_name='Papu')    where id='fac';
update revenue_line set owner_id = (select id from person where short_name='JY')      where id='big';

-- ═══════════════════════════════════════════════════════════════════════════
-- 上线前必须补的数据（档案第 14 节「仍需补齐事项」）
--   · 各主体最新银行余额；个人与公司开支的准确拆分  → money + entity
--   · 5 位核心成员的周交付定义与验收标准（只有 JY 能定）→ deliverable
--   · 四条收入线各自当前的 Next Paid Step 与证据      → project
-- 在这些补齐之前，v_runway 只能当估算用，不能当事实用。
-- ═══════════════════════════════════════════════════════════════════════════
