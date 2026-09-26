/* FLOW — profile page: any wallet's balances, coins held and activity */
(function () {
  const F = FLOW;
  F.layout("profile");
  const root = F.$("#profile");
  let addr = (F.qs("a") || F.qs("address") || "").trim();
  const S = { tab: "coins", hideDust: F.store.get("hideDust", true), holdings: null, sol: null, err: null, sigs: null };

  function prompt() {
    root.innerHTML = `<div class="empty-state" style="max-width:560px;margin:40px auto">
      <b>View a profile</b>Connect your wallet to see your own portfolio, or paste any Solana wallet address.
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;justify-content:center">
        <button class="btn btn-primary" id="pc">${F.icons.wallet}Connect wallet</button>
      </div>
      <form id="pf" style="display:flex;gap:8px;margin-top:12px"><input class="select" style="flex:1" id="pa" placeholder="Wallet address"><button class="btn btn-ghost">View</button></form></div>`;
    F.$("#pc").onclick = F.openWalletModal;
    F.$("#pf").onsubmit = (e) => { e.preventDefault(); const v = F.$("#pa").value.trim(); if (F.isAddress(v)) location.href = "profile.html?a=" + v; else F.toast("That's not a valid Solana address", "", "warn"); };
  }

  function shell() {
    document.title = `${F.short(addr)} — ${F.cfg.siteName}`;
    root.innerHTML = `
      <div class="pbanner" id="pbanner"></div>
      <div class="profile-head">
        <div class="avatar-wrap"><img class="avatar" id="pav" src="${F.avatar(addr)}" alt=""><span class="online-dot hidden" id="pdot" title="Online now"></span></div>
        <div>
          <h1 id="pname">${F.short(addr, 6)}</h1>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="copy" id="cp">${F.short(addr, 10)} ${F.icons.copy}</button><span class="muted" style="font-size:12px" id="psince"></span></div>
          <div class="pbio" id="pbio"></div>
          <div id="pteam"></div>
          <div class="follow-counts" id="pfollow"></div>
          <div class="plevel" id="plevel"></div>
          <div class="pshow" id="pshow"></div>
        </div>
        <div class="actions">
          <span id="phide"></span><span id="pcos"></span><span id="pach"></span><span id="pedit"></span><span id="ptip"></span><span id="pdm"></span>
          <button class="btn btn-ghost btn-sm" id="share">${F.icons.copy}Share</button>
          <a class="btn btn-ghost btn-sm" href="${F.solscanAcc(addr)}" target="_blank" rel="noopener">Solscan ${F.icons.ext}</a>
        </div>
      </div>
      <div id="pnlcard"></div>
      <div id="psup"></div>
      <div id="pinvite"></div>
      <div class="kpis" id="kpis">${Array(4).fill('<div class="skeleton" style="height:66px"></div>').join("")}</div>
      <div class="panel">
        <div class="subtabs" id="tabs"><button data-t="coins" class="active">Coins held</button><button data-t="pnl">PnL</button><button data-t="posts">Posts</button><button data-t="activity">Activity</button></div>
        <div id="body"></div>
      </div>`;
    F.$("#cp").onclick = () => F.copy(addr, "Address copied");
    F.$("#share").onclick = () => F.copy(location.origin + location.pathname + "?a=" + addr, "Profile link copied");
    F.$("#tabs").onclick = (e) => {
      const b = e.target.closest("[data-t]"); if (!b) return;
      S.tab = b.dataset.t; F.$$("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
      if (S.tab === "coins") renderCoins();
      else if (S.tab === "posts") showPosts();
      else if (S.tab === "pnl") renderPnl();
      else loadActivity();
    };
  }

  async function load() {
    try {
      const { sol, tokens } = await F.tokenBalances(addr);
      S.sol = sol;
      const mints = tokens.map((t) => t.mint);
      const coins = mints.length ? F.toCoins(await F.dex.tokens(mints.slice(0, 120))) : [];
      const byMint = Object.fromEntries(coins.map((c) => [c.mint, c]));
      S.holdings = tokens.map((t) => {
        const c = byMint[t.mint];
        return { ...t, coin: c, value: c?.priceUsd ? t.amount * c.priceUsd : null };
      }).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
      S.err = null;
    } catch (e) { S.err = e.message; }
    renderKpis();
    renderPnlCard();
    if (S.tab === "coins") renderCoins();
  }

  async function solPrice() {
    try { const r = await F.dex.tokens([F.SOL]); const p = r.find((x) => x.baseToken?.address === F.SOL && /USD/.test(x.quoteToken?.symbol)); return Number(p?.priceUsd) || null; } catch { return null; }
  }

  async function renderKpis() {
    const el = F.$("#kpis");
    if (S.err) { el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><b>Couldn't load this wallet</b>${F.esc(S.err)}</div>`; return; }
    const sp = await solPrice();
    const tokVal = S.holdings.reduce((s, h) => s + (h.value || 0), 0);
    const total = tokVal + (sp ? S.sol * sp : 0);
    const priced = S.holdings.filter((h) => h.value > 1).length;
    el.innerHTML = [
      ["Portfolio value", F.usd(total)],
      ["SOL balance", `${S.sol.toFixed(4)} <span class="muted" style="font-size:12px">${sp ? F.usd(S.sol * sp) : ""}</span>`],
      ["Coins value", F.usd(tokVal)],
      ["Coins held", `${priced} <span class="muted" style="font-size:12px">(${S.holdings.length} incl. dust)</span>`],
    ].map(([l, v]) => `<div class="stat"><div class="l">${l}</div><div class="v">${v}</div></div>`).join("");
  }

  function renderCoins() {
    const b = F.$("#body");
    if (S.err) { b.innerHTML = ""; return; }
    if (!S.holdings) { b.innerHTML = `<div class="skeleton" style="height:200px"></div>`; return; }
    let list = S.holdings;
    if (S.hideDust) list = list.filter((h) => (h.value || 0) >= 1);
    b.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><label class="toggle"><input type="checkbox" id="dust" ${S.hideDust ? "checked" : ""}><span class="sw"></span>Hide small balances</label></div>
      ${list.length ? `<div class="table-wrap" style="border:0;background:none"><table class="t" style="min-width:600px"><thead><tr><th>Coin</th><th class="num">Amount</th><th class="num">Price</th><th class="num">24h</th><th class="num">Value</th><th></th></tr></thead><tbody>
      ${list.map((h) => { const c = h.coin; return `<tr data-href="coin.html?c=${h.mint}" style="cursor:pointer">
        <td><div class="coin-cell"><img src="${F.img(c?.image, h.mint)}" alt="${F.esc(c?.symbol || "")}"><div><div class="n">${F.esc(c?.name || F.short(h.mint, 6))}</div><div class="s">${c ? "$" + F.esc(c.symbol) : "Unknown token"}</div></div></div></td>
        <td class="num sens">${F.num(h.amount)}</td><td class="num">${F.price(c?.priceUsd)}</td><td class="num">${F.pct(c?.chg?.h24)}</td><td class="num sens"><b>${F.usd(h.value)}</b></td>
        <td class="num"><a class="btn btn-ghost btn-sm" href="coin.html?c=${h.mint}">Trade</a></td></tr>`; }).join("")}
      </tbody></table></div>` : `<div class="empty-state"><b>No coins yet</b>${S.hideDust && S.holdings.length ? "Only small balances — switch off “Hide small balances” to see them." : "This wallet doesn't hold any tokens."}</div>`}`;
    F.$("#dust").onchange = (e) => { S.hideDust = e.target.checked; F.store.set("hideDust", S.hideDust); renderCoins(); };
  }

  /* ---------- PnL from verified FLOW trades ---------- */
  let pnlRows = null;
  async function renderPnl() {
    const b = F.$("#body");
    if (!F.pnl || !F.auth.enabled) { b.innerHTML = ""; return; }
    if (!member) { try { member = await F.profiles.byWallet(addr); } catch {} }
    if (!member) { b.innerHTML = `<div class="empty-state"><b>No FLOW trades</b>This wallet hasn't joined ${F.esc(F.cfg.siteName)} yet.</div>`; return; }
    if (!pnlRows) {
      b.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
      const hold = S.holdings ? new Map(S.holdings.map((h) => [h.mint, h.amount])) : null;
      try { pnlRows = await F.pnl(member.id, hold); } catch (e) { b.innerHTML = `<div class="empty-state"><b>Couldn't load PnL</b>${F.esc(e.message)}</div>`; return; }
    }
    if (S.tab !== "pnl") return;
    const rows = pnlRows, sol = await F.solUsd();
    const me = F.auth.isMe(addr);
    if (!rows.length) { b.innerHTML = `<div class="empty-state"><b>No trades yet</b>${me ? `Buy or sell any coin on ${F.esc(F.cfg.siteName)} and your profit and loss shows up here.` : `This member hasn't traded on ${F.esc(F.cfg.siteName)} yet.`}</div>`; return; }
    const tot = rows.reduce((s, r) => s + r.total, 0), real = rows.reduce((s, r) => s + r.realized, 0), unr = rows.reduce((s, r) => s + r.unreal, 0);
    const spent = rows.reduce((s, r) => s + r.bs, 0);
    const closed = rows.filter((r) => r.st > 0), wins = closed.filter((r) => r.realized > 0).length;
    const usd = (v) => (sol ? `<span class="muted" style="font-size:12px">${v < 0 ? "−" : ""}${F.usd(Math.abs(v * sol))}</span>` : "");
    const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
    b.innerHTML = `<div class="pnl-tab"><div class="kpis" style="margin-bottom:14px">
        <div class="stat"><div class="l">Total PnL</div><div class="v ${cls(tot)}">${F.fmtSol(tot)} ${usd(tot)}</div></div>
        <div class="stat"><div class="l">Realized</div><div class="v ${cls(real)}">${F.fmtSol(real)}</div></div>
        <div class="stat"><div class="l">Unrealized</div><div class="v ${cls(unr)}">${F.fmtSol(unr)}</div></div>
        <div class="stat"><div class="l">Win rate</div><div class="v">${closed.length ? Math.round((wins / closed.length) * 100) + "%" : "—"} <span class="muted" style="font-size:12px">${wins}/${closed.length} sold</span></div></div>
      </div>
      ${me ? `<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn btn-ghost btn-sm" id="pnl-share-all">${F.icons.share}Share my PnL</button></div>` : ""}
      <div class="table-wrap" style="border:0;background:none"><table class="t" style="min-width:640px"><thead><tr><th>Coin</th><th class="num">Bought</th><th class="num">Sold</th><th class="num">Holding</th><th class="num">PnL</th><th></th></tr></thead><tbody>
      ${rows.map((r, i) => { const c = r.coin; return `<tr data-href="coin.html?c=${r.mint}" style="cursor:pointer">
        <td><div class="coin-cell"><img src="${F.img(c?.image, r.mint)}" alt=""><div><div class="n">${F.esc(c?.name || r.symbol || F.short(r.mint))}</div><div class="s">$${F.esc(c?.symbol || r.symbol || "")} · ${r.trades} trade${r.trades > 1 ? "s" : ""}</div></div></div></td>
        <td class="num">${r.bs.toFixed(3)} SOL</td><td class="num">${r.ss.toFixed(3)} SOL</td>
        <td class="num">${r.openVal != null && r.open > 0 ? r.openVal.toFixed(3) + " SOL" : "—"}</td>
        <td class="num"><b class="${cls(r.total)}">${F.fmtSol(r.total)}</b><div class="${cls(r.total)}" style="font-size:12px">${F.fmtPct(r.pct)}</div></td>
        <td class="num">${me ? `<button class="btn btn-ghost btn-sm" data-pshare="${i}" title="Share">${F.icons.share}</button>` : ""}</td></tr>`; }).join("")}
      </tbody></table></div>
      <p class="note">Only trades made on ${F.esc(F.cfg.siteName)} count, and each one is checked on the Solana blockchain. Unrealized PnL uses today's price.</p></div>`;
    b.onclick = (e) => {
      const s = e.target.closest("[data-pshare]");
      if (s) { e.stopPropagation(); const r = rows[Number(s.dataset.pshare)]; const c = r.coin || {};
        return F.openShare({ tag: "MY TRADE", big: F.fmtPct(r.pct), up: r.total >= 0, line1: `${F.fmtSol(r.total)} on $${c.symbol || r.symbol}`, line2: `Bought ${r.bs.toFixed(3)} SOL · ${r.ss ? `sold ${r.ss.toFixed(3)} SOL` : "still holding"}`,
          coin: { image: c.image, symbol: c.symbol || r.symbol, name: c.name }, user: F.shareUser(), url: location.origin + location.pathname.replace(/[^/]*$/, "") + "coin.html?c=" + r.mint, text: `${F.fmtPct(r.pct)} on $${c.symbol || r.symbol} 🌊` }); }
    };
    const sa = F.$("#pnl-share-all");
    if (sa) sa.onclick = () => { const best = rows.slice().sort((a, b2) => b2.total - a.total)[0]?.coin;
      F.openShare({ tag: "MY PNL", big: F.fmtSol(tot, 2), up: tot >= 0, line1: `${F.fmtPct(spent ? (tot / spent) * 100 : null)} across ${rows.length} coin${rows.length > 1 ? "s" : ""}`, line2: `Win rate ${closed.length ? Math.round((wins / closed.length) * 100) + "%" : "—"} · verified on-chain`,
        coin: { image: best?.image || member.avatar_url, symbol: "PNL", name: `${F.displayName(member).replace(/<[^>]+>/g, "")} on FLOW` }, user: F.shareUser(), url: location.href.split("#")[0], text: `My FLOW PnL: ${F.fmtSol(tot, 2)} 🌊` }); };
  }

  /* ---------- achievements button + showcase ---------- */
  let achFor = null;
  async function renderAch() {
    const slot = F.$("#pach"), show = F.$("#pshow");
    if (!slot || !F.achievements || !F.auth.enabled || !member) return;
    if (achFor === member.id + (F.auth.profile?.id || "")) return;
    achFor = member.id + (F.auth.profile?.id || "");
    slot.innerHTML = `<button class="btn btn-ghost btn-sm ach-btn" id="achbtn">🏆 Achievements <span class="muted">…</span></button>`;
    F.$("#achbtn").onclick = () => F.openAchievements(member);
    try {
      const list = F.achievements.evaluate(await F.achievements.statsFor(member.id));
      const got = list.filter((a) => a.done);
      F.$("#achbtn").innerHTML = `🏆 Achievements <span class="ach-count">${got.length}/${list.length}</span>`;
      const ord = { u: 0, c: 1, r: 2, e: 3, l: 4 };
      const top = got.sort((a, b) => ord[b.r] - ord[a.r]).slice(0, 7);
      if (show) {
        show.innerHTML = top.length ? top.map((a) => `<button class="pshow-t ${F.achievements.RAR[a.r].cls}" title="${F.esc(a.name)} · ${F.achievements.RAR[a.r].name}">${a.ic}</button>`).join("") : "";
        show.onclick = () => F.openAchievements(member);
      }
      if (F.qs("ach") && !renderAch.opened) { renderAch.opened = true; F.openAchievements(member); }
    } catch {}
  }

  /* ---------- PnL card: portfolio value, profit over time, rank ---------- */
  const PC = { range: F.store.get("pnlRange", "1M"), trades: null, forId: null, busy: false };
  const RANGES = { "1D": 864e5, "1W": 7 * 864e5, "1M": 30 * 864e5, ALL: Infinity };
  const money = (v, sign) => (v == null || isNaN(v) ? "—" : `${v < 0 ? "−" : sign && v > 0 ? "+" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  async function renderPnlCard() {
    const el = F.$("#pnlcard"); if (!el) return;
    if (!F.auth.enabled || !F.pnl) { el.innerHTML = ""; return; }
    if (!member) { try { member = await F.profiles.byWallet(addr); } catch {} }
    if (!member) { el.innerHTML = ""; return; }
    if (PC.busy) { PC.again = true; return; } PC.busy = true; PC.again = false;
    try {
      if (PC.forId !== member.id || !PC.trades) {
        const { data } = await F.sb.from("trades").select("mint,side,sol_amount,tokens,created_at").eq("user_id", member.id).eq("verified", true).gt("tokens", 0).order("created_at", { ascending: true }).limit(3000);
        PC.trades = data || []; PC.forId = member.id;
      }
      const sol = await F.solUsd();
      const mints = [...new Set(PC.trades.map((t) => t.mint))];
      const coins = await F.coinsByMint(mints);
      const hold = S.holdings ? new Map(S.holdings.map((h) => [h.mint, h.amount])) : null;
      // walk trades in order with average-cost accounting
      const pos = new Map(), ev = []; let realized = 0;
      for (const t of PC.trades) {
        const p = pos.get(t.mint) || { tok: 0, cost: 0 }, s = +t.sol_amount || 0, k = +t.tokens || 0, at = Date.parse(t.created_at);
        if (t.side === "buy") { p.tok += k; p.cost += s; ev.push({ t: at, r: realized, buy: s }); }
        else { const avg = p.tok ? p.cost / p.tok : 0, m = Math.min(k, p.tok), got = k ? s * (m / k) : 0; realized += got - m * avg; p.tok -= m; p.cost -= m * avg; ev.push({ t: at, r: realized, buy: 0 }); }
        pos.set(t.mint, p);
      }
      let unreal = 0;
      for (const [m, p] of pos) {
        let open = p.tok; if (hold) open = Math.min(open, hold.get(m) || 0);
        const c = coins.get(m), px = c?.priceUsd && sol ? c.priceUsd / sol : null;
        if (px != null && open > 0 && p.tok > 0) unreal += open * px - open * (p.cost / p.tok);
      }
      const now = Date.now(), span = RANGES[PC.range] || RANGES["1M"];
      const start = span === Infinity ? (ev[0]?.t ?? now - 864e5) : now - span;
      const before = ev.filter((e) => e.t < start), inside = ev.filter((e) => e.t >= start);
      const base = before.length ? before[before.length - 1].r : 0;
      const pReal = realized - base, profit = pReal + unreal;
      const buyVol = inside.reduce((a, e) => a + e.buy, 0);
      const pct = buyVol > 0 ? (profit / buyVol) * 100 : null;
      const usd = (v) => (sol ? v * sol : null);
      const portfolio = S.holdings ? S.holdings.reduce((a, h) => a + (h.value || 0), 0) + (S.sol != null && sol ? S.sol * sol : 0) : null;
      // chart points (USD)
      const pts = [{ t: start, v: 0 }, ...inside.map((e) => ({ t: e.t, v: e.r - base })), { t: now, v: pReal + unreal }].map((p) => ({ t: p.t, v: usd(p.v) ?? p.v }));
      // rank among FLOW traders for the same period
      let rank = null;
      try { const { data: tt } = await F.sb.rpc("top_traders", { since: new Date(span === Infinity ? 0 : start).toISOString(), lim: 100 }); const i = (tt || []).findIndex((r) => r.user_id === member.id); if (i >= 0) rank = i + 1; } catch {}
      const up = profit >= 0, cls = profit > 0 ? "up" : profit < 0 ? "down" : "";
      el.innerHTML = `<div class="pnl-card ${up ? "is-up" : "is-down"}">
        <div class="pc-top">
          <div class="pc-main">
            <div class="pc-big">${portfolio != null ? money(portfolio) : "…"}</div>
            <div class="pc-lbl">Profit</div>
            <div class="pc-profit ${cls}">${money(usd(profit), true)} <span>(${F.fmtPct(pct)})</span> <em>${PC.range === "ALL" ? "All time" : PC.range}</em></div>
            ${rank ? `<div class="pc-rank ${cls}">Rank: #${rank}</div>` : `<div class="pc-rank muted">${PC.trades.length ? "Not ranked yet" : "No FLOW trades yet"}</div>`}
          </div>
          <div class="pc-side">
            <div class="pc-ranges">${Object.keys(RANGES).map((r) => `<button data-pr="${r}" class="${PC.range === r ? "active" : ""}">${r}</button>`).join("")}</div>
            <div class="pc-sol" title="SOL balance"><span class="pc-sol-ic">◎</span>${S.sol != null ? S.sol.toFixed(3) + " SOL" : "—"}<b>≈ ${S.sol != null && sol ? money(S.sol * sol) : "—"}</b></div>
            ${F.auth.isMe(addr) && PC.trades.length ? `<button class="btn btn-ghost btn-sm" id="pc-share">${F.icons.share}Share</button>` : ""}
          </div>
        </div>
        <div class="pc-chart" id="pc-chart"></div>
        <div class="pc-stats">
          <div><div class="pc-lbl">Realized</div><div class="pc-v ${pReal > 0 ? "up" : pReal < 0 ? "down" : ""}">${money(usd(pReal), true)}</div></div>
          <div><div class="pc-lbl">Unrealized</div><div class="pc-v ${unreal > 0 ? "up" : unreal < 0 ? "down" : ""}">${money(usd(unreal), true)}</div></div>
          <div><div class="pc-lbl">Buy volume</div><div class="pc-v">${money(usd(buyVol))}</div></div>
        </div>
        ${PC.trades.length ? "" : `<p class="note" style="margin:10px 0 0">Buy or sell any coin on ${F.esc(F.cfg.siteName)} to start the chart. Every trade is verified on-chain.</p>`}
      </div>`;
      drawChart(F.$("#pc-chart"), pts, up);
      F.$$("[data-pr]", el).forEach((b) => (b.onclick = () => { PC.range = b.dataset.pr; F.store.set("pnlRange", PC.range); renderPnlCard(); }));
      const sh = F.$("#pc-share");
      if (sh) sh.onclick = () => F.openShare({ tag: `MY PNL · ${PC.range === "ALL" ? "ALL TIME" : PC.range}`, big: money(usd(profit), true).replace(/\.\d\d$/, ""), up, line1: `${F.fmtPct(pct)} profit${rank ? ` · Rank #${rank} on FLOW` : ""}`, line2: `Realized ${money(usd(pReal), true)} · Unrealized ${money(usd(unreal), true)}`,
        coin: { image: member.avatar_url, symbol: "PNL", name: "Verified on-chain" }, user: F.shareUser(), url: location.href.split("#")[0], text: `My FLOW PnL: ${money(usd(profit), true)} 🌊` });
    } finally { PC.busy = false; if (PC.again) { PC.again = false; setTimeout(renderPnlCard, 50); } }
  }
  function drawChart(box, pts, up) {
    if (!box) return;
    const W = 600, H = 170, P = 8;
    const col = up ? "var(--up)" : "var(--down)";
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    let lo = Math.min(0, ...pts.map((p) => p.v)), hi = Math.max(0, ...pts.map((p) => p.v));
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const x = (t) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
    const y = (v) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
    // step line: value holds until the next trade
    let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].v).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].t).toFixed(1)} V${y(pts[i].v).toFixed(1)}`;
    const last = pts[pts.length - 1];
    const area = `${d} V${y(lo).toFixed(1)} H${x(t0).toFixed(1)} Z`;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="pc-svg">
        <defs><pattern id="pcdots" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="rgba(255,255,255,.07)"/></pattern>
          <linearGradient id="pcfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${up ? "#3d8bff" : "#ff4d6a"}" stop-opacity=".22"/><stop offset="1" stop-color="${up ? "#3d8bff" : "#ff4d6a"}" stop-opacity="0"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#pcdots)"/>
        <line x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="rgba(255,255,255,.12)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
        <path d="${area}" fill="url(#pcfill)"/>
        <path d="${d}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
        <line class="pc-x" x1="0" x2="0" y1="0" y2="${H}" stroke="rgba(255,255,255,.25)" vector-effect="non-scaling-stroke" style="display:none"/>
      </svg><span class="pc-dot" style="left:${(x(last.t) / W) * 100}%;top:${(y(last.v) / H) * 100}%;background:${col}"></span><div class="pc-tip hidden"></div>`;
    const svg = F.$("svg", box), tip = F.$(".pc-tip", box), xl = F.$(".pc-x", box);
    box.onmousemove = (e) => {
      const r = svg.getBoundingClientRect(), fx = ((e.clientX - r.left) / r.width) * W;
      let best = pts[0]; for (const p of pts) if (x(p.t) <= fx) best = p;
      xl.style.display = ""; xl.setAttribute("x1", x(best.t)); xl.setAttribute("x2", x(best.t));
      tip.classList.remove("hidden");
      tip.innerHTML = `<b class="${best.v >= 0 ? "up" : "down"}">${money(best.v, true)}</b><span>${new Date(best.t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>`;
      tip.style.left = Math.min(r.width - 150, Math.max(0, e.clientX - r.left - 70)) + "px";
    };
    box.onmouseleave = () => { tip.classList.add("hidden"); xl.style.display = "none"; };
  }
  document.addEventListener("flow:trade", () => { PC.trades = null; setTimeout(renderPnlCard, 800); });

  /* ---------- invite card (own profile) ---------- */
  function renderInvite() {
    const el = F.$("#pinvite"); if (!el) return;
    if (!F.inviteLink || !F.auth.profile || !F.auth.isMe(addr)) { el.innerHTML = ""; return; }
    const link = F.inviteLink(F.auth.profile);
    const s = F.levels?.get(F.auth.profile.id);
    el.innerHTML = `<div class="invite-card"><div class="invite-ic">${F.icons.gift}</div>
      <div style="flex:1;min-width:0"><b>Invite friends to ${F.esc(F.cfg.siteName)}</b><div class="muted" style="font-size:13px">+100 XP for every friend who joins with your link${s ? ` · <b style="color:var(--text)">${s.invites || 0}</b> joined so far` : ""}. Invite 1 for 🎟️ Recruiter, 10 for 📣 Ambassador.</div>
        <div class="invite-link"><input readonly value="${F.esc(link)}" id="invlink"><button class="btn btn-primary btn-sm" id="invcopy">${F.icons.copy}Copy</button></div></div></div>`;
    F.$("#invcopy").onclick = () => F.copy(link, "Invite link copied");
    F.$("#invlink").onclick = (e) => e.target.select();
  }
  document.addEventListener("flow:auth", () => setTimeout(renderInvite, 100));

  async function loadActivity() {
    const b = F.$("#body");
    b.innerHTML = `<p class="muted">Loading activity…</p>`;
    try {
      S.sigs = S.sigs || (await F.rpc("getSignaturesForAddress", [addr, { limit: 40 }]));
      if (S.tab !== "activity") return;
      b.innerHTML = S.sigs.length ? `<div class="table-wrap" style="border:0;background:none"><table class="t" style="min-width:520px"><thead><tr><th>Transaction</th><th>Status</th><th class="num">When</th></tr></thead><tbody>
        ${S.sigs.map((s) => `<tr><td><a class="mono" href="${F.solscanTx(s.signature)}" target="_blank" rel="noopener">${F.short(s.signature, 10)}</a>${s.memo ? ` <span class="muted">${F.esc(s.memo).slice(0, 40)}</span>` : ""}</td>
        <td>${s.err ? '<span class="down">Failed</span>' : '<span class="up">Success</span>'}</td><td class="num muted">${s.blockTime ? F.ago(s.blockTime * 1000) + " ago" : "—"}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty-state"><b>No activity</b>This wallet has no transactions yet.</div>`;
    } catch (e) {
      b.innerHTML = `<div class="empty-state"><b>Activity unavailable</b>Needs a Solana RPC endpoint (see config.js). ${F.esc(e.message)}</div>`;
    }
  }

  async function start() {
    const u = F.qs("u");
    if (!addr && u && F.auth.enabled) {
      const want = u.toLowerCase().replace(/^@/, "");
      const { data } = await F.sb.from("profiles").select("wallet,name").ilike("name", want.replace(/_/g, "_").replace(/[%]/g, "")).limit(20);
      const hit = (data || []).find((p) => p.name && p.name.replace(/ /g, "_").toLowerCase() === want)
        || (await F.sb.from("profiles").select("wallet,name").ilike("name", want.replace(/_/g, " ")).limit(5)).data?.find((p) => p.name.replace(/ /g, "_").toLowerCase() === want);
      if (hit) addr = hit.wallet;
      else { root.innerHTML = `<div class="empty-state"><b>No member called @${F.esc(u)}</b>Check the spelling, or search by wallet address.</div>`; return; }
    }
    if (!addr) { if (F.wallet.pubkey) addr = F.wallet.pubkey; else return prompt(); }
    if (!F.isAddress(addr)) { root.innerHTML = `<div class="empty-state"><b>Invalid address</b>That doesn't look like a Solana wallet address.</div>`; return; }
    shell(); renderCoins(); load(); loadMember();
  }

  /* ---------- member identity (name, picture, online) ---------- */
  let member = null;
  async function loadMember() {
    if (F.auth.enabled) { try { member = await F.profiles.byWallet(addr); } catch {} }
    if (F.auth.isMe?.(addr)) member = F.auth.profile;
    renderIdentity();
    if (F.qs("edit") && !openedEdit) { openedEdit = true; if (F.auth.isMe?.(addr)) openEdit(); }
  }
  let openedEdit = false;
  async function renderLevel() {
    const el = F.$("#plevel"); if (!el) return;
    if (!F.levels || !member) { el.innerHTML = ""; return; }
    try { F.levels.forget(member.id); await F.levels.load([member.id]); } catch { return; }
    const i = F.levels.info(member.id); if (!i) { el.innerHTML = ""; return; }
    const b = F.levels.badges(member.id);
    el.innerHTML = `<div class="plevel-row"><span class="lvl-pill lv${Math.min(5, Math.ceil(i.level / 5))}">Lv ${i.level}</span>
        <div class="xpbar" title="${i.xp} / ${i.next} XP"><i style="width:${i.pct}%"></i></div><span class="muted" style="font-size:12px">${i.xp} / ${i.next} XP</span>${i.streak ? `<span class="streak-pill" title="Visited ${i.streak} days in a row">🔥 ${i.streak}-day streak</span>` : ""}<span id="pseason"></span></div>
      ${b.length ? `<div class="badge-row">${b.map((x) => `<span class="mbadge" title="${F.esc(x.why)}">${x.ic} ${F.esc(x.name)}</span>`).join("")}</div>` : ""}`;
    renderSeason().catch(() => {});
  }
  async function renderSeason() {
    const el = F.$("#pseason"); if (!el || !F.season || !member) return;
    const [s, { data: past }] = await Promise.all([F.season.of(member.id), F.sb.from("season_rewards").select("season,rank,place").eq("user_id", member.id).order("season", { ascending: false }).limit(3)]);
    const R = Object.fromEntries(F.season.RANKS.map((r) => [r.id, r]));
    const e2 = F.$("#pseason"); if (!e2) return;
    e2.innerHTML = F.season.pill(+s.points || 0) + (s.place ? `<span class="muted" style="font-size:12px;margin-left:4px">#${s.place} this season</span>` : "")
      + (past || []).map((x) => `<span class="rk rk-${x.rank} rk-past" title="Finished #${x.place} in ${F.season.label(Date.parse(x.season + "T00:00:00Z"))}">${R[x.rank]?.ic || ""} ${new Date(x.season + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })}</span>`).join("");
  }
  async function renderDmBtn() {
    const slot = F.$("#pdm"); if (!slot) return;
    slot.innerHTML = "";
    if (!F.auth.enabled || !member || !F.auth.profile || F.auth.isMe(addr)) return;
    const { data } = await F.sb.rpc("can_dm", { a: F.auth.profile.id, b: member.id }).catch(() => ({ data: false }));
    if (data) slot.innerHTML = `<a class="btn btn-ghost btn-sm" href="messages.html?to=${F.esc(member.id)}">${F.icons.chat}Message</a>`;
    else slot.innerHTML = `<button class="btn btn-ghost btn-sm" disabled title="You can message each other once you both follow each other">${F.icons.chat}Message</button>`;
    if (F.reportBtn) slot.insertAdjacentHTML("beforeend", ` <button class="btn btn-ghost btn-sm" data-report="user:${F.esc(member.id)}" title="Report this member">${F.icons.flag}Report</button>`);
  }
  document.addEventListener("flow:follow", () => setTimeout(renderDmBtn, 300));
  document.addEventListener("flow:cos", () => { if (F.auth.isMe(addr)) { member = F.auth.profile; renderIdentity(); } });
  document.addEventListener("flow:tip", (e) => { if (e.detail?.to === addr) setTimeout(() => F.renderSupporters(F.$("#psup"), addr), 1500); });
  let counts = null, countsFor = null;
  async function renderFollow() {
    const el = F.$("#pfollow"); if (!el) return;
    if (!F.auth.enabled || !member) { el.innerHTML = ""; return; }
    if (countsFor !== member.id) { countsFor = member.id; counts = await F.follows.counts(member.id).catch(() => null); }
    const me = F.auth.isMe?.(addr);
    el.innerHTML = `${counts ? `<button class="linkish" data-fl="followers"><b>${counts.followers}</b> Followers</button><button class="linkish" data-fl="following"><b>${counts.following}</b> Following</button>` : ""}
      ${!me ? F.followBtn(member.id) : ""}`;
    el.onclick = (e) => { const b = e.target.closest("[data-fl]"); if (b) F.showFollowList(member.id, b.dataset.fl, b.dataset.fl === "followers" ? "Followers" : "Following"); };
  }
  document.addEventListener("flow:follow", (e) => { if (member && e.detail.id === member.id && counts) { counts.followers += e.detail.on ? 1 : -1; renderFollow(); } });
  document.addEventListener("flow:follows-ready", () => renderFollow());
  document.addEventListener("flow:streak", () => { if (member && F.auth.isMe(addr)) renderLevel(); });
  async function showPosts() {
    const b = F.$("#body");
    if (!F.renderUserPosts || !F.auth.enabled) { b.innerHTML = ""; return; }
    if (!member) { try { member = await F.profiles.byWallet(addr); } catch {} }
    if (S.tab !== "posts") return;
    if (!member) { b.innerHTML = `<div class="empty-state"><b>No posts yet</b>This wallet hasn't joined ${F.esc(F.cfg.siteName)} yet.</div>`; return; }
    F.renderUserPosts(b, member.id);
  }
  function renderIdentity() {
    if (!F.$("#pname")) return;
    const me = F.auth.isMe?.(addr), connectedHere = F.wallet.pubkey === addr;
    document.body.classList.toggle("own-profile", !!(me || connectedHere));
    const tp = F.$("#ptip");
    if (tp && F.sendSolModal) {
      tp.innerHTML = me || connectedHere ? "" : `<button class="btn btn-primary btn-sm tip-btn" id="tipbtn"><span class="tip-sol">◎</span>Send SOL</button>`;
      const tb = F.$("#tipbtn"); if (tb) tb.onclick = () => F.sendSolModal({ wallet: addr, name: member?.name || null, avatar_url: member?.avatar_url || null });
    }
    const hb = F.$("#phide");
    if (hb) hb.innerHTML = me || connectedHere ? F.hideBalBtn() : "";
    F.$("#pname").innerHTML = `${member?.name ? F.esc(member.name) : F.short(addr, 6)} ${F.founderBadge(addr)} ${me || connectedHere ? '<span class="badge blue">You</span>' : ""}${member?.banned ? ' <span class="badge suspended" title="This account was suspended for breaking the rules">Suspended</span>' : ""}`;
    F.$("#pav").src = member?.avatar_url || F.avatar(addr);
    F.$("#psince").textContent = member ? `Member since ${new Date(member.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : "";
    F.$("#pdot").classList.toggle("hidden", !F.online.has(addr));
    if (member?.name) document.title = `${member.name} — ${F.cfg.siteName}`;
    const bn = F.$("#pbanner");
    if (bn) { bn.style.backgroundImage = member?.banner_url ? `url("${member.banner_url.replace(/"/g, "")}")` : ""; bn.classList.toggle("has", !!member?.banner_url);
      bn.className = bn.className.replace(/\bfx-\S+/g, "").trim(); if (member?.cos_fx) bn.classList.add("fx-" + member.cos_fx); }
    const aw = F.$(".avatar-wrap");
    if (aw) { aw.className = aw.className.replace(/\bcf-\S+/g, "").trim(); if (member?.cos_frame) aw.classList.add("cf-" + member.cos_frame); }
    const pn = F.$("#pname");
    if (pn) { pn.className = pn.className.replace(/\bcn-\S+/g, "").trim(); if (member?.cos_name) pn.classList.add("cn-" + member.cos_name); }
    const ptm = F.$("#pteam");
    if (ptm && member && F.sb) F.sb.from("team_members").select("role,teams(id,name,tag,emblem,color)").eq("user_id", member.id).maybeSingle().then(({ data }) => {
      const t = data?.teams; ptm.innerHTML = t ? `<a class="pteam tc-bd-${F.esc(t.color)}" href="teams.html?t=${t.id}"><span class="t-emb tc-${F.esc(t.color)} sm">${F.esc(t.emblem)}</span>${F.esc(t.name)} <span class="ttag tc-${F.esc(t.color)}">${F.esc(t.tag)}</span>${data.role === "owner" ? " 👑" : data.role === "officer" ? " ⭐" : ""}</a>` : ""; });
    const pc = F.$("#pcos");
    if (pc) pc.innerHTML = (me && F.openCustomize) ? `<button class="btn btn-ghost btn-sm" id="cosbtn">🎨 Customize</button>` : "";
    const cb = F.$("#cosbtn"); if (cb) cb.onclick = F.openCustomize;
    if (F.renderSupporters && !renderIdentity.sup) { renderIdentity.sup = true; F.renderSupporters(F.$("#psup"), addr); }
    const bio = F.$("#pbio");
    if (bio) {
      const links = [];
      if (member?.name) links.push(`<span class="muted mono">@${F.esc(F.handleOf(member))}</span>`);
      if (member?.x_handle) links.push(`<a href="https://x.com/${encodeURIComponent(member.x_handle)}" target="_blank" rel="noopener nofollow" class="plink">${F.icons.x}@${F.esc(member.x_handle)}</a>`);
      if (member?.tiktok_handle) links.push(`<a href="https://www.tiktok.com/@${encodeURIComponent(member.tiktok_handle)}" target="_blank" rel="noopener nofollow" class="plink">${F.icons.tiktok}@${F.esc(member.tiktok_handle)}</a>`);
      bio.innerHTML = `${member?.bio ? `<p class="pbio-text">${F.esc(member.bio)}</p>` : ""}${links.length ? `<div class="plinks">${links.join("")}</div>` : ""}`;
    }
    renderFollow(); renderLevel().then(renderInvite); renderDmBtn(); renderPnlCard(); renderAch();
    const ed = F.$("#pedit");
    if (!F.auth.enabled) ed.innerHTML = "";
    else if (me) { ed.innerHTML = `<button class="btn btn-primary btn-sm" id="edit-btn">${F.icons.edit}Edit profile</button>`; F.$("#edit-btn").onclick = openEdit; }
    else if (connectedHere) { ed.innerHTML = `<button class="btn btn-primary btn-sm" id="edit-btn">${F.icons.edit}Sign in to edit</button>`; F.$("#edit-btn").onclick = async () => { await F.auth.signIn(); if (F.auth.isMe(addr)) { member = F.auth.profile; renderIdentity(); openEdit(); } }; }
    else ed.innerHTML = "";
  }
  function openEdit() {
    const p = F.auth.profile; if (!p) return;
    let file = null;
    const m = F.h(`<div class="modal-bg"><div class="modal">
      <h3>Edit profile</h3><p>Your name and picture show in chat, on the leaderboard and on your profile.</p>
      <label class="edit-avatar" title="Change picture"><img id="ea-img" src="${F.avatarOf(p)}" alt=""><span>${F.icons.edit}</span><input type="file" accept="image/*" id="ea-file" hidden></label>
      <label class="edit-banner" title="Change banner" style="${p.banner_url ? `background-image:url('${F.esc(p.banner_url)}')` : ""}"><span>${F.icons.edit} Banner</span><input type="file" accept="image/*" id="eb-file" hidden></label>
      <label class="label" for="ea-name">Display name</label>
      <input class="input" id="ea-name" maxlength="20" placeholder="e.g. moonboy" value="${F.esc(p.name || "")}">
      <p class="note" style="margin:6px 0 12px">2–20 characters: letters, numbers, spaces, _ . - · People can mention you as @${F.esc(F.handleOf(p) || "yourname")}</p>
      <label class="label" for="ea-bio">Bio</label>
      <textarea class="input" id="ea-bio" maxlength="160" rows="2" style="height:auto;padding:10px 12px;resize:none" placeholder="Tell people what you trade…">${F.esc(p.bio || "")}</textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0 16px">
        <div><label class="label" for="ea-x">X (Twitter)</label><input class="input" id="ea-x" maxlength="16" placeholder="handle" value="${F.esc(p.x_handle || "")}"></div>
        <div><label class="label" for="ea-tt">TikTok</label><input class="input" id="ea-tt" maxlength="25" placeholder="handle" value="${F.esc(p.tiktok_handle || "")}"></div>
      </div>
      <div style="display:flex;gap:8px">
        ${p.avatar_url ? '<button class="btn btn-ghost" id="ea-rm">Remove picture</button>' : ""}
        <span style="flex:1"></span><button class="btn btn-ghost" id="ea-cancel">Cancel</button><button class="btn btn-primary" id="ea-save">Save</button>
      </div></div></div>`);
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener("click", (e) => { if (e.target === m) close(); });
    F.$("#ea-cancel", m).onclick = close;
    F.$("#ea-file", m).onchange = (e) => { file = e.target.files[0]; if (file) F.$("#ea-img", m).src = URL.createObjectURL(file); };
    let bannerFile = null;
    F.$("#eb-file", m).onchange = (e) => { bannerFile = e.target.files[0]; if (bannerFile) F.$(".edit-banner", m).style.backgroundImage = `url('${URL.createObjectURL(bannerFile)}')`; };
    let removePic = false;
    const rm = F.$("#ea-rm", m); if (rm) rm.onclick = () => { removePic = true; file = null; F.$("#ea-img", m).src = F.avatar(p.wallet); rm.remove(); };
    F.$("#ea-save", m).onclick = async () => {
      const btn = F.$("#ea-save", m); btn.disabled = true; btn.textContent = "Saving…";
      try {
        const fields = {};
        const name = F.$("#ea-name", m).value.trim().replace(/\s+/g, " ");
        if (name !== (p.name || "")) fields.name = name || null;
        if (file) fields.avatar_url = await F.auth.uploadAvatar(file);
        else if (removePic) fields.avatar_url = null;
        if (bannerFile) fields.banner_url = await F.auth.uploadBanner(bannerFile);
        const bio = F.$("#ea-bio", m).value.trim().replace(/\s+/g, " ");
        if (bio !== (p.bio || "")) fields.bio = bio || null;
        const xh = F.$("#ea-x", m).value.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//, "");
        if (xh && !/^[A-Za-z0-9_]{1,15}$/.test(xh)) throw new Error("X handle can only have letters, numbers and _ (max 15)");
        if (xh !== (p.x_handle || "")) fields.x_handle = xh || null;
        const th = F.$("#ea-tt", m).value.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/, "");
        if (th && !/^[A-Za-z0-9_.]{2,24}$/.test(th)) throw new Error("TikTok handle can only have letters, numbers, _ and . (2–24)");
        if (th !== (p.tiktok_handle || "")) fields.tiktok_handle = th || null;
        if (Object.keys(fields).length) member = await F.auth.updateProfile(fields);
        renderIdentity(); close(); F.toast("Profile saved");
      } catch (e) { F.toast("Couldn't save", F.esc(e.message), "err"); btn.disabled = false; btn.textContent = "Save"; }
    };
  }
  document.addEventListener("flow:auth", () => { if (addr) { if (F.auth.isMe(addr)) member = F.auth.profile; renderIdentity(); } });
  document.addEventListener("flow:online", () => { const d = F.$("#pdot"); if (d) d.classList.toggle("hidden", !F.online.has(addr)); });
  document.addEventListener("flow:wallet", () => {
    if (!F.qs("a") && F.wallet.pubkey && addr !== F.wallet.pubkey) { addr = F.wallet.pubkey; S.holdings = null; S.sigs = null; member = null; start(); }
    else if (addr) renderIdentity();
  });
  start();
})();
