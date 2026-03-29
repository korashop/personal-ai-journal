create table if not exists public.pattern_threads (
  id text primary key,
  user_id text not null,
  title text not null,
  overview text not null,
  status text not null default 'active',
  dimensions text[] not null default '{}',
  questions text[] not null default '{}',
  explore_options text[] not null default '{}',
  entry_ids text[] not null default '{}',
  entry_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists pattern_threads_user_updated_idx
  on public.pattern_threads (user_id, updated_at desc);
