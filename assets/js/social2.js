/* FLOW social v2: follows + notification bell. Loaded on every page after social.js */
(function () {
  const F = FLOW;
  if (!F.auth?.enabled) { F.follows = { has: () => false, load: async () => {}, toggle: async () => {} }; return; }
  const me = () => F.auth.profile;

  /* ================= follows ================= */
  const following = new Set(); // profile ids I follow
  let loadedFor = null;
  F.follows = {
    has: (id) => following.has(id),
    async load() {
      if (!me()) { following.clear(); loadedFor = null; return; }
      if (loadedFor === me().id) return;
      const { data } = await F.sb.from("follows").select("following_id").eq("follower_id", me().id).limit(5000);
      following.clear(); (data || []).forEach((r) => following.add(r.following_id));
      loadedFor = me().id;
    },
    ids: () => [...following],
    async counts(id) {
      const { data } = await F.sb.rpc("follow_counts", { uid: id });
      const r = Array.isArray(data) ? data[0] : data;
      return { followers: Number(r?.followers || 0), following: Number(r?.following || 0) };
    },
    async toggle(id) {
      if (!me()) { await F.auth.signIn(); if (!me()) return null; await F.follows.load(); }
      if (id === me().id) return null;
      const was = following.has(id);
      if (was) following.delete(id); else following.add(id);
      const { error } = was
        ? await F.sb.from("follows").delete().eq("follower_id", me().id).eq("following_id", id)
        : await F.sb.from("follows").insert({ follower_id: me().id, following_id: id });
      if (error && error.code !== "23505") {
        if (was) following.add(id); else following.delete(id);
        F.toast("Couldn't update follow", F.esc(error.message), "err");
        return was;
      }
      document.dispatchEvent(new CustomEvent("flow:follow", { detail: { id, on: !was } }));
      return !was;
    },
    /* list of followers / following of a member, as profiles */
    async list(id, kind) {
      const col = kind === "followers" ? "follower_id" : "following_id";
      const where = kind === "followers" ? "following_id" : "follower_id";
      const { data } = await F.sb.from("follows").select(col).eq(where, id).order("created_at", { ascending: false }).limit(200);
      const ids = (data || []).map((r) => r[col]);
      if (!ids.length) return [];
      const { data: profs } = await F.sb.from("profiles").select("id,wallet,name,avatar_url").in("id", ids);
      const m = new Map((profs || []).map((p) => [p.id, p]));
      return ids.map((i) => m.get(i)).filter(Boolean);
    },
  };
  F.followBtn = (id, cls = "") => {
    if (!id || (me() && me().id === id)) return "";
    const on = following.has(id);
    return `<button class="btn btn-sm ${on ? "btn-ghost following" : "btn-primary"} ${cls}" data-follow="${id}">${on ? "Following" : "Follow"}</button>`;
  };
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-follow]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    b.disabled = true;
    const on = await F.follows.toggle(b.dataset.follow);
    b.disabled = false;
    if (on === null) return;
    F.$$(`[data-follow="${b.dataset.follow}"]`).forEach((x) => {
      x.className = x.className.replace(/\b(btn-primary|btn-ghost|following)\b/g, "").trim() + (on ? " btn-ghost following" : " btn-primary");
      x.textContent = on ? "Following" : "Follow";
    });
  });

  F.showFollowList = async (id, kind, title) => {
    const m = F.h(`<div class="modal-bg"><div class="modal" style="max-width:440px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0">${F.esc(title)}</h3><button class="icon-btn" data-x>${F.icons.close}</button></div>
      <div class="follow-list"><div class="skeleton" style="height:120px"></div></div></div></div>`);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); });
    document.body.appendChild(m);
    const list = await F.follows.list(id, kind);
    F.$(".follow-list", m).innerHTML = list.length ? list.map((p) => `<div class="follow-row">
        <a href="profile.html?a=${F.esc(p.wallet)}" class="follow-who"><img src="${F.avatarOf(p)}" alt=""><div><div class="n">${F.displayName(p)} ${F.founderBadge(p.wallet, true)}</div><div class="s mono">${F.short(p.wallet)}</div></div></a>
        ${F.followBtn(p.id)}</div>`).join("")
      : `<p class="muted" style="margin:6px 0 0">${kind === "followers" ? "No followers yet." : "Not following anyone yet."}</p>`;
  };

  /* ================= notifications ================= */
  const N = { list: [], unread: 0, chan: null, open: false, forId: null };
  const SELN = "id,type,post_id,mint,symbol,sol_amount,read,created_at,actor:profiles!notifications_actor_id_fkey(id,wallet,name,avatar_url)";

  function text(n) {
    const who = `<b>${F.displayName(n.actor)}</b>`;
    switch (n.type) {
      case "like": return `${who} liked your post`;
      case "comment": return `${who} commented on your post`;
      case "follow": return `${who} started following you`;
      case "buy": return `${who} bought ${n.sol_amount ? F.num(n.sol_amount, 3) + " SOL of " : ""}<b>$${F.esc(n.symbol || "coin")}</b>`;
      case "sell": return `${who} sold ${n.sol_amount ? F.num(n.sol_amount, 3) + " SOL of " : ""}<b>$${F.esc(n.symbol || "coin")}</b>`;
    }
    return who;
  }
  function href(n) {
    if (n.type === "like" || n.type === "comment") return n.post_id ? `post.html?p=${n.post_id}` : "post.html";
    if (n.type === "buy" || n.type === "sell") return `coin.html?c=${n.mint}`;
    return `profile.html?a=${n.actor?.wallet || ""}`;
  }
  const icon = { like: "♥", comment: "💬", follow: "➕", buy: "🟦", sell: "🟥" };

  function renderBell() {
    const slot = F.$("#bell-slot"); if (!slot) return;
    if (!me()) { slot.innerHTML = ""; return; }
    slot.innerHTML = `<button class="bell" id="bell" title="Notifications" aria-label="Notifications">${F.icons.bell}${N.unread ? `<span class="bell-badge">${N.unread > 99 ? "99+" : N.unread}</span>` : ""}</button>`;
    F.$("#bell").onclick = (e) => { e.stopPropagation(); N.open ? closePanel() : openPanel(); };
  }
  function panelHtml() {
    if (!N.list.length) return `<div class="notif-empty">No notifications yet.<br><span class="muted">Likes, comments, follows and trades from people you follow show up here.</span></div>`;
    return N.list.map((n) => `<a class="notif ${n.read ? "" : "unread"}" href="${href(n)}">
      <span class="notif-ic">${icon[n.type] || "•"}</span>
      <img src="${F.avatarOf(n.actor)}" alt="">
      <span class="notif-txt">${text(n)}<span class="muted"> · ${F.ago(Date.parse(n.created_at))}</span></span></a>`).join("");
  }
  function openPanel() {
    closePanel();
    N.open = true;
    const p = F.h(`<div class="notif-panel" id="notif-panel"><div class="notif-head"><b>Notifications</b><span style="display:flex;gap:12px">${F.alertsList ? '<button class="linkish" id="notif-alerts">🔔 Price alerts</button>' : ""}${N.list.length ? '<button class="linkish" id="notif-clear">Clear all</button>' : ""}</span></div><div class="notif-list">${panelHtml()}</div></div>`);
    F.$("#bell-slot").appendChild(p);
    p.addEventListener("click", (e) => e.stopPropagation());
    const na = F.$("#notif-alerts", p); if (na) na.onclick = () => { closePanel(); F.alertsList(); };
    const clr = F.$("#notif-clear", p);
    if (clr) clr.onclick = async () => { await F.sb.from("notifications").delete().eq("user_id", me().id); N.list = []; N.unread = 0; renderBell(); openPanel(); };
    setTimeout(() => document.addEventListener("click", closePanel, { once: true }));
    if (N.unread) {
      N.unread = 0; renderBell(); F.$("#bell-slot").appendChild(p);
      F.sb.from("notifications").update({ read: true }).eq("user_id", me().id).eq("read", false).then(() => { N.list.forEach((n) => (n.read = true)); });
    }
  }
  function closePanel() { N.open = false; F.$("#notif-panel")?.remove(); }

  async function loadNotifications() {
    if (!me()) { N.list = []; N.unread = 0; N.forId = null; renderBell(); return; }
    const { data } = await F.sb.from("notifications").select(SELN).eq("user_id", me().id).order("created_at", { ascending: false }).limit(40);
    N.list = data || []; N.unread = N.list.filter((n) => !n.read).length; N.forId = me().id;
    renderBell();
    if (N.chan) { F.sb.removeChannel(N.chan); N.chan = null; }
    N.chan = F.sb.channel("flow-notif-" + me().id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${me().id}` }, async ({ new: n }) => {
        const { data: actor } = await F.sb.from("profiles").select("id,wallet,name,avatar_url").eq("id", n.actor_id).single();
        n.actor = actor || {};
        N.list.unshift(n); N.list = N.list.slice(0, 60); N.unread++;
        renderBell();
        if (N.open) F.$("#notif-panel .notif-list").innerHTML = panelHtml();
        F.toast("New notification", text(n));
      })
      .subscribe();
  }

  /* record a trade made on FLOW (lets followers get "X bought $COIN") */
  F.logTrade = async ({ mint, symbol, side, sol, signature }) => {
    if (!me() || !signature) return;
    try { await F.sb.from("trades").insert({ user_id: me().id, mint, symbol: (symbol || "").slice(0, 20) || null, side, sol_amount: sol != null ? Number(sol.toFixed(6)) : null, signature }); } catch {}
  };

  /* ================= levels & badges ================= */
  const stats = new Map();   // profile id -> stats
  let topWeek, topWeekP = null;
  const BADGES = [
    { id: "early", ic: "🌊", name: "Early member", why: "One of the first 10,000 members", test: (s) => s.join_rank > 0 && s.join_rank <= 10000 },
    { id: "top", ic: "🏆", name: "Top poster of the week", why: "Most likes received this week", test: (s) => s.id === topWeek },
    { id: "poster", ic: "✍️", name: "Poster", why: "10+ posts", test: (s) => s.posts >= 10 },
    { id: "popular", ic: "🔥", name: "Popular", why: "50+ likes received", test: (s) => s.likes >= 50 },
    { id: "social", ic: "🤝", name: "Social", why: "10+ followers", test: (s) => s.followers >= 10 },
    { id: "trader", ic: "💱", name: "Trader", why: "10+ trades on FLOW", test: (s) => s.trades >= 10 },
    { id: "streak", ic: "🔥", name: "On fire", why: "7-day visit streak", test: (s) => s.streak >= 7 },
    { id: "champ", ic: "👑", name: "Weekly champ", why: "Won a weekly FLOW competition", test: (s) => s.wins >= 1 },
    { id: "recruiter", ic: "🎟️", name: "Recruiter", why: "Invited a friend to FLOW", test: (s) => s.invites >= 1 },
    { id: "ambassador", ic: "📣", name: "Ambassador", why: "Invited 10+ friends to FLOW", test: (s) => s.invites >= 10 },
  ];
  const xpOf = (s) => s.posts * 10 + s.likes * 3 + s.comments * 4 + s.trades * 8 + s.followers * 6 + (s.checkins || 0) * 5 + (s.invites || 0) * 100 + (s.wins || 0) * 100;
  const levelOf = (xp) => Math.min(99, Math.floor(Math.sqrt(xp / 40)) + 1);
  const xpFor = (lvl) => 40 * (lvl - 1) ** 2;
  F.levels = {
    async load(ids) {
      if (!topWeekP) topWeekP = F.sb.rpc("top_poster_week").then(({ data }) => { topWeek = data || null; }).catch(() => {});
      const need = [...new Set(ids)].filter((i) => i && !stats.has(i));
      for (let i = 0; i < need.length; i += 200) {
        const chunk = need.slice(i, i + 200);
        const { data } = await F.sb.rpc("member_stats", { uids: chunk });
        chunk.forEach((id) => stats.has(id) || stats.set(id, null));
        (data || []).forEach((r) => {
          const s = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === "id" ? v : Number(v || 0)]));
          s.xp = xpOf(s); s.level = levelOf(s.xp); stats.set(r.id, s);
        });
      }
      await topWeekP;
    },
    get: (id) => stats.get(id) || null,
    badges: (id) => { const s = stats.get(id); return s ? BADGES.filter((b) => b.test(s)) : []; },
    info: (id) => {
      const s = stats.get(id); if (!s) return null;
      const next = xpFor(s.level + 1), cur = xpFor(s.level);
      return { ...s, next, pct: Math.min(100, ((s.xp - cur) / Math.max(1, next - cur)) * 100) };
    },
    forget: (id) => stats.delete(id),
  };
  /* Placeholders: <span class="lvl" data-lvl="PROFILE_ID"></span> get filled with "Lv 3" + top badge */
  F.lvlTag = (id) => (id ? `<span class="lvl" data-lvl="${F.esc(id)}"></span>` : "");
  F.fillLevels = async (root = document) => {
    const els = F.$$("[data-lvl]", root).filter((e) => !e.dataset.done);
    if (!els.length) return;
    try { await F.levels.load(els.map((e) => e.dataset.lvl)); } catch { return; }
    els.forEach((e) => {
      const s = F.levels.get(e.dataset.lvl); if (!s) return;
      const b = F.levels.badges(s.id);
      const top = b.find((x) => x.id === "champ") || b.find((x) => x.id === "top") || b.find((x) => x.id === "early");
      e.innerHTML = `${top ? `<span class="lvl-badge" title="${F.esc(top.name)}">${top.ic}</span>` : ""}<span class="lvl-pill lv${Math.min(5, Math.ceil(s.level / 5))}" title="Level ${s.level} · ${s.xp} XP">Lv ${s.level}</span>`;
      e.dataset.done = 1;
    });
  };
  /* auto-fill any new placeholders that appear on the page */
  let lvlTimer;
  new MutationObserver(() => { clearTimeout(lvlTimer); lvlTimer = setTimeout(() => F.fillLevels(), 250); }).observe(document.body, { childList: true, subtree: true });

  /* ================= daily streak ================= */
  F.streak = null;
  async function checkin() {
    if (!me()) return;
    const key = "checkin_" + me().id + "_" + new Date().toISOString().slice(0, 10);
    const { data } = await F.sb.rpc("do_checkin");
    const r = Array.isArray(data) ? data[0] : data;
    if (!r) return;
    F.streak = r.streak;
    if (r.new_today && !F.store.get(key, false)) {
      F.store.set(key, true);
      F.toast(`🔥 ${r.streak}-day streak!`, r.streak > 1 ? `Welcome back. +5 XP — come back tomorrow to keep it going.` : `+5 XP for visiting today. Come back tomorrow to start a streak.`);
      F.levels.forget(me().id);
    }
    document.dispatchEvent(new CustomEvent("flow:streak"));
  }

  /* ================= direct messages: unread count in the menu ================= */
  F.dm = { unread: 0, chan: null };
  async function loadDmUnread() {
    if (!me()) { F.dm.unread = 0; paintDm(); return; }
    const { count } = await F.sb.from("dm_messages").select("id", { count: "exact", head: true }).eq("recipient_id", me().id).eq("read", false);
    F.dm.unread = count || 0; paintDm();
    if (F.dm.chan) F.sb.removeChannel(F.dm.chan);
    F.dm.chan = F.sb.channel("flow-dm-" + me().id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages", filter: `recipient_id=eq.${me().id}` }, ({ new: m }) => {
        document.dispatchEvent(new CustomEvent("flow:dm", { detail: m }));
        if (F.dm.openWith === m.sender_id) return;
        F.dm.unread++; paintDm();
        F.sb.from("profiles").select("name,wallet").eq("id", m.sender_id).single().then(({ data }) =>
          F.toast(`💬 ${F.displayName(data || {}, "")}`, `${F.esc(m.body.slice(0, 80))} · <a href="messages.html?to=${m.sender_id}">Reply</a>`));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages", filter: `sender_id=eq.${me().id}` }, ({ new: m }) =>
        document.dispatchEvent(new CustomEvent("flow:dm", { detail: m })))
      .subscribe();
  }
  function paintDm() {
    const a = F.$('.nav a[data-nav="messages"]'); if (!a) return;
    let b = F.$(".nav-badge", a);
    if (!F.dm.unread) { b?.remove(); return; }
    if (!b) { b = F.h('<span class="nav-badge"></span>'); a.appendChild(b); }
    b.textContent = F.dm.unread > 99 ? "99+" : F.dm.unread;
  }
  F.dm.refresh = loadDmUnread;

  /* ---------------- boot ---------------- */
  let lastAuthId = null;
  const onAuth = async () => {
    await F.follows.load();
    if ((me()?.id || null) !== lastAuthId) { lastAuthId = me()?.id || null; checkin(); loadDmUnread(); }
    if (!me() || N.forId !== me().id) await loadNotifications();
    else renderBell();
    document.dispatchEvent(new CustomEvent("flow:follows-ready"));
  };
  document.addEventListener("flow:auth", onAuth);
  const wait = () => (F.$("#bell-slot") ? onAuth() : setTimeout(wait, 50));
  wait();
})();
