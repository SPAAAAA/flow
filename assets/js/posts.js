/* FLOW posts: Twitter-style feed with likes and comments.
   Used by post.html (full feed) and profile.html (a member's posts). */
(function () {
  const F = FLOW;
  const SEL = "id,body,like_count,comment_count,created_at,user_id,coin_mint,profiles!posts_user_id_fkey(id,wallet,name,avatar_url)";
  const liked = new Set();       // post ids the signed-in member liked
  const byId = new Map();        // post id -> post
  const openComments = new Set();
  let ctxCoin = null;            // coin page we're rendering a thread for (hide its own chip)
  const coinMeta = new Map();

  /* ---------------- call tracking ----------------
     A post that is about a coin (posted in its thread, or containing its address)
     is a "call". We look up the coin's price at the moment of posting from public
     chart data (so nobody can fake it) and compare it with the price now. */
  const CA_RE = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/;
  const callMint = (p) => p.coin_mint || (p.body.match(CA_RE) || [])[1] || null;
  const candleCache = new Map(); // key -> Promise<candles>
  function candles(pool, tf, agg) {
    const k = pool + tf + agg;
    if (!candleCache.has(k)) candleCache.set(k, F.gecko.ohlcv(pool, tf, agg, 1000).catch(() => []));
    return candleCache.get(k);
  }
  async function priceAt(pool, t) {
    const sec = Math.floor(t / 1000), age = Date.now() - t;
    // 15-minute candles cover ~10 days, 4-hour candles ~5 months
    const list = age < 9.5 * 864e5 ? await candles(pool, "minute", 15) : await candles(pool, "hour", 4);
    if (!list.length || sec < list[0].time) return null;
    let best = null;
    for (const c of list) { if (c.time <= sec) best = c; else break; }
    return best ? best.close : null;
  }
  async function fillCalls(root = document) {
    const els = F.$$("[data-call]:not([data-done])", root); if (!els.length) return;
    els.forEach((e) => (e.dataset.done = 1));
    const mints = [...new Set(els.map((e) => e.dataset.call))];
    const need = mints.filter((m) => !coinMeta.has(m));
    if (need.length) { try { F.toCoins(await F.dex.tokens(need)).forEach((c) => coinMeta.set(c.mint, c)); } catch {} need.forEach((m) => coinMeta.has(m) || coinMeta.set(m, null)); }
    for (const e of els) {
      const c = coinMeta.get(e.dataset.call);
      if (!c || !c.pair || !c.priceUsd) { e.remove(); continue; }
      const t = Number(e.dataset.at);
      if (Date.now() - t < 5 * 60e3) { e.innerHTML = `<span class="call-pill neutral">📍 Called at ${F.usd(c.mcap)} MC</span>`; continue; }
      const then = await priceAt(c.pair, t);
      if (!then) { e.remove(); continue; }
      const chg = (c.priceUsd / then - 1) * 100;
      const mcThen = c.mcap ? c.mcap * (then / c.priceUsd) : null;
      const up = chg >= 0;
      e.innerHTML = `<a class="call-pill ${up ? "up" : "down"}" href="coin.html?c=${F.esc(c.mint)}" title="Price when posted: ${F.price(then)} · now: ${F.price(c.priceUsd)}">
        ${up ? "📈" : "📉"} <b>${up ? "+" : ""}${Math.abs(chg) >= 1000 ? Math.round(chg).toLocaleString() : chg.toFixed(chg > -10 && chg < 10 ? 1 : 0)}%</b> since call
        <span class="muted">· $${F.esc(c.symbol)}${mcThen ? ` ${F.usd(mcThen)} → ${F.usd(c.mcap)} MC` : ""}</span></a>`;
    }
  }
  F.fillCalls = fillCalls;
  let callTimer;
  new MutationObserver(() => { clearTimeout(callTimer); callTimer = setTimeout(() => fillCalls(), 300); }).observe(document.body, { childList: true, subtree: true });
  async function fillCoinChips(root = document) {
    const chips = F.$$("[data-coinchip]", root); if (!chips.length) return;
    const need = [...new Set(chips.map((c) => c.dataset.coinchip))].filter((m) => !coinMeta.has(m));
    if (need.length) { try { F.toCoins(await F.dex.tokens(need)).forEach((c) => coinMeta.set(c.mint, c)); } catch {} need.forEach((m) => coinMeta.has(m) || coinMeta.set(m, null)); }
    chips.forEach((el) => { const c = coinMeta.get(el.dataset.coinchip); if (!c) return; el.innerHTML = `<img src="${F.img(c.image, c.mint)}" alt="">on <b>$${F.esc(c.symbol)}</b>`; });
  }

  const me = () => F.auth.profile;
  const canMod = (uid) => me() && (me().id === uid || me().is_admin);
  const heart = (on) => `<svg viewBox="0 0 24 24" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-9.3-9.2C1.4 8.4 3.6 5 7 5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8C19.5 16.4 12 21 12 21z"/></svg>`;
  const bubble = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z"/></svg>`;
  const linkIc = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>`;
  const trash = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`;

  function fmtText(s) {
    return F.esc(s)
      .replace(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g, (a) => `<a href="coin.html?c=${a}" class="msg-ca">${F.short(a)}</a>`)
      .replace(/\$([A-Za-z][A-Za-z0-9]{1,11})\b/g, '<b class="msg-tk">$$$1</b>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (m, sp, u) => `${sp}<a href="${u}" target="_blank" rel="noopener nofollow ugc" class="post-link">${u.replace(/^https?:\/\//, "").slice(0, 40)}</a>`);
  }
  function when(t) {
    const d = new Date(t), s = (Date.now() - d) / 1000;
    return s < 60 * 60 * 24 * 7 ? F.ago(d.getTime()) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  function postHtml(p) {
    const u = p.profiles || {};
    const on = liked.has(p.id);
    return `<article class="post" data-post="${p.id}">
      <a href="profile.html?a=${F.esc(u.wallet || "")}" class="post-av"><img src="${F.avatarOf(u)}" alt=""></a>
      <div class="post-main">
        <div class="post-top">
          <a href="profile.html?a=${F.esc(u.wallet || "")}" class="post-name">${F.displayName(u)}</a>${F.founderBadge(u.wallet, true)}${F.lvlTag ? F.lvlTag(u.id || p.user_id) : ""}
          <span class="post-handle mono">${F.short(u.wallet || "")}</span><span class="muted">·</span>
          <a class="post-time" href="post.html?p=${p.id}" title="${new Date(p.created_at).toLocaleString()}">${when(p.created_at)}</a>
          ${canMod(p.user_id) ? `<button class="post-del" data-del-post="${p.id}" title="Delete post">${trash}</button>` : ""}
        </div>
        ${p.coin_mint && p.coin_mint !== ctxCoin ? `<a class="coin-chip" href="coin.html?c=${F.esc(p.coin_mint)}" data-coinchip="${F.esc(p.coin_mint)}"><img src="${F.avatar(p.coin_mint)}" alt="">on <b>${F.short(p.coin_mint)}</b></a>` : ""}
        <div class="post-text">${fmtText(p.body)}</div>
        ${callMint(p) ? `<div class="call" data-call="${F.esc(callMint(p))}" data-at="${Date.parse(p.created_at)}"></div>` : ""}
        <div class="post-actions">
          <button class="pa pa-comment" data-comments="${p.id}" title="Comments">${bubble}<span>${p.comment_count || ""}</span></button>
          <button class="pa pa-like ${on ? "on" : ""}" data-like="${p.id}" title="${on ? "Unlike" : "Like"}">${heart(on)}<span>${p.like_count || ""}</span></button>
          <button class="pa pa-share" data-share="${p.id}" title="Copy link">${linkIc}</button>
        </div>
        <div class="post-comments ${openComments.has(p.id) ? "" : "hidden"}" id="pc-${p.id}"></div>
      </div></article>`;
  }

  async function loadLiked(ids) {
    if (!me() || !ids.length) return;
    const { data } = await F.sb.from("post_likes").select("post_id").eq("user_id", me().id).in("post_id", ids);
    (data || []).forEach((r) => liked.add(r.post_id));
  }
  function remember(list) { list.forEach((p) => { byId.set(p.id, p); if (p.profiles) F.profiles.remember(p.profiles); }); }

  function refreshPost(id) {
    const p = byId.get(id); if (!p) return;
    F.$$(`[data-post="${id}"]`).forEach((el) => {
      const like = F.$(".pa-like", el), com = F.$(".pa-comment span", el);
      const on = liked.has(id);
      like.classList.toggle("on", on); like.title = on ? "Unlike" : "Like";
      like.innerHTML = `${heart(on)}<span>${p.like_count || ""}</span>`;
      com.textContent = p.comment_count || "";
    });
  }

  /* ---------------- actions ---------------- */
  async function needSignIn() {
    if (me()) return true;
    F.toast("Sign in to join in", "Sign in with your wallet to post, like and comment.");
    await F.auth.signIn();
    return !!me();
  }
  async function toggleLike(id) {
    if (!(await needSignIn())) return;
    const p = byId.get(id); if (!p) return;
    const was = liked.has(id);
    // optimistic update
    if (was) { liked.delete(id); p.like_count = Math.max(0, p.like_count - 1); } else { liked.add(id); p.like_count++; }
    refreshPost(id);
    const q = was
      ? F.sb.from("post_likes").delete().eq("post_id", id).eq("user_id", me().id)
      : F.sb.from("post_likes").insert({ post_id: id, user_id: me().id });
    const { error } = await q;
    if (error && error.code !== "23505") {
      if (was) { liked.add(id); p.like_count++; } else { liked.delete(id); p.like_count = Math.max(0, p.like_count - 1); }
      refreshPost(id);
      F.toast("Couldn't update like", F.esc(error.message), "err");
    }
  }
  const armed = new Map();
  async function deletePost(id, btn) {
    if (!armed.get(id)) {
      armed.set(id, true); btn.classList.add("armed"); btn.innerHTML = "Delete?";
      setTimeout(() => { armed.delete(id); if (btn.isConnected) { btn.classList.remove("armed"); btn.innerHTML = trash; } }, 3000);
      return;
    }
    const { error } = await F.sb.from("posts").delete().eq("id", id);
    if (error) return F.toast("Couldn't delete", F.esc(error.message), "err");
    F.$$(`[data-post="${id}"]`).forEach((el) => el.remove());
    byId.delete(id);
    F.toast("Post deleted");
    if (F.qs("p") == id) location.href = "post.html";
  }

  /* ---------------- comments ---------------- */
  function commentHtml(c) {
    const u = c.profiles || {};
    return `<div class="cmt" data-cmt="${c.id}">
      <a href="profile.html?a=${F.esc(u.wallet || "")}"><img src="${F.avatarOf(u)}" alt=""></a>
      <div class="cmt-body"><div class="cmt-top"><a href="profile.html?a=${F.esc(u.wallet || "")}" class="post-name">${F.displayName(u)}</a>${F.founderBadge(u.wallet, true)}${F.lvlTag ? F.lvlTag(u.id || c.user_id) : ""}
        <span class="muted">· ${when(c.created_at)}</span>${canMod(c.user_id) ? `<button class="msg-del" data-del-cmt="${c.id}" data-post-of="${c.post_id}" title="Delete">×</button>` : ""}</div>
        <div class="post-text">${fmtText(c.body)}</div></div></div>`;
  }
  async function toggleComments(id, forceOpen) {
    const box = F.$(`#pc-${id}`); if (!box) return;
    const open = forceOpen || box.classList.contains("hidden");
    box.classList.toggle("hidden", !open);
    if (!open) { openComments.delete(id); return; }
    openComments.add(id);
    box.innerHTML = `<div class="muted" style="font-size:13px;padding:6px 0">Loading comments…</div>`;
    const { data, error } = await F.sb.from("post_comments").select("id,post_id,body,created_at,user_id,profiles!post_comments_user_id_fkey(id,wallet,name,avatar_url)").eq("post_id", id).order("created_at", { ascending: true }).limit(200);
    if (error) { box.innerHTML = `<div class="muted">Couldn't load comments.</div>`; return; }
    box.innerHTML = `<div class="cmt-list">${data.map(commentHtml).join("") || '<div class="muted cmt-empty" style="font-size:13px;padding:4px 0">No comments yet.</div>'}</div>
      ${me() ? `<form class="cmt-form" data-cform="${id}"><img src="${F.avatarOf(me())}" alt=""><input maxlength="300" placeholder="Write a comment…" autocomplete="off"><button class="btn btn-primary btn-sm">Reply</button></form>`
             : `<button class="btn btn-ghost btn-sm" data-signin style="margin-top:8px">Sign in to comment</button>`}`;
    F.$("input", box)?.focus();
  }
  async function addComment(form) {
    const id = Number(form.dataset.cform), inp = F.$("input", form), body = inp.value.trim();
    if (!body) return;
    const btn = F.$("button", form); btn.disabled = true;
    const { data, error } = await F.sb.from("post_comments").insert({ post_id: id, user_id: me().id, body }).select("id,post_id,body,created_at,user_id").single();
    btn.disabled = false;
    if (error) return F.toast("Comment not sent", F.esc(/Slow down/.test(error.message) ? "Slow mode — wait a few seconds." : error.message), "warn");
    inp.value = "";
    appendComment({ ...data, profiles: me() });
    const p = byId.get(id); if (p) { p.comment_count++; refreshPost(id); }
  }
  const seenCmt = new Set();
  function appendComment(c) {
    if (seenCmt.has(c.id)) return; seenCmt.add(c.id);
    const list = F.$(`#pc-${c.post_id} .cmt-list`); if (!list) return;
    F.$(".cmt-empty", list)?.remove();
    list.insertAdjacentHTML("beforeend", commentHtml(c));
  }
  async function deleteComment(cid, pid, btn) {
    const { error } = await F.sb.from("post_comments").delete().eq("id", cid);
    if (error) return F.toast("Couldn't delete", F.esc(error.message), "err");
    btn.closest(".cmt")?.remove();
    const p = byId.get(pid); if (p) { p.comment_count = Math.max(0, p.comment_count - 1); refreshPost(pid); }
  }

  /* one delegated click handler for every feed on the page */
  document.addEventListener("click", (e) => {
    const t = e.target;
    let b;
    if ((b = t.closest("[data-like]"))) return toggleLike(Number(b.dataset.like));
    if ((b = t.closest("[data-comments]"))) return toggleComments(Number(b.dataset.comments));
    if ((b = t.closest("[data-share]"))) return F.copy(new URL("post.html?p=" + b.dataset.share, location.href).href, "Post link copied");
    if ((b = t.closest("[data-del-post]"))) return deletePost(Number(b.dataset.delPost), b);
    if ((b = t.closest("[data-del-cmt]"))) return deleteComment(Number(b.dataset.delCmt), Number(b.dataset.postOf), b);
    if ((b = t.closest("[data-signin]"))) return F.auth.signIn();
  });
  document.addEventListener("submit", (e) => { const f = e.target.closest("[data-cform]"); if (f) { e.preventDefault(); addComment(f); } });

  /* ---------------- live updates ---------------- */
  let live = null, onNewPost = null;
  function startLive() {
    if (live || !F.auth.enabled) return;
    live = F.sb.channel("flow-posts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, ({ new: p }) => onNewPost && onNewPost(p))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "posts" }, ({ new: p }) => {
        const cur = byId.get(p.id); if (!cur) return;
        cur.like_count = p.like_count; cur.comment_count = p.comment_count; refreshPost(p.id);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "posts" }, ({ old }) => { F.$$(`[data-post="${old.id}"]`).forEach((el) => el.remove()); byId.delete(old.id); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "post_comments" }, async ({ new: c }) => {
        if (!openComments.has(c.post_id) || seenCmt.has(c.id)) return;
        const { data } = await F.sb.from("profiles").select("id,wallet,name,avatar_url").eq("id", c.user_id).single();
        appendComment({ ...c, profiles: data || {} });
      })
      .subscribe();
  }

  /* ---------------- data loaders ---------------- */
  async function fetchNew({ before, userId, userIds, coinMint, limit = 20 } = {}) {
    let q = F.sb.from("posts").select(SEL).order("created_at", { ascending: false }).limit(limit);
    if (before) q = q.lt("created_at", before);
    if (userId) q = q.eq("user_id", userId);
    if (userIds) q = q.in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    if (coinMint) q = q.eq("coin_mint", coinMint);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  async function fetchTrending() {
    const { data: top, error } = await F.sb.rpc("trending_posts", { lim: 50 });
    if (error) throw error;
    const ids = (top || []).map((r) => r.id);
    let list = [];
    if (ids.length) {
      const { data } = await F.sb.from("posts").select(SEL).in("id", ids);
      const m = new Map((data || []).map((p) => [p.id, p]));
      list = top.map((r) => m.get(r.id) && Object.assign(m.get(r.id), { recent_likes: r.recent_likes })).filter(Boolean);
    }
    // Fill up with the most-liked posts from the last 24 hours that got no fresh likes yet
    if (list.length < 20) {
      const since = new Date(Date.now() - 864e5).toISOString();
      const { data } = await F.sb.from("posts").select(SEL).gte("created_at", since).order("like_count", { ascending: false }).order("created_at", { ascending: false }).limit(30);
      (data || []).forEach((p) => { if (!ids.includes(p.id)) list.push(p); });
    }
    return list;
  }

  /* Render a member's posts into a container (used by the profile page) */
  F.renderUserPosts = async (box, userId) => {
    if (!F.auth.enabled) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="skeleton" style="height:120px"></div>`;
    try {
      const list = await fetchNew({ userId, limit: 50 });
      remember(list); await loadLiked(list.map((p) => p.id));
      box.innerHTML = list.length ? `<div class="feed">${list.map(postHtml).join("")}</div>` : `<div class="empty-state"><b>No posts yet</b>Posts from this member will show up here.</div>`;
      fillCoinChips(box); startLive();
    } catch (e) { box.innerHTML = `<div class="empty-state"><b>Couldn't load posts</b>${F.esc(e.message)}</div>`; }
  };

  /* ---------------- reusable composer ---------------- */
  function mountComposer(c, { coinMint = null, placeholder = "What's happening in the trenches?", onPosted } = {}) {
    if (!c) return;
    if (!me()) {
      c.innerHTML = `<div class="composer-cta"><div><b>${coinMint ? "Join the conversation" : `Share something with ${F.esc(F.cfg.siteName)}`}</b><div class="muted" style="font-size:13px">Sign in with your wallet to post, like and comment. It's free.</div></div>
        <button class="btn btn-primary" data-signin ${F.auth.busy ? "disabled" : ""}>${F.auth.busy ? "Check your wallet…" : F.wallet.connected ? "Sign in with wallet" : "Connect wallet"}</button></div>`;
      return;
    }
    if (F.$("textarea", c)) return; // keep what they're typing
    c.innerHTML = `<img src="${F.avatarOf(me())}" alt="" class="composer-av">
      <form class="composer-form">
        <textarea maxlength="500" rows="2" placeholder="${F.esc(placeholder)}"></textarea>
        <div class="composer-bar"><span class="muted" style="font-size:12px">${coinMint ? "Also shows on the Post page" : "Tip: paste a coin address or $TICKER"}</span><span class="spacer"></span>
          <span class="count">500</span><button class="btn btn-primary btn-sm" disabled>Post</button></div>
      </form>`;
    const form = F.$("form", c), ta = F.$("textarea", c), cnt = F.$(".count", c), send = F.$("button", form);
    const upd = () => { const n = 500 - ta.value.length; cnt.textContent = n; cnt.classList.toggle("warn", n < 40); send.disabled = !ta.value.trim(); ta.style.height = "auto"; ta.style.height = Math.min(260, ta.scrollHeight) + "px"; };
    ta.addEventListener("input", upd);
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = ta.value.trim(); if (!body) return;
      send.disabled = true; send.textContent = "Posting…";
      const row = { user_id: me().id, body }; if (coinMint) row.coin_mint = coinMint;
      const { data, error } = await F.sb.from("posts").insert(row).select(SEL).single();
      send.textContent = "Post";
      if (error) { upd(); return F.toast("Not posted", F.esc(/Slow down/.test(error.message) ? "Slow mode — you can post again in a few seconds." : error.message), "warn"); }
      ta.value = ""; upd();
      remember([data]);
      onPosted && onPosted(data);
      F.toast("Posted");
    };
  }

  /* ---------------- coin thread (coin page Comments tab) ---------------- */
  F.renderCoinThread = async (box, mint) => {
    if (!F.auth.enabled) { box.innerHTML = `<p class="muted">Comments aren't set up yet.</p>`; return; }
    ctxCoin = mint;
    box.innerHTML = `<div class="composer thread-composer"></div><div class="thread-feed" style="margin-top:12px"><div class="skeleton" style="height:100px"></div></div>
      <div class="load-more hidden"><button class="btn btn-ghost btn-sm">Load more</button></div>`;
    const comp = F.$(".composer", box), feedEl = F.$(".thread-feed", box), more = F.$(".load-more", box);
    let list = [];
    const draw = () => {
      feedEl.innerHTML = list.length ? `<div class="feed">${list.map(postHtml).join("")}</div>` : `<div class="empty-state" style="padding:28px"><b>No comments yet</b>Be the first to say something about this coin.</div>`;
    };
    const mountC = () => mountComposer(comp, { coinMint: mint, placeholder: "Say something about this coin…", onPosted: (p) => { list.unshift(p); draw(); } });
    mountC();
    try {
      list = await fetchNew({ coinMint: mint, limit: 30 });
      remember(list); await loadLiked(list.map((p) => p.id));
      draw(); more.classList.toggle("hidden", list.length < 30);
    } catch (e) { feedEl.innerHTML = `<p class="muted">Couldn't load comments: ${F.esc(e.message)}</p>`; }
    F.$("button", more).onclick = async () => {
      const older = await fetchNew({ coinMint: mint, before: list[list.length - 1]?.created_at, limit: 30 }).catch(() => []);
      remember(older); await loadLiked(older.map((p) => p.id)); list.push(...older); draw(); more.classList.toggle("hidden", older.length < 30);
    };
    onNewPost = (p) => { if (p.coin_mint !== mint || byId.has(p.id) || !box.isConnected) return;
      F.sb.from("posts").select(SEL).eq("id", p.id).single().then(({ data }) => { if (data && !byId.has(data.id)) { remember([data]); list.unshift(data); draw(); } }); };
    startLive();
    const reAuth = async () => { if (!box.isConnected) return; mountC(); liked.clear(); await loadLiked(list.map((p) => p.id)); draw(); };
    document.addEventListener("flow:auth", reAuth);
    document.addEventListener("flow:wallet", mountC);
  };
  F.coinThreadCount = async (mint) => {
    if (!F.auth.enabled) return 0;
    const { count } = await F.sb.from("posts").select("id", { count: "exact", head: true }).eq("coin_mint", mint);
    return count || 0;
  };

  /* ================= Post page ================= */
  const root = F.$("#postpage");
  if (!root) return;
  F.layout("post");
  const single = Number(F.qs("p")) || null;
  const S = { tab: ["new", "following"].includes(F.qs("tab")) ? F.qs("tab") : F.store.get("postTab", "trending"), list: [], more: true, pending: [] };

  if (!F.auth.enabled) { root.innerHTML = `<div class="empty-state"><b>Posts aren't set up yet</b>Connect Supabase in config.js.</div>`; return; }

  root.innerHTML = `<div class="feed-wrap">
    ${single ? `<a href="post.html" class="back-link">← All posts</a><div id="feed"></div>` : `
    <div class="section-title"><h2>${F.icons.edit.replace("<svg", '<svg width="20" height="20"')} Posts</h2></div>
    <div class="composer" id="composer"></div>
    <div class="toolbar" style="margin:16px 0 12px"><div class="tabs" id="ptabs"><button data-t="trending">🔥 Trending</button><button data-t="new">New</button><button data-t="following">Following</button></div>
      <span class="muted" id="ptabhint" style="font-size:12px"></span></div>
    <div class="new-posts hidden" id="newposts"></div>
    <div id="feed"><div class="skeleton" style="height:140px;margin-bottom:10px"></div><div class="skeleton" style="height:140px"></div></div>
    <div class="load-more hidden" id="pmore"><button class="btn btn-ghost">Load more</button></div>`}
  </div>`;

  function renderComposer() {
    mountComposer(F.$("#composer"), { onPosted: async (data) => {
      if (S.tab !== "new") { S.tab = "new"; F.store.set("postTab", "new"); await loadFeed(); }
      else if (!F.$(`#feed [data-post="${data.id}"]`)) { const f = F.$("#feed .feed"); if (f) f.insertAdjacentHTML("afterbegin", postHtml(data)); else loadFeed(); }
    } });
  }

  async function loadFeed() {
    const feed = F.$("#feed");
    F.$$("#ptabs button").forEach((b) => b.classList.toggle("active", b.dataset.t === S.tab));
    const hint = F.$("#ptabhint"); if (hint) hint.textContent = S.tab === "trending" ? "Most liked in the last 24 hours" : S.tab === "following" ? "Latest posts from people you follow" : "Latest posts first";
    F.$("#newposts")?.classList.add("hidden"); S.pending = [];
    feed.innerHTML = `<div class="skeleton" style="height:140px;margin-bottom:10px"></div><div class="skeleton" style="height:140px"></div>`;
    try {
      if (S.tab === "following") {
        if (!me()) { feed.innerHTML = `<div class="empty-state"><b>See posts from people you follow</b>Sign in with your wallet, then follow members from their profile or from any post.<div style="margin-top:12px"><button class="btn btn-primary" data-signin>Sign in</button></div></div>`; F.$("#pmore").classList.add("hidden"); return; }
        await F.follows.load();
        if (!F.follows.ids().length) { feed.innerHTML = `<div class="empty-state"><b>You're not following anyone yet</b>Tap Follow on a member's profile to see their posts here.</div>`; F.$("#pmore").classList.add("hidden"); return; }
      }
      const list = S.tab === "trending" ? await fetchTrending() : S.tab === "following" ? await fetchNew({ userIds: F.follows.ids() }) : await fetchNew();
      S.list = list; S.more = S.tab !== "trending" && list.length === 20;
      remember(list); await loadLiked(list.map((p) => p.id));
      feed.innerHTML = list.length ? `<div class="feed">${list.map(postHtml).join("")}</div>`
        : `<div class="empty-state"><b>${S.tab === "trending" ? "Nothing trending yet" : S.tab === "following" ? "Nothing new yet" : "No posts yet"}</b>${S.tab === "trending" ? "Posts with the most likes in the last 24 hours show up here." : S.tab === "following" ? "People you follow haven't posted yet." : "Be the first to post!"}</div>`;
      fillCoinChips(feed);
      F.$("#pmore").classList.toggle("hidden", !S.more);
    } catch (e) { feed.innerHTML = `<div class="empty-state"><b>Couldn't load posts</b>${F.esc(e.message)}</div>`; }
  }
  async function loadMore() {
    const last = S.list[S.list.length - 1]; if (!last) return;
    const btn = F.$("#pmore button"); btn.disabled = true;
    try {
      const list = await fetchNew({ before: last.created_at, ...(S.tab === "following" ? { userIds: F.follows.ids() } : {}) });
      remember(list); await loadLiked(list.map((p) => p.id));
      S.list.push(...list); S.more = list.length === 20;
      F.$("#feed .feed").insertAdjacentHTML("beforeend", list.map(postHtml).join("")); fillCoinChips(F.$("#feed"));
    } catch {}
    btn.disabled = false; F.$("#pmore").classList.toggle("hidden", !S.more);
  }
  async function loadSingle() {
    const feed = F.$("#feed");
    const { data, error } = await F.sb.from("posts").select(SEL).eq("id", single).maybeSingle();
    if (error || !data) { feed.innerHTML = `<div class="empty-state"><b>Post not found</b>It may have been deleted.</div>`; return; }
    remember([data]); await loadLiked([data.id]);
    document.title = `${data.profiles?.name || "Post"}: "${data.body.slice(0, 40)}" — ${F.cfg.siteName}`;
    openComments.add(data.id);
    feed.innerHTML = `<div class="feed single">${postHtml(data)}</div>`; fillCoinChips(feed);
    toggleComments(data.id, true);
  }

  onNewPost = async (p) => {
    if (single || byId.has(p.id)) return;
    if (S.tab !== "new") return;
    S.pending.push(p);
    const n = F.$("#newposts");
    n.textContent = `Show ${S.pending.length} new post${S.pending.length === 1 ? "" : "s"}`;
    n.classList.remove("hidden");
  };
  if (!single) {
    F.$("#ptabs").onclick = (e) => { const b = e.target.closest("[data-t]"); if (!b || b.dataset.t === S.tab) return; S.tab = b.dataset.t; F.store.set("postTab", S.tab); loadFeed(); };
    F.$("#pmore button").onclick = loadMore;
    F.$("#newposts").onclick = () => { window.scrollTo({ top: 0, behavior: "smooth" }); loadFeed(); };
  }

  let booted = false;
  const boot = async () => {
    renderComposer();
    if (!booted) { booted = true; single ? loadSingle() : loadFeed(); startLive(); return; }
    // auth changed: refresh like state + delete buttons
    if (S.tab === "following") return loadFeed();
    liked.clear(); await loadLiked([...byId.keys()]);
    F.$$("#feed [data-post]").forEach((el) => { const p = byId.get(Number(el.dataset.post)); if (p) el.outerHTML = postHtml(p); });
  };
  let t; document.addEventListener("flow:auth", () => { clearTimeout(t); t = setTimeout(boot, 150); });
  document.addEventListener("flow:wallet", renderComposer);
  setTimeout(() => { if (!booted) boot(); }, 1200); // in case auth resolves before we listen
})();
