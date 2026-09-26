-- =========================================================
-- FLOW social v3: profile bio/banner/links, @mentions, polls,
-- daily streaks, direct messages, "Trending on FLOW".
-- Run after levels.sql. Safe to re-run.
-- =========================================================

-- ---------- profile bio, banner, links ----------
alter table public.profiles add column if not exists bio text check (bio is null or char_length(bio) <= 160);
alter table public.profiles add column if not exists banner_url text check (banner_url is null or char_length(banner_url) < 500);
alter table public.profiles add column if not exists x_handle text check (x_handle is null or x_handle ~ '^[A-Za-z0-9_]{1,15}$');
alter table public.profiles add column if not exists tiktok_handle text check (tiktok_handle is null or tiktok_handle ~ '^[A-Za-z0-9_.]{2,24}$');
grant update (name, avatar_url, last_seen, bio, banner_url, x_handle, tiktok_handle) on public.profiles to authenticated;

-- ---------- notifications: allow "mention" ----------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like','comment','follow','buy','sell','mention'));

-- @mentions in posts and comments -> notification (handle = name with spaces as _)
create or replace function public.notify_mentions() returns trigger
language plpgsql security definer set search_path = public as $$
declare h text; target uuid; pid bigint; n int := 0;
begin
  -- read the post id without touching a column the other table doesn't have
  if tg_table_name = 'posts' then pid := (to_jsonb(new) ->> 'id')::bigint;
  else pid := (to_jsonb(new) ->> 'post_id')::bigint; end if;
  for h in select distinct lower(m[1]) from regexp_matches(new.body, '@([A-Za-z0-9_.\-]{2,20})', 'g') as m loop
    exit when n >= 10;
    target := null;
    select id into target from public.profiles where lower(replace(name, ' ', '_')) = h limit 1;
    if target is not null and target <> new.user_id then
      insert into public.notifications (user_id, actor_id, type, post_id) values (target, new.user_id, 'mention', pid);
      n := n + 1;
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists mention_posts on public.posts;
create trigger mention_posts after insert on public.posts for each row execute function public.notify_mentions();
drop trigger if exists mention_comments on public.post_comments;
create trigger mention_comments after insert on public.post_comments for each row execute function public.notify_mentions();

