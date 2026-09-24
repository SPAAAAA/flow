/* FLOW — home page: trending strip + live coin grid */
(function () {
  const F = FLOW;
  F.layout(F.qs("tab") === "watchlist" ? "watchlist" : "home");
  const root = F.$("#home");

  const TABS = [
    { id: "trending", label: "🔥 Trending" },
    { id: "new", label: "New" },
    { id: "graduating", label: "About to graduate" },
    { id: "gainers", label: "Top gainers" },
    { id: "mcap", label: "Market cap" },
    { id: "volume", label: "Volume" },
    { id: "watchlist", label: "★ Watchlist" },
  ];
  const state = {
    tab: F.qs("tab") || F.store.get("tab", "trending"),
    view: F.store.get("view", "grid"),
    pumpOnly: F.store.get("pumpOnly", false),
    minLiq: F.store.get("minLiq", 0),
    shown: 30,
    coins: [],
    watchCoins: [],
    loading: true,
    error: null,
    updated: null,
  };
  if (!TABS.some((t) => t.id === state.tab)) state.tab = "trending";

  root.innerHTML = `
    <div class="section-title"><h2><span class="live-dot"></span>Now trending</h2><span class="muted" id="updated"></span></div>
    <div class="hero" id="hero">${Array(4).fill('<div class="skeleton" style="height:170px"></div>').join("")}</div>
    <div class="toolbar">
      <div class="tabs" id="tabs">${TABS.map((t) => `<button data-tab="${t.id}">${t.label}</button>`).join("")}</div>
      <div class="spacer"></div>
      <label class="toggle"><input type="checkbox" id="pumpOnly"><span class="sw"></span>pump.fun coins only</label>
      <select class="select" id="minLiq" title="Minimum liquidity">
        <option value="0">Any liquidity</option><option value="5000">Liq ≥ $5K</option><option value="25000">Liq ≥ $25K</option><option value="100000">Liq ≥ $100K</option>
      </select>
      <div class="view-toggle"><button data-view="grid" title="Grid">${F.icons.grid}</button><button data-view="list" title="List">${F.icons.list}</button></div>
    </div>
    <div id="list"></div>
    <div class="load-more hidden" id="more"><button class="btn btn-ghost">Load more</button></div>`;

  F.$("#pumpOnly").checked = state.pumpOnly;
  F.$("#minLiq").value = String(state.minLiq);

  F.$("#tabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]"); if (!b) return;
    state.tab = b.dataset.tab; state.shown = 30;
    if (state.tab !== "watchlist") F.store.set("tab", state.tab);
    history.replaceState(null, "", state.tab === "watchlist" ? "?tab=watchlist" : location.pathname);
    F.$$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === (state.tab === "watchlist" ? "watchlist" : "home")));
    if (state.tab === "watchlist") loadWatch(); else render();
  };
  F.$("#pumpOnly").onchange = (e) => { state.pumpOnly = e.target.checked; F.store.set("pumpOnly", state.pumpOnly); render(); };
  F.$("#minLiq").onchange = (e) => { state.minLiq = Number(e.target.value); F.store.set("minLiq", state.minLiq); render(); };
  F.$(".view-toggle").onclick = (e) => { const b = e.target.closest("[data-view]"); if (!b) return; state.view = b.dataset.view; F.store.set("view", state.view); render(); };
  F.$("#more button").onclick = () => { state.shown += 30; render(); };
  document.addEventListener("flow:watch", () => { if (state.tab === "watchlist") loadWatch(); });

  function sorted() {
    let list = state.tab === "watchlist" ? state.watchCoins.slice() : state.coins.slice();
    if (state.pumpOnly) list = list.filter((c) => c.isPump);
    if (state.minLiq) list = list.filter((c) => (c.liq || 0) >= state.minLiq || c.onCurve);
    const by = (f) => (a, b) => (f(b) ?? -Infinity) - (f(a) ?? -Infinity);
    const txns = (c, k) => (c.txns[k]?.buys || 0) + (c.txns[k]?.sells || 0);
    switch (state.tab) {
      case "trending":
        // momentum score: recent activity + volume + boosts; featured pinned first
        list.sort(by((c) => (c.featured ? 1e15 : 0) + (c.vol.h1 || 0) * 2 + (c.vol.h6 || 0) * 0.5 + txns(c, "h1") * 50 + (c.boosts || 0) * 100));
        break;
      case "new": list.sort(by((c) => c.createdAt)); break;
      case "graduating": list = list.filter((c) => c.onCurve).sort(by((c) => c.progress)); break;
      case "gainers": list = list.filter((c) => (c.vol.h24 || 0) > 1000).sort(by((c) => c.chg.h24)); break;
      case "mcap": list.sort(by((c) => c.mcap)); break;
      case "volume": list.sort(by((c) => c.vol.h24)); break;
    }
    return list;
  }

  function renderHero() {
    const top = state.coins.slice().sort((a, b) => ((b.vol.h1 || 0) + (b.boosts || 0) * 50) - ((a.vol.h1 || 0) + (a.boosts || 0) * 50)).slice(0, 8);
    F.$("#hero").innerHTML = top.map((c, i) => `<a class="hero-card" href="coin.html?c=${c.mint}">
      <div class="bg" style="background-image:url('${F.esc(c.header || c.image || F.avatar(c.mint))}')"></div><div class="shade"></div>
      <span class="rank">#${i + 1}</span>
      <div class="body"><img src="${F.img(c.image, c.mint)}" alt="${F.esc(c.symbol)}"><div style="min-width:0"><div class="nm">${F.esc(c.name)}</div><div class="sub">MC ${F.usd(c.mcap)}</div></div><div class="chg">${F.pct(c.chg.h1)}<div class="muted" style="font-size:11px;font-weight:500;text-align:right">1h</div></div></div>
    </a>`).join("") || "";
  }

  function render() {
    F.$$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
    F.$$(".view-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
    const box = F.$("#list");
    if (state.loading && !state.coins.length && state.tab !== "watchlist") {
      box.innerHTML = `<div class="grid">${Array(9).fill('<div class="skeleton" style="height:134px"></div>').join("")}</div>`;
      return;
    }
    if (state.error && !state.coins.length && state.tab !== "watchlist") {
      box.innerHTML = `<div class="empty-state"><b>Couldn't load coins</b>${F.esc(state.error)}<div style="margin-top:14px"><button class="btn btn-ghost" id="retry">${F.icons.refresh}Retry</button></div></div>`;
      F.$("#retry").onclick = load; return;
    }
    const list = sorted();
    if (!list.length) {
      box.innerHTML = state.tab === "watchlist"
        ? `<div class="empty-state"><b>Your watchlist is empty</b>Tap the ☆ on any coin to keep an eye on it here.</div>`
        : `<div class="empty-state"><b>No coins match</b>Try switching off filters.</div>`;
      F.$("#more").classList.add("hidden"); return;
    }
    const page = list.slice(0, state.shown);
    box.innerHTML = state.view === "grid" ? `<div class="grid">${page.map(F.coinCard).join("")}</div>` : F.coinTable(page);
    F.$("#more").classList.toggle("hidden", list.length <= state.shown);
  }

  async function load() {
    state.loading = true; if (!state.coins.length) render();
    try {
      state.coins = await F.loadUniverse();
      state.error = null; state.updated = Date.now();
      renderHero();
    } catch (e) { state.error = e.message; }
    state.loading = false;
    if (state.tab !== "watchlist") render();
    tickUpdated();
  }
  async function loadWatch() {
    const m = F.watch.list();
    render();
    if (!m.length) { state.watchCoins = []; return render(); }
    F.$("#list").innerHTML = `<div class="grid">${Array(Math.min(m.length, 6)).fill('<div class="skeleton" style="height:134px"></div>').join("")}</div>`;
    try { state.watchCoins = F.toCoins(await F.dex.tokens(m)); } catch { state.watchCoins = []; }
    render();
  }
  function tickUpdated() { const u = F.$("#updated"); if (u && state.updated) u.textContent = "Updated " + F.ago(state.updated) + " ago"; }

  render();
  load();
  if (state.tab === "watchlist") loadWatch();
  setInterval(() => { if (!document.hidden) load(); }, 30000);
  setInterval(tickUpdated, 5000);
})();
