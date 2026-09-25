/* FLOW — leaderboard: top coins and most active traders */
(function () {
  const F = FLOW;
  F.layout("leaderboard");
  const root = F.$("#lb");
  const TABS = [
    { id: "week", label: "🏆 This week" },
    { id: "pnl", label: "FLOW traders" },
    { id: "mcap", label: "Top market cap" },
    { id: "gainers", label: "Top gainers 24h" },
    { id: "volume", label: "Most traded" },
    { id: "traders", label: "Hot wallets" },
    { id: "members", label: "Online members" },
  ];
  const S = { tab: F.qs("tab") || (F.auth.enabled ? "week" : "mcap"), coins: null, traders: null, err: null, pnlRange: "all" };
  if (!TABS.some((t) => t.id === S.tab)) S.tab = "mcap";

  root.innerHTML = `
    <div class="section-title"><h2>${F.icons.trophy.replace("<svg", '<svg width="20" height="20"')} Leaderboard</h2><span class="muted" id="sub"></span></div>
    <div class="toolbar"><div class="tabs" id="tabs">${TABS.map((t) => `<button data-t="${t.id}">${t.label}</button>`).join("")}</div></div>
    <div id="podium"></div><div id="body"><div class="skeleton" style="height:400px"></div></div>`;
  F.$("#tabs").onclick = (e) => {
    const b = e.target.closest("[data-t]"); if (!b) return;
    S.tab = b.dataset.t; history.replaceState(null, "", "?tab=" + S.tab); render();
  };

  const metric = {
    mcap: { f: (c) => c.mcap, fmt: (c) => F.usd(c.mcap), l: "Market cap" },
    gainers: { f: (c) => ((c.vol.h24 || 0) > 5000 ? c.chg.h24 : null), fmt: (c) => F.pct(c.chg.h24), l: "24h change" },
    volume: { f: (c) => c.vol.h24, fmt: (c) => F.usd(c.vol.h24), l: "24h volume" },
  };

  function podium(items, img, name, sub, href) {
    const order = [1, 0, 2].filter((i) => items[i]);
    return `<div class="podium">${order.map((i) => { const x = items[i]; return `<a class="p ${i === 0 ? "first" : ""}" href="${href(x)}"><span class="medal">${["🥇", "🥈", "🥉"][i]}</span>
      <img src="${img(x)}" alt=""><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name(x)}</div><div style="margin-top:4px">${sub(x)}</div></a>`; }).join("")}</div>`;
  }

  function render() {
    F.$$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.t === S.tab));
    const body = F.$("#body"), pod = F.$("#podium");
    if (S.tab === "traders") return renderTraders();
    if (S.tab === "members") return renderMembers();
    if (S.tab === "week") return renderWeek();
    if (S.tab === "pnl") return renderPnl();
    F.$("#sub").textContent = "Live Solana meme coins tracked by FLOW";
    if (S.err) { pod.innerHTML = ""; body.innerHTML = `<div class="empty-state"><b>Couldn't load</b>${F.esc(S.err)}</div>`; return; }
    if (!S.coins) { pod.innerHTML = ""; body.innerHTML = `<div class="skeleton" style="height:400px"></div>`; return; }
    const m = metric[S.tab];
    const list = S.coins.filter((c) => m.f(c) != null).sort((a, b) => m.f(b) - m.f(a)).slice(0, 50);
    pod.innerHTML = podium(list, (c) => F.img(c.image, c.mint), (c) => `${F.esc(c.name)} <span class="muted">$${F.esc(c.symbol)}</span>`, (c) => `<b>${m.fmt(c)}</b>`, (c) => "coin.html?c=" + c.mint);
    body.innerHTML = F.coinTable(list);
  }

  async function loadTraders() {
    const pools = (S.coins || []).filter((c) => c.pair).sort((a, b) => (b.vol.h1 || 0) - (a.vol.h1 || 0)).slice(0, 8);
    const agg = new Map();
    for (const c of pools) {
      try {
        const trades = await F.gecko.trades(c.pair);
        for (const t of trades) {
          if (!t.trader) continue;
          const a = agg.get(t.trader) || { addr: t.trader, vol: 0, n: 0, buy: 0, sell: 0, coins: new Set() };
          a.vol += t.usd || 0; a.n++; a.coins.add(c.symbol);
          if (t.kind === "buy") a.buy += t.usd || 0; else a.sell += t.usd || 0;
          agg.set(t.trader, a);
        }
      } catch {}
      if (S.tab === "traders") { S.traders = [...agg.values()]; renderTraders(true); }
      await F.sleep(400);
    }
    S.traders = [...agg.values()];
    S.tradersDone = true;
    if (S.tab === "traders") renderTraders();
  }

  function renderTraders(partial) {
    const body = F.$("#body"), pod = F.$("#podium");
    F.$("#sub").textContent = "Most active wallets across the latest trades on the hottest coins";
    if (!S.traders) {
      pod.innerHTML = ""; body.innerHTML = `<div class="skeleton" style="height:400px"></div>`;
      if (S.coins && !S.loadingTraders) { S.loadingTraders = true; loadTraders(); }
      return;
    }
    const list = S.traders.sort((a, b) => b.vol - a.vol).slice(0, 50);
    if (!list.length) { pod.innerHTML = ""; body.innerHTML = `<div class="empty-state"><b>No trader data yet</b>Try again in a moment.</div>`; return; }
    pod.innerHTML = podium(list, (t) => F.avatar(t.addr), (t) => `<span class="mono" data-wname="${t.addr}">${F.short(t.addr)}</span>`, (t) => `<b>${F.usd(t.vol)}</b> <span class="muted">volume</span>`, (t) => "profile.html?a=" + t.addr);
    body.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Trader</th><th class="num">Volume</th><th class="num">Trades</th><th class="num">Bought</th><th class="num">Sold</th><th>Coins</th></tr></thead><tbody>
      ${list.map((t, i) => `<tr data-href="profile.html?a=${t.addr}" style="cursor:pointer"><td class="rank-num">${i + 1}</td>
        <td><div class="coin-cell"><img src="${F.avatar(t.addr)}" data-wavatar="${t.addr}" alt="" style="border-radius:50%"><span class="mono" data-wname="${t.addr}">${F.short(t.addr, 5)}</span></div></td>
        <td class="num"><b>${F.usd(t.vol)}</b></td><td class="num">${t.n}</td><td class="num up">${F.usd(t.buy)}</td><td class="num down">${F.usd(t.sell)}</td>
        <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${[...t.coins].slice(0, 4).map((s) => "$" + F.esc(s)).join(", ")}</td></tr>`).join("")}
      </tbody></table></div>${partial ? '<p class="note">Still collecting trades…</p>' : ""}`;
    F.$$(".podium img", pod).forEach((im, i) => { const a = pod.querySelectorAll("[data-wname]")[i]?.dataset.wname; if (a) im.dataset.wavatar = a; });
    if (!partial) { F.fillNames(pod); F.fillNames(body); }
  }

  /* ---------- shared helpers for member boards ---------- */
  const profs = new Map();
  async function loadProfs(ids) {
    const need = [...new Set(ids)].filter((i) => i && !profs.has(i));
    if (!need.length) return;
    const { data } = await F.sb.from("profiles").select("id,wallet,name,avatar_url").in("id", need);
    (data || []).forEach((p) => profs.set(p.id, p));
  }
  const P = (id) => profs.get(id) || { id, wallet: "" };
  const who = (p) => `<a class="wk-who" href="profile.html?a=${F.esc(p.wallet)}"><img src="${F.avatarOf(p)}" alt=""><span class="n">${F.displayName(p)}</span>${F.founderBadge(p.wallet, true)}${F.lvlTag(p.id)}${F.auth.profile?.id === p.id ? ' <span class="badge blue">You</span>' : ""}</a>`;
  const weekStart = () => { const d = new Date(); const day = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day); };
  const needSupabase = () => { F.$("#podium").innerHTML = ""; F.$("#body").innerHTML = `<div class="empty-state"><b>Not set up yet</b>Connect Supabase in config.js.</div>`; };

  /* ---------- weekly competition ---------- */
  let wkTimer = null, wkData = null;
  function countdown() {
    const el = F.$("#wk-cd"); if (!el) { clearInterval(wkTimer); return; }
    let s = Math.max(0, Math.floor((weekStart() + 7 * 864e5 - Date.now()) / 1000));
    const d = Math.floor(s / 86400); s %= 86400; const h = Math.floor(s / 3600); s %= 3600; const m = Math.floor(s / 60);
    el.textContent = `${d}d ${h}h ${m}m`;
  }
  async function renderWeek() {
    const body = F.$("#body"); F.$("#podium").innerHTML = "";
    if (!F.auth.enabled) return needSupabase();
    F.$("#sub").textContent = "New race every Monday 00:00 UTC";
    body.innerHTML = `<div class="week-hero"><div class="week-hero-l"><div class="week-title">🏆 Weekly competition</div>
        <div class="muted">Ends in <b id="wk-cd" style="color:var(--text)"></b> · winners get the 👑 Weekly champ badge and +100 XP</div></div></div>
      <div class="week-grid">
        <div class="panel week-card"><h3>💰 Top trader</h3><p class="note" style="margin:0 0 10px">Most profit on coins bought <i>and</i> sold on ${F.esc(F.cfg.siteName)} this week. Verified on-chain.</p><div id="wk-trader"><div class="skeleton" style="height:150px"></div></div></div>
        <div class="panel week-card"><h3>🎯 Best call</h3><p class="note" style="margin:0 0 10px">Biggest gain since a coin was posted this week (post in a coin's thread or paste its address).</p><div id="wk-call"><div class="skeleton" style="height:150px"></div></div></div>
        <div class="panel week-card"><h3>✍️ Top poster</h3><p class="note" style="margin:0 0 10px">Most likes from other members on posts this week.</p><div id="wk-poster"><div class="skeleton" style="height:150px"></div></div></div>
      </div>
      <h3 style="margin:26px 0 12px;font-size:15px">👑 Hall of fame</h3><div id="wk-hof"><div class="skeleton" style="height:80px"></div></div>`;
    countdown(); clearInterval(wkTimer); wkTimer = setInterval(countdown, 30000);
    F.sb.rpc("award_last_week").then(() => loadHof(), () => loadHof());
    const since = new Date(weekStart()).toISOString();
    const [tr, po, calls] = await Promise.all([
      F.sb.rpc("top_traders", { since, lim: 5 }).then((r) => r.data || []),
      F.sb.rpc("week_posters", { lim: 5 }).then((r) => r.data || []),
      F.sb.rpc("week_calls", {}).then((r) => r.data || []),
    ]);
    await loadProfs([...tr.map((r) => r.user_id), ...po.map((r) => r.user_id), ...calls.map((r) => r.user_id)]);
    if (S.tab !== "week") return;
    const empty = (t) => `<p class="muted" style="font-size:13px">${t}</p>`;
    const row = (i, p, val, extra = "") => `<div class="wk-row ${i === 0 ? "lead" : ""}"><span class="wk-rank">${["🥇", "🥈", "🥉"][i] || i + 1}</span>${who(p)}<span class="wk-val">${val}</span>${extra}</div>`;
    F.$("#wk-trader").innerHTML = tr.length ? tr.map((r, i) => row(i, P(r.user_id), `<b class="${r.pnl >= 0 ? "up" : "down"}">${F.fmtSol(+r.pnl)}</b>`)).join("") : empty("No closed trades yet this week. Buy and sell a coin on FLOW to enter.");
    F.$("#wk-poster").innerHTML = po.length ? po.map((r, i) => row(i, P(r.user_id), `<b>${r.likes}</b> ♥`)).join("") : empty("No likes yet this week — post something good.");
    // best calls: price when posted vs now
    const box = F.$("#wk-call");
    const list = calls.slice(0, 60).map((c) => ({ ...c, mint: c.coin_mint || (c.body.match(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/) || [])[1] })).filter((c) => c.mint);
    if (!list.length) { box.innerHTML = empty("No calls yet this week. Post about a coin to enter."); return; }
    const results = [];
    for (const c of list) {
      const r = await F.callResult(c.mint, Date.parse(c.created_at)).catch(() => null);
      if (r && Date.now() - Date.parse(c.created_at) > 5 * 60e3) results.push({ ...c, r });
      if (S.tab !== "week") return;
    }
    const best = new Map();
    results.forEach((x) => { const b = best.get(x.user_id); if (!b || x.r.chg > b.r.chg) best.set(x.user_id, x); });
    const top = [...best.values()].sort((a, b) => b.r.chg - a.r.chg).slice(0, 5);
    wkData = top;
    box.innerHTML = top.length ? top.map((x, i) => row(i, P(x.user_id), `<a href="post.html?p=${x.id}" class="${x.r.chg >= 0 ? "up" : "down"}"><b>${F.fmtPct(x.r.chg)}</b></a> <span class="muted" style="font-size:12px">$${F.esc(x.r.coin.symbol)}</span>`,
      F.auth.profile?.id === x.user_id ? `<button class="icon-btn wk-share" data-wkshare="${i}" title="Share">${F.icons.share}</button>` : "")).join("") : empty("Calls need a few minutes of price history — check back soon.");
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-wkshare]"); if (!b || !wkData) return;
    const x = wkData[Number(b.dataset.wkshare)], c = x.r.coin;
    F.openShare({ tag: "MY CALL", big: F.fmtPct(x.r.chg), up: x.r.chg >= 0, line1: `since I called $${c.symbol}`, line2: x.r.mcThen ? `Called at ${F.usd(x.r.mcThen)} MC → ${F.usd(x.r.mcEnd)} MC` : "",
      coin: { image: c.image, symbol: c.symbol, name: c.name }, user: F.shareUser(), url: new URL("post.html?p=" + x.id, location.href).href, text: `Called $${c.symbol} early: ${F.fmtPct(x.r.chg)} 🎯` });
  });
  async function loadHof() {
    const { data } = await F.sb.from("week_winners").select("*").order("week", { ascending: false }).limit(30);
    const el = F.$("#wk-hof"); if (!el) return;
    const rows = data || [];
    await loadProfs(rows.map((r) => r.user_id));
    if (!F.$("#wk-hof")) return;
    if (!rows.length) { el.innerHTML = `<p class="muted" style="font-size:13px">The first champions are crowned when this week ends.</p>`; return; }
    const weeks = new Map(); rows.forEach((r) => { if (!weeks.has(r.week)) weeks.set(r.week, {}); weeks.get(r.week)[r.category] = r; });
    const IC = { trader: "💰", call: "🎯", poster: "✍️" };
    el.innerHTML = `<div class="hof">${[...weeks.entries()].map(([wk, cats]) => `<div class="hof-week"><div class="hof-date">Week of ${new Date(wk + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>
      ${["trader", "call", "poster"].map((k) => cats[k] ? `<div class="hof-item"><span>${IC[k]}</span>${who(P(cats[k].user_id))}<span class="muted" style="font-size:12px;margin-left:auto">${F.esc(cats[k].detail || "")}</span></div>` : "").join("")}</div>`).join("")}</div>`;
  }

  /* ---------- FLOW traders (verified PnL) ---------- */
  async function renderPnl() {
    const body = F.$("#body"), pod = F.$("#podium");
    if (!F.auth.enabled) return needSupabase();
    F.$("#sub").textContent = "Realized profit from trades made on FLOW, verified on the Solana blockchain";
    pod.innerHTML = ""; body.innerHTML = `<div class="skeleton" style="height:300px"></div>`;
    const since = S.pnlRange === "week" ? new Date(weekStart()).toISOString() : S.pnlRange === "month" ? new Date(Date.now() - 30 * 864e5).toISOString() : "1970-01-01T00:00:00Z";
    const [{ data, error }, sol] = await Promise.all([F.sb.rpc("top_traders", { since, lim: 50 }), F.solUsd()]);
    if (S.tab !== "pnl") return;
    const toggle = `<div class="adm-filter" style="margin-bottom:14px">${[["all", "All time"], ["month", "30 days"], ["week", "This week"]].map(([k, l]) => `<button class="chip ${S.pnlRange === k ? "active" : ""}" data-pr="${k}">${l}</button>`).join("")}</div>`;
    if (error) { body.innerHTML = toggle + `<div class="empty-state"><b>Couldn't load</b>${F.esc(error.message)}</div>`; }
    else {
      const rows = data || [];
      await loadProfs(rows.map((r) => r.user_id));
      if (S.tab !== "pnl") return;
      if (!rows.length) { body.innerHTML = toggle + `<div class="empty-state"><b>No verified trades yet</b>Buy and sell any coin on ${F.esc(F.cfg.siteName)} to get on this board.</div>`; }
      else {
        const usd = (v) => (sol ? F.usd(Math.abs(v * sol)) : "");
        pod.innerHTML = podium(rows, (r) => F.avatarOf(P(r.user_id)), (r) => F.displayName(P(r.user_id)), (r) => `<b class="${r.pnl >= 0 ? "up" : "down"}">${F.fmtSol(+r.pnl)}</b>`, (r) => "profile.html?a=" + P(r.user_id).wallet);
        body.innerHTML = toggle + `<div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Member</th><th class="num">Profit</th><th class="num">Volume</th><th class="num">Trades</th><th class="num">Winning coins</th></tr></thead><tbody>
          ${rows.map((r, i) => { const p = P(r.user_id); return `<tr data-href="profile.html?a=${F.esc(p.wallet)}" style="cursor:pointer"><td class="rank-num">${i + 1}</td>
            <td><div class="coin-cell"><img src="${F.avatarOf(p)}" alt="" style="border-radius:50%"><span>${F.displayName(p)} ${F.founderBadge(p.wallet, true)}</span></div></td>
            <td class="num"><b class="${r.pnl >= 0 ? "up" : "down"}">${F.fmtSol(+r.pnl)}</b><div class="muted" style="font-size:12px">${r.pnl < 0 ? "−" : ""}${usd(+r.pnl)}</div></td>
            <td class="num">${(+r.volume).toFixed(2)} SOL</td><td class="num">${r.trades}</td><td class="num">${r.wins}/${r.coins}</td></tr>`; }).join("")}
          </tbody></table></div><p class="note">Counts coins bought and sold on ${F.esc(F.cfg.siteName)} in the chosen period, at the average buy price. Min. 0.05 SOL volume.</p>`;
      }
    }
    F.$$("[data-pr]", body).forEach((b) => (b.onclick = () => { S.pnlRange = b.dataset.pr; renderPnl(); }));
  }

  /* ---------- online members ---------- */
  async function renderMembers() {
    const body = F.$("#body"), pod = F.$("#podium");
    pod.innerHTML = "";
    if (!F.auth.enabled) { F.$("#sub").textContent = ""; body.innerHTML = `<div class="empty-state"><b>Members aren't set up yet</b>Connect Supabase in config.js to show who's online.</div>`; return; }
    const online = [...F.online.values()];
    F.$("#sub").textContent = `${online.length} member${online.length === 1 ? "" : "s"} online now`;
    const card = (m, on) => `<a class="member" href="profile.html?a=${F.esc(m.wallet)}">
      <div class="avatar-wrap"><img src="${F.esc(m.avatar || m.avatar_url || F.avatar(m.wallet))}" alt="">${on ? '<span class="online-dot" style="position:absolute;right:-2px;bottom:-2px;width:12px;height:12px;border:2px solid var(--panel);margin:0"></span>' : ""}</div>
      <div style="min-width:0"><div class="n">${F.esc(m.name || F.short(m.wallet))} ${F.founderBadge(m.wallet, true)}${m.id && F.lvlTag ? F.lvlTag(m.id) : ""}${F.auth.isMe(m.wallet) ? ' <span class="badge blue">You</span>' : ""}</div>
      <div class="s">${on ? "Online now" : "Last seen " + F.ago(Date.parse(m.last_seen)) + " ago"}</div></div></a>`;
    const signInCta = !F.auth.profile ? `<div class="empty-state" style="margin-bottom:16px;padding:22px"><b>Want to show up here?</b>Sign in with your wallet — it's free and only proves you own it.<div style="margin-top:12px"><button class="btn btn-primary" id="mem-signin">${F.wallet.connected ? "Sign in with wallet" : "Connect wallet"}</button></div></div>` : "";
    body.innerHTML = `${signInCta}
      <h3 style="margin:0 0 12px;font-size:15px"><span class="online-dot"></span>Online now</h3>
      ${online.length ? `<div class="members">${online.sort((a, b) => (a.name || "~").localeCompare(b.name || "~")).map((m) => card(m, true)).join("")}</div>` : `<div class="empty-state"><b>Nobody signed in right now</b>Members appear here the moment they're on ${F.esc(F.cfg.siteName)}.</div>`}
      <h3 style="margin:26px 0 12px;font-size:15px">Recently active</h3><div id="recent"><div class="skeleton" style="height:120px"></div></div>`;
    const b = F.$("#mem-signin"); if (b) b.onclick = F.auth.signIn;
    const { data } = await F.sb.from("profiles").select("id,wallet,name,avatar_url,last_seen").order("last_seen", { ascending: false }).limit(60);
    if (S.tab !== "members") return;
    const rest = (data || []).filter((m) => !F.online.has(m.wallet));
    F.$("#recent").innerHTML = rest.length ? `<div class="members">${rest.map((m) => card(m, false)).join("")}</div>` : `<p class="muted">No other members yet.</p>`;
  }
  let memT;
  const rerenderMembers = () => { if (S.tab === "members") { clearTimeout(memT); memT = setTimeout(renderMembers, 300); } };
  document.addEventListener("flow:online", rerenderMembers);
  document.addEventListener("flow:auth", rerenderMembers);

  (async () => {
    const own = ["members", "week", "pnl"];
    if (own.includes(S.tab)) render();
    try { S.coins = await F.loadUniverse(); } catch (e) { S.err = e.message; }
    if (!own.includes(S.tab)) render();
  })();
})();
