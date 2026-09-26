-- =========================================================
-- FLOW teams: up to 50 members, owner / officers / members,
-- open or request-to-join, private team chat, season team board.
-- Run after social5.sql. Safe to re-run.
-- =========================================================

create table if not exists public.teams (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(btrim(name)) between 3 and 24 and name ~ '^[A-Za-z0-9 _.\-]+$'),
  tag         text not null check (tag ~ '^[A-Z0-9]{2,5}$'),
  description text check (description is null or char_length(description) <= 200),
  emblem      text not null default '🌊' check (char_length(emblem) <= 8),
  color       text not null default 'blue' check (color in ('blue','green','purple','gold','red','pink','cyan','orange')),
  join_mode   text not null default 'open' check (join_mode in ('open','request')),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create unique index if not exists teams_name_uq on public.teams (lower(name));
create unique index if not exists teams_tag_uq on public.teams (tag);

create table if not exists public.team_members (
  team_id   bigint not null references public.teams(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','officer','member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create unique index if not exists team_members_one_team on public.team_members (user_id);  -- one team per member

create table if not exists public.team_requests (
  team_id    bigint not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.team_chat (
  id         bigint generated always as identity primary key,
  team_id    bigint not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists team_chat_idx on public.team_chat (team_id, created_at desc);

-- ---------- security: everything is changed through the functions below ----------
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_requests enable row level security;
alter table public.team_chat enable row level security;
revoke all on public.teams, public.team_members, public.team_requests, public.team_chat from anon, authenticated;
grant select on public.teams, public.team_members to anon, authenticated;
grant select on public.team_requests to authenticated;
grant select, delete on public.team_chat to authenticated;
grant insert (team_id, user_id, body) on public.team_chat to authenticated;

create or replace function public.team_of(uid uuid) returns bigint
language sql stable security definer set search_path = public as $$ select team_id from public.team_members where user_id = uid $$;
create or replace function public.team_role(uid uuid, tid bigint) returns text
language sql stable security definer set search_path = public as $$ select role from public.team_members where user_id = uid and team_id = tid $$;

drop policy if exists "teams readable" on public.teams;
create policy "teams readable" on public.teams for select using (true);
drop policy if exists "members readable" on public.team_members;
create policy "members readable" on public.team_members for select using (true);
drop policy if exists "requests visible" on public.team_requests;
create policy "requests visible" on public.team_requests for select
  using (user_id = auth.uid() or public.team_role(auth.uid(), team_id) in ('owner','officer'));
drop policy if exists "team chat for members" on public.team_chat;
create policy "team chat for members" on public.team_chat for select using (public.team_of(auth.uid()) = team_id);
drop policy if exists "team chat post" on public.team_chat;
create policy "team chat post" on public.team_chat for insert
  with check (user_id = auth.uid() and public.team_of(auth.uid()) = team_id and public.can_post(auth.uid()));
drop policy if exists "team chat delete" on public.team_chat;
create policy "team chat delete" on public.team_chat for delete
  using (user_id = auth.uid() or public.team_role(auth.uid(), team_id) in ('owner','officer') or public.is_admin(auth.uid()));

create or replace function public.team_chat_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.team_chat where user_id = new.user_id and created_at > now() - interval '2 seconds') then
    raise exception 'Slow down — wait a second between messages';
  end if;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists team_chat_limit on public.team_chat;
create trigger team_chat_limit before insert on public.team_chat for each row execute function public.team_chat_limit();
do $$ begin alter publication supabase_realtime add table public.team_chat; exception when duplicate_object then null; end $$;

-- hard cap: 50 members per team
create or replace function public.team_cap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.team_members where team_id = new.team_id) >= 50 then
    raise exception 'This team is full (50 members)';
  end if;
  return new;
end $$;
drop trigger if exists team_cap on public.team_members;
create trigger team_cap before insert on public.team_members for each row execute function public.team_cap();

-- ---------- actions ----------
create or replace function public.team_create(p_name text, p_tag text, p_desc text, p_emblem text, p_color text, p_mode text) returns bigint
language plpgsql security definer set search_path = public as $$
declare tid bigint;
begin
  if auth.uid() is null or not public.can_post(auth.uid()) then raise exception 'Sign in first'; end if;
  if public.team_of(auth.uid()) is not null then raise exception 'Leave your current team first'; end if;
  insert into public.teams (name, tag, description, emblem, color, join_mode, owner_id)
    values (btrim(p_name), upper(btrim(p_tag)), nullif(btrim(p_desc), ''), coalesce(nullif(p_emblem, ''), '🌊'), coalesce(p_color, 'blue'), coalesce(p_mode, 'open'), auth.uid())
    returning id into tid;
  insert into public.team_members (team_id, user_id, role) values (tid, auth.uid(), 'owner');
  delete from public.team_requests where user_id = auth.uid();
  return tid;
exception when unique_violation then raise exception 'That team name or tag is already taken';
end $$;
grant execute on function public.team_create(text, text, text, text, text, text) to authenticated;

create or replace function public.team_update(p_name text, p_desc text, p_emblem text, p_color text, p_mode text) returns void
language plpgsql security definer set search_path = public as $$
declare tid bigint := public.team_of(auth.uid());
begin
  if tid is null or public.team_role(auth.uid(), tid) <> 'owner' then raise exception 'Only the team owner can change settings'; end if;
  update public.teams set name = btrim(p_name), description = nullif(btrim(p_desc), ''), emblem = coalesce(nullif(p_emblem, ''), emblem),
    color = coalesce(p_color, color), join_mode = coalesce(p_mode, join_mode) where id = tid;
exception when unique_violation then raise exception 'That team name is already taken';
end $$;
grant execute on function public.team_update(text, text, text, text, text) to authenticated;

-- join an open team, or send a request to a request-only team. returns 'joined' | 'requested'
create or replace function public.team_join(tid bigint) returns text
language plpgsql security definer set search_path = public as $$
declare m text;
begin
  if auth.uid() is null or not public.can_post(auth.uid()) then raise exception 'Sign in first'; end if;
  if public.team_of(auth.uid()) is not null then raise exception 'Leave your current team first'; end if;
  select join_mode into m from public.teams where id = tid;
  if m is null then raise exception 'Team not found'; end if;
  if (select count(*) from public.team_members where team_id = tid) >= 50 then raise exception 'This team is full (50 members)'; end if;
  if m = 'open' then
    insert into public.team_members (team_id, user_id) values (tid, auth.uid());
    delete from public.team_requests where user_id = auth.uid();
    return 'joined';
  end if;
  if (select count(*) from public.team_requests where user_id = auth.uid()) >= 5 then raise exception 'You have too many open requests'; end if;
  insert into public.team_requests (team_id, user_id) values (tid, auth.uid()) on conflict do nothing;
  return 'requested';
end $$;
grant execute on function public.team_join(bigint) to authenticated;

create or replace function public.team_cancel_request(tid bigint) returns void
language sql security definer set search_path = public as $$ delete from public.team_requests where team_id = tid and user_id = auth.uid() $$;
grant execute on function public.team_cancel_request(bigint) to authenticated;

create or replace function public.team_answer(uid uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare tid bigint := public.team_of(auth.uid());
begin
  if tid is null or public.team_role(auth.uid(), tid) not in ('owner','officer') then raise exception 'Only owners and officers can do this'; end if;
  if not exists (select 1 from public.team_requests where team_id = tid and user_id = uid) then raise exception 'Request not found'; end if;
  delete from public.team_requests where team_id = tid and user_id = uid;
  if accept then
    if public.team_of(uid) is not null then raise exception 'They already joined another team'; end if;
    insert into public.team_members (team_id, user_id) values (tid, uid);
    delete from public.team_requests where user_id = uid;
  end if;
end $$;
grant execute on function public.team_answer(uuid, boolean) to authenticated;

-- leave; an owner hands the team to the longest-serving officer (or member). The last one out closes the team.
create or replace function public.team_leave() returns void
language plpgsql security definer set search_path = public as $$
declare tid bigint := public.team_of(auth.uid()); r text; heir uuid;
begin
  if tid is null then return; end if;
  r := public.team_role(auth.uid(), tid);
  delete from public.team_members where team_id = tid and user_id = auth.uid();
  if r = 'owner' then
    select user_id into heir from public.team_members where team_id = tid order by (role = 'officer') desc, joined_at limit 1;
    if heir is null then delete from public.teams where id = tid;
    else update public.team_members set role = 'owner' where team_id = tid and user_id = heir; update public.teams set owner_id = heir where id = tid; end if;
  end if;
end $$;
grant execute on function public.team_leave() to authenticated;

create or replace function public.team_kick(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare tid bigint := public.team_of(auth.uid()); mine text; theirs text;
begin
  if tid is null then raise exception 'You are not in a team'; end if;
  mine := public.team_role(auth.uid(), tid); theirs := public.team_role(uid, tid);
  if theirs is null then raise exception 'Not in your team'; end if;
  if uid = auth.uid() then raise exception 'Use Leave instead'; end if;
  if not (mine = 'owner' or (mine = 'officer' and theirs = 'member')) then raise exception 'You can''t remove this member'; end if;
  delete from public.team_members where team_id = tid and user_id = uid;
end $$;
grant execute on function public.team_kick(uuid) to authenticated;

-- owner promotes/demotes officers, or hands over ownership
create or replace function public.team_set_role(uid uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
declare tid bigint := public.team_of(auth.uid());
begin
  if tid is null or public.team_role(auth.uid(), tid) <> 'owner' then raise exception 'Only the owner can change roles'; end if;
  if public.team_role(uid, tid) is null or uid = auth.uid() then raise exception 'Pick another member of your team'; end if;
  if new_role = 'owner' then
    update public.team_members set role = 'officer' where team_id = tid and user_id = auth.uid();
    update public.team_members set role = 'owner' where team_id = tid and user_id = uid;
    update public.teams set owner_id = uid where id = tid;
  elsif new_role in ('officer','member') then
    update public.team_members set role = new_role where team_id = tid and user_id = uid;
  else raise exception 'Unknown role'; end if;
end $$;
grant execute on function public.team_set_role(uuid, text) to authenticated;

-- admins can close teams with offensive names
create or replace function public.admin_delete_team(tid bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'admins only'; end if;
  delete from public.teams where id = tid;
end $$;
grant execute on function public.admin_delete_team(bigint) to authenticated;

-- ---------- team leaderboard: season points of all members this season ----------
create or replace function public.team_board(lim int default 50)
returns table (team_id bigint, name text, tag text, emblem text, color text, join_mode text, members bigint, points bigint, top_user uuid)
language sql stable security definer set search_path = public as $$
  with sb as (select b.user_id, b.points from public.season_board(null, 1000) b)
  select t.id, t.name, t.tag, t.emblem, t.color, t.join_mode,
    (select count(*) from public.team_members m where m.team_id = t.id),
    coalesce((select sum(sb.points) from public.team_members m join sb on sb.user_id = m.user_id where m.team_id = t.id), 0)::bigint,
    (select m.user_id from public.team_members m left join sb on sb.user_id = m.user_id where m.team_id = t.id order by sb.points desc nulls last limit 1)
  from public.teams t
  order by 8 desc, 7 desc, t.created_at
  limit least(greatest(lim, 1), 200);
$$;
grant execute on function public.team_board(int) to anon, authenticated;

-- ---------- achievements: team counters ----------
create or replace function public.team_stats(uid uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'in_team',   public.team_of(uid) is not null,
    'team_owner', exists (select 1 from public.teams where owner_id = uid),
    'team_size', coalesce((select count(*) from public.team_members m where m.team_id = public.team_of(uid)), 0),
    'team_msgs', (select count(*) from public.team_chat c where c.user_id = uid),
    'team_rank', (select r from (select b.team_id, row_number() over (order by b.points desc) r from public.team_board(200) b) x where x.team_id = public.team_of(uid))
  );
$$;
grant execute on function public.team_stats(uuid) to anon, authenticated;
