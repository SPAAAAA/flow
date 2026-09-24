-- =========================================================
-- FLOW posts: a Twitter-style feed with likes and comments
-- Run once in Supabase → SQL Editor (after schema.sql). Safe to re-run.
-- =========================================================

create table if not exists public.posts (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  body          text not null check (char_length(btrim(body)) between 1 and 500),
  like_count    integer not null default 0,
  comment_count integer not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_user_idx on public.posts (user_id, created_at desc);

create table if not exists public.post_likes (
  post_id    bigint not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_likes_recent_idx on public.post_likes (created_at desc);
create index if not exists post_likes_user_idx on public.post_likes (user_id);

create table if not exists public.post_comments (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);

-- ---------- security ----------
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;

revoke all on public.posts, public.post_likes, public.post_comments from anon, authenticated;
grant select on public.posts, public.post_likes, public.post_comments to anon, authenticated;
grant insert (user_id, body), delete on public.posts to authenticated;
grant insert (post_id, user_id), delete on public.post_likes to authenticated;
grant insert (post_id, user_id, body), delete on public.post_comments to authenticated;

create or replace function public.can_post(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = uid and not p.banned);
$$;
create or replace function public.is_admin(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = uid and p.is_admin);
$$;

drop policy if exists "posts readable" on public.posts;
create policy "posts readable" on public.posts for select using (true);
drop policy if exists "post as yourself" on public.posts;
create policy "post as yourself" on public.posts for insert with check (user_id = auth.uid() and public.can_post(auth.uid()));
drop policy if exists "delete own post or admin" on public.posts;
create policy "delete own post or admin" on public.posts for delete using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "likes readable" on public.post_likes;
create policy "likes readable" on public.post_likes for select using (true);
drop policy if exists "like as yourself" on public.post_likes;
create policy "like as yourself" on public.post_likes for insert with check (user_id = auth.uid() and public.can_post(auth.uid()));
drop policy if exists "unlike own" on public.post_likes;
create policy "unlike own" on public.post_likes for delete using (user_id = auth.uid());

drop policy if exists "comments readable" on public.post_comments;
create policy "comments readable" on public.post_comments for select using (true);
drop policy if exists "comment as yourself" on public.post_comments;
create policy "comment as yourself" on public.post_comments for insert with check (user_id = auth.uid() and public.can_post(auth.uid()));
drop policy if exists "delete own comment or admin" on public.post_comments;
create policy "delete own comment or admin" on public.post_comments for delete using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- ---------- slow mode ----------
create or replace function public.posts_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.posts where user_id = new.user_id and created_at > now() - interval '20 seconds') then
    raise exception 'Slow down — you can post again in a few seconds';
  end if;
  new.created_at := now(); new.like_count := 0; new.comment_count := 0;
  return new;
end $$;
drop trigger if exists posts_rate_limit on public.posts;
create trigger posts_rate_limit before insert on public.posts for each row execute function public.posts_rate_limit();

create or replace function public.comments_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.post_comments where user_id = new.user_id and created_at > now() - interval '5 seconds') then
    raise exception 'Slow down — wait a few seconds between comments';
  end if;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists comments_rate_limit on public.post_comments;
create trigger comments_rate_limit before insert on public.post_comments for each row execute function public.comments_rate_limit();

-- ---------- keep like / comment counters in sync ----------
create or replace function public.post_counters() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'post_likes' then
    if tg_op = 'INSERT' then update public.posts set like_count = like_count + 1 where id = new.post_id;
    else update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id; end if;
  else
    if tg_op = 'INSERT' then update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    else update public.posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id; end if;
  end if;
  return null;
end $$;
drop trigger if exists likes_counter on public.post_likes;
create trigger likes_counter after insert or delete on public.post_likes for each row execute function public.post_counters();
drop trigger if exists comments_counter on public.post_comments;
create trigger comments_counter after insert or delete on public.post_comments for each row execute function public.post_counters();

-- ---------- trending: most likes received in the last 24 hours ----------
create or replace function public.trending_posts(lim int default 50)
returns table (id bigint, recent_likes bigint)
language sql stable security definer set search_path = public as $$
  select l.post_id as id, count(*) as recent_likes
  from public.post_likes l
  where l.created_at > now() - interval '24 hours'
  group by l.post_id
  order by count(*) desc, max(l.created_at) desc
  limit least(greatest(lim, 1), 100);
$$;
grant execute on function public.trending_posts(int) to anon, authenticated;

-- ---------- live updates ----------
do $$ begin alter publication supabase_realtime add table public.posts; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.post_comments; exception when duplicate_object then null; end $$;
