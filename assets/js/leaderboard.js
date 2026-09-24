/* FLOW — leaderboard: top coins and most active traders */
(function () {
  const F = FLOW;
  F.layout("leaderboard");
  const root = F.$("#lb");
  const TABS = [
    { id: "mcap", label: "Top market cap" },
    { id: "gainers", label: "Top gainers 24h" },
    { id: "volume", label: "Most traded" },
    { id: "traders", label: "Top traders" },
  ];
  const S = { tab: F.qs("tab") || "mcap", coins: null, traders: null, err: null };
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
    pod.innerHTML = podium(list, (t) => F.avatar(t.addr), (t) => `<span class="mono">${F.short(t.addr)}</span>`, (t) => `<b>${F.usd(t.vol)}</b> <span class="muted">volume</span>`, (t) => "profile.html?a=" + t.addr);
    body.innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Trader</th><th class="num">Volume</th><th class="num">Trades</th><th class="num">Bought</th><th class="num">Sold</th><th>Coins</th></tr></thead><tbody>
      ${list.map((t, i) => `<tr data-href="profile.html?a=${t.addr}" style="cursor:pointer"><td class="rank-num">${i + 1}</td>
        <td><div class="coin-cell"><img src="${F.avatar(t.addr)}" alt="" style="border-radius:50%"><span class="mono">${F.short(t.addr, 5)}</span></div></td>
        <td class="num"><b>${F.usd(t.vol)}</b></td><td class="num">${t.n}</td><td class="num up">${F.usd(t.buy)}</td><td class="num down">${F.usd(t.sell)}</td>
        <td class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${[...t.coins].slice(0, 4).map((s) => "$" + F.esc(s)).join(", ")}</td></tr>`).join("")}
      </tbody></table></div>${partial ? '<p class="note">Still collecting trades…</p>' : ""}`;
  }

  (async () => {
    try { S.coins = await F.loadUniverse(); } catch (e) { S.err = e.message; }
    render();
  })();
})();
