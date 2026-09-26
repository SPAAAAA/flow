-- =========================================================
-- FLOW social v5: seasons & ranks, cosmetics, verified tips + top supporters,
-- live coin rooms. Run after achievements.sql. Safe to re-run.
-- =========================================================

-- ---------- cosmetics (unlocked through achievements) ----------
alter table public.profiles add column if not exists cos_frame text check (cos_frame is null or cos_frame in ('wave','emerald','sapphire','amethyst','gold','prism','founder'));
alter table public.profiles add column if not exists cos_name  text check (cos_name  is null or cos_name  in ('blue','green','ice','violet','gold','rainbow'));
alter table public.profiles add column if not exists cos_fx    text check (cos_fx    is null or cos_fx    in ('sparkle','waves','aurora','goldrays'));
grant update (name, avatar_url, last_seen, bio, banner_url, x_handle, tiktok_handle, cos_frame, cos_name, cos_fx) on public.profiles to authenticated;

-- the founder frame is only for the founder wallet
create or replace function public.cosmetics_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cos_frame = 'founder' and new.wallet <> '5ZfqZdmid5jMVixfTZULPNvzRKtxxfCXYW6Xn8E6yDn7' then new.cos_frame := null; end if;
  return new;
end $$;
drop trigger if exists cosmetics_guard on public.profiles;
create trigger cosmetics_guard before update of cos_frame on public.profiles for each row execute function public.cosmetics_guard();

-- ---------- notifications: allow tips ----------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like','comment','follow','buy','sell','mention','tip'));

-- ---------- tips (SOL sent between members, written only by the log-trade function after reading the chain) ----------
create table if not exists public.tips (
  id               bigint generated always as identity primary key,
  sender_id        uuid not null references public.profiles(id) on delete cascade,
  recipient_wallet text not null check (recipient_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  recipient_id     uuid references public.profiles(id) on delete set null,
  lamports         bigint not null check (lamports > 0),
  signature        text not null unique,
  created_at       timestamptz not null default now()
);
create index if not exists tips_recipient_idx on public.tips (recipient_wallet, created_at desc);
alter table public.tips enable row level security;
revoke all on public.tips from anon, authenticated;
grant select on public.tips to anon, authenticated;
drop policy if exists "tips readable" on public.tips;
create policy "tips readable" on public.tips for select using (true);

create or replace function public.notify_tip() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.recipient_id is not null and new.recipient_id <> new.sender_id then
    insert into public.notifications (user_id, actor_id, type, sol_amount) values (new.recipient_id, new.sender_id, 'tip', new.lamports / 1e9);
  end if;
  return null;
end $$;
drop trigger if exists notify_tip on public.tips;
create trigger notify_tip after insert on public.tips for each row execute function public.notify_tip();

create or replace function public.top_supporters(w text, lim int default 10)
returns table (sender_id uuid, sol numeric, tips bigint, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.sender_id, round(sum(t.lamports) / 1e9, 6), count(*), max(t.created_at)
  from public.tips t where t.recipient_wallet = w
  group by t.sender_id order by 2 desc limit least(greatest(lim, 1), 50);
$$;
grant execute on function public.top_supporters(text, int) to anon, authenticated;

create or replace function public.tips_summary(w text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'received_sol', coalesce((select sum(lamports) from public.tips where recipient_wallet = w), 0) / 1e9,
    'received_n',   (select count(*) from public.tips where recipient_wallet = w),
    'supporters',   (select count(distinct sender_id) from public.tips where recipient_wallet = w));
$$;
grant execute on function public.tips_summary(text) to anon, authenticated;

-- ---------- live coin rooms ----------
create table if not exists public.coin_chat (
  id         bigint generated always as identity primary key,
  mint       text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 280),
  created_at timestamptz not null default now()
);
create index if not exists coin_chat_mint_idx on public.coin_chat (mint, created_at desc);
alter table public.coin_chat enable row level security;
revoke all on public.coin_chat from anon, authenticated;
grant select on public.coin_chat to anon, authenticated;
grant insert (mint, user_id, body), delete on public.coin_chat to authenticated;
drop policy if exists "rooms readable" on public.coin_chat;
create policy "rooms readable" on public.coin_chat for select using (true);
drop policy if exists "room as yourself" on public.coin_chat;
create policy "room as yourself" on public.coin_chat for insert with check (user_id = auth.uid() and public.can_post(auth.uid()));
drop policy if exists "room delete own or admin" on public.coin_chat;
create policy "room delete own or admin" on public.coin_chat for delete using (user_id = auth.uid() or public.is_admin(auth.uid()));

create or replace function public.room_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.coin_chat where user_id = new.user_id and created_at > now() - interval '2 seconds') then
    raise exception 'Slow down — wait a second between messages';
  end if;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists room_rate_limit on public.coin_chat;
create trigger room_rate_limit before insert on public.coin_chat for each row execute function public.room_rate_limit();
do $$ begin alter publication supabase_realtime add table public.coin_chat; exception when duplicate_object then null; end $$;

