-- =========================================================
-- FLOW levels & badges: member stats used to compute XP, levels and badges
-- Run after social2.sql. Safe to re-run. Read-only functions.
-- =========================================================

create or replace function public.member_stats(uids uuid[])
returns table (id uuid, posts bigint, likes bigint, comments bigint, trades bigint, followers bigint, join_rank bigint)
language sql stable security definer set search_path = public as $$
  select p.id,
    (select count(*) from public.posts x where x.user_id = p.id),
    (select coalesce(sum(x.like_count), 0) from public.posts x where x.user_id = p.id),
    (select count(*) from public.post_comments c where c.user_id = p.id),
    (select count(*) from public.trades t where t.user_id = p.id),
    (select count(*) from public.follows f where f.following_id = p.id),
    (select count(*) from public.profiles q where q.created_at <= p.created_at)
  from public.profiles p
  where p.id = any (uids[1:200]);
$$;
grant execute on function public.member_stats(uuid[]) to anon, authenticated;

-- member whose posts received the most likes in the last 7 days (needs at least 3)
create or replace function public.top_poster_week()
returns uuid
language sql stable security definer set search_path = public as $$
  select x.user_id
  from public.post_likes l join public.posts x on x.id = l.post_id
  where l.created_at > now() - interval '7 days' and l.user_id <> x.user_id
  group by x.user_id
  having count(*) >= 3
  order by count(*) desc, max(l.created_at) desc
  limit 1;
$$;
grant execute on function public.top_poster_week() to anon, authenticated;
