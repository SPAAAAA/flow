-- =========================================================
-- FLOW database: profiles, global chat, avatars
-- Run once in Supabase → SQL Editor. Safe to re-run.
-- =========================================================

-- ---------- helpers ----------
create or replace function public.wallet_of(uid uuid)
returns text language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select u.raw_user_meta_data -> 'custom_claims' ->> 'address' from auth.users u where u.id = uid),
    (select u.raw_user_meta_data ->> 'address' from auth.users u where u.id = uid),
    (select i.identity_data ->> 'address' from auth.identities i where i.user_id = uid and i.provider = 'web3' limit 1),
    (select split_part(i.provider_id, ':', 3) from auth.identities i where i.user_id = uid and i.provider = 'web3' limit 1),
    (select split_part(u.raw_user_meta_data ->> 'sub', ':', 3) from auth.users u where u.id = uid)
  );
$$;

-- ---------- profiles ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  wallet      text unique not null,
  name        text check (name is null or (char_length(name) between 2 and 20 and name ~ '^[A-Za-z0-9_ .\-]+$')),
  avatar_url  text check (avatar_url is null or char_length(avatar_url) < 500),
  is_admin    boolean not null default false,
  banned      boolean not null default false,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create unique index if not exists profiles_name_unique on public.profiles (lower(name)) where name is not null;

alter table public.profiles enable row level security;
drop policy if exists "profiles readable by everyone" on public.profiles;
create policy "profiles readable by everyone" on public.profiles for select using (true);
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- users may only change these columns (wallet / admin / banned are locked)
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (name, avatar_url, last_seen) on public.profiles to authenticated;

-- called by the site right after wallet sign-in: creates the profile with the VERIFIED wallet
create or replace function public.ensure_profile()
returns public.profiles language plpgsql security definer set search_path = public as $$
declare w text; p public.profiles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  w := public.wallet_of(auth.uid());
  if w is null or w = '' then raise exception 'no wallet on this account'; end if;
  insert into public.profiles (id, wallet) values (auth.uid(), w)
    on conflict (id) do update set last_seen = now()
    returning * into p;
  return p;
end $$;
grant execute on function public.ensure_profile() to authenticated;

-- ---------- chat ----------
create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 400),
  created_at  timestamptz not null default now()
);
create index if not exists messages_created_idx on public.messages (created_at desc);

alter table public.messages enable row level security;
drop policy if exists "messages readable by everyone" on public.messages;
create policy "messages readable by everyone" on public.messages for select using (true);
drop policy if exists "members post as themselves" on public.messages;
create policy "members post as themselves" on public.messages for insert
  with check (user_id = auth.uid() and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.banned));
drop policy if exists "delete own or admin" on public.messages;
create policy "delete own or admin" on public.messages for delete
  using (user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
grant select on public.messages to anon, authenticated;
grant insert (user_id, body), delete on public.messages to authenticated;

-- slow mode: 1 message per 3 seconds per user
create or replace function public.chat_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.messages m where m.user_id = new.user_id and m.created_at > now() - interval '3 seconds') then
    raise exception 'Slow down — wait a few seconds between messages';
  end if;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists chat_rate_limit on public.messages;
create trigger chat_rate_limit before insert on public.messages for each row execute function public.chat_rate_limit();

-- live updates for chat
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

-- ---------- avatar storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp','image/png','image/jpeg','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/webp','image/png','image/jpeg','image/gif'];

drop policy if exists "avatar public read" on storage.objects;
create policy "avatar public read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatar upload own folder" on storage.objects;
create policy "avatar upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar update own folder" on storage.objects;
create policy "avatar update own folder" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar delete own folder" on storage.objects;
create policy "avatar delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- make yourself admin (optional) ----------
-- update public.profiles set is_admin = true where wallet = 'YOUR_WALLET_ADDRESS';
