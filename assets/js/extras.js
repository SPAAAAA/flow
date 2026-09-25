/* FLOW extras: verified trade logging, PnL, share cards, price alerts, invite links, call results */
(function () {
  const F = FLOW;
  const me = () => F.auth?.profile;
  F.icons.alert = F.icons.bell;
  F.icons.share = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>`;
  F.icons.gift = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/></svg>`;
  const siteUrl = () => location.origin + location.pathname.replace(/[^/]*$/, "");

  /* ================= prices ================= */
  let solP = null, solT = 0;
  F.solUsd = () => {
    if (!solP || Date.now() - solT > 300000) {
      solT = Date.now();
      solP = F.dex.tokens([F.SOL]).then((r) => { const p = r.find((x) => x.baseToken?.address === F.SOL && /USD/.test(x.quoteToken?.symbol || "")); return Number(p?.priceUsd) || null; }).catch(() => null);
    }
    return solP;
  };
  const coinCache = new Map();
  F.coinsByMint = async (mints, fresh) => {
    const need = [...new Set(mints)].filter((m) => m && (fresh || !coinCache.has(m)));
    for (let i = 0; i < need.length; i += 30) {
      try { F.toCoins(await F.dex.tokens(need.slice(i, i + 30))).forEach((c) => coinCache.set(c.mint, c)); } catch {}
    }
    const out = new Map(); mints.forEach((m) => coinCache.has(m) && out.set(m, coinCache.get(m)));
    return out;
  };

  /* ================= verified trade logging =================
     The browser only sends the transaction signature. The log-trade server
     function reads the swap from the Solana blockchain and records the real amounts. */
  F.logTrade = async ({ mint, symbol, signature }) => {
    if (!me() || !signature || !F.sb?.functions) return null;
    for (let i = 0; i < 3; i++) {
      try {
        const { data, error } = await F.sb.functions.invoke("log-trade", { body: { signature, mint, symbol } });
        if (!error && data?.ok) {
          F.levels?.forget(me().id);
          document.dispatchEvent(new CustomEvent("flow:trade", { detail: data.trade }));
          return data.trade;
        }
        const st = error?.context?.status;
        if (st && st !== 404 && st !== 500) return null; // not retryable
      } catch {}
      await F.sleep(6000);
    }
    return null;
  };

  /* ================= PnL =================
     Only swaps made on FLOW and verified on-chain count. Realized = what you sold for,
     minus what those tokens cost at your average buy price. Unrealized = tokens still held
     (from FLOW buys) valued at today's price. */
  F.pnl = async (uid, holdMap) => {
    const { data, error } = await F.sb.rpc("pnl_of", { uid });
    if (error) throw error;
    const rows = data || [];
    const [coins, sol] = await Promise.all([F.coinsByMint(rows.map((r) => r.mint)), F.solUsd()]);
    return rows.map((r) => {
      const bs = +r.buy_sol, ss = +r.sell_sol, bt = +r.buy_tokens, st = +r.sell_tokens;
      const avg = bt ? bs / bt : 0;
      const matched = Math.min(st, bt);
      const realized = st && bt ? ss * (matched / st) - matched * avg : 0;
      let open = Math.max(0, bt - st);
      if (holdMap) open = Math.min(open, holdMap.get(r.mint) || 0);
      const c = coins.get(r.mint);
      const px = c?.priceUsd && sol ? c.priceUsd / sol : null;
      const openVal = px != null ? open * px : null;
      const unreal = openVal != null ? openVal - open * avg : 0;
      const total = realized + unreal;
      return { ...r, coin: c, bs, ss, bt, st, avg, realized, open, openVal, unreal, total, pct: bs ? (total / bs) * 100 : null };
    });
  };
  F.fmtSol = (v, d = 3) => (v == null || isNaN(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v) < 0.001 && v !== 0 ? Math.abs(v).toFixed(5) : Math.abs(v).toFixed(d)} SOL`);
  F.fmtPct = (v) => (v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v) >= 1000 ? Math.round(Math.abs(v)).toLocaleString() : Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}%`);

  /* ================= call results (price when posted vs later) ================= */
  const cc = new Map();
  const candles = (pool, tf, agg) => { const k = pool + tf + agg; if (!cc.has(k)) cc.set(k, F.gecko.ohlcv(pool, tf, agg, 1000).catch(() => [])); return cc.get(k); };
  async function priceAt(pool, t) {
    const sec = Math.floor(t / 1000), age = Date.now() - t;
    const list = age < 9.5 * 864e5 ? await candles(pool, "minute", 15) : await candles(pool, "hour", 4);
    if (!list.length || sec < list[0].time) return null;
    let best = null;
    for (const c of list) { if (c.time <= sec) best = c; else break; }
    return best ? best.close : null;
  }
  F.callResult = async (mint, t, tEnd) => {
    const c = (await F.coinsByMint([mint])).get(mint);
    if (!c?.pair || !c.priceUsd) return null;
    const then = await priceAt(c.pair, t); if (!then) return null;
    const end = tEnd && tEnd < Date.now() - 60000 ? await priceAt(c.pair, tEnd) : c.priceUsd;
    if (!end) return null;
    return { coin: c, then, end, chg: (end / then - 1) * 100, mcThen: c.mcap ? c.mcap * (then / c.priceUsd) : null, mcEnd: c.mcap ? c.mcap * (end / c.priceUsd) : null };
  };

  /* ================= share cards ================= */
  function loadImg(src) {
    return new Promise((res) => {
      if (!src) return res(null);
      const im = new Image(); im.crossOrigin = "anonymous"; im.referrerPolicy = "no-referrer";
      const t = setTimeout(() => res(null), 5000);
      im.onload = () => { clearTimeout(t); res(im); }; im.onerror = () => { clearTimeout(t); res(null); };
      im.src = src;
    });
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function circleImg(ctx, im, x, y, d, fallbackText, bg) {
    ctx.save(); ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    if (im) { const s = Math.max(d / im.width, d / im.height); ctx.drawImage(im, x + (d - im.width * s) / 2, y + (d - im.height * s) / 2, im.width * s, im.height * s); }
    else { ctx.fillStyle = bg || "#232734"; ctx.fillRect(x, y, d, d); ctx.fillStyle = "#eceef4"; ctx.font = `800 ${d * 0.42}px Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText((fallbackText || "?").slice(0, 2).toUpperCase(), x + d / 2, y + d / 2 + 2); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; }
    ctx.restore();
  }
  function fit(ctx, text, max, size, weight = 800) { let s = size; do { ctx.font = `${weight} ${s}px Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`; s -= 4; } while (ctx.measureText(text).width > max && s > 20); }
  // opts: { tag, big, up, line1, line2, coin:{image,symbol,name}, user:{name,avatar} }
  F.shareCard = async (o) => {
    try { await Promise.all([document.fonts.load("800 100px Inter"), document.fonts.load("600 30px Inter")]); } catch {}
    const W = 1200, H = 630, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const upC = "#3d8bff", dnC = "#ff4d6a", col = o.up === false ? dnC : upC;
    ctx.fillStyle = "#0c0d12"; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(W - 180, 120, 20, W - 180, 120, 620); g.addColorStop(0, o.up === false ? "rgba(255,77,106,.30)" : "rgba(61,139,255,.38)"); g.addColorStop(1, "rgba(12,13,18,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(80, H, 10, 80, H, 520); g.addColorStop(0, "rgba(61,139,255,.16)"); g.addColorStop(1, "rgba(12,13,18,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,.035)"; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // brand
    rr(ctx, 64, 52, 56, 56, 14); ctx.fillStyle = "#3d8bff"; ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 5; ctx.lineCap = "round";
    for (const dy of [-9, 5]) { ctx.beginPath(); ctx.moveTo(76, 80 + dy); ctx.bezierCurveTo(86, 70 + dy, 96, 90 + dy, 108, 78 + dy); ctx.stroke(); }
    ctx.fillStyle = "#eceef4"; ctx.font = "800 40px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"; ctx.fillText("FLOW", 136, 94);
    if (o.tag) { ctx.font = "700 22px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"; const tw = ctx.measureText(o.tag).width + 36; rr(ctx, W - 64 - tw, 58, tw, 44, 22); ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = "#b9bdcb"; ctx.fillText(o.tag, W - 64 - tw + 18, 88); }
    // coin
    const viaProxy = (u) => (u && /^https?:/.test(u) ? `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=256&h=256&fit=cover&output=png` : null);
    const [cim, uim] = await Promise.all([loadImg(o.coin?.image).then((im) => im || loadImg(viaProxy(o.coin?.image))), loadImg(o.user?.avatar).then((im) => im || loadImg(viaProxy(o.user?.avatar)))]);
    circleImg(ctx, cim, 64, 150, 104, o.coin?.symbol, "#1c1f2a");
    ctx.fillStyle = "#eceef4"; fit(ctx, "$" + (o.coin?.symbol || ""), 700, 62); ctx.fillText("$" + (o.coin?.symbol || ""), 190, 208);
    ctx.fillStyle = "#7d8294"; ctx.font = "600 26px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"; ctx.fillText((o.coin?.name || "").slice(0, 40), 192, 244);
    // big number
    ctx.fillStyle = col; fit(ctx, o.big, W - 128, 190); ctx.fillText(o.big, 58, 420);
    ctx.fillStyle = "#b9bdcb"; ctx.font = "600 30px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    if (o.line1) ctx.fillText(o.line1.slice(0, 64), 64, 470);
    if (o.line2) { ctx.fillStyle = "#7d8294"; ctx.font = "500 24px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"; ctx.fillText(o.line2.slice(0, 80), 64, 506); }
    // footer
    ctx.fillStyle = "rgba(255,255,255,.07)"; ctx.fillRect(0, H - 86, W, 1);
    circleImg(ctx, uim, 64, H - 70, 52, o.user?.name, "#232734");
    ctx.fillStyle = "#eceef4"; ctx.font = "700 26px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"; ctx.fillText((o.user?.name || "").slice(0, 28), 130, H - 36);
    ctx.fillStyle = "#7d8294"; ctx.font = "600 24px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif"; ctx.textAlign = "right";
    ctx.fillText(siteUrl().replace(/^https?:\/\//, "").replace(/\/$/, ""), W - 64, H - 36); ctx.textAlign = "left";
    return cv;
  };
  F.openShare = async (o) => {
    const m = F.h(`<div class="modal-bg"><div class="modal share-modal">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0">Share</h3><button class="icon-btn" data-x>${F.icons.close}</button></div>
      <div class="share-prev"><div class="skeleton" style="aspect-ratio:1200/630"></div></div>
      <div class="share-btns"><button class="btn btn-primary" id="sh-dl">Download image</button><button class="btn btn-ghost" id="sh-copy">Copy image</button>
        <button class="btn btn-ghost hidden" id="sh-native">${F.icons.share}Share…</button><a class="btn btn-ghost" id="sh-x" target="_blank" rel="noopener">${F.icons.x}Post on X</a></div></div></div>`);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); });
    document.body.appendChild(m);
    const cv = await F.shareCard(o);
    const url = o.url || siteUrl();
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    const src = URL.createObjectURL(blob);
    F.$(".share-prev", m).innerHTML = `<img src="${src}" alt="Share card">`;
    const fname = `flow-${(o.coin?.symbol || "card").toLowerCase()}.png`;
    F.$("#sh-dl", m).onclick = () => { const a = document.createElement("a"); a.href = src; a.download = fname; a.click(); };
    F.$("#sh-copy", m).onclick = async () => { try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); F.toast("Image copied ✓", "Paste it into X, Discord or TikTok."); } catch { F.toast("Couldn't copy", "Use Download instead.", "warn"); } };
    const file = new File([blob], fname, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { const b = F.$("#sh-native", m); b.classList.remove("hidden"); b.onclick = () => navigator.share({ files: [file], text: o.text || "", url }).catch(() => {}); }
    F.$("#sh-x", m).href = `https://x.com/intent/tweet?text=${encodeURIComponent((o.text || "") + " ")}&url=${encodeURIComponent(url)}`;
  };
  F.shareUser = () => { const p = me(); return p ? { name: p.name || F.short(p.wallet), avatar: p.avatar_url || null } : null; };

  /* ================= price alerts ================= */
  const AL = { list: [], loaded: false };
  F.alerts = AL;
  async function loadAlerts() {
    if (!me()) { AL.list = []; AL.loaded = false; return; }
    const { data } = await F.sb.from("price_alerts").select("*").eq("user_id", me().id).order("created_at", { ascending: false }).limit(100);
    AL.list = data || []; AL.loaded = true;
    document.dispatchEvent(new CustomEvent("flow:alerts"));
  }
  async function checkAlerts() {
    if (!me()) return;
    const act = AL.list.filter((a) => !a.triggered_at);
    if (!act.length) return;
    const coins = await F.coinsByMint(act.map((a) => a.mint), true);
    for (const a of act) {
      const c = coins.get(a.mint), p = c?.priceUsd;
      if (!p) continue;
      if (!(a.direction === "above" ? p >= a.price : p <= a.price)) continue;
      const now = new Date().toISOString();
      const { data } = await F.sb.from("price_alerts").update({ triggered_at: now }).eq("id", a.id).is("triggered_at", null).select("id").maybeSingle();
      a.triggered_at = now;
      if (data) fire(a, c);
    }
    document.dispatchEvent(new CustomEvent("flow:alerts"));
  }
  function fire(a, c) {
    const title = `🔔 $${c.symbol} ${a.label || (a.direction === "above" ? "went above " : "went below ") + F.price(a.price)}`;
    const body = `Now ${F.price(c.priceUsd)} · MC ${F.usd(c.mcap)}`;
    F.toast(title, `${body} · <a href="coin.html?c=${c.mint}">Open coin</a>`);
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        const n = new Notification(title.replace("🔔 ", ""), { body, icon: c.image || undefined, tag: "flow-alert-" + a.id });
        n.onclick = () => { window.focus(); location.href = "coin.html?c=" + c.mint; };
      }
    } catch {}
  }
  let alertTimer = null;
  async function startAlerts() {
    clearInterval(alertTimer); alertTimer = null;
    await loadAlerts();
    if (!me()) return;
    checkAlerts();
    alertTimer = setInterval(checkAlerts, 45000);
  }

  const TYPES = [
    { id: "up", label: "Goes up", unit: "%", chips: [25, 50, 100, 200, 500], chipFmt: (v) => (v >= 100 ? `${v / 100 + 1}x` : `+${v}%`) },
    { id: "down", label: "Goes down", unit: "%", chips: [20, 30, 50, 70], chipFmt: (v) => `−${v}%` },
    { id: "mcabove", label: "MC above", unit: "$", chips: [2, 5, 10], chipFmt: (v) => `${v}x MC` },
    { id: "mcbelow", label: "MC below", unit: "$", chips: [0.5, 0.25], chipFmt: (v) => `${v * 100}% MC` },
    { id: "above", label: "Price above", unit: "$" },
    { id: "below", label: "Price below", unit: "$" },
  ];
  F.alertModal = (coin) => {
    if (!F.auth?.enabled) return;
    if (!me()) return F.auth.signIn();
    if (!coin?.priceUsd) return F.toast("No price yet", "Alerts need a live price for this coin.", "warn");
    let type = "up";
    const m = F.h(`<div class="modal-bg"><div class="modal" style="max-width:460px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><h3 style="margin:0">🔔 Price alert · $${F.esc(coin.symbol)}</h3><button class="icon-btn" data-x>${F.icons.close}</button></div>
      <p style="margin:0 0 12px;font-size:13px">Now ${F.price(coin.priceUsd)} · MC ${F.usd(coin.mcap)}</p>
      <div class="al-types">${TYPES.map((t) => `<button class="chip" data-ty="${t.id}">${t.label}</button>`).join("")}</div>
      <div class="al-row"><div class="field" style="flex:1"><input id="al-v" inputmode="decimal" placeholder="0" autocomplete="off"><span class="unit" id="al-u">%</span></div></div>
      <div class="al-chips" id="al-chips"></div>
      <p class="al-prev" id="al-prev"></p>
      <button class="btn btn-primary" style="width:100%" id="al-go">Create alert</button>
      <div id="al-list"></div>
      <p class="note" style="margin-top:12px" id="al-note">Alerts are checked while ${F.esc(F.cfg.siteName)} is open in any tab.</p>
    </div></div>`);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); });
    document.body.appendChild(m);
    const inp = F.$("#al-v", m);
    const target = () => {
      const v = Number(String(inp.value).replace(/[, $%]/g, "")); if (!v || v < 0) return null;
      const p = coin.priceUsd, mc = coin.mcap;
      switch (type) {
        case "up": return { direction: "above", price: p * (1 + v / 100), label: `is up ${v}%` };
        case "down": return v >= 100 ? null : { direction: "below", price: p * (1 - v / 100), label: `is down ${v}%` };
        case "mcabove": return mc ? { direction: "above", price: p * (v / mc), label: `MC above ${F.usd(v)}` } : null;
        case "mcbelow": return mc ? { direction: "below", price: p * (v / mc), label: `MC below ${F.usd(v)}` } : null;
        case "above": return { direction: "above", price: v, label: `above ${F.price(v)}` };
        case "below": return { direction: "below", price: v, label: `below ${F.price(v)}` };
      }
    };
    const paint = () => {
      F.$$("[data-ty]", m).forEach((b) => b.classList.toggle("active", b.dataset.ty === type));
      const t = TYPES.find((x) => x.id === type);
      F.$("#al-u", m).textContent = t.unit === "%" ? "%" : type.startsWith("mc") ? "USD MC" : "USD";
      F.$("#al-chips", m).innerHTML = (t.chips || []).map((v) => `<button class="chip" data-cv="${v}">${t.chipFmt(v)}</button>`).join("");
      prev();
    };
    const prev = () => {
      const t = target(), el = F.$("#al-prev", m);
      if (!t) { el.textContent = ""; return; }
      const wrong = t.direction === "above" ? t.price <= coin.priceUsd : t.price >= coin.priceUsd;
      el.innerHTML = wrong ? `<span class="down">That's already ${t.direction === "above" ? "below" : "above"} the current price.</span>`
        : `Alerts you when the price goes ${t.direction} <b>${F.price(t.price)}</b>${coin.mcap ? ` (MC ≈ ${F.usd(coin.mcap * (t.price / coin.priceUsd))})` : ""}.`;
    };
    m.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ty]"); if (b) { type = b.dataset.ty; inp.value = ""; paint(); inp.focus(); return; }
      const c = e.target.closest("[data-cv]");
      if (c) { const v = Number(c.dataset.cv); inp.value = type === "mcabove" || type === "mcbelow" ? Math.round((coin.mcap || 0) * v) : v; prev(); }
      const d = e.target.closest("[data-al-del]"); if (d) delAlert(Number(d.dataset.alDel)).then(drawList);
    });
    inp.oninput = prev;
    const drawList = () => {
      const mine = AL.list.filter((a) => a.mint === coin.mint);
      F.$("#al-list", m).innerHTML = mine.length ? `<div class="al-list"><div class="muted" style="font-size:12px;margin:14px 0 6px">Your alerts for $${F.esc(coin.symbol)}</div>${mine.map(alertRow).join("")}</div>` : "";
    };
    F.$("#al-go", m).onclick = async () => {
      const t = target(); if (!t) return F.toast("Enter a value", "", "warn");
      if (t.direction === "above" ? t.price <= coin.priceUsd : t.price >= coin.priceUsd) return F.toast("Check the target", "That level is already reached.", "warn");
      const b = F.$("#al-go", m); b.disabled = true;
      const { data, error } = await F.sb.from("price_alerts").insert({ user_id: me().id, mint: coin.mint, symbol: (coin.symbol || "").slice(0, 20), direction: t.direction, price: Number(t.price.toPrecision(10)), base_price: coin.priceUsd, label: t.label.slice(0, 40) }).select().single();
      b.disabled = false;
      if (error) return F.toast("Alert not saved", F.esc(error.message.replace(/^.*?: /, "")), "warn");
      AL.list.unshift(data); inp.value = ""; prev(); drawList();
      F.toast("Alert set ✓", `We'll tell you when $${F.esc(coin.symbol)} ${F.esc(t.label)}.`);
      askNotify();
      if (!alertTimer) startAlerts();
    };
    if ("Notification" in window && Notification.permission === "default") F.$("#al-note", m).insertAdjacentHTML("beforeend", ` <button class="linkish" id="al-perm">Turn on desktop notifications</button>`);
    const pb = F.$("#al-perm", m); if (pb) pb.onclick = () => askNotify(true).then(() => pb.remove());
    paint(); drawList(); setTimeout(() => inp.focus(), 50);
  };
  function alertRow(a) {
    return `<div class="al-item ${a.triggered_at ? "done" : ""}"><span>${a.triggered_at ? "✓" : "🔔"}</span>
      <a href="coin.html?c=${F.esc(a.mint)}" class="al-sym">$${F.esc(a.symbol || F.short(a.mint))}</a>
      <span class="al-lbl">${F.esc(a.label || a.direction + " " + F.price(a.price))}</span>
      <span class="muted al-when">${a.triggered_at ? "hit " + F.ago(Date.parse(a.triggered_at)) + " ago" : "active"}</span>
      <button class="msg-del" style="opacity:1" data-al-del="${a.id}" title="Delete">×</button></div>`;
  }
  async function delAlert(id) {
    await F.sb.from("price_alerts").delete().eq("id", id);
    AL.list = AL.list.filter((a) => a.id !== id);
    document.dispatchEvent(new CustomEvent("flow:alerts"));
  }
  async function askNotify(force) {
    try { if ("Notification" in window && Notification.permission === "default" && (force || !F.store.get("askedNotify", false))) { F.store.set("askedNotify", true); await Notification.requestPermission(); } } catch {}
  }
  F.alertsList = () => {
    if (!me()) return F.auth.signIn();
    const m = F.h(`<div class="modal-bg"><div class="modal" style="max-width:480px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0">🔔 My price alerts</h3><button class="icon-btn" data-x>${F.icons.close}</button></div>
      <div id="al-all"></div><p class="note" style="margin-top:12px">Create alerts from any coin page with the 🔔 Alert button.</p></div></div>`);
    const draw = () => { F.$("#al-all", m).innerHTML = AL.list.length ? `<div class="al-list">${AL.list.map(alertRow).join("")}</div>` : `<p class="muted">No alerts yet.</p>`; };
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); const d = e.target.closest("[data-al-del]"); if (d) delAlert(Number(d.dataset.alDel)).then(draw); });
    document.body.appendChild(m); draw();
  };

  /* ================= invite links ================= */
  const ref = F.qs("ref");
  if (ref && /^[1-9A-HJ-NP-Za-km-z]{6,44}$/.test(ref)) F.store.set("ref", { code: ref, t: Date.now() });
  F.inviteLink = (p = me()) => (p ? siteUrl() + "?ref=" + p.wallet.slice(0, 8) : siteUrl());
  async function applyRef() {
    const p = me(), r = F.store.get("ref", null);
    if (!p || !r?.code) return;
    if (p.referred_by || Date.parse(p.created_at) < Date.now() - 864e5 || p.wallet.startsWith(r.code)) { F.store.set("ref", null); return; }
    const { data } = await F.sb.rpc("set_referrer", { code: r.code });
    F.store.set("ref", null);
    if (data) { p.referred_by = true; F.toast("Welcome to FLOW 🌊", "You joined through a friend's invite — they get a thank-you badge."); }
  }

  /* ================= streamer mode: hide balances ================= */
  const eyeOn = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeOff = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;
  F.hideBal = !!F.store.get("hideBal", false);
  const applyHide = () => {
    document.documentElement.classList.toggle("hidebal", F.hideBal);
    F.$$("[data-hidebal]").forEach((b) => { b.innerHTML = F.hideBalInner(); b.classList.toggle("on", F.hideBal); b.title = F.hideBal ? "Show balances" : "Hide balances (streamer mode)"; });
  };
  F.hideBalInner = () => (F.hideBal ? `${eyeOff}<span>Balances hidden</span>` : `${eyeOn}<span>Hide balances</span>`);
  F.hideBalBtn = () => `<button class="btn btn-ghost btn-sm hb-btn ${F.hideBal ? "on" : ""}" data-hidebal title="${F.hideBal ? "Show balances" : "Hide balances (streamer mode)"}">${F.hideBalInner()}</button>`;
  F.toggleHideBal = () => { F.hideBal = !F.hideBal; F.store.set("hideBal", F.hideBal); applyHide(); F.toast(F.hideBal ? "Balances hidden 🙈" : "Balances visible", F.hideBal ? "Streamer mode is on — your numbers are covered on your profile, wallet button and trade panel." : ""); };
  document.addEventListener("click", (e) => { if (e.target.closest("[data-hidebal]")) { e.preventDefault(); F.toggleHideBal(); } });
  applyHide();
  // small eye next to the wallet button on every page
  function eyeInTopbar() {
    const chip = F.$("#wchip");
    if (!chip || F.$("#hb-top")) return;
    const b = F.h(`<button class="icon-btn hb-top" id="hb-top" data-hidebal title="Hide balances (streamer mode)"></button>`);
    chip.parentElement.insertBefore(b, chip);
    applyHide();
  }
  new MutationObserver(() => eyeInTopbar()).observe(document.body, { childList: true, subtree: true });

  /* ================= boot ================= */
  let lastId = undefined;
  function onAuth() {
    const id = me()?.id || null;
    if (id === lastId) return;
    lastId = id;
    startAlerts(); applyRef();
  }
  document.addEventListener("flow:auth", onAuth);
  setTimeout(onAuth, 1300);
})();
