/* FLOW — coin page: chart, trades, holders, buy/sell via Jupiter */
(function () {
  const F = FLOW, CFG = F.cfg;
  F.layout("home");
  const root = F.$("#coin");
  const mint = (F.qs("c") || F.qs("mint") || "").trim();

  if (!F.isAddress(mint)) {
    root.innerHTML = `<div class="empty-state"><b>Coin not found</b>Paste a contract address in the search bar, or <a href="index.html" style="color:var(--accent-2)">browse coins</a>.</div>`;
    return;
  }

  const S = {
    coin: null, info: null, decimals: null,
    mode: "buy", tf: F.store.get("tf", "5m"),
    slip: F.store.get("slip", CFG.defaultSlippageBps),
    quote: null, quoting: false, quoteErr: null,
    sol: null, bal: null, trades: [], tab: F.auth?.enabled ? "comments" : "trades",
  };

  /* ---------------- skeleton ---------------- */
  root.innerHTML = `
  <div class="coin-layout">
    <div class="coin-main">
      <div class="coin-head" id="head"><div class="skeleton" style="width:56px;height:56px;border-radius:14px"></div><div class="skeleton" style="width:220px;height:40px"></div></div>
      <div class="stats" id="stats">${Array(6).fill('<div class="skeleton" style="height:66px"></div>').join("")}</div>
      <div class="panel">
        <div class="chart-bar" id="tfbar">
          ${["1m", "5m", "15m", "1h", "4h", "1D"].map((t) => `<button data-tf="${t}">${t}</button>`).join("")}
          <span class="sp"></span><span class="muted" style="font-size:12px" id="lastp"></span>
        </div>
        <div class="chart-box" id="chart"><div class="chart-msg" id="chartmsg">Loading chart…</div></div>
      </div>
      <div class="panel">
        <div class="subtabs" id="subtabs"><button data-t="comments" class="active">Comments <span class="tab-count" id="ccount"></span></button><button data-t="trades">Trades</button><button data-t="holders">Top holders</button><button data-t="about">About</button></div>
        <div id="tabbody"></div>
      </div>
    </div>
    <div class="coin-side">
      <div class="panel trade" id="trade"></div>
      <div class="panel" id="curve" style="display:none"></div>
      <div class="panel" id="pos"></div>
      <div class="panel" id="safety"></div>
    </div>
  </div>`;

  /* ---------------- data ---------------- */
  async function loadCoin() {
    try {
      const pairs = await F.dex.tokenPairs(mint);
      const coins = F.toCoins(pairs);
      const c = coins.find((x) => x.mint === mint);
      if (c) {
        // keep description from previous load (profiles endpoint)
        if (S.coin?.description && !c.description) c.description = S.coin.description;
        S.coin = c;
      }
    } catch (e) { if (!S.coin) console.warn(e); }
    if (!S.coin) {
      // unknown to DexScreener (e.g. just launched) — fall back to Jupiter token info
      const t = S.info || (await F.jup.tokenInfo(mint));
      S.info = t;
      S.coin = { mint, name: t?.name || "Unknown token", symbol: t?.symbol || "???", image: t?.icon, priceUsd: t?.usdPrice, mcap: t?.mcap, liq: t?.liquidity, vol: {}, chg: {}, txns: {}, websites: [], socials: [], pair: null, dexId: t?.launchpad || "", onCurve: false, isPump: /pump$/.test(mint) };
    }
    document.title = `${S.coin.name} ($${S.coin.symbol}) — ${CFG.siteName}`;
    renderHead(); renderStats(); renderCurve(); renderTradeStatic();
  }

  async function loadInfo() {
    S.info = await F.jup.tokenInfo(mint);
    if (S.info?.decimals != null) S.decimals = S.info.decimals;
    if (S.decimals == null) {
      try { S.decimals = (await F.rpc("getTokenSupply", [mint])).value.decimals; } catch { S.decimals = 6; }
    }
    renderStats(); renderSafety();
    if (S.tab === "about") renderAbout();
  }

  /* ---------------- header + stats ---------------- */
  function socialLinks(c) {
    const out = [];
    (c.websites || []).forEach((w) => out.push(`<a class="btn btn-ghost btn-sm" href="${F.esc(w.url)}" target="_blank" rel="noopener nofollow">${F.icons.globe}${F.esc(w.label || "Website")}</a>`));
    (c.socials || []).forEach((s) => {
      const t = (s.type || s.platform || "").toLowerCase();
      const url = s.url || (t === "twitter" ? "https://x.com/" + s.handle : t === "telegram" ? "https://t.me/" + s.handle : s.handle);
      const ic = t === "twitter" || t === "x" ? F.icons.x : t === "telegram" ? F.icons.telegram : t === "discord" ? F.icons.discord : F.icons.ext;
      if (url) out.push(`<a class="btn btn-ghost btn-sm" href="${F.esc(url)}" target="_blank" rel="noopener nofollow">${ic}${F.esc(t === "twitter" ? "X" : t || "Link")}</a>`);
    });
    return out.join("");
  }
  function renderHead() {
    const c = S.coin;
    F.$("#head").innerHTML = `
      <img src="${F.img(c.image, c.mint)}" alt="${F.esc(c.symbol)}">
      <div>
        <h1>${F.esc(c.name)} <span class="tk">$${F.esc(c.symbol)}</span></h1>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px">
          <button class="copy" id="copyca">${F.short(c.mint, 6)} ${F.icons.copy}</button>
          ${c.onCurve ? '<span class="badge blue">Bonding curve</span>' : c.isPump ? '<span class="badge">Graduated</span>' : ""}
          ${c.dexId ? `<span class="badge">${F.esc(c.dexId)}</span>` : ""}
          ${c.createdAt ? `<span class="muted" style="font-size:12px">Created ${F.ago(c.createdAt)} ago</span>` : ""}
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-star="${c.mint}" style="position:static">${F.watch.has(c.mint) ? F.icons.starFill : F.icons.star}</button>
        <button class="btn btn-ghost btn-sm" id="share">${F.icons.copy}Share</button>
        ${c.dsUrl ? `<a class="btn btn-ghost btn-sm" href="${F.esc(c.dsUrl)}" target="_blank" rel="noopener">DEX Screener ${F.icons.ext}</a>` : ""}
        <a class="btn btn-ghost btn-sm" href="https://solscan.io/token/${c.mint}" target="_blank" rel="noopener">Solscan ${F.icons.ext}</a>
      </div>`;
    F.$("#copyca").onclick = () => F.copy(c.mint, "Contract address copied");
    F.$("#share").onclick = () => F.copy(location.href, "Link copied");
  }
  function renderStats() {
    const c = S.coin; if (!c) return;
    const t24 = c.txns?.h24 || {};
    const holders = S.info?.holderCount;
    F.$("#stats").innerHTML = [
      ["Price", F.price(c.priceUsd)],
      ["Market cap", F.usd(c.mcap)],
      ["Liquidity", F.usd(c.liq)],
      ["Volume 24h", F.usd(c.vol?.h24)],
      ["Change 24h", F.pct(c.chg?.h24)],
      ["Holders", holders ? Number(holders).toLocaleString() : "—"],
      ["Buys / Sells 24h", t24.buys != null ? `<span class="up">${t24.buys.toLocaleString()}</span> / <span class="down">${t24.sells.toLocaleString()}</span>` : "—"],
    ].map(([l, v]) => `<div class="stat"><div class="l">${l}</div><div class="v">${v}</div></div>`).join("");
    const lp = F.$("#lastp"); if (lp) lp.innerHTML = `${F.price(c.priceUsd)} · 1h ${F.pct(c.chg?.h1)}`;
  }
  function renderCurve() {
    const c = S.coin, el = F.$("#curve");
    if (!c.onCurve || c.progress == null) { el.style.display = "none"; return; }
    el.style.display = "";
    el.innerHTML = `<div class="curve"><div class="top"><b>Bonding curve progress</b><b class="up">${c.progress.toFixed(1)}%</b></div>
      <div class="progress"><i style="width:${c.progress}%"></i></div>
      <p class="note">When the market cap reaches about ${F.usd(CFG.graduationMcapUsd)}, this coin graduates from the pump.fun bonding curve to PumpSwap. Estimate based on market cap.</p></div>`;
  }
  function renderSafety() {
    const t = S.info, el = F.$("#safety");
    if (!t) { el.innerHTML = `<h3>Token checks</h3><p class="muted" style="margin:0">No audit data available for this token.</p>`; return; }
    const a = t.audit || {};
    const row = (label, ok, txt) => `<div class="trade-row"><span>${label}</span><b class="${ok === true ? "up" : ok === false ? "down" : ""}">${txt}</b></div>`;
    el.innerHTML = `<h3>Token checks</h3>
      ${row("Mint authority", a.mintAuthorityDisabled === true ? true : a.mintAuthorityDisabled === false ? false : null, a.mintAuthorityDisabled ? "Disabled ✓" : a.mintAuthorityDisabled === false ? "Enabled ⚠" : "Unknown")}
      ${row("Freeze authority", a.freezeAuthorityDisabled === true ? true : a.freezeAuthorityDisabled === false ? false : null, a.freezeAuthorityDisabled ? "Disabled ✓" : a.freezeAuthorityDisabled === false ? "Enabled ⚠" : "Unknown")}
      ${a.topHoldersPercentage != null ? row("Top 10 holders", a.topHoldersPercentage < 30, a.topHoldersPercentage.toFixed(1) + "%") : ""}
      ${a.devBalancePercentage != null ? row("Dev holds", a.devBalancePercentage < 5, a.devBalancePercentage.toFixed(2) + "%") : ""}
      ${t.organicScoreLabel ? row("Organic activity", t.organicScoreLabel === "high" ? true : t.organicScoreLabel === "low" ? false : null, t.organicScoreLabel) : ""}
      ${t.isVerified ? row("Jupiter verified", true, "Yes") : ""}
      <p class="note">Automated checks from Jupiter. Not a guarantee — always do your own research.</p>`;
  }

  /* ---------------- chart ---------------- */
  let chart, candles, volume, chartPool = null;
  const TF = { "1m": ["minute", 1], "5m": ["minute", 5], "15m": ["minute", 15], "1h": ["hour", 1], "4h": ["hour", 4], "1D": ["day", 1] };
  function priceFmt(p) { return p >= 1 ? p.toFixed(4) : F.tinyNum(p); }
  function initChart() {
    if (chart || !window.LightweightCharts) return;
    const el = F.$("#chart");
    chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#8a8fa3", fontFamily: "Inter, sans-serif" },
      grid: { vertLines: { color: "rgba(255,255,255,.04)" }, horzLines: { color: "rgba(255,255,255,.04)" } },
      rightPriceScale: { borderColor: "#262a37" },
      timeScale: { borderColor: "#262a37", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      localization: { priceFormatter: priceFmt },
    });
    candles = chart.addCandlestickSeries({
      upColor: "#3d8bff", downColor: "#ff4d6a", borderUpColor: "#3d8bff", borderDownColor: "#ff4d6a", wickUpColor: "#3d8bff", wickDownColor: "#ff4d6a",
      priceFormat: { type: "custom", formatter: priceFmt, minMove: 1e-12 },
    });
    volume = chart.addHistogramSeries({ priceScaleId: "", priceFormat: { type: "volume" } });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  }
  function dexEmbed() {
    const c = S.coin;
    if (!c?.pair) return false;
    F.$("#chart").innerHTML = `<iframe src="https://dexscreener.com/solana/${c.pair}?embed=1&theme=dark&info=0&trades=0&chartLeftToolbar=0" style="width:100%;height:100%;border:0;border-radius:8px" loading="lazy" title="Chart"></iframe>`;
    chart = null; chartPool = "embed";
    return true;
  }
  async function loadChart(fit) {
    const c = S.coin;
    F.$$("#tfbar [data-tf]").forEach((b) => b.classList.toggle("active", b.dataset.tf === S.tf));
    if (!c?.pair) { F.$("#chart").innerHTML = `<div class="chart-msg">No trading pool found yet.<br>You can still try to trade — Jupiter will find a route if one exists.</div>`; return; }
    if (chartPool === "embed") return;
    if (!window.LightweightCharts) { dexEmbed(); return; }
    initChart();
    try {
      const [tf, agg] = TF[S.tf];
      const data = await F.gecko.ohlcv(c.pair, tf, agg);
      if (!data.length) throw new Error("no candles");
      candles.setData(data.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      volume.setData(data.map((d) => ({ time: d.time, value: d.value, color: d.close >= d.open ? "rgba(61,139,255,.35)" : "rgba(255,77,106,.35)" })));
      F.$("#chartmsg")?.remove();
      if (fit || chartPool !== c.pair) chart.timeScale().fitContent();
      chartPool = c.pair;
    } catch (e) {
      if (!chartPool) dexEmbed();
    }
  }
  F.$("#tfbar").onclick = (e) => {
    const b = e.target.closest("[data-tf]"); if (!b) return;
    S.tf = b.dataset.tf; F.store.set("tf", S.tf);
    if (chartPool === "embed") { chartPool = null; F.$("#chart").innerHTML = '<div class="chart-msg" id="chartmsg">Loading chart…</div>'; }
    loadChart(true);
  };

  /* ---------------- trades / holders / about ---------------- */
  F.$("#subtabs").onclick = (e) => {
    const b = e.target.closest("[data-t]"); if (!b) return;
    S.tab = b.dataset.t;
    F.$$("#subtabs button").forEach((x) => x.classList.toggle("active", x === b));
    if (S.tab === "comments") renderComments(); else if (S.tab === "trades") renderTrades(); else if (S.tab === "holders") loadHolders(); else renderAbout();
  };
  function renderComments() {
    const b = F.$("#tabbody");
    if (!F.renderCoinThread) { b.innerHTML = `<p class="muted">Comments aren't available.</p>`; return; }
    F.renderCoinThread(b, mint);
  }
  async function loadTrades() {
    if (!S.coin?.pair) { S.trades = []; if (S.tab === "trades") renderTrades(); return; }
    try { S.trades = await F.gecko.trades(S.coin.pair); } catch { S.tradesErr = true; }
    if (S.tab === "trades") renderTrades();
  }
  function renderTrades() {
    const b = F.$("#tabbody");
    if (!S.trades.length) { b.innerHTML = `<p class="muted">${S.tradesErr ? "Trade feed unavailable right now." : S.coin?.pair ? "Loading trades…" : "No trades yet."}</p>`; return; }
    const quoteSym = S.coin.quote?.symbol || "SOL";
    b.innerHTML = `<div class="table-wrap" style="border:0;background:none"><table class="t" style="min-width:640px"><thead><tr><th>Account</th><th>Type</th><th class="num">${quoteSym}</th><th class="num">${F.esc(S.coin.symbol)}</th><th class="num">USD</th><th class="num">Price</th><th class="num">Time</th><th class="num">Tx</th></tr></thead><tbody>
      ${S.trades.slice(0, 50).map((t) => `<tr>
        <td><a href="profile.html?a=${t.trader}" style="display:flex;align-items:center;gap:8px"><img src="${F.avatar(t.trader)}" data-wavatar="${t.trader}" alt="" style="width:20px;height:20px;border-radius:50%;object-fit:cover"><span class="mono" data-wname="${t.trader}">${F.short(t.trader)}</span></a></td>
        <td><span class="${t.kind === "buy" ? "up" : "down"}" style="font-weight:700">${t.kind === "buy" ? "Buy" : "Sell"}</span></td>
        <td class="num">${F.num(t.quoteAmt, 3)}</td><td class="num">${F.num(t.tokenAmt)}</td><td class="num">${F.usd(t.usd)}</td><td class="num">${F.price(t.price)}</td>
        <td class="num muted">${F.ago(t.time)}</td>
        <td class="num"><a href="${F.solscanTx(t.tx)}" target="_blank" rel="noopener" class="muted">${F.icons.ext.replace("<svg", '<svg width="14" height="14"')}</a></td></tr>`).join("")}
    </tbody></table></div>`;
    F.fillNames(b);
  }
  async function loadHolders() {
    const b = F.$("#tabbody");
    b.innerHTML = `<p class="muted">Loading holders…</p>`;
    try {
      const [largest, supply] = await Promise.all([F.rpc("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]), F.rpc("getTokenSupply", [mint])]);
      const total = Number(supply.value.uiAmount) || 1;
      const accs = largest.value.slice(0, 20);
      let owners = {};
      try {
        const m = await F.rpc("getMultipleAccounts", [accs.map((a) => a.address), { encoding: "jsonParsed" }]);
        m.value.forEach((v, i) => { owners[accs[i].address] = v?.data?.parsed?.info?.owner; });
      } catch {}
      if (S.tab !== "holders") return;
      b.innerHTML = accs.map((a, i) => {
        const owner = owners[a.address] || a.address;
        const pct = (Number(a.uiAmount) / total) * 100;
        const isPool = S.coin.pair && owner === S.coin.pair;
        return `<div class="holder-row"><div style="flex:1;min-width:0"><span class="muted" style="display:inline-block;width:24px">${i + 1}.</span>
          <a href="profile.html?a=${owner}" class="mono">${F.short(owner, 5)}</a> ${isPool ? '<span class="badge blue">Pool / curve</span>' : ""}
          <div class="bar" style="width:${Math.min(100, pct)}%"></div></div><b style="margin-left:12px">${pct.toFixed(2)}%</b></div>`;
      }).join("") + `<p class="note">Top 20 token accounts. Total supply ${F.num(total)}.</p>`;
    } catch (e) {
      b.innerHTML = `<p class="muted">Holder data needs a Solana RPC endpoint. ${F.esc(e.message)}</p>${S.info?.audit?.topHoldersPercentage != null ? `<p>Top 10 holders own <b>${S.info.audit.topHoldersPercentage.toFixed(1)}%</b> of supply.</p>` : ""}`;
    }
  }
  function renderAbout() {
    const c = S.coin, t = S.info || {};
    F.$("#tabbody").innerHTML = `
      ${c.description ? `<p>${F.esc(c.description)}</p>` : `<p class="muted">No description provided by the creator.</p>`}
      ${socialLinks(c) ? `<div class="links-row" style="margin:12px 0">${socialLinks(c)}</div>` : ""}
      <div class="trade-row"><span>Contract</span><b class="mono">${F.short(c.mint, 8)}</b></div>
      ${c.pair ? `<div class="trade-row"><span>Pool</span><b class="mono">${F.short(c.pair, 8)}</b></div>` : ""}
      ${c.dexId ? `<div class="trade-row"><span>Market</span><b>${F.esc(c.dexId)}</b></div>` : ""}
      ${c.fdv ? `<div class="trade-row"><span>FDV</span><b>${F.usd(c.fdv)}</b></div>` : ""}
      ${t.circSupply ? `<div class="trade-row"><span>Circulating supply</span><b>${F.num(t.circSupply)}</b></div>` : ""}
      ${S.decimals != null ? `<div class="trade-row"><span>Decimals</span><b>${S.decimals}</b></div>` : ""}
      ${c.createdAt ? `<div class="trade-row"><span>Pool created</span><b>${new Date(c.createdAt).toLocaleString()}</b></div>` : ""}`;
  }

  /* ---------------- trade panel ---------------- */
  function renderTradeStatic() {
    if (F.$("#trade").dataset.ready) { updateTradeLabels(); return; }
    F.$("#trade").dataset.ready = 1;
    F.$("#trade").innerHTML = `
      <div class="bs"><button class="buy active" data-m="buy">Buy</button><button class="sell" data-m="sell">Sell</button></div>
      <div class="trade-row" style="padding-top:0"><span id="balLabel">Balance</span><b id="balVal">—</b></div>
      <div class="field"><input id="amt" inputmode="decimal" placeholder="0.00" autocomplete="off"><span class="unit" id="unit"></span></div>
      <div class="quick" id="quick"></div>
      <div id="qinfo"></div>
      <button class="btn btn-primary" id="go">Connect wallet</button>
      <details style="margin-top:12px"><summary class="muted" style="cursor:pointer;font-size:13px">Slippage: <b id="slipLbl"></b></summary>
        <div class="slip" style="margin-top:8px" id="slip">${[100, 500, 1000, 2000].map((v) => `<button data-s="${v}">${v / 100}%</button>`).join("")}<input id="slipc" placeholder="Custom %" inputmode="decimal"></div>
        <p class="note">Meme coins move fast — higher slippage makes trades more likely to succeed but you may get a worse price.</p></details>
      <p class="note">Swaps are routed by Jupiter and signed in your wallet.<span id="feenote"></span></p>`;
    F.feeReady().then((ok) => { const n = F.$("#feenote"); if (n && ok) n.textContent = ` A ${CFG.platformFeeBps / 100}% ${CFG.siteName} fee applies to each trade.`; });
    F.$(".bs").onclick = (e) => { const b = e.target.closest("[data-m]"); if (b) setMode(b.dataset.m); };
    F.$("#amt").addEventListener("input", (e) => { e.target.value = e.target.value.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"); S.maxRaw = null; queueQuote(); });
    F.$("#quick").onclick = (e) => {
      const b = e.target.closest("[data-q]"); if (!b) return;
      const v = b.dataset.q;
      if (S.mode === "buy") { F.$("#amt").value = v; S.maxRaw = null; }
      else {
        if (!S.bal?.amount) return F.toast("No balance", `You don't hold any $${F.esc(S.coin.symbol)}`, "warn");
        const p = Number(v);
        if (p === 100) { S.maxRaw = S.bal.raw; F.$("#amt").value = String(S.bal.amount); }
        else { S.maxRaw = ((BigInt(S.bal.raw) * BigInt(p)) / 100n).toString(); F.$("#amt").value = String(+(S.bal.amount * p / 100).toPrecision(8)); }
      }
      queueQuote(0);
    };
    F.$("#slip").onclick = (e) => { const b = e.target.closest("[data-s]"); if (b) setSlip(Number(b.dataset.s)); };
    F.$("#slipc").onchange = (e) => { const v = parseFloat(e.target.value); if (v > 0 && v <= 50) setSlip(Math.round(v * 100)); };
    F.$("#go").onclick = execute;
    setSlip(S.slip); updateTradeLabels();
  }
  function setSlip(v) {
    S.slip = v; F.store.set("slip", v);
    F.$("#slipLbl").textContent = v / 100 + "%";
    F.$$("#slip [data-s]").forEach((b) => b.classList.toggle("active", Number(b.dataset.s) === v));
    queueQuote();
  }
  function setMode(m) {
    S.mode = m; S.quote = null; S.maxRaw = null; F.$("#amt").value = "";
    F.$$(".bs button").forEach((b) => b.classList.toggle("active", b.dataset.m === m));
    updateTradeLabels(); renderQuote();
  }
  function updateTradeLabels() {
    const c = S.coin; if (!c || !F.$("#unit")) return;
    const buy = S.mode === "buy";
    F.$("#unit").innerHTML = buy ? `<img src="${F.SOL_ICON}" alt="">SOL` : `<img src="${F.img(c.image, c.mint)}" alt="">${F.esc(c.symbol)}`;
    F.$("#quick").innerHTML = buy ? CFG.quickBuys.map((q) => `<button data-q="${q}">${q} SOL</button>`).join("") : [25, 50, 75, 100].map((q) => `<button data-q="${q}">${q === 100 ? "Max" : q + "%"}</button>`).join("");
    F.$("#balLabel").textContent = buy ? "SOL balance" : `${c.symbol} balance`;
    F.$("#balVal").textContent = !F.wallet.connected ? "—" : buy ? (S.sol != null ? S.sol.toFixed(4) + " SOL" : "…") : S.bal ? F.num(S.bal.amount) + " " + c.symbol : "…";
    const go = F.$("#go");
    go.className = "btn " + (buy ? "btn-primary" : "btn-danger");
    go.textContent = !F.wallet.connected ? "Connect wallet" : `${buy ? "Buy" : "Sell"} $${c.symbol}`;
    go.disabled = false;
  }

  let qTimer, qSeq = 0, qRefresh;
  function amountRaw() {
    const v = F.$("#amt").value.trim();
    if (!v || !(parseFloat(v) > 0)) return null;
    if (S.mode === "sell" && S.maxRaw) return S.maxRaw;
    const dec = S.mode === "buy" ? 9 : S.decimals ?? 6;
    const [i, f = ""] = v.split(".");
    return (BigInt(i || "0") * 10n ** BigInt(dec) + BigInt((f + "0".repeat(dec)).slice(0, dec) || "0")).toString();
  }
  function queueQuote(delay = 400) {
    clearTimeout(qTimer); clearInterval(qRefresh);
    qTimer = setTimeout(getQuote, delay);
  }
  async function getQuote() {
    const raw = amountRaw();
    if (!raw || raw === "0") { S.quote = null; S.quoteErr = null; renderQuote(); return; }
    if (S.mode === "sell" && S.decimals == null) await loadInfo();
    const seq = ++qSeq;
    S.quoting = true; renderQuote();
    try {
      const q = S.mode === "buy" ? await F.jup.quote(F.SOL, mint, raw, S.slip) : await F.jup.quote(mint, F.SOL, raw, S.slip);
      if (seq !== qSeq) return;
      S.quote = q; S.quoteErr = null;
    } catch (e) {
      if (seq !== qSeq) return;
      S.quote = null;
      S.quoteErr = /route|liquidity|COULD_NOT_FIND/i.test(e.message) ? "No route found for this trade — the coin may have too little liquidity." : e.message;
    }
    S.quoting = false; renderQuote();
    clearInterval(qRefresh);
    qRefresh = setInterval(() => { if (!document.hidden && !S.sending) getQuote(); }, 15000);
  }
  function renderQuote() {
    const el = F.$("#qinfo"); if (!el) return;
    const c = S.coin;
    if (S.quoteErr) { el.innerHTML = `<p class="down" style="font-size:13px;margin:6px 0">${F.esc(S.quoteErr)}</p>`; return; }
    if (!S.quote) { el.innerHTML = S.quoting ? `<p class="muted" style="font-size:13px">Finding best price…</p>` : ""; return; }
    const q = S.quote, buy = S.mode === "buy";
    const outDec = buy ? S.decimals ?? 6 : 9;
    const out = Number(q.outAmount) / 10 ** outDec, min = Number(q.otherAmountThreshold) / 10 ** outDec;
    const impact = Number(q.priceImpactPct) * 100;
    const route = [...new Set((q.routePlan || []).map((r) => r.swapInfo?.label).filter(Boolean))].join(" → ");
    const sym = buy ? c.symbol : "SOL";
    el.innerHTML = `
      <div class="trade-row"><span>You receive ≈</span><b>${F.num(out, 4)} ${F.esc(sym)}</b></div>
      <div class="trade-row"><span>Minimum received</span><b>${F.num(min, 4)} ${F.esc(sym)}</b></div>
      <div class="trade-row"><span>Price impact</span><b class="${impact > 5 ? "down" : ""}">${impact < 0.01 ? "<0.01" : impact.toFixed(2)}%</b></div>
      ${Number(q.platformFee?.feeBps) > 0 ? `<div class="trade-row"><span>${F.esc(CFG.siteName)} fee (${Number(q.platformFee.feeBps) / 100}%)</span><b>≈ ${F.num(((buy ? Number(q.inAmount) : Number(q.outAmount)) / 1e9) * Number(q.platformFee.feeBps) / 1e4, 5)} SOL</b></div>` : ""}
      ${route ? `<div class="trade-row"><span>Route</span><b style="max-width:200px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${F.esc(route)}</b></div>` : ""}
      ${impact > 10 ? `<p class="down" style="font-size:12px;margin:4px 0">⚠ High price impact — you'll lose a large part of this trade to slippage.</p>` : ""}`;
  }

  async function execute() {
    if (!F.wallet.connected) return F.openWalletModal();
    if (S.sending) return;
    const raw = amountRaw();
    if (!raw) return F.toast("Enter an amount", "", "warn");
    const buy = S.mode === "buy";
    if (buy && S.sol != null && Number(raw) / 1e9 > S.sol - 0.005) return F.toast("Not enough SOL", "Keep a little SOL (≈0.005) for network fees.", "warn");
    if (!buy && S.bal && BigInt(raw) > BigInt(S.bal.raw || 0)) return F.toast("Not enough tokens", "", "warn");
    const go = F.$("#go");
    S.sending = true; go.disabled = true; go.textContent = "Preparing…";
    try {
      const q = buy ? await F.jup.quote(F.SOL, mint, raw, S.slip) : await F.jup.quote(mint, F.SOL, raw, S.slip);
      S.quote = q; renderQuote();
      const { swapTransaction } = await F.jup.swapTx(q, F.wallet.pubkey);
      go.textContent = "Confirm in wallet…";
      const sig = await F.wallet.sendBase64Tx(swapTransaction);
      go.textContent = "Confirming…";
      const t = F.toast("Transaction sent", `<a href="${F.solscanTx(sig)}" target="_blank" rel="noopener">View on Solscan</a>`);
      const res = await F.wallet.confirm(sig);
      t.remove();
      if (res.ok !== false && F.logTrade) F.logTrade({ mint, symbol: S.coin.symbol, side: buy ? "buy" : "sell", sol: buy ? Number(q.inAmount) / 1e9 : Number(q.outAmount) / 1e9, signature: sig });
      if (res.ok === true) F.toast(`${buy ? "Bought" : "Sold"} $${S.coin.symbol} ✓`, `<a href="${F.solscanTx(sig)}" target="_blank" rel="noopener">View transaction</a>`);
      else if (res.ok === false) F.toast("Transaction failed", `Usually caused by price moving past your slippage. <a href="${F.solscanTx(sig)}" target="_blank" rel="noopener">Details</a>`, "err");
      else F.toast("Transaction submitted", `Couldn't confirm yet — check <a href="${F.solscanTx(sig)}" target="_blank" rel="noopener">Solscan</a>.`, "warn");
      F.$("#amt").value = ""; S.quote = null; S.maxRaw = null; renderQuote();
      setTimeout(loadBalances, 1500); setTimeout(loadTrades, 3000);
    } catch (e) {
      F.toast("Trade not completed", F.esc(e.message || String(e)), "err");
    } finally {
      S.sending = false; updateTradeLabels();
    }
  }

  async function loadBalances() {
    if (!F.wallet.connected) { S.sol = null; S.bal = null; renderPos(); updateTradeLabels(); return; }
    try {
      const { sol, tokens } = await F.tokenBalances(F.wallet.pubkey);
      S.sol = sol;
      S.bal = tokens.find((t) => t.mint === mint) || { mint, amount: 0, raw: "0" };
      if (S.bal.decimals != null && S.decimals == null) S.decimals = S.bal.decimals;
    } catch (e) {
      S.sol = null; S.bal = null;
    }
    updateTradeLabels(); renderPos();
  }
  function renderPos() {
    const el = F.$("#pos"), c = S.coin;
    if (!F.wallet.connected) { el.innerHTML = `<h3>Your position</h3><p class="muted" style="margin:0">Connect your wallet to see your balance.</p>`; return; }
    if (!S.bal) { el.innerHTML = `<h3>Your position</h3><p class="muted" style="margin:0">Loading…</p>`; return; }
    const val = S.bal.amount * (c?.priceUsd || 0);
    el.innerHTML = `<h3>Your position</h3>
      <div class="trade-row"><span>Holding</span><b>${F.num(S.bal.amount)} ${F.esc(c?.symbol || "")}</b></div>
      <div class="trade-row"><span>Value</span><b>${F.usd(val)}</b></div>
      <div class="trade-row"><span>SOL balance</span><b>${S.sol != null ? S.sol.toFixed(4) : "—"} SOL</b></div>`;
  }
  document.addEventListener("flow:wallet", loadBalances);

  /* mobile buy/sell bar */
  const mbar = F.h(`<div class="mbar"><button class="btn btn-primary" data-mb="buy">Buy</button><button class="btn btn-danger" data-mb="sell">Sell</button></div>`);
  mbar.onclick = (e) => { const b = e.target.closest("[data-mb]"); if (!b) return; setMode(b.dataset.mb); F.$("#trade").scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => F.$("#amt").focus({ preventScroll: true }), 400); };
  document.body.appendChild(mbar); document.body.classList.add("has-mbar");

  /* ---------------- boot ---------------- */
  (async () => {
    await loadCoin();
    loadChart(true); loadTrades(); loadInfo(); loadBalances(); renderPos();
    F.$$("#subtabs button").forEach((x) => x.classList.toggle("active", x.dataset.t === S.tab));
    if (S.tab === "comments") renderComments(); else renderTrades();
    if (F.coinThreadCount) F.coinThreadCount(mint).then((n) => { const e = F.$("#ccount"); if (e && n) e.textContent = n > 999 ? "999+" : n; });
  })();
  setInterval(() => { if (!document.hidden) { loadCoin(); } }, 12000);
  setInterval(() => { if (!document.hidden) { loadChart(false); if (S.tab === "trades") loadTrades(); } }, 20000);
})();
