-- =====================================================================
-- ZION NETCOM — PAYMENTS TABLE SETUP
-- =====================================================================
-- HOW TO USE:
-- 1. Go to your Supabase project → SQL Editor → New Query
-- 2. Paste this entire file and click "Run"
-- 3. Then go to Project Settings → API and copy your "Project URL"
--    and "anon public" key — you'll need to paste those into
--    payment.html and dashboard.html (placeholders are marked clearly)
-- 4. Finally, go to Authentication → Users → Add User, and create
--    ONE login (email + password) for yourself — that's the only
--    account that will be able to see the dashboard.
-- =====================================================================

-- 1. Create the payments table
create table if not exists payments (
    id uuid primary key default gen_random_uuid(),
    full_name text not null,
    email text not null,
    phone text,
    purpose text,
    reference_note text,
    amount numeric not null,
    transaction_ref text unique not null,
    status text default 'success',
    created_at timestamptz default now()
);

-- 2. Enable Row Level Security (required — keeps your data locked down)
alter table payments enable row level security;

-- 3. Allow the public payment page to INSERT a new row after a successful
--    Paystack charge. It can only ever add rows — never read, edit, or delete.
create policy "Public can insert payment records"
on payments
for insert
to anon
with check (true);

-- 4. Allow ONLY logged-in (authenticated) users to READ the payments table.
--    Since you'll be the only person with a login (created in step 4 above),
--    this means only you can view the dashboard data.
create policy "Authenticated users can view payments"
on payments
for select
to authenticated
using (true);

-- 5. Index for fast sorting by date on the dashboard
create index if not exists payments_created_at_idx on payments (created_at desc);