-- ---------- seasons (calendar months, UTC) ----------
create or replace function public.season_start(t timestamptz default now()) returns date
language sql immutable as $$ select date_trunc('month', t at time zone 'utc')::date $$;

-- season points: posts x10, likes received x3, comments x4, verified trades x8,
-- check-in days x5, friends invited x100, realized profit (SOL) x50
create or replace function public.season_board(ss date default null, lim int default 50)
returns table (user_id uuid, points bigint, posts bigint, likes bigint, comments bigint, trades bigint, checkins bigint, invites bigint, profit numeric)
language sql stable security definer set search_path = public as $$
  with b as (select coalesce(ss, public.season_start(now())) s),
  w as (select (s::timestamp at time zone 'utc') a, ((s + interval '1 month')::timestamp at time zone 'utc') z, s from b),
  pp as (select x.user_id u, count(*) n from public.posts x, w where x.created_at >= w.a and x.created_at < w.z group by 1),
  lk as (select x.user_id u, count(*) n from public.post_likes l join public.posts x on x.id = l.post_id, w where l.created_at >= w.a and l.created_at < w.z and l.user_id <> x.user_id group by 1),
  cm as (select c.user_id u, count(*) n from public.post_comments c, w where c.created_at >= w.a and c.created_at < w.z group by 1),
  tr as (select t.user_id u, count(*) n from public.trades t, w where t.verified and t.created_at >= w.a and t.created_at < w.z group by 1),
  ck as (select k.user_id u, count(*) n from public.checkins k, w where k.day >= w.s and k.day < (w.s + interval '1 month')::date group by 1),
  iv as (select r.referred_by u, count(*) n from public.profiles r, w where r.referred_by is not null and r.created_at >= w.a and r.created_at < w.z group by 1),
  per as (select t.user_id u, t.mint,
            coalesce(sum(t.sol_amount) filter (where t.side = 'buy'), 0) bs, coalesce(sum(t.tokens) filter (where t.side = 'buy'), 0) bt,
            coalesce(sum(t.sol_amount) filter (where t.side = 'sell'), 0) ss2, coalesce(sum(t.tokens) filter (where t.side = 'sell'), 0) st
          from public.trades t, w where t.verified and t.tokens > 0 and t.created_at >= w.a and t.created_at < w.z group by 1, 2),
  pf as (select u, sum(case when st > 0 and bt > 0 then (least(st, bt) / st) * ss2 - least(st, bt) * (bs / bt) else 0 end) n from per group by 1),
  us as (select u from pp union select u from lk union select u from cm union select u from tr union select u from ck union select u from iv)
  select us.u,
    (coalesce(pp.n, 0) * 10 + coalesce(lk.n, 0) * 3 + coalesce(cm.n, 0) * 4 + coalesce(tr.n, 0) * 8 + coalesce(ck.n, 0) * 5 + coalesce(iv.n, 0) * 100
      + greatest(0, round(coalesce(pf.n, 0) * 50)))::bigint,
    coalesce(pp.n, 0), coalesce(lk.n, 0), coalesce(cm.n, 0), coalesce(tr.n, 0), coalesce(ck.n, 0), coalesce(iv.n, 0), round(coalesce(pf.n, 0), 4)
  from us
  join public.profiles pr on pr.id = us.u and not pr.banned
  left join pp on pp.u = us.u left join lk on lk.u = us.u left join cm on cm.u = us.u left join tr on tr.u = us.u
  left join ck on ck.u = us.u left join iv on iv.u = us.u left join pf on pf.u = us.u
  order by 2 desc
  limit least(greatest(lim, 1), 1000);
$$;
grant execute on function public.season_board(date, int) to anon, authenticated;

create or replace function public.season_rank_name(p bigint) returns text
language sql immutable as $$
  select case when p >= 5000 then 'legend' when p >= 2000 then 'diamond' when p >= 750 then 'gold' when p >= 250 then 'silver' else 'bronze' end
$$;

-- end-of-season rewards (idempotent; anyone may trigger it, it only records what the data says)
create table if not exists public.season_rewards (
  season  date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  points  bigint not null,
  rank    text not null check (rank in ('bronze','silver','gold','diamond','legend')),
  place   int not null,
  primary key (season, user_id)
);
alter table public.season_rewards enable row level security;
revoke all on public.season_rewards from anon, authenticated;
grant select on public.season_rewards to anon, authenticated;
drop policy if exists "season rewards readable" on public.season_rewards;
create policy "season rewards readable" on public.season_rewards for select using (true);

create or replace function public.award_last_season() returns void
language plpgsql security definer set search_path = public as $$
declare last date := (public.season_start(now()) - interval '1 month')::date;
begin
  if exists (select 1 from public.season_rewards where season = last) then return; end if;
  insert into public.season_rewards (season, user_id, points, rank, place)
    select last, b.user_id, b.points, public.season_rank_name(b.points), row_number() over (order by b.points desc)
    from public.season_board(last, 1000) b where b.points > 0
    on conflict do nothing;
end $$;
grant execute on function public.award_last_season() to anon, authenticated;
