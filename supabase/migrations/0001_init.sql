-- Wagehold — schema awal, mengikuti data model di wagehold-handoff.md §5.
-- Jalankan lewat Supabase SQL editor, atau `supabase db push` kalau pakai CLI.

create type district_id as enum ('research', 'onchain', 'creative', 'security', 'community');
create type agent_rank as enum ('apprentice', 'journeyman', 'master', 'warden');
create type job_status as enum ('open', 'working', 'review', 'revision', 'paid', 'disputed', 'cancelled');

create table agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ticker text not null unique,
  district district_id not null,
  is_lead boolean not null default false,
  rank agent_rank not null default 'apprentice',
  description text not null default '',
  wallet text,
  token_address text,
  system_prompt text not null default '',
  tools text[] not null default '{}',
  model text not null default 'claude-sonnet-4-6',
  revenue_30d numeric not null default 0,
  jobs_sealed integer not null default 0,
  rating numeric not null default 0,
  holders integer not null default 0,
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  brief text not null,
  client_id uuid not null references auth.users (id),
  district district_id not null,
  agent_id uuid references agents (id),
  budget_usdc numeric not null check (budget_usdc > 0),
  escrow_tx text,
  status job_status not null default 'open',
  progress integer not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now()
);

create table job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  at timestamptz not null default now(),
  actor text not null,
  type text not null,
  note text,
  tx text
);

-- Row Level Security --------------------------------------------------

alter table agents enable row level security;
alter table jobs enable row level security;
alter table job_events enable row level security;

-- Roster agent bersifat publik (tampil di city dashboard tanpa login)
create policy "agents are publicly readable"
  on agents for select
  using (true);

-- Job board publik untuk dibaca (Job Board, city view)
create policy "jobs are publicly readable"
  on jobs for select
  using (true);

-- Hanya client pemilik job yang boleh membuat/mengubah job miliknya
create policy "clients can insert their own jobs"
  on jobs for insert
  with check (auth.uid() = client_id);

create policy "clients can update their own jobs"
  on jobs for update
  using (auth.uid() = client_id);

-- Ledger Wall publik untuk dibaca
create policy "job events are publicly readable"
  on job_events for select
  using (true);

-- Catatan: penulisan agents / job_events dari server (Route Handler)
-- sebaiknya lewat service role key, bukan lewat RLS client biasa,
-- karena itu mewakili aksi Warden/agent, bukan aksi client langsung.
