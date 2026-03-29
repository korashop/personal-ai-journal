create extension if not exists pgcrypto;

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  created_at timestamptz not null default now(),
  raw_text text not null,
  source text not null check (source in ('typed', 'paste', 'photo')),
  tags text[] not null default '{}',
  photo_url text,
  summary text,
  has_open_threads boolean not null default false,
  ai_response jsonb
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  entry_id uuid not null references public.entries(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.memory_doc (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  content text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.highlights (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  source text not null check (source in ('kindle', 'snipd')),
  content text not null,
  book_title text,
  author text,
  highlight_date timestamptz,
  embedding jsonb
);

create index if not exists entries_user_created_idx on public.entries (user_id, created_at desc);
create index if not exists conversations_entry_created_idx on public.conversations (entry_id, created_at asc);
create index if not exists highlights_user_idx on public.highlights (user_id);
