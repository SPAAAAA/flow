-- =========================================================
-- FLOW social v4: verified trades + PnL, weekly competitions,
-- invite links, price alerts. Run after safety.sql. Safe to re-run.
-- =========================================================

-- ---------- trades are now written ONLY by the log-trade edge function,
-- which reads the transaction from the Solana blockchain first ----------
alter table public.trades add column if not exists tokens numeric check (tokens is null or tokens >= 0);
alter table public.trades add column if not exists verified boolean not null default false;
revoke insert on public.trades from authenticated;
revoke insert (user_id, mint, symbol, side, sol_amount, signature) on public.trades from authenticated;
drop policy if exists "log own trades" on public.trades;
create index if not exists trades_verified_idx on public.trades (created_at desc) where verified;

-- per-coin totals for one member (verified trades only)
create or replace function public.pnl_of(uid uuid)
returns table (mint text, symbol text, buy_sol numeric, sell_sol numeric, buy_tokens numeric, sell_tokens numeric, trades bigint, first_at timestamptz, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.mint, (array_agg(t.symbol order by t.created_at desc))[1],
    coalesce(sum(t.sol_amount) filter (where t.side = 'buy'), 0),
    coalesce(sum(t.sol_amount) filter (where t.side = 'sell'), 0),
    coalesce(sum(t.tokens) filter (where t.side = 'buy'), 0),
    coalesce(sum(t.tokens) filter (where t.side = 'sell'), 0),
    count(*), min(t.created_at), max(t.created_at)
  from public.trades t
  where t.user_id = uid and t.verified and t.tokens > 0
  group by t.mint order by max(t.created_at) desc limit 200;
$$;
grant execute on function public.pnl_of(uuid) to anon, authenticated;

-- realized profit (in SOL) per member for trades since a moment in time.
-- Only tokens bought AND sold in the window count, at the average buy price.
create or replace function public.top_traders(since timestamptz default '-infinity', lim int default 50)
returns table (user_id uuid, pnl numeric, volume numeric, trades bigint, wins bigint, coins bigint)
language sql stable security definer set search_path = public as $$
  with per as (
    select t.user_id, t.mint,
      coalesce(sum(t.sol_amount) filter (where t.side = 'buy'), 0) bs,
      coalesce(sum(t.tokens) filter (where t.side = 'buy'), 0) bt,
      coalesce(sum(t.sol_amount) filter (where t.side = 'sell'), 0) ss,
      coalesce(sum(t.tokens) filter (where t.side = 'sell'), 0) st,
      count(*) n
    from public.trades t
    where t.verified and t.tokens > 0 and t.created_at >= since
    group by t.user_id, t.mint
  ), r as (
    select user_id, n, bs + ss vol,
      case when st > 0 and bt > 0 then (least(st, bt) / st) * ss - least(st, bt) * (bs / bt) else 0 end p
    from per
  )
  select r.user_id, round(sum(r.p), 6), round(sum(r.vol), 6), sum(r.n)::bigint, count(*) filter (where r.p > 0), count(*)
  from r join public.profiles pr on pr.id = r.user_id and not pr.banned
  group by r.user_id
  having sum(r.vol) >= 0.05 and sum(r.p) <> 0
  order by 2 desc
  limit least(greatest(lim, 1), 100);
$$;
grant execute on function public.top_traders(timestamptz, int) to anon, authenticated;

-- ---------- weekly competitions ----------
create table if not exists public.week_winners (
  week      date not null,                      -- monday (UTC) the week started
  category  text not null check (category in ('trader','call','poster')),
  user_id   uuid not null references public.profiles(id) on delete cascade,
  value     numeric,
  detail    text check (detail is null or char_length(detail) <= 200),
  created_at timestamptz not null default now(),
  primary key (week, category)
);
alter table public.week_winners enable row level security;
revoke all on public.week_winners from anon, authenticated;
grant select on public.week_winners to anon, authenticated;
drop policy if exists "winners readable" on public.week_winners;
create policy "winners readable" on public.week_winners for select using (true);

create or replace function public.week_start(t timestamptz default now()) returns date
language sql immutable as $$ select date_trunc('week', t at time zone 'utc')::date $$;

-- anyone may call this; it only ever records what the data says.
-- Crowns last week's top trader (realized PnL) and top poster (likes received).
create or replace function public.award_last_week() returns void
language plpgsql security definer set search_path = public as $$
declare wk date := public.week_start(now()) - 7; s timestamptz; e timestamptz; w record;
begin
  s := (wk::timestamp at time zone 'utc'); e := s + interval '7 days';
  if not exists (select 1 from public.week_winners where week = wk and category = 'trader') then
    with per as (
      select t.user_id, t.mint,
        coalesce(sum(t.sol_amount) filter (where t.side = 'buy'), 0) bs, coalesce(sum(t.tokens) filter (where t.side = 'buy'), 0) bt,
        coalesce(sum(t.sol_amount) filter (where t.side = 'sell'), 0) ss, coalesce(sum(t.tokens) filter (where t.side = 'sell'), 0) st
      from public.trades t where t.verified and t.tokens > 0 and t.created_at >= s and t.created_at < e group by 1, 2
    )
    select per.user_id, sum(case when st > 0 and bt > 0 then (least(st, bt) / st) * ss - least(st, bt) * (bs / bt) else 0 end) p
      into w from per join public.profiles pr on pr.id = per.user_id and not pr.banned
      group by per.user_id having sum(bs + ss) >= 0.05 order by 2 desc limit 1;
    if w.user_id is not null and w.p > 0 then
      insert into public.week_winners (week, category, user_id, value, detail) values (wk, 'trader', w.user_id, round(w.p, 4), round(w.p, 4) || ' SOL profit') on conflict do nothing;
    end if;
  end if;
  if not exists (select 1 from public.week_winners where week = wk and category = 'poster') then
    select x.user_id, count(*) c into w
      from public.post_likes l join public.posts x on x.id = l.post_id join public.profiles pr on pr.id = x.user_id and not pr.banned
      where l.created_at >= s and l.created_at < e and l.user_id <> x.user_id
      group by x.user_id having count(*) >= 3 order by 2 desc limit 1;
    if w.user_id is not null then
      insert into public.week_winners (week, category, user_id, value, detail) values (wk, 'poster', w.user_id, w.c, w.c || ' likes') on conflict do nothing;
    end if;
  end if;
end $$;
grant execute on function public.award_last_week() to anon, authenticated;

-- best call needs live price history, so an admin confirms it (the admin page computes it)
create or replace function public.admin_award_call(wk date, uid uuid, gain numeric, info text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'admins only'; end if;
  if wk >= public.week_start(now()) then raise exception 'That week is not over yet'; end if;
  insert into public.week_winners (week, category, user_id, value, detail) values (wk, 'call', uid, gain, left(info, 200))
    on conflict (week, category) do update set user_id = excluded.user_id, value = excluded.value, detail = excluded.detail;
end $$;
grant execute on function public.admin_award_call(date, uuid, numeric, text) to authenticated;

-- posts that are calls this week (have a coin), for the "best call" race
create or replace function public.week_calls(wk date default null)
returns table (id bigint, user_id uuid, coin_mint text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.user_id, p.coin_mint, p.body, p.created_at
  from public.posts p join public.profiles pr on pr.id = p.user_id and not pr.banned
  where p.created_at >= (coalesce(wk, public.week_start(now()))::timestamp at time zone 'utc')
    and p.created_at < (coalesce(wk, public.week_start(now()))::timestamp at time zone 'utc') + interval '7 days'
    and (p.coin_mint is not null or p.body ~ '[1-9A-HJ-NP-Za-km-z]{32,44}')
  order by p.created_at desc limit 300;
$$;
grant execute on function public.week_calls(date) to anon, authenticated;

-- ---------- invite links ----------
alter table public.profiles add column if not exists referred_by uuid references public.profiles(id) on delete set null;
create index if not exists profiles_ref_idx on public.profiles (referred_by) where referred_by is not null;

-- code = first 8 characters of the inviter's wallet
create or replace function public.set_referrer(code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare me public.profiles; ref uuid; n int;
begin
  if auth.uid() is null or code !~ '^[1-9A-HJ-NP-Za-km-z]{6,44}$' then return false; end if;
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.referred_by is not null or me.created_at < now() - interval '1 day' then return false; end if;
  select count(*), min(id::text)::uuid into n, ref from public.profiles where wallet like code || '%' and id <> me.id and created_at < me.created_at;
  if n <> 1 then return false; end if;
  update public.profiles set referred_by = ref where id = me.id;
  return true;
end $$;
grant execute on function public.set_referrer(text) to authenticated;

-- ---------- member_stats: + weekly wins + invites ----------
drop function if exists public.member_stats(uuid[]);
create function public.member_stats(uids uuid[])
returns table (id uuid, posts bigint, likes bigint, comments bigint, trades bigint, followers bigint, join_rank bigint, checkins bigint, streak int, wins bigint, invites bigint)
language sql stable security definer set search_path = public as $$
  select p.id,
    (select count(*) from public.posts x where x.user_id = p.id),
    (select coalesce(sum(x.like_count), 0) from public.posts x where x.user_id = p.id),
    (select count(*) from public.post_comments c where c.user_id = p.id),
    (select count(*) from public.trades t where t.user_id = p.id),
    (select count(*) from public.follows f where f.following_id = p.id),
    (select count(*) from public.profiles q where q.created_at <= p.created_at),
    (select count(*) from public.checkins k where k.user_id = p.id),
    public.streak_of(p.id),
    (select count(*) from public.week_winners w where w.user_id = p.id),
    (select count(*) from public.profiles r where r.referred_by = p.id)
  from public.profiles p
  where p.id = any (uids[1:200]);
$$;
grant execute on function public.member_stats(uuid[]) to anon, authenticated;

-- ---------- price alerts ----------
create table if not exists public.price_alerts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  mint         text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  symbol       text check (symbol is null or char_length(symbol) <= 20),
  direction    text not null check (direction in ('above','below')),
  price        numeric not null check (price > 0),
  base_price   numeric check (base_price is null or base_price > 0),
  label        text check (label is null or char_length(label) <= 40),
  created_at   timestamptz not null default now(),
  triggered_at timestamptz
);
create index if not exists price_alerts_user_idx on public.price_alerts (user_id, triggered_at);
alter table public.price_alerts enable row level security;
revoke all on public.price_alerts from anon, authenticated;
grant select, delete on public.price_alerts to authenticated;
grant insert (user_id, mint, symbol, direction, price, base_price, label) on public.price_alerts to authenticated;
grant update (triggered_at) on public.price_alerts to authenticated;
drop policy if exists "own alerts" on public.price_alerts;
create policy "own alerts" on public.price_alerts for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.alerts_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.price_alerts where user_id = new.user_id and triggered_at is null) >= 30 then
    raise exception 'You can have up to 30 active alerts';
  end if;
  new.created_at := now(); new.triggered_at := null;
  return new;
end $$;
drop trigger if exists alerts_limit on public.price_alerts;
create trigger alerts_limit before insert on public.price_alerts for each row execute function public.alerts_limit();

-- current-week poster race (likes received from others since Monday UTC)
create or replace function public.week_posters(lim int default 5)
returns table (user_id uuid, likes bigint)
language sql stable security definer set search_path = public as $$
  select x.user_id, count(*)
  from public.post_likes l join public.posts x on x.id = l.post_id join public.profiles pr on pr.id = x.user_id and not pr.banned
  where l.created_at >= (public.week_start(now())::timestamp at time zone 'utc') and l.user_id <> x.user_id
  group by x.user_id order by 2 desc limit least(greatest(lim, 1), 20);
$$;
grant execute on function public.week_posters(int) to anon, authenticated;
