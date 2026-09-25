-- =========================================================
-- FLOW social v2: coin threads, follows, notifications, trade log
-- Run after schema.sql and posts.sql. Safe to re-run.
-- =========================================================

-- ---------- coin threads: a post can belong to a coin ----------
alter table public.posts add column if not exists coin_mint text
  check (coin_mint is null or coin_mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$');
create index if not exists posts_coin_idx on public.posts (coin_mint, created_at desc) where coin_mint is not null;
grant insert (user_id, body, coin_mint) on public.posts to authenticated;

-- ---------- follows ----------
create table if not exists public.follows (
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id);
alter table public.follows enable row level security;
revoke all on public.follows from anon, authenticated;
grant select on public.follows to anon, authenticated;
grant insert (follower_id, following_id), delete on public.follows to authenticated;
drop policy if exists "follows readable" on public.follows;
create policy "follows readable" on public.follows for select using (true);
drop policy if exists "follow as yourself" on public.follows;
create policy "follow as yourself" on public.follows for insert with check (follower_id = auth.uid() and public.can_post(auth.uid()));
drop policy if exists "unfollow own" on public.follows;
create policy "unfollow own" on public.follows for delete using (follower_id = auth.uid());

create or replace function public.follow_counts(uid uuid)
returns table (followers bigint, following bigint)
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.follows where following_id = uid),
         (select count(*) from public.follows where follower_id = uid);
$$;
grant execute on function public.follow_counts(uuid) to anon, authenticated;

-- ---------- trades made on FLOW (for "someone you follow bought ...") ----------
create table if not exists public.trades (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  mint       text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  symbol     text check (symbol is null or char_length(symbol) <= 20),
  side       text not null check (side in ('buy','sell')),
  sol_amount numeric check (sol_amount is null or (sol_amount >= 0 and sol_amount < 1000000)),
  signature  text not null unique check (signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,90}$'),
  created_at timestamptz not null default now()
);
create index if not exists trades_user_idx on public.trades (user_id, created_at desc);
alter table public.trades enable row level security;
revoke all on public.trades from anon, authenticated;
grant select on public.trades to anon, authenticated;
grant insert (user_id, mint, symbol, side, sol_amount, signature) on public.trades to authenticated;
drop policy if exists "trades readable" on public.trades;
create policy "trades readable" on public.trades for select using (true);
drop policy if exists "log own trades" on public.trades;
create policy "log own trades" on public.trades for insert with check (user_id = auth.uid());

-- ---------- notifications ----------
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,   -- who receives it
  actor_id   uuid not null references public.profiles(id) on delete cascade,   -- who did it
  type       text not null check (type in ('like','comment','follow','buy','sell')),
  post_id    bigint references public.posts(id) on delete cascade,
  mint       text,
  symbol     text,
  sol_amount numeric,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;
drop policy if exists "see own notifications" on public.notifications;
create policy "see own notifications" on public.notifications for select using (user_id = auth.uid());
drop policy if exists "mark own read" on public.notifications;
create policy "mark own read" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "clear own" on public.notifications;
create policy "clear own" on public.notifications for delete using (user_id = auth.uid());

-- create notifications automatically (users can never insert them directly)
create or replace function public.make_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if tg_table_name = 'post_likes' then
    select user_id into owner from public.posts where id = new.post_id;
    if owner is not null and owner <> new.user_id and not exists (
      select 1 from public.notifications where user_id = owner and actor_id = new.user_id and type = 'like' and post_id = new.post_id) then
      insert into public.notifications (user_id, actor_id, type, post_id) values (owner, new.user_id, 'like', new.post_id);
    end if;
  elsif tg_table_name = 'post_comments' then
    select user_id into owner from public.posts where id = new.post_id;
    if owner is not null and owner <> new.user_id then
      insert into public.notifications (user_id, actor_id, type, post_id) values (owner, new.user_id, 'comment', new.post_id);
    end if;
  elsif tg_table_name = 'follows' then
    if not exists (select 1 from public.notifications where user_id = new.following_id and actor_id = new.follower_id and type = 'follow' and created_at > now() - interval '1 day') then
      insert into public.notifications (user_id, actor_id, type) values (new.following_id, new.follower_id, 'follow');
    end if;
  elsif tg_table_name = 'trades' then
    insert into public.notifications (user_id, actor_id, type, mint, symbol, sol_amount)
      select f.follower_id, new.user_id, new.side, new.mint, new.symbol, new.sol_amount
      from public.follows f where f.following_id = new.user_id
      limit 5000;
  end if;
  return null;
end $$;
drop trigger if exists notify_like on public.post_likes;
create trigger notify_like after insert on public.post_likes for each row execute function public.make_notification();
drop trigger if exists notify_comment on public.post_comments;
create trigger notify_comment after insert on public.post_comments for each row execute function public.make_notification();
drop trigger if exists notify_follow on public.follows;
create trigger notify_follow after insert on public.follows for each row execute function public.make_notification();
drop trigger if exists notify_trade on public.trades;
create trigger notify_trade after insert on public.trades for each row execute function public.make_notification();

-- live updates
do $$ begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end $$;
