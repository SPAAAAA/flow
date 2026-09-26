-- =========================================================
-- FLOW teams v2: coin calls to your team (+ notifications) and
-- private team voice rooms (realtime authorization). Run after teams.sql.
-- =========================================================

create table if not exists public.team_calls (
  id         bigint generated always as identity primary key,
  team_id    bigint not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  mint       text not null check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  symbol     text check (symbol is null or char_length(symbol) <= 20),
  note       text check (note is null or char_length(note) <= 140),
  created_at timestamptz not null default now()
);
create index if not exists team_calls_idx on public.team_calls (team_id, created_at desc);
alter table public.team_calls enable row level security;
revoke all on public.team_calls from anon, authenticated;
grant select, delete on public.team_calls to authenticated;
grant insert (team_id, user_id, mint, symbol, note) on public.team_calls to authenticated;
drop policy if exists "team calls for members" on public.team_calls;
create policy "team calls for members" on public.team_calls for select using (public.team_of(auth.uid()) = team_id);
drop policy if exists "call to own team" on public.team_calls;
create policy "call to own team" on public.team_calls for insert
  with check (user_id = auth.uid() and public.team_of(auth.uid()) = team_id and public.can_post(auth.uid()));
drop policy if exists "delete own call or officer" on public.team_calls;
create policy "delete own call or officer" on public.team_calls for delete
  using (user_id = auth.uid() or public.team_role(auth.uid(), team_id) in ('owner','officer'));

create or replace function public.team_call_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.team_calls where user_id = new.user_id and created_at > now() - interval '60 seconds') then
    raise exception 'One call per minute — give the team a moment';
  end if;
  if (select count(*) from public.team_calls where user_id = new.user_id and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'Daily call limit reached (20)';
  end if;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists team_call_guard on public.team_calls;
create trigger team_call_guard before insert on public.team_calls for each row execute function public.team_call_guard();

-- notify every teammate
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like','comment','follow','buy','sell','mention','tip','team_call'));
create or replace function public.notify_team_call() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, actor_id, type, mint, symbol)
    select m.user_id, new.user_id, 'team_call', new.mint, new.symbol
    from public.team_members m where m.team_id = new.team_id and m.user_id <> new.user_id;
  return null;
end $$;
drop trigger if exists notify_team_call on public.team_calls;
create trigger notify_team_call after insert on public.team_calls for each row execute function public.notify_team_call();
do $$ begin alter publication supabase_realtime add table public.team_calls; exception when duplicate_object then null; end $$;

-- ---------- private team voice: only members may use the "voice-team-<id>" realtime channel ----------
drop policy if exists "team voice read" on realtime.messages;
create policy "team voice read" on realtime.messages for select to authenticated
  using (realtime.topic() = 'voice-team-' || public.team_of(auth.uid())::text);
drop policy if exists "team voice write" on realtime.messages;
create policy "team voice write" on realtime.messages for insert to authenticated
  with check (realtime.topic() = 'voice-team-' || public.team_of(auth.uid())::text);

-- ---------- achievements: add team call count ----------
create or replace function public.team_stats(uid uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'in_team',    public.team_of(uid) is not null,
    'team_owner', exists (select 1 from public.teams where owner_id = uid),
    'team_size',  coalesce((select count(*) from public.team_members m where m.team_id = public.team_of(uid)), 0),
    'team_msgs',  (select count(*) from public.team_chat c where c.user_id = uid),
    'team_calls', (select count(*) from public.team_calls c where c.user_id = uid),
    'team_rank',  (select r from (select b.team_id, row_number() over (order by b.points desc) r from public.team_board(200) b) x where x.team_id = public.team_of(uid))
  );
$$;
grant execute on function public.team_stats(uuid) to anon, authenticated;
