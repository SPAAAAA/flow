/* FLOW achievements: 60+ goals in categories with rarities. Icons stay grey until unlocked.
   The big FLOW emblem at the top fills with colour as you unlock more — 100% = fully coloured. */
(function () {
  const F = FLOW;
  const me = () => F.auth?.profile;

  const RAR = {
    u: { name: "Uncommon", cls: "r-u" },   // grey
    c: { name: "Common", cls: "r-c" },     // green
    r: { name: "Rare", cls: "r-r" },       // blue
    e: { name: "Epic", cls: "r-e" },       // purple
    l: { name: "Legendary", cls: "r-l" },  // gold
  };
  const ORDER = { u: 0, c: 1, r: 2, e: 3, l: 4 };
  const n = (v) => Number(v || 0);
  const bestRank = (s) => { const p = n(s.season_now); const now = p >= 5000 ? 4 : p >= 2000 ? 3 : p >= 750 ? 2 : p >= 250 ? 1 : 0; return Math.max(now, n(s.best_rank)); };
  const b = (v) => (v ? 1 : 0);

  // cur(s) -> current value, goal -> target, unit -> "trades" etc.
  const LIST = [
    // ---------- Getting started ----------
    { cat: "Getting started", id: "welcome", ic: "🌊", name: "Welcome Aboard", r: "u", desc: "Join FLOW with your wallet", cur: () => 1, goal: 1 },
    { cat: "Getting started", id: "cheese", ic: "📸", name: "Say Cheese", r: "u", desc: "Upload a profile picture", cur: (s) => b(s.has_avatar), goal: 1 },
    { cat: "Getting started", id: "named", ic: "🪪", name: "Identity", r: "u", desc: "Pick a display name", cur: (s) => b(s.has_name), goal: 1 },
    { cat: "Getting started", id: "bio", ic: "📝", name: "Storyteller", r: "u", desc: "Write a bio on your profile", cur: (s) => b(s.has_bio), goal: 1 },
    { cat: "Getting started", id: "banner", ic: "🖼️", name: "Fresh Paint", r: "c", desc: "Add a profile banner", cur: (s) => b(s.has_banner), goal: 1 },
    { cat: "Getting started", id: "linked", ic: "🔗", name: "Linked Up", r: "c", desc: "Link your X or TikTok", cur: (s) => b(s.has_link), goal: 1 },
    { cat: "Getting started", id: "complete", ic: "🎁", name: "Complete Package", r: "r", desc: "Picture, name, bio, banner and a social link", cur: (s) => b(s.has_avatar) + b(s.has_name) + b(s.has_bio) + b(s.has_banner) + b(s.has_link), goal: 5, unit: "profile steps" },
    { cat: "Getting started", id: "alert", ic: "🔔", name: "On Watch", r: "u", desc: "Set your first price alert", cur: (s) => n(s.alerts), goal: 1, unit: "alert" },

    // ---------- Trading ----------
    { cat: "Trading", id: "t1", ic: "🍼", name: "First Bite", r: "u", desc: "Make your first trade on FLOW", cur: (s) => n(s.trades), goal: 1, unit: "trade" },
    { cat: "Trading", id: "t10", ic: "⚙️", name: "Regular", r: "c", desc: "Make 10 trades", cur: (s) => n(s.trades), goal: 10, unit: "trades" },
    { cat: "Trading", id: "t50", ic: "📊", name: "Day Trader", r: "r", desc: "Make 50 trades", cur: (s) => n(s.trades), goal: 50, unit: "trades" },
    { cat: "Trading", id: "t250", ic: "🤖", name: "Trading Machine", r: "e", desc: "Make 250 trades", cur: (s) => n(s.trades), goal: 250, unit: "trades" },
    { cat: "Trading", id: "t1000", ic: "🏦", name: "Market Maker", r: "l", desc: "Make 1,000 trades", cur: (s) => n(s.trades), goal: 1000, unit: "trades" },
    { cat: "Trading", id: "c5", ic: "🧭", name: "Explorer", r: "c", desc: "Trade 5 different coins", cur: (s) => n(s.coins), goal: 5, unit: "coins" },
    { cat: "Trading", id: "c25", ic: "🗂️", name: "Collector", r: "r", desc: "Trade 25 different coins", cur: (s) => n(s.coins), goal: 25, unit: "coins" },
    { cat: "Trading", id: "c100", ic: "🎰", name: "Degen Dex", r: "e", desc: "Trade 100 different coins", cur: (s) => n(s.coins), goal: 100, unit: "coins" },
    { cat: "Trading", id: "v1", ic: "🐟", name: "Small Fish", r: "c", desc: "Buy 1 SOL worth of coins in total", cur: (s) => n(s.buy_sol), goal: 1, unit: "SOL" },
    { cat: "Trading", id: "v10", ic: "🐬", name: "Dolphin", r: "r", desc: "Buy 10 SOL in total", cur: (s) => n(s.buy_sol), goal: 10, unit: "SOL" },
    { cat: "Trading", id: "v50", ic: "🦈", name: "Shark", r: "e", desc: "Buy 50 SOL in total", cur: (s) => n(s.buy_sol), goal: 50, unit: "SOL" },
    { cat: "Trading", id: "v250", ic: "🐋", name: "Whale", r: "l", desc: "Buy 250 SOL in total", cur: (s) => n(s.buy_sol), goal: 250, unit: "SOL" },

    // ---------- Profits ----------
    { cat: "Profits", id: "p1", ic: "💵", name: "First Profit", r: "u", desc: "Sell a coin for a profit", cur: (s) => n(s.wins_sold), goal: 1, unit: "winning sell" },
    { cat: "Profits", id: "p10", ic: "🍗", name: "Winner Winner", r: "r", desc: "Sell 10 different coins for a profit", cur: (s) => n(s.wins_sold), goal: 10, unit: "winning coins" },
    { cat: "Profits", id: "x2", ic: "✌️", name: "Double Up", r: "r", desc: "Take profit at +100% (2x) or more", cur: (s) => n(s.best_pct), goal: 100, unit: "% on your best trade", pct: true },
    { cat: "Profits", id: "x10", ic: "🚀", name: "Tenbagger", r: "e", desc: "Take profit at 10x", cur: (s) => n(s.best_pct), goal: 900, unit: "% on your best trade", pct: true },
    { cat: "Profits", id: "x100", ic: "🌕", name: "Moonshot", r: "l", desc: "Take profit at 100x", cur: (s) => n(s.best_pct), goal: 9900, unit: "% on your best trade", pct: true },
    { cat: "Profits", id: "sol1", ic: "📈", name: "In the Green", r: "r", desc: "Make 1 SOL realized profit", cur: (s) => n(s.realized), goal: 1, unit: "SOL profit" },
    { cat: "Profits", id: "sol10", ic: "💰", name: "Bag Secured", r: "e", desc: "Make 10 SOL realized profit", cur: (s) => n(s.realized), goal: 10, unit: "SOL profit" },
    { cat: "Profits", id: "sol100", ic: "🖨️", name: "Money Printer", r: "l", desc: "Make 100 SOL realized profit", cur: (s) => n(s.realized), goal: 100, unit: "SOL profit" },
    { cat: "Profits", id: "rekt", ic: "🩸", name: "Rekt", r: "c", desc: "Sell a coin at −90% or worse. It happens.", cur: (s) => b(n(s.worst_pct) <= -90), goal: 1 },

    // ---------- Posts & calls ----------
    { cat: "Posts & calls", id: "post1", ic: "📣", name: "First Callout", r: "u", desc: "Write your first post", cur: (s) => n(s.posts), goal: 1, unit: "post" },
    { cat: "Posts & calls", id: "post10", ic: "✍️", name: "Poster", r: "c", desc: "Write 10 posts", cur: (s) => n(s.posts), goal: 10, unit: "posts" },
    { cat: "Posts & calls", id: "post100", ic: "🎙️", name: "Influencer", r: "r", desc: "Write 100 posts", cur: (s) => n(s.posts), goal: 100, unit: "posts" },
    { cat: "Posts & calls", id: "post500", ic: "📰", name: "Headline Act", r: "e", desc: "Write 500 posts", cur: (s) => n(s.posts), goal: 500, unit: "posts" },
    { cat: "Posts & calls", id: "call5", ic: "🎯", name: "Caller", r: "c", desc: "Post about 5 coins (calls)", cur: (s) => n(s.calls), goal: 5, unit: "calls" },
    { cat: "Posts & calls", id: "call50", ic: "🔮", name: "Oracle", r: "e", desc: "Make 50 calls", cur: (s) => n(s.calls), goal: 50, unit: "calls" },
    { cat: "Posts & calls", id: "like1", ic: "👍", name: "Liked", r: "u", desc: "Get your first like", cur: (s) => n(s.likes_recv), goal: 1, unit: "like" },
    { cat: "Posts & calls", id: "like50", ic: "👏", name: "Crowd Pleaser", r: "r", desc: "Get 50 likes in total", cur: (s) => n(s.likes_recv), goal: 50, unit: "likes" },
    { cat: "Posts & calls", id: "viral", ic: "⚡", name: "Viral", r: "e", desc: "Get 25 likes on a single post", cur: (s) => n(s.top_post), goal: 25, unit: "likes on one post" },
    { cat: "Posts & calls", id: "like500", ic: "🌟", name: "Superstar", r: "l", desc: "Get 500 likes in total", cur: (s) => n(s.likes_recv), goal: 500, unit: "likes" },
    { cat: "Posts & calls", id: "poll", ic: "🗳️", name: "Pollster", r: "c", desc: "Create a poll", cur: (s) => n(s.polls), goal: 1, unit: "poll" },
    { cat: "Posts & calls", id: "vote10", ic: "☑️", name: "Voice Heard", r: "c", desc: "Vote in 10 polls", cur: (s) => n(s.votes), goal: 10, unit: "votes" },

    // ---------- Community ----------
    { cat: "Community", id: "chat50", ic: "💬", name: "Chatterbox", r: "c", desc: "Send 50 messages in global chat", cur: (s) => n(s.chat), goal: 50, unit: "messages" },
    { cat: "Community", id: "chat500", ic: "🗣️", name: "Motormouth", r: "r", desc: "Send 500 messages in global chat", cur: (s) => n(s.chat), goal: 500, unit: "messages" },
    { cat: "Community", id: "cmt25", ic: "🗨️", name: "Commenter", r: "c", desc: "Leave 25 comments", cur: (s) => n(s.comments), goal: 25, unit: "comments" },
    { cat: "Community", id: "likes100", ic: "❤️", name: "Supporter", r: "r", desc: "Like 100 posts", cur: (s) => n(s.likes_given), goal: 100, unit: "likes given" },
    { cat: "Community", id: "follow5", ic: "🤝", name: "Friendly", r: "u", desc: "Follow 5 members", cur: (s) => n(s.following), goal: 5, unit: "follows" },
    { cat: "Community", id: "dm", ic: "✉️", name: "Pen Pal", r: "c", desc: "Send a direct message", cur: (s) => n(s.dms), goal: 1, unit: "DM" },
    { cat: "Community", id: "fans10", ic: "👥", name: "Followed", r: "r", desc: "Reach 10 followers", cur: (s) => n(s.followers), goal: 10, unit: "followers" },
    { cat: "Community", id: "fans100", ic: "🎬", name: "Famous", r: "e", desc: "Reach 100 followers", cur: (s) => n(s.followers), goal: 100, unit: "followers" },
    { cat: "Community", id: "fans1000", ic: "🏟️", name: "Celebrity", r: "l", desc: "Reach 1,000 followers", cur: (s) => n(s.followers), goal: 1000, unit: "followers" },
    { cat: "Community", id: "watchdog", ic: "🛡️", name: "Watchdog", r: "c", desc: "Report a scam or rule-breaker", cur: (s) => n(s.reports), goal: 1, unit: "report" },

    // ---------- Streaks & loyalty ----------
    { cat: "Streaks", id: "s3", ic: "🌅", name: "Warming Up", r: "u", desc: "Visit 3 days in a row", cur: (s) => n(s.best_streak), goal: 3, unit: "days in a row" },
    { cat: "Streaks", id: "s7", ic: "🔥", name: "On Fire", r: "c", desc: "Visit 7 days in a row", cur: (s) => n(s.best_streak), goal: 7, unit: "days in a row" },
    { cat: "Streaks", id: "s14", ic: "🗓️", name: "Fortnight", r: "r", desc: "Visit 14 days in a row", cur: (s) => n(s.best_streak), goal: 14, unit: "days in a row" },
    { cat: "Streaks", id: "s30", ic: "🔒", name: "Locked In", r: "e", desc: "Visit 30 days in a row", cur: (s) => n(s.best_streak), goal: 30, unit: "days in a row" },
    { cat: "Streaks", id: "s100", ic: "🖥️", name: "Terminally Online", r: "l", desc: "Visit 100 days in a row", cur: (s) => n(s.best_streak), goal: 100, unit: "days in a row" },
    { cat: "Streaks", id: "d30", ic: "🏠", name: "Regular Visitor", r: "c", desc: "Visit on 30 different days", cur: (s) => n(s.checkins), goal: 30, unit: "days" },
    { cat: "Streaks", id: "d100", ic: "🎖️", name: "Veteran", r: "r", desc: "Visit on 100 different days", cur: (s) => n(s.checkins), goal: 100, unit: "days" },
    { cat: "Streaks", id: "d365", ic: "🪖", name: "Year in the Trenches", r: "l", desc: "Visit on 365 different days", cur: (s) => n(s.checkins), goal: 365, unit: "days" },

    // ---------- Tips ----------
    { cat: "Tips", id: "tip1", ic: "💝", name: "Generous", r: "c", desc: "Send SOL to another member", cur: (s) => n(s.tips_sent_n), goal: 1, unit: "tip" },
    { cat: "Tips", id: "tip1sol", ic: "🎩", name: "Patron", r: "r", desc: "Send 1 SOL in tips in total", cur: (s) => n(s.tips_sent_sol), goal: 1, unit: "SOL sent" },
    { cat: "Tips", id: "tip10sol", ic: "🏛️", name: "Philanthropist", r: "e", desc: "Send 10 SOL in tips in total", cur: (s) => n(s.tips_sent_sol), goal: 10, unit: "SOL sent" },
    { cat: "Tips", id: "tipped", ic: "🪙", name: "Tipped", r: "c", desc: "Receive your first tip", cur: (s) => n(s.tips_recv_n), goal: 1, unit: "tip" },
    { cat: "Tips", id: "fans5", ic: "🌹", name: "Fan Favourite", r: "r", desc: "Get tips from 5 different members", cur: (s) => n(s.supporters), goal: 5, unit: "supporters" },
    { cat: "Tips", id: "stack", ic: "📺", name: "Streamer Stack", r: "l", desc: "Receive 10 SOL in tips in total", cur: (s) => n(s.tips_recv_sol), goal: 10, unit: "SOL received" },

    // ---------- Live rooms ----------
    { cat: "Live rooms", id: "room1", ic: "🎤", name: "Room Rookie", r: "u", desc: "Send a message in a live coin room", cur: (s) => n(s.room_msgs), goal: 1, unit: "message" },
    { cat: "Live rooms", id: "room100", ic: "📻", name: "On Air", r: "r", desc: "Send 100 messages in live rooms", cur: (s) => n(s.room_msgs), goal: 100, unit: "messages" },
    { cat: "Live rooms", id: "room1000", ic: "🎧", name: "Voice of the Trenches", r: "e", desc: "Send 1,000 messages in live rooms", cur: (s) => n(s.room_msgs), goal: 1000, unit: "messages" },
    { cat: "Live rooms", id: "rooms10", ic: "🗺️", name: "Globetrotter", r: "r", desc: "Chat in 10 different coin rooms", cur: (s) => n(s.room_coins), goal: 10, unit: "rooms" },

    // ---------- Seasons ----------
    { cat: "Seasons", id: "rk1", ic: "🥈", name: "Silver Lining", r: "c", desc: "Reach Silver in a season", cur: (s) => b(bestRank(s) >= 1), goal: 1 },
    { cat: "Seasons", id: "rk2", ic: "🥇", name: "Golden Season", r: "r", desc: "Reach Gold in a season", cur: (s) => b(bestRank(s) >= 2), goal: 1 },
    { cat: "Seasons", id: "rk3", ic: "💎", name: "Diamond Season", r: "e", desc: "Reach Diamond in a season", cur: (s) => b(bestRank(s) >= 3), goal: 1 },
    { cat: "Seasons", id: "rk4", ic: "🔱", name: "Season Legend", r: "l", desc: "Reach FLOW Legend in a season", cur: (s) => b(bestRank(s) >= 4), goal: 1 },
    { cat: "Seasons", id: "podium", ic: "🏅", name: "Podium Finish", r: "e", desc: "Finish a season in the top 3", cur: (s) => n(s.season_top3), goal: 1, unit: "top-3 finish" },
    { cat: "Seasons", id: "seasons3", ic: "📆", name: "Season Veteran", r: "r", desc: "Finish 3 seasons", cur: (s) => n(s.seasons), goal: 3, unit: "seasons" },
    { cat: "Seasons", id: "pts1000", ic: "⚡", name: "Point Machine", r: "r", desc: "Earn 1,000 points in one season", cur: (s) => n(s.season_now), goal: 1000, unit: "points this season" },

    // ---------- Style ----------
    { cat: "Style", id: "dressed", ic: "👔", name: "Dressed Up", r: "u", desc: "Equip a frame, name colour or banner effect", cur: (s) => n(s.cosmetics), goal: 1, unit: "cosmetic" },
    { cat: "Style", id: "drip", ic: "💅", name: "Full Drip", r: "r", desc: "Wear a frame, name colour and banner effect at once", cur: (s) => n(s.cosmetics), goal: 3, unit: "cosmetics" },
    { cat: "Style", id: "collector_c", ic: "🧥", name: "Wardrobe", r: "e", desc: "Unlock 10 cosmetics", cur: (s) => n(s._cos_unlocked), goal: 10, unit: "cosmetics unlocked" },
    { cat: "Style", id: "collector_all", ic: "👑", name: "Trendsetter", r: "l", desc: "Unlock every cosmetic", cur: (s) => n(s._cos_unlocked), goal: 16, unit: "cosmetics unlocked" },
    { cat: "Style", id: "invite_style", ic: "🪞", name: "Mirror Mirror", r: "c", desc: "Upload a picture and pick a name colour", cur: (s) => b(s.has_avatar) + b(s.cosmetics > 0), goal: 2, unit: "steps" },

    // ---------- Competitions & growth ----------
    { cat: "Legacy", id: "early", ic: "🌊", name: "Early Member", r: "e", desc: "One of the first 10,000 members", cur: (s) => b(n(s.join_rank) > 0 && n(s.join_rank) <= 10000), goal: 1, noProgress: true },
    { cat: "Legacy", id: "og", ic: "🦖", name: "OG", r: "l", desc: "One of the first 1,000 members", cur: (s) => b(n(s.join_rank) > 0 && n(s.join_rank) <= 1000), goal: 1, noProgress: true },
    { cat: "Legacy", id: "champ", ic: "👑", name: "Weekly Champ", r: "e", desc: "Win a weekly FLOW competition", cur: (s) => n(s.wins), goal: 1, unit: "win" },
    { cat: "Legacy", id: "dynasty", ic: "🏆", name: "Dynasty", r: "l", desc: "Win 5 weekly competitions", cur: (s) => n(s.wins), goal: 5, unit: "wins" },
    { cat: "Legacy", id: "inv1", ic: "🎟️", name: "Recruiter", r: "c", desc: "Invite a friend who joins", cur: (s) => n(s.invites), goal: 1, unit: "invite" },
    { cat: "Legacy", id: "inv10", ic: "🌍", name: "Ambassador", r: "e", desc: "Invite 10 friends who join", cur: (s) => n(s.invites), goal: 10, unit: "invites" },
    { cat: "Legacy", id: "inv50", ic: "🎪", name: "Ringleader", r: "l", desc: "Invite 50 friends who join", cur: (s) => n(s.invites), goal: 50, unit: "invites" },
    { cat: "Legacy", id: "year", ic: "🎂", name: "One Year of FLOW", r: "r", desc: "Be a member for a year", cur: (s) => n(s.days_member), goal: 365, unit: "days" },
  ];
  const CATS = [...new Set(LIST.map((a) => a.cat))];

  /* ---------------- data ---------------- */
  const cache = new Map();
  async function statsFor(uid) {
    if (cache.has(uid) && Date.now() - cache.get(uid).at < 60000) return cache.get(uid).s;
    const { data, error } = await F.sb.rpc("achievement_stats", { uid });
    if (error || !data) throw error || new Error("No data");
    const s = { ...data };
    // trade results from verified trades
    try {
      const rows = await F.pnl(uid);
      let wins = 0, best = 0, worst = 0, real = 0;
      rows.forEach((r) => {
        if (!r.st || !r.bt) return;
        const matched = Math.min(r.st, r.bt), cost = matched * r.avg;
        const pct = cost > 0 ? (r.realized / cost) * 100 : 0;
        if (r.realized > 0) wins++;
        best = Math.max(best, pct); worst = Math.min(worst, pct); real += r.realized;
      });
      Object.assign(s, { wins_sold: wins, best_pct: best, worst_pct: worst, realized: Math.max(0, real) });
    } catch {}
    cache.set(uid, { s, at: Date.now() });
    return s;
  }
  function evaluate(s) {
    if (F.COS && s._cos_unlocked == null) {
      // cosmetics unlock from achievement counts — count them from the non-Style achievements
      const base = LIST.filter((a) => a.cat !== "Style").map((a) => ({ r: a.r, done: Math.max(0, a.cur(s) || 0) >= a.goal }));
      const c = { all: 0, u: 0, c: 0, r: 0, e: 0, l: 0 }; base.filter((a) => a.done).forEach((a) => { c.all++; c[a.r]++; });
      s._cos_unlocked = Object.values(F.COS).flat().filter((x) => x.id !== "founder" && x.t(c, "")).length;
    }
    return LIST.map((a) => {
      const cur = Math.max(0, a.cur(s) || 0);
      return { ...a, cur, done: cur >= a.goal, frac: Math.min(1, cur / a.goal) };
    });
  }
  F.achievements = { LIST, RAR, statsFor, evaluate, total: LIST.length };

  /* ---------------- emblem (fills with colour as you progress) ---------------- */
  function emblemSvg(colored) {
    const id = colored ? "embc" : "embg";
    const fill = colored ? `url(#${id}f)` : "#262a35", edge = colored ? `url(#${id}e)` : "#343947", wave = colored ? "#ffffff" : "#3c4252", star = colored ? "#ffe08a" : "#3a3f4d";
    return `<svg viewBox="0 0 200 220" class="emb-svg">
      <defs>
        <linearGradient id="${id}f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6aa8ff"/><stop offset=".5" stop-color="#3d5bff"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient>
        <linearGradient id="${id}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#f5a623"/></linearGradient>
      </defs>
      <path d="M100 8 L182 40 V110 C182 160 146 196 100 212 C54 196 18 160 18 110 V40 Z" fill="${fill}" stroke="${edge}" stroke-width="8" stroke-linejoin="round"/>
      <path d="M100 26 L166 52 V110 C166 150 138 180 100 194 C62 180 34 150 34 110 V52 Z" fill="none" stroke="${colored ? "rgba(255,255,255,.25)" : "#30343f"}" stroke-width="2"/>
      <g fill="none" stroke="${wave}" stroke-width="11" stroke-linecap="round">
        <path d="M52 100 C70 82 86 118 104 100 S138 82 150 96"/>
        <path d="M52 132 C70 114 86 150 104 132 S138 114 150 128"/>
      </g>
      <g fill="${star}"><path d="M100 44 l5 10 11 2 -8 8 2 11 -10 -5 -10 5 2 -11 -8 -8 11 -2z"/><circle cx="64" cy="66" r="4"/><circle cx="138" cy="64" r="4"/></g>
      <path d="M70 176 L100 160 L130 176" fill="none" stroke="${star}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  /* ---------------- modal ---------------- */
  F.openAchievements = async (profile) => {
    if (!F.auth?.enabled || !profile?.id) return;
    const mine = me()?.id === profile.id;
    const m = F.h(`<div class="modal-bg"><div class="modal ach-modal">
      <div class="ach-head"><h3>${mine ? "Achievements" : `${F.displayName(profile)}'s achievements`}</h3><button class="icon-btn" data-x>${F.icons.close}</button></div>
      <div class="ach-body"><div class="skeleton" style="height:260px;border-radius:16px"></div><div class="skeleton" style="height:80px;margin-top:12px;border-radius:14px"></div></div></div></div>`);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); });
    document.body.appendChild(m);
    let list;
    try { list = evaluate(await statsFor(profile.id)); } catch (e) { F.$(".ach-body", m).innerHTML = `<div class="empty-state"><b>Couldn't load achievements</b>${F.esc(e.message || "")}</div>`; return; }
    if (mine) remember(list);
    const done = list.filter((a) => a.done).length, total = list.length, pct = Math.round((done / total) * 100);
    const locked = list.filter((a) => !a.done && !a.noProgress);
    const next = locked.sort((a, b) => b.frac - a.frac || ORDER[a.r] - ORDER[b.r])[0] || null;
    const togo = (a) => { const left = a.goal - a.cur; if (a.pct) return `${Math.round(a.cur)}% / ${a.goal}%`; if (a.goal === 1 && !a.unit) return "not yet"; const v = a.unit === "SOL" || /SOL/.test(a.unit || "") ? left.toFixed(2).replace(/\.00$/, "") : Math.ceil(left); return `${v} ${a.unit || ""} to go`; };
    const body = F.$(".ach-body", m);
    const heroOverview = () => `<div class="ach-hero ${pct === 100 ? "full" : ""}"><div class="ach-rays"></div>
        <div class="ach-up">${pct === 100 ? "ALL UNLOCKED · FLOW LEGEND" : next ? `UP NEXT · ${RAR[next.r].name.toUpperCase()}` : "KEEP GOING"}</div>
        <div class="ach-emblem"><div class="emb-g">${emblemSvg(false)}</div><div class="emb-c" style="clip-path:inset(${100 - pct}% 0 0 0)">${emblemSvg(true)}</div></div>
        <div class="ach-hero-name">${pct === 100 ? "You coloured in FLOW" : next ? F.esc(next.name) : ""}</div>
        <div class="ach-hero-desc">${pct === 100 ? "Every achievement unlocked. Legendary." : next ? F.esc(next.desc) : ""}</div></div>`;
    const heroOne = (a) => `<div class="ach-hero one ${RAR[a.r].cls}"><div class="ach-rays"></div>
        <div class="ach-up">${a.done ? "UNLOCKED" : "LOCKED"} · ${RAR[a.r].name.toUpperCase()}</div>
        <div class="ach-big ${a.done ? "on" : ""}">${a.ic}</div>
        <div class="ach-hero-name">${F.esc(a.name)}</div>
        <div class="ach-hero-desc">${F.esc(a.desc)}${!a.done && !a.noProgress && a.goal > 1 ? ` · <b>${a.pct ? Math.round(a.cur) + "%" : fmtNum(a.cur, a)} / ${a.pct ? a.goal + "%" : fmtNum(a.goal, a)}</b>` : ""}</div>
        <button class="linkish ach-back" data-back>← All achievements</button></div>`;
    const tile = (a) => `<button class="ach-tile ${RAR[a.r].cls} ${a.done ? "on" : ""}" data-ach="${a.id}" title="${F.esc(a.name)} — ${F.esc(a.desc)}">
        <span class="ach-t-box"><span class="ach-ic">${a.ic}</span>${!a.done && a.frac > 0 && !a.noProgress ? `<i class="ach-mini" style="width:${Math.max(6, a.frac * 100)}%"></i>` : ""}${a.done ? '<span class="ach-check">✓</span>' : ""}</span>
        <span class="ach-nm">${F.esc(a.name)}</span></button>`;
    const byR = Object.keys(RAR).map((k) => ({ k, all: list.filter((a) => a.r === k).length, got: list.filter((a) => a.r === k && a.done).length }));
    body.innerHTML = `<div id="ach-hero">${heroOverview()}</div>
      <div class="ach-prog"><div class="ach-ring" style="--p:${pct}"><span>${done}</span></div>
        <div class="ach-prog-main"><b>${done} of ${total} unlocked</b><div class="muted">${next ? `Next: <b style="color:var(--text)">${F.esc(next.name)}</b> · ${togo(next)}` : pct === 100 ? "You've unlocked everything 🎉" : ""}</div>
          <div class="ach-bar"><i style="width:${next ? next.frac * 100 : 100}%"></i></div></div>
        <div class="ach-pct">${pct}%</div></div>
      <div class="ach-legend">${byR.map((x) => `<span class="ach-chip ${RAR[x.k].cls}"><i></i>${RAR[x.k].name} <b>${x.got}/${x.all}</b></span>`).join("")}</div>
      ${CATS.map((c) => { const items = list.filter((a) => a.cat === c).sort((a, b) => ORDER[a.r] - ORDER[b.r] || a.goal - b.goal); return `<section class="ach-sec"><div class="ach-sec-h"><b>${c}</b><span>${items.filter((a) => a.done).length} of ${items.length}</span></div><div class="ach-grid">${items.map(tile).join("")}</div></section>`; }).join("")}`;
    body.addEventListener("click", (e) => {
      const t = e.target.closest("[data-ach]");
      if (t) { const a = list.find((x) => x.id === t.dataset.ach); F.$("#ach-hero", body).innerHTML = heroOne(a); F.$$(".ach-tile", body).forEach((x) => x.classList.toggle("sel", x === t)); body.scrollTo({ top: 0, behavior: "smooth" }); return; }
      if (e.target.closest("[data-back]")) { F.$("#ach-hero", body).innerHTML = heroOverview(); F.$$(".ach-tile.sel", body).forEach((x) => x.classList.remove("sel")); }
    });
  };
  function fmtNum(v, a) { return /SOL/.test(a.unit || "") ? (+v).toFixed(2).replace(/\.00$/, "") : Math.floor(v).toLocaleString(); }

  /* ---------------- "achievement unlocked" toasts for the signed-in member ---------------- */
  function remember(list) {
    const p = me(); if (!p) return [];
    const key = "ach_seen_" + p.id;
    const seen = F.store.get(key, null);
    const now = list.filter((a) => a.done).map((a) => a.id);
    F.store.set(key, now);
    if (!seen) return []; // first time: don't flood with toasts
    return list.filter((a) => a.done && !seen.includes(a.id));
  }
  async function check() {
    const p = me(); if (!p || !F.sb) return;
    try {
      cache.delete(p.id);
      const fresh = remember(evaluate(await statsFor(p.id)));
      fresh.sort((a, b) => ORDER[b.r] - ORDER[a.r]).slice(0, 3).forEach((a, i) => setTimeout(() =>
        F.toast(`🏆 Achievement unlocked · ${RAR[a.r].name}`, `<span style="font-size:18px">${a.ic}</span> <b>${F.esc(a.name)}</b> — ${F.esc(a.desc)} <a href="profile.html?a=${p.wallet}&ach=1">View</a>`), i * 1200));
    } catch {}
  }
  let lastId;
  document.addEventListener("flow:auth", () => { const id = me()?.id || null; if (id && id !== lastId) { lastId = id; setTimeout(check, 4000); } });
  document.addEventListener("flow:trade", () => setTimeout(check, 3000));
  setInterval(() => { if (!document.hidden) check(); }, 5 * 60000);
})();
