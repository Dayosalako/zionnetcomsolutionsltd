-- =====================================================================
-- ZION NETCOM — VISITOR TRACKING SETUP
-- =====================================================================
-- HOW TO USE:
-- 1. Go to your Supabase project → SQL Editor → New Query
-- 2. Paste this entire file and click "Run"  (safe to run more than once)
--
-- WHAT THIS CREATES:
--   page_views          one row per page a visitor opens
--   visitor_identities  links an anonymous visitor to a name/email when they
--                       submit the contact form or make a payment
--   record_time()       lets a page report how long it was open / how far it
--                       was scrolled (the ONLY thing anonymous users can update)
--
-- SECURITY MODEL:
--   * The public website (anon key) can only INSERT. It can never read, edit
--     or delete visitor data.
--   * Only you, logged in with your Supabase admin account (authenticated),
--     can read the data in the Visitors tab of admin.html.
--   * Raw IP addresses are NEVER stored — only country / region / city.
-- =====================================================================


-- 1. PAGE VIEWS ---------------------------------------------------------
create table if not exists page_views (
    id               uuid primary key default gen_random_uuid(),
    created_at       timestamptz not null default now(),

    -- which website (lets one dashboard cover several sites)
    site             text check (char_length(site) <= 120),

    -- who (anonymous random ID kept in the visitor's browser)
    visitor_id       text not null check (char_length(visitor_id) <= 64),
    session_id       text not null check (char_length(session_id) <= 64),
    is_new_visitor   boolean not null default false,

    -- what
    page_path        text not null check (char_length(page_path) <= 300),
    page_query       text check (char_length(page_query) <= 300),
    page_title       text check (char_length(page_title) <= 300),

    -- where they came from
    referrer         text check (char_length(referrer) <= 500),
    referrer_host    text check (char_length(referrer_host) <= 200),
    utm_source       text check (char_length(utm_source) <= 100),
    utm_medium       text check (char_length(utm_medium) <= 100),
    utm_campaign     text check (char_length(utm_campaign) <= 100),

    -- device
    device_type      text check (char_length(device_type) <= 20),
    browser          text check (char_length(browser) <= 40),
    os               text check (char_length(os) <= 40),
    screen_w         int  check (screen_w between 0 and 20000),
    screen_h         int  check (screen_h between 0 and 20000),
    language         text check (char_length(language) <= 20),
    timezone         text check (char_length(timezone) <= 60),

    -- location (from IP lookup in the browser; the IP itself is not saved)
    country          text check (char_length(country) <= 80),
    country_code     text check (char_length(country_code) <= 4),
    region           text check (char_length(region) <= 80),
    city             text check (char_length(city) <= 80),

    -- engagement (filled in when the visitor leaves the page)
    duration_seconds int check (duration_seconds between 0 and 3600),
    scroll_depth     int check (scroll_depth between 0 and 100)
);

-- (for anyone who ran an earlier version of this file)
alter table page_views add column if not exists site text check (char_length(site) <= 120);

alter table page_views enable row level security;

drop policy if exists "Public can record page views" on page_views;
create policy "Public can record page views"
on page_views for insert
to anon
with check (true);

drop policy if exists "Admin can read page views" on page_views;
create policy "Admin can read page views"
on page_views for select
to authenticated
using (true);

-- lets you clear test data / old data from the Supabase table editor
drop policy if exists "Admin can delete page views" on page_views;
create policy "Admin can delete page views"
on page_views for delete
to authenticated
using (true);

create index if not exists page_views_created_at_idx on page_views (created_at desc);
create index if not exists page_views_visitor_idx    on page_views (visitor_id, created_at desc);
create index if not exists page_views_path_idx       on page_views (page_path);
create index if not exists page_views_site_idx       on page_views (site);


-- 2. VISITOR IDENTITIES -------------------------------------------------
create table if not exists visitor_identities (
    id          uuid primary key default gen_random_uuid(),
    created_at  timestamptz not null default now(),
    visitor_id  text not null check (char_length(visitor_id) <= 64),
    name        text check (char_length(name)  <= 200),
    email       text check (char_length(email) <= 200),
    phone       text check (char_length(phone) <= 50),
    source      text not null default 'other' check (source in ('contact','payment','review','other'))
);

alter table visitor_identities enable row level security;

drop policy if exists "Public can record identities" on visitor_identities;
create policy "Public can record identities"
on visitor_identities for insert
to anon
with check (true);

drop policy if exists "Admin can read identities" on visitor_identities;
create policy "Admin can read identities"
on visitor_identities for select
to authenticated
using (true);

drop policy if exists "Admin can delete identities" on visitor_identities;
create policy "Admin can delete identities"
on visitor_identities for delete
to authenticated
using (true);

create index if not exists visitor_identities_visitor_idx on visitor_identities (visitor_id);
create index if not exists visitor_identities_email_idx   on visitor_identities (lower(email));


-- 3. RECORD TIME-ON-PAGE ------------------------------------------------
-- Anonymous users get NO update permission on the table itself. Instead they
-- may call this one function, which can only:
--   * touch a single row whose random id they already hold,
--   * only within 24 hours of that page view,
--   * and only ever RAISE duration / scroll (never lower, never other columns).
create or replace function public.record_time(
    p_id     uuid,
    p_secs   int,
    p_scroll int default null
) returns void
language sql
security definer
set search_path = public
as $$
    update page_views
       set duration_seconds = greatest(coalesce(duration_seconds, 0), least(greatest(p_secs, 0), 3600)),
           scroll_depth     = case
                                when p_scroll is null then scroll_depth
                                else greatest(coalesce(scroll_depth, 0), least(greatest(p_scroll, 0), 100))
                              end
     where id = p_id
       and created_at > now() - interval '24 hours';
$$;

revoke all on function public.record_time(uuid, int, int) from public;
grant execute on function public.record_time(uuid, int, int) to anon, authenticated;


-- =====================================================================
-- OPTIONAL — data retention (recommended: keep 13 months, then delete)
-- Run manually now and then, or schedule it under Database → Cron:
--   delete from page_views          where created_at < now() - interval '13 months';
--   delete from visitor_identities  where created_at < now() - interval '13 months';
-- =====================================================================
