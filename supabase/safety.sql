-- =========================================================
-- FLOW safety: reports, admin tools (ban / purge / reset), coin scam reports.
-- Run after social3.sql. Safe to re-run.
-- =========================================================

-- the founder wallet is the admin
update public.profiles set is_admin = true where wallet = '5ZfqZdmid5jMVixfTZULPNvzRKtxxfCXYW6Xn8E6yDn7';

-- ---------- reports ----------
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('post','comment','chat','user','dm','coin')),
  target_id   text not null check (char_length(target_id) between 1 and 64),
  target_user uuid references public.profiles(id) on delete set null,
  reason      text not null check (reason in ('spam','scam','abuse','nsfw','impersonation','other')),
  note        text check (note is null or char_length(note) <= 200),
  snapshot    text,
  status      text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at  timestamptz not null default now(),
  unique (reporter_id, kind, target_id)
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists reports_coin_idx on public.reports (target_id) where kind = 'coin';

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant insert (reporter_id, kind, target_id, reason, note) on public.reports to authenticated;
grant select on public.reports to authenticated;
grant update (status) on public.reports to authenticated;

drop policy if exists "report as yourself" on public.reports;
create policy "report as yourself" on public.reports for insert
  with check (reporter_id = auth.uid() and public.can_post(auth.uid()));
drop policy if exists "admins read reports" on public.reports;
create policy "admins read reports" on public.reports for select using (public.is_admin(auth.uid()) or reporter_id = auth.uid());
drop policy if exists "admins update reports" on public.reports;
create policy "admins update reports" on public.reports for update using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- fill target_user + a snapshot of the reported content server-side (never trust the client)
create or replace function public.report_fill() returns trigger
language plpgsql security definer set search_path = public as $$
declare uid uuid; snap text; tid bigint;
begin
  if (select count(*) from public.reports where reporter_id = new.reporter_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many reports — try again later';
  end if;
  new.status := 'open'; new.created_at := now();
  if new.kind in ('post','comment','chat','dm') then
    if new.target_id !~ '^[0-9]{1,18}$' then raise exception 'Invalid target'; end if;
    tid := new.target_id::bigint;
  end if;
  if new.kind = 'post' then select user_id, left(p.body, 500) into uid, snap from public.posts p where id = tid;
  elsif new.kind = 'comment' then select user_id, left(c.body, 300) into uid, snap from public.post_comments c where id = tid;
  elsif new.kind = 'chat' then select user_id, left(m.body, 400) into uid, snap from public.messages m where id = tid;
  elsif new.kind = 'dm' then
    select sender_id, left(d.body, 1000) into uid, snap from public.dm_messages d where id = tid and recipient_id = new.reporter_id;
  elsif new.kind = 'user' then
    if new.target_id !~ '^[0-9a-f-]{36}$' then raise exception 'Invalid target'; end if;
    select id, coalesce(name, wallet) || coalesce(' — ' || bio, '') into uid, snap from public.profiles where id = new.target_id::uuid;
  elsif new.kind = 'coin' then
    if new.target_id !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then raise exception 'Invalid coin'; end if;
    snap := new.target_id;
  end if;
  if new.kind <> 'coin' and uid is null then raise exception 'That content no longer exists'; end if;
  if uid = new.reporter_id then raise exception 'You can''t report yourself'; end if;
  new.target_user := uid; new.snapshot := snap;
  return new;
end $$;
drop trigger if exists report_fill on public.reports;
create trigger report_fill before insert on public.reports for each row execute function public.report_fill();

-- public: how many members flagged a coin as a scam
create or replace function public.coin_reports(m text) returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from public.reports where kind = 'coin' and target_id = m and reason = 'scam' and status <> 'dismissed';
$$;
grant execute on function public.coin_reports(text) to anon, authenticated;

-- ---------- admin queue ----------
create or replace function public.admin_reports(st text default 'open')
returns table (id bigint, kind text, target_id text, reason text, note text, snapshot text, status text, created_at timestamptz,
               reporter_id uuid, target_user uuid, same_target bigint, still_exists boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin(auth.uid()) then raise exception 'admins only'; end if;
  return query
  select r.id, r.kind, r.target_id, r.reason, r.note, r.snapshot, r.status, r.created_at, r.reporter_id, r.target_user,
    (select count(*) from public.reports x where x.kind = r.kind and x.target_id = r.target_id),
    case r.kind
      when 'post' then exists (select 1 from public.posts p where p.id::text = r.target_id)
      when 'comment' then exists (select 1 from public.post_comments c where c.id::text = r.target_id)
      when 'chat' then exists (select 1 from public.messages m where m.id::text = r.target_id)
      when 'dm' then exists (select 1 from public.dm_messages d where d.id::text = r.target_id)
      else true end
  from public.reports r
  where st = 'all' or r.status = st
  order by r.created_at desc limit 200;
end $$;
grant execute on function public.admin_reports(text) to authenticated;

-- ban / unban (admins can't be banned)
create or replace function public.admin_set_ban(uid uuid, ban boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'admins only'; end if;
  if ban and public.is_admin(uid) then raise exception 'You can''t ban an admin'; end if;
  update public.profiles set banned = ban where id = uid;
end $$;
grant execute on function public.admin_set_ban(uuid, boolean) to authenticated;

-- delete everything a member posted (posts, comments, chat)
create or replace function public.admin_purge(uid uuid) returns json
language plpgsql security definer set search_path = public as $$
declare a int; b int; c int;
begin
  if not public.is_admin(auth.uid()) then raise exception 'admins only'; end if;
  if public.is_admin(uid) then raise exception 'You can''t purge an admin'; end if;
  delete from public.posts where user_id = uid; get diagnostics a = row_count;
  delete from public.post_comments where user_id = uid; get diagnostics b = row_count;
  delete from public.messages where user_id = uid; get diagnostics c = row_count;
  update public.reports set status = 'resolved' where target_user = uid and status = 'open';
  return json_build_object('posts', a, 'comments', b, 'chat', c);
end $$;
grant execute on function public.admin_purge(uuid) to authenticated;

-- wipe name / picture / bio / banner / links (e.g. impersonation or NSFW)
create or replace function public.admin_reset_profile(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'admins only'; end if;
  update public.profiles set name = null, avatar_url = null, bio = null, banner_url = null, x_handle = null, tiktok_handle = null where id = uid;
end $$;
grant execute on function public.admin_reset_profile(uuid) to authenticated;

-- admins may delete reported DMs
drop policy if exists "admin delete dm" on public.dm_messages;
create policy "admin delete dm" on public.dm_messages for delete using (public.is_admin(auth.uid()));
grant delete on public.dm_messages to authenticated;

-- overview numbers for the admin page
create or replace function public.admin_overview() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'admins only'; end if;
  return json_build_object(
    'members', (select count(*) from public.profiles),
    'new24', (select count(*) from public.profiles where created_at > now() - interval '24 hours'),
    'banned', (select count(*) from public.profiles where banned),
    'open_reports', (select count(*) from public.reports where status = 'open'),
    'posts24', (select count(*) from public.posts where created_at > now() - interval '24 hours'),
    'trades24', (select count(*) from public.trades where created_at > now() - interval '24 hours'));
end $$;
grant execute on function public.admin_overview() to authenticated;
