-- =====================================================================
-- ZION NETCOM — BLOG POSTS TABLE SETUP
-- =====================================================================
-- HOW TO USE:
-- 1. Go to your Supabase project → SQL Editor → New Query
-- 2. Paste this entire file and click "Run"
-- =====================================================================

-- 1. Create the blog_posts table
create table if not exists blog_posts (
    id          uuid primary key default gen_random_uuid(),
    title       text not null,
    slug        text unique not null,
    excerpt     text,
    content     text not null,
    topic       text,
    cover_emoji text default '🖥️',
    status      text default 'draft' check (status in ('draft','published')),
    created_at  timestamptz default now(),
    published_at timestamptz
);

-- 2. Enable Row Level Security
alter table blog_posts enable row level security;

-- 3. Anyone can read PUBLISHED posts (public blog)
create policy "Public can read published posts"
on blog_posts for select
to anon
using (status = 'published');

-- 4. Authenticated admin can do everything (read drafts, publish, delete)
create policy "Authenticated admin full access"
on blog_posts for all
to authenticated
using (true)
with check (true);

-- 5. The GitHub Actions service role can insert new drafts
--    (service role bypasses RLS automatically — no extra policy needed)

-- 6. Indexes for fast queries
create index if not exists blog_posts_status_idx on blog_posts (status);
create index if not exists blog_posts_published_at_idx on blog_posts (published_at desc);
create index if not exists blog_posts_slug_idx on blog_posts (slug);