-- ---------- polls ----------
create table if not exists public.post_polls (
  post_id  bigint primary key references public.posts(id) on delete cascade,
  options  text[] not null check (cardinality(options) between 2 and 4),
  ends_at  timestamptz not null
);
create table if not exists public.poll_votes (
  post_id    bigint not null references public.post_polls(post_id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  option     smallint not null check (option between 0 and 3),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_polls enable row level security;
alter table public.poll_votes enable row level security;
revoke all on public.post_polls, public.poll_votes from anon, authenticated;
grant select on public.post_polls to anon, authenticated;
grant insert (post_id, options, ends_at) on public.post_polls to authenticated;
grant select on public.poll_votes to authenticated;
grant insert (post_id, user_id, option) on public.poll_votes to authenticated;

drop policy if exists "polls readable" on public.post_polls;
create policy "polls readable" on public.post_polls for select using (true);
drop policy if exists "poll on own post" on public.post_polls;
create policy "poll on own post" on public.post_polls for insert
  with check (exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));
drop policy if exists "see own votes" on public.poll_votes;
create policy "see own votes" on public.poll_votes for select using (user_id = auth.uid());
drop policy if exists "vote as yourself" on public.poll_votes;
create policy "vote as yourself" on public.poll_votes for insert with check (user_id = auth.uid() and public.can_post(auth.uid()));

create or replace function public.poll_validate() returns trigger
language plpgsql security definer set search_path = public as $$
declare o text; pl public.post_polls;
begin
  if tg_table_name = 'post_polls' then
    foreach o in array new.options loop
      if o is null or char_length(btrim(o)) not between 1 and 40 then raise exception 'Poll options must be 1-40 characters'; end if;
    end loop;
    if new.ends_at <= now() or new.ends_at > now() + interval '7 days 1 minute' then raise exception 'Polls can run up to 7 days'; end if;
  else
    select * into pl from public.post_polls where post_id = new.post_id;
    if pl.ends_at <= now() then raise exception 'This poll has ended'; end if;
    if new.option >= cardinality(pl.options) then raise exception 'Invalid option'; end if;
    new.created_at := now();
  end if;
  return new;
end $$;
drop trigger if exists poll_validate on public.post_polls;
create trigger poll_validate before insert on public.post_polls for each row execute function public.poll_validate();
drop trigger if exists vote_validate on public.poll_votes;
create trigger vote_validate before insert on public.poll_votes for each row execute function public.poll_validate();

create or replace function public.poll_results(ids bigint[])
returns table (post_id bigint, option smallint, votes bigint)
language sql stable security definer set search_path = public as $$
  select v.post_id, v.option, count(*) from public.poll_votes v
  where v.post_id = any (ids[1:100]) group by v.post_id, v.option;
$$;
grant execute on function public.poll_results(bigint[]) to anon, authenticated;

-- ---------- daily streaks ----------
create table if not exists public.checkins (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null,
  primary key (user_id, day)
);
alter table public.checkins enable row level security;
revoke all on public.checkins from anon, authenticated;

create or replace function public.streak_of(uid uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare anchor date; s int;
begin
  select max(day) into anchor from public.checkins where user_id = uid;
  if anchor is null or anchor < (now() at time zone 'utc')::date - 1 then return 0; end if;
  select count(*) into s from (
    select day, row_number() over (order by day desc) as rn from public.checkins where user_id = uid
  ) t where t.day = anchor - (t.rn - 1)::int;
  return s;
end $$;

-- called once per visit by a signed-in member; returns {streak, new_today}
create or replace function public.do_checkin()
returns table (streak int, new_today boolean)
language plpgsql security definer set search_path = public as $$
declare inserted int;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then return; end if;
  insert into public.checkins (user_id, day) values (auth.uid(), (now() at time zone 'utc')::date) on conflict do nothing;
  get diagnostics inserted = row_count;
  return query select public.streak_of(auth.uid()), inserted > 0;
end $$;
grant execute on function public.do_checkin() to authenticated;

-- member_stats now also returns check-in days and current streak
drop function if exists public.member_stats(uuid[]);
create function public.member_stats(uids uuid[])
returns table (id uuid, posts bigint, likes bigint, comments bigint, trades bigint, followers bigint, join_rank bigint, checkins bigint, streak int)
language sql stable security definer set search_path = public as $$
  select p.id,
    (select count(*) from public.posts x where x.user_id = p.id),
    (select coalesce(sum(x.like_count), 0) from public.posts x where x.user_id = p.id),
    (select count(*) from public.post_comments c where c.user_id = p.id),
    (select count(*) from public.trades t where t.user_id = p.id),
    (select count(*) from public.follows f where f.following_id = p.id),
    (select count(*) from public.profiles q where q.created_at <= p.created_at),
    (select count(*) from public.checkins k where k.user_id = p.id),
    public.streak_of(p.id)
  from public.profiles p
  where p.id = any (uids[1:200]);
$$;
grant execute on function public.member_stats(uuid[]) to anon, authenticated;

-- ---------- direct messages (members who follow each other) ----------
create table if not exists public.dm_messages (
  id           bigint generated always as identity primary key,
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(btrim(body)) between 1 and 1000),
  read         boolean not null default false,
  created_at   timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index if not exists dm_pair_idx on public.dm_messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at desc);
create index if not exists dm_recipient_idx on public.dm_messages (recipient_id, read);
alter table public.dm_messages enable row level security;
revoke all on public.dm_messages from anon, authenticated;
grant select on public.dm_messages to authenticated;
grant insert (sender_id, recipient_id, body) on public.dm_messages to authenticated;
grant update (read) on public.dm_messages to authenticated;

create or replace function public.can_dm(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.follows where follower_id = a and following_id = b)
     and exists (select 1 from public.follows where follower_id = b and following_id = a);
$$;
grant execute on function public.can_dm(uuid, uuid) to authenticated;

drop policy if exists "read own dms" on public.dm_messages;
create policy "read own dms" on public.dm_messages for select using (auth.uid() in (sender_id, recipient_id));
drop policy if exists "send dm to mutual" on public.dm_messages;
create policy "send dm to mutual" on public.dm_messages for insert
  with check (sender_id = auth.uid() and public.can_post(auth.uid()) and public.can_dm(sender_id, recipient_id));
drop policy if exists "mark dm read" on public.dm_messages;
create policy "mark dm read" on public.dm_messages for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create or replace function public.dm_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.dm_messages where sender_id = new.sender_id and created_at > now() - interval '1 second') then
    raise exception 'Slow down';
  end if;
  new.created_at := now(); new.read := false;
  return new;
end $$;
drop trigger if exists dm_rate_limit on public.dm_messages;
create trigger dm_rate_limit before insert on public.dm_messages for each row execute function public.dm_rate_limit();

-- conversation list for the signed-in member
create or replace function public.dm_threads()
returns table (other_id uuid, last_body text, last_at timestamptz, last_from_me boolean, unread bigint)
language sql stable security invoker set search_path = public as $$
  with m as (
    select case when sender_id = auth.uid() then recipient_id else sender_id end as other,
           body, created_at, sender_id = auth.uid() as mine,
           (recipient_id = auth.uid() and not read) as unread
    from public.dm_messages where auth.uid() in (sender_id, recipient_id)
  )
  select other,
         (array_agg(body order by created_at desc))[1],
         max(created_at),
         (array_agg(mine order by created_at desc))[1],
         count(*) filter (where unread)
  from m group by other order by max(created_at) desc limit 100;
$$;
grant execute on function public.dm_threads() to authenticated;

do $$ begin alter publication supabase_realtime add table public.dm_messages; exception when duplicate_object then null; end $$;

-- ---------- Trending on FLOW: coins members posted about / traded in the last 24h ----------
create or replace function public.flow_trending(lim int default 12)
returns table (mint text, posts bigint, trades bigint, members bigint, score bigint)
language sql stable security definer set search_path = public as $$
  with a as (
    select coin_mint as mint, 1 as p, 0 as t, user_id from public.posts
      where coin_mint is not null and created_at > now() - interval '24 hours'
    union all
    select mint, 0, 1, user_id from public.trades where created_at > now() - interval '24 hours'
  )
  select mint, sum(p), sum(t), count(distinct user_id), sum(p) + sum(t) * 2 + count(distinct user_id) * 3
  from a group by mint
  order by 5 desc, 4 desc
  limit least(greatest(lim, 1), 30);
$$;
grant execute on function public.flow_trending(int) to anon, authenticated;
