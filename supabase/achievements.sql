-- =========================================================
-- FLOW achievements: one call returns every counter the achievements need.
-- Run after social5.sql. Safe to re-run. Read-only.
-- =========================================================
create or replace function public.achievement_stats(uid uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'has_avatar',  p.avatar_url is not null,
    'has_name',    p.name is not null,
    'has_bio',     coalesce(char_length(p.bio), 0) > 0,
    'has_banner',  p.banner_url is not null,
    'has_link',    p.x_handle is not null or p.tiktok_handle is not null,
    'join_rank',   (select count(*) from public.profiles q where q.created_at <= p.created_at),
    'days_member', extract(day from now() - p.created_at)::int,
    'trades',      (select count(*) from public.trades t where t.user_id = p.id and t.verified),
    'coins',       (select count(distinct t.mint) from public.trades t where t.user_id = p.id and t.verified),
    'buy_sol',     (select coalesce(sum(t.sol_amount), 0) from public.trades t where t.user_id = p.id and t.verified and t.side = 'buy'),
    'posts',       (select count(*) from public.posts x where x.user_id = p.id),
    'likes_recv',  (select coalesce(sum(x.like_count), 0) from public.posts x where x.user_id = p.id),
    'top_post',    (select coalesce(max(x.like_count), 0) from public.posts x where x.user_id = p.id),
    'calls',       (select count(*) from public.posts x where x.user_id = p.id and (x.coin_mint is not null or x.body ~ '[1-9A-HJ-NP-Za-km-z]{32,44}')),
    'comments',    (select count(*) from public.post_comments c where c.user_id = p.id),
    'likes_given', (select count(*) from public.post_likes l where l.user_id = p.id),
    'chat',        (select count(*) from public.messages m where m.user_id = p.id),
    'polls',       (select count(*) from public.post_polls pp join public.posts x on x.id = pp.post_id where x.user_id = p.id),
    'votes',       (select count(*) from public.poll_votes v where v.user_id = p.id),
    'following',   (select count(*) from public.follows f where f.follower_id = p.id),
    'followers',   (select count(*) from public.follows f where f.following_id = p.id),
    'dms',         (select count(*) from public.dm_messages d where d.sender_id = p.id),
    'checkins',    (select count(*) from public.checkins k where k.user_id = p.id),
    'streak',      public.streak_of(p.id),
    'best_streak', (select coalesce(max(n), 0) from (
                      select count(*) n from (
                        select k.day - (row_number() over (order by k.day))::int grp from public.checkins k where k.user_id = p.id
                      ) g group by grp) s),
    'wins',        (select count(*) from public.week_winners w where w.user_id = p.id),
    'invites',     (select count(*) from public.profiles r where r.referred_by = p.id),
    'reports',     (select count(*) from public.reports r where r.reporter_id = p.id),
    'alerts',      (select count(*) from public.price_alerts a where a.user_id = p.id),
    'tips_sent_n',   (select count(*) from public.tips t where t.sender_id = p.id),
    'tips_sent_sol', (select coalesce(sum(t.lamports), 0) / 1e9 from public.tips t where t.sender_id = p.id),
    'tips_recv_n',   (select count(*) from public.tips t where t.recipient_wallet = p.wallet),
    'tips_recv_sol', (select coalesce(sum(t.lamports), 0) / 1e9 from public.tips t where t.recipient_wallet = p.wallet),
    'supporters',    (select count(distinct t.sender_id) from public.tips t where t.recipient_wallet = p.wallet),
    'room_msgs',     (select count(*) from public.coin_chat c where c.user_id = p.id),
    'room_coins',    (select count(distinct c.mint) from public.coin_chat c where c.user_id = p.id),
    'seasons',       (select count(*) from public.season_rewards r where r.user_id = p.id),
    'season_top3',   (select count(*) from public.season_rewards r where r.user_id = p.id and r.place <= 3),
    'season_now',    coalesce((select b.points from public.season_board(null, 1000) b where b.user_id = p.id), 0),
    'best_rank',     (select coalesce(max(case r.rank when 'silver' then 1 when 'gold' then 2 when 'diamond' then 3 when 'legend' then 4 else 0 end), 0) from public.season_rewards r where r.user_id = p.id),
    'cosmetics',     (p.cos_frame is not null)::int + (p.cos_name is not null)::int + (p.cos_fx is not null)::int
  )
  from public.profiles p where p.id = uid;
$$;
grant execute on function public.achievement_stats(uuid) to anon, authenticated;
