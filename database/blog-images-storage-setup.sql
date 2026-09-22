-- =====================================================================
-- ZION NETCOM — BLOG IMAGES SETUP
-- =====================================================================
-- HOW TO USE:
-- 1. Go to your Supabase project → SQL Editor → New Query
-- 2. Paste this entire file and click "Run"  (safe to run more than once)
--
-- WHAT THIS DOES:
--   * Adds a "cover_image_url" column to blog_posts, for a post's cover photo.
--   * Creates a storage bucket called "blog-images" to hold every photo
--     uploaded from the Blog admin (cover photos AND photos placed inside
--     a post's body).
--
-- SECURITY MODEL:
--   * Anyone can VIEW the images (they need to, to see your blog) — this is
--     a public bucket, same as your favicon or logo.
--   * Only you, signed in to blog-admin.html, can upload, replace or delete
--     images. Nobody else can write to it.
--   * Only image files are accepted (PNG, JPEG, WebP, GIF), max 8 MB each.
-- =====================================================================


-- 1. Cover photo column on each post -------------------------------------
alter table blog_posts add column if not exists cover_image_url text check (char_length(cover_image_url) <= 600);


-- 2. Storage bucket --------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog-images', 'blog-images', true, 8388608, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
set public = true,
    file_size_limit = 8388608,
    allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif'];


-- 3. Who can do what with the images ---------------------------------------
drop policy if exists "Public can view blog images" on storage.objects;
create policy "Public can view blog images"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'blog-images');

drop policy if exists "Admin can upload blog images" on storage.objects;
create policy "Admin can upload blog images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'blog-images');

drop policy if exists "Admin can replace blog images" on storage.objects;
create policy "Admin can replace blog images"
on storage.objects for update
to authenticated
using (bucket_id = 'blog-images');

drop policy if exists "Admin can delete blog images" on storage.objects;
create policy "Admin can delete blog images"
on storage.objects for delete
to authenticated
using (bucket_id = 'blog-images');
