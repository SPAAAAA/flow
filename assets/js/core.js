/* FLOW core: helpers, data APIs, layout, wallet, search. Loaded on every page. */
(function () {
  const CFG = window.FLOW_CONFIG;
  const F = (window.FLOW = {});
  F.cfg = CFG;
  F.SOL = "So11111111111111111111111111111111111111112";
  F.SOL_ICON = "assets/img/sol.svg";
  const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

  /* ---------------- tiny DOM helpers ---------------- */
  F.$ = (s, r = document) => r.querySelector(s);
  F.$$ = (s, r = document) => [...r.querySelectorAll(s)];
  F.h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  F.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  F.qs = (k) => new URLSearchParams(location.search).get(k);
  F.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  F.store = {
    get(k, d) { try { const v = localStorage.getItem("flow_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("flow_" + k, JSON.stringify(v)); } catch {} },
  };

  /* ---------------- formatting ---------------- */
  F.usd = (n, opts = {}) => {
    if (n == null || isNaN(n)) return "—";
    n = Number(n);
    const a = Math.abs(n);
    if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return "$" + (n / 1e3).toFixed(opts.k ?? 1) + "K";
    if (a >= 1) return "$" + n.toFixed(2);
    return "$" + F.tinyNum(n);
  };
  F.tinyNum = (n) => {
    n = Number(n);
    if (!n) return "0";
    if (Math.abs(n) >= 0.01) return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    const s = n.toExponential(3); // e.g. 1.234e-7
    const [m, e] = s.split("e");
    const zeros = -Number(e) - 1;
    const digits = m.replace(".", "").replace("-", "").slice(0, 4);
    const sub = String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[d]).join("");
    return (n < 0 ? "-" : "") + "0.0" + sub + digits;
  };
  F.price = (n) => (n == null || isNaN(n) ? "—" : Number(n) >= 1 ? "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 }) : "$" + F.tinyNum(n));
  F.num = (n, d = 2) => {
    if (n == null || isNaN(n)) return "—";
    n = Number(n); const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
    if (a >= 1) return n.toFixed(d);
    return F.tinyNum(n);
  };
  F.pct = (n) => (n == null || isNaN(n) ? '<span class="muted">—</span>' : `<span class="${n >= 0 ? "up" : "down"}">${n >= 0 ? "+" : ""}${Number(n).toFixed(Math.abs(n) >= 100 ? 0 : 2)}%</span>`);
  F.ago = (t) => {
    if (!t) return "—";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return Math.floor(s) + "s";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    if (s < 86400 * 30) return Math.floor(s / 86400) + "d";
    if (s < 86400 * 365) return Math.floor(s / 86400 / 30) + "mo";
    return Math.floor(s / 86400 / 365) + "y";
  };
  F.short = (a, n = 4) => (a ? a.slice(0, n) + "…" + a.slice(-n) : "");
  F.isAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((s || "").trim());
  F.b58 = (bytes) => {
    const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    bytes = Uint8Array.from(bytes); let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
    let out = ""; while (n > 0n) { out = A[Number(n % 58n)] + out; n /= 58n; }
    for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
    return out;
  };
  F.solscanTx = (sig) => "https://solscan.io/tx/" + sig;
  F.solscanAcc = (a) => "https://solscan.io/account/" + a;

  /* deterministic gradient avatar (no external service) */
  F.avatar = (seed) => {
    let h = 0; for (const c of seed || "flow") h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const a = h % 360, b = (a + 40 + (h >> 8) % 80) % 360;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${a},80%,60%)'/><stop offset='1' stop-color='hsl(${b},75%,40%)'/></linearGradient></defs><rect width='80' height='80' fill='url(#g)'/><circle cx='${20 + (h % 40)}' cy='${20 + ((h >> 4) % 40)}' r='${14 + (h % 10)}' fill='rgba(255,255,255,.18)'/></svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg).replace(/'/g, "%27");
  };
  F.fallbackImg = (seed) => F.avatar(seed);
  F.img = (src, seed) => F.esc(src || F.avatar(seed));
  // attach onerror fallback globally
  document.addEventListener("error", (e) => {
    const t = e.target;
    if (t.tagName === "IMG" && !t.dataset.fb) { t.dataset.fb = 1; t.src = F.avatar(t.alt || "x"); }
  }, true);

  /* ---------------- icons ---------------- */
  const I = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  F.icons = {
    home: I('<path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>'),
    trophy: I('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
    star: I('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'),
    starFill: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
    user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
    search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    menu: I('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    copy: I('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
    ext: I('<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
    wallet: I('<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>'),
    grid: I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    list: I('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    flame: I('<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8 0 4 3 7 7 7z"/>'),
    x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.9zm-1.1 16.2h1.7L7.4 4.7H5.6z"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.2-8.3c.4-.4-.1-.6-.6-.2L6.2 13 1.3 11.5c-1-.3-1.1-1 .2-1.5L20.6 2.6c.9-.3 1.6.2 1.3 1.7z"/></svg>',
    discord: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 5.3A18 18 0 0 0 15.6 4l-.6 1.1a16.6 16.6 0 0 0-5 0L9.4 4A18 18 0 0 0 5 5.3 18.6 18.6 0 0 0 1.8 17.9 18 18 0 0 0 7.3 20.7l1.2-1.9a11 11 0 0 1-1.9-.9l.5-.4a12.9 12.9 0 0 0 11 0l.5.4-1.9.9 1.2 1.9a18 18 0 0 0 5.5-2.8A18.5 18.5 0 0 0 20 5.3zM8.7 15.3c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2zm6.6 0c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2z"/></svg>',
    instagram: I('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>'),
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 2h-3.4v13.4a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.1a6.4 6.4 0 1 0 5.4 6.3V8.6a7.9 7.9 0 0 0 4.4 1.4V6.6a4.5 4.5 0 0 1-4.4-4.6z"/></svg>',
    globe: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    logout: I('<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>'),
    bell: I('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
    close: I('<path d="M6 6l12 12M18 6 6 18"/>'),
    chat: I('<path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z"/>'),
    send: I('<path d="m4 12 16-8-6 16-2.5-6.5z"/>'),
    edit: I('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    users: I('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>'),
    refresh: I('<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>'),
  };
  F.logo = `<svg viewBox="0 0 32 32" fill="none"><path d="M4 12c4-5 8-5 12 0s8 5 12 0" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><path d="M4 20c4-5 8-5 12 0s8 5 12 0" stroke="#fff" stroke-opacity=".6" stroke-width="3.2" stroke-linecap="round"/></svg>`;

  /* ---------------- founder badge ---------------- */
  F.isFounder = (w) => !!w && (CFG.founders || []).includes(w);
  // Styles are inline so the badge always looks right, even if an old stylesheet is cached.
  F.founderBadge = (w, small) => {
    if (!F.isFounder(w)) return "";
    const sz = small ? 10 : 13;
    const st = `display:inline-flex;align-items:center;gap:${small ? 3 : 5}px;padding:${small ? "1px 6px 1px 5px" : "3px 10px 3px 8px"};border-radius:999px;font-size:${small ? 9.5 : 12}px;line-height:1.4;font-weight:800;letter-spacing:.07em;vertical-align:middle;white-space:nowrap;flex:none;color:#1a1300;background:linear-gradient(135deg,#ffe58a,#ffb800 55%,#ffd24d);box-shadow:0 0 0 1px rgba(255,210,77,.6),0 0 18px -4px rgba(255,184,0,.7)`;
    return `<span class="founder${small ? " sm" : ""}" style="${st}" title="Founder of ${F.esc(CFG.siteName)}"><svg width="${sz}" height="${sz}" style="width:${sz}px;height:${sz}px;flex:none" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>FOUNDER</span>`;
  };

  /* ---------------- toasts ---------------- */
  F.toast = (title, msg = "", type = "") => {
    let box = F.$(".toasts");
    if (!box) { box = F.h('<div class="toasts"></div>'); document.body.appendChild(box); }
    const t = F.h(`<div class="toast ${type}"><b>${F.esc(title)}</b><div>${msg}</div></div>`);
    box.appendChild(t);
    setTimeout(() => t.remove(), type === "err" ? 9000 : 6000);
    return t;
  };
  F.copy = async (text, label = "Copied") => {
    try { await navigator.clipboard.writeText(text); F.toast(label, F.esc(F.short(text, 6))); } catch { F.toast("Copy failed", "", "err"); }
  };

  /* ---------------- fetch with cache ---------------- */
  const mem = new Map();
  F.getJSON = async (url, { ttl = 15000, headers = {} } = {}) => {
    const hit = mem.get(url);
    if (hit && Date.now() - hit.t < ttl) return hit.p;
    const p = (async () => {
      for (let i = 0; i < 3; i++) {
        const r = await fetch(url, { headers });
        if (r.status === 429) { await F.sleep(1200 * (i + 1)); continue; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }
      throw new Error("Rate limited — try again in a moment");
    })();
    mem.set(url, { t: Date.now(), p });
    p.catch(() => mem.delete(url));
    return p;
  };

  /* ================= DexScreener ================= */
  const DS = "https://api.dexscreener.com";
  F.dex = {
    async boostsTop() { return (await F.getJSON(DS + "/token-boosts/top/v1", { ttl: 60000 })).filter((x) => x.chainId === "solana"); },
    async boostsLatest() { return (await F.getJSON(DS + "/token-boosts/latest/v1", { ttl: 60000 })).filter((x) => x.chainId === "solana"); },
    async profilesLatest() { return (await F.getJSON(DS + "/token-profiles/latest/v1", { ttl: 60000 })).filter((x) => x.chainId === "solana"); },
    async takeovers() { try { return (await F.getJSON(DS + "/community-takeovers/latest/v1", { ttl: 60000 })).filter((x) => x.chainId === "solana"); } catch { return []; } },
    async tokens(mints) {
      const out = [];
      const uniq = [...new Set(mints)];
      const chunks = [];
      for (let i = 0; i < uniq.length; i += 30) chunks.push(uniq.slice(i, i + 30));
      const res = await Promise.all(chunks.map((c) => F.getJSON(`${DS}/tokens/v1/solana/${c.join(",")}`, { ttl: 20000 }).catch(() => [])));
      res.forEach((r) => out.push(...(Array.isArray(r) ? r : [])));
      return out;
    },
    async tokenPairs(mint) { return F.getJSON(`${DS}/token-pairs/v1/solana/${mint}`, { ttl: 8000 }); },
    async search(q) { const r = await F.getJSON(`${DS}/latest/dex/search?q=${encodeURIComponent(q)}`, { ttl: 20000 }); return (r.pairs || []).filter((p) => p.chainId === "solana"); },
  };

  /* Pick the best pair for each base token and normalise into a "coin" */
  F.toCoins = (pairs, meta = {}) => {
    const best = new Map();
    for (const p of pairs || []) {
      if (!p || p.chainId !== "solana" || !p.baseToken) continue;
      const mint = p.baseToken.address;
      if (mint === F.SOL || CFG.blocklist.includes(mint)) continue;
      const score = (p.liquidity?.usd || 0) + (p.volume?.h24 || 0) * 0.01;
      const cur = best.get(mint);
      if (!cur || score > cur._s) best.set(mint, Object.assign(p, { _s: score }));
    }
    return [...best.values()].map((p) => F.pairToCoin(p, meta[p.baseToken.address]));
  };
  F.pairToCoin = (p, m = {}) => {
    const mcap = p.marketCap || p.fdv || null;
    const onCurve = p.dexId === "pumpfun";
    return {
      mint: p.baseToken.address,
      name: p.baseToken.name,
      symbol: p.baseToken.symbol,
      image: p.info?.imageUrl || m.icon || null,
      header: p.info?.header || m.header || null,
      description: m.description || null,
      priceUsd: Number(p.priceUsd) || null,
      priceNative: Number(p.priceNative) || null,
      mcap, fdv: p.fdv, liq: p.liquidity?.usd || null,
      vol: p.volume || {}, chg: p.priceChange || {}, txns: p.txns || {},
      createdAt: p.pairCreatedAt || null,
      dexId: p.dexId, pair: p.pairAddress, quote: p.quoteToken,
      websites: p.info?.websites || [], socials: p.info?.socials || [],
      boosts: p.boosts?.active || m.boost || 0,
      dsUrl: p.url, onCurve,
      progress: onCurve && mcap ? Math.min(100, (mcap / CFG.graduationMcapUsd) * 100) : null,
      isPump: /pump$/.test(p.baseToken.address) || p.dexId === "pumpfun" || p.dexId === "pumpswap",
    };
  };

  /* Load the live coin universe for home / leaderboard */
  F.loadUniverse = async () => {
    const [top, latestB, profiles, cto] = await Promise.all([
      F.dex.boostsTop().catch(() => []), F.dex.boostsLatest().catch(() => []),
      F.dex.profilesLatest().catch(() => []), F.dex.takeovers(),
    ]);
    const meta = {};
    const order = [];
    const add = (x, extra = {}) => {
      const k = x.tokenAddress; if (!k) return;
      meta[k] = Object.assign(meta[k] || {}, { icon: x.icon, header: x.header, description: x.description }, extra);
      if (!order.includes(k)) order.push(k);
    };
    top.forEach((x) => add(x, { boost: x.totalAmount || x.amount || 0 }));
    latestB.forEach((x) => add(x));
    profiles.forEach((x) => add(x, { profiledAt: Date.now() }));
    cto.forEach((x) => add(x, { cto: true }));
    CFG.featured.forEach((k) => { if (!order.includes(k)) order.unshift(k); });
    const pairs = await F.dex.tokens(order.slice(0, 150));
    const coins = F.toCoins(pairs, meta);
    coins.forEach((c) => { c.featured = CFG.featured.includes(c.mint); c.cto = !!meta[c.mint]?.cto; c.rankBoost = order.indexOf(c.mint); });
    return coins;
  };

  /* ================= GeckoTerminal (charts + trades) ================= */
  const GT = "https://api.geckoterminal.com/api/v2";
  const GTH = { Accept: "application/json;version=20230302" };
  F.gecko = {
    async ohlcv(pool, tf, agg, limit = 300) {
      const r = await F.getJSON(`${GT}/networks/solana/pools/${pool}/ohlcv/${tf}?aggregate=${agg}&limit=${limit}&currency=usd`, { ttl: 20000, headers: GTH });
      return (r.data?.attributes?.ohlcv_list || []).map((c) => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], value: c[5] })).sort((a, b) => a.time - b.time);
    },
    async trades(pool) {
      const r = await F.getJSON(`${GT}/networks/solana/pools/${pool}/trades`, { ttl: 12000, headers: GTH });
      return (r.data || []).map((d) => {
        const a = d.attributes;
        const buy = a.kind === "buy";
        return {
          kind: a.kind, time: Date.parse(a.block_timestamp), tx: a.tx_hash, trader: a.tx_from_address,
          usd: Number(a.volume_in_usd),
          tokenAmt: Number(buy ? a.to_token_amount : a.from_token_amount),
          quoteAmt: Number(buy ? a.from_token_amount : a.to_token_amount),
          price: Number(buy ? a.price_to_in_usd : a.price_from_in_usd),
        };
      });
    },
  };

  /* ================= Jupiter ================= */
  const jh = () => (CFG.jupiterApiKey ? { "x-api-key": CFG.jupiterApiKey } : {});
  /* Platform fee is only charged once the fee token account exists on-chain
     (otherwise Jupiter swaps would fail). Result is cached. */
  let feeCheck = null;
  F.feeReady = () => {
    if (!(CFG.platformFeeBps > 0 && CFG.feeAccount)) return Promise.resolve(false);
    if (F.store.get("feeOk_" + CFG.feeAccount, 0) > Date.now()) return Promise.resolve(true);
    if (!feeCheck) feeCheck = F.rpc("getAccountInfo", [CFG.feeAccount, { encoding: "jsonParsed" }]).then((r) => {
      const info = r?.value?.data?.parsed?.info;
      const ok = !!info && info.mint === F.SOL;
      if (ok) F.store.set("feeOk_" + CFG.feeAccount, Date.now() + 6 * 3600e3);
      return ok;
    }).catch(() => false);
    return feeCheck;
  };
  F.jup = {
    async quote(inputMint, outputMint, amountRaw, slippageBps) {
      const q = new URLSearchParams({ inputMint, outputMint, amount: String(amountRaw), slippageBps: String(slippageBps), maxAccounts: "64" });
      if ((inputMint === F.SOL || outputMint === F.SOL) && (await F.feeReady())) q.set("platformFeeBps", String(CFG.platformFeeBps));
      const r = await fetch(`${CFG.jupiterBase}/quote?${q}`, { headers: jh() });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || j.errorCode || `Quote failed (${r.status})`);
      return j;
    },
    async swapTx(quoteResponse, userPublicKey) {
      const body = {
        quoteResponse, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_500_000, priorityLevel: "high" } },
      };
      if (Number(quoteResponse.platformFee?.feeBps) > 0 && CFG.feeAccount) body.feeAccount = CFG.feeAccount;
      const r = await fetch(`${CFG.jupiterBase}/swap`, { method: "POST", headers: { "Content-Type": "application/json", ...jh() }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.swapTransaction) throw new Error(j.error || `Could not build swap (${r.status})`);
      return j;
    },
    async tokenInfo(mint) {
      try {
        const r = await F.getJSON(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, { ttl: 300000 });
        return (Array.isArray(r) ? r : []).find((t) => t.id === mint) || null;
      } catch { return null; }
    },
    async holdings(owner) {
      const r = await fetch(`https://lite-api.jup.ag/ultra/v1/holdings/${owner}`);
      if (!r.ok) throw new Error("holdings " + r.status);
      return r.json();
    },
  };

  /* ================= Solana RPC ================= */
  F.rpc = async (method, params = []) => {
    const r = await fetch(CFG.rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (!r.ok) throw new Error(`RPC ${r.status}${r.status === 403 ? " — add your own RPC URL in config.js" : ""}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  };
  F.solBalance = async (owner) => {
    try { const j = await F.jup.holdings(owner); return Number(j.uiAmount ?? Number(j.amount || 0) / 1e9); }
    catch { return (await F.rpc("getBalance", [owner, { commitment: "confirmed" }])).value / 1e9; }
  };

  /* All SPL + Token-2022 balances of an owner: [{mint, amount(ui), raw, decimals}] */
  F.tokenBalances = async (owner) => {
    // Try Jupiter holdings first (no RPC key needed), then RPC.
    try {
      const j = await F.jup.holdings(owner);
      const list = [];
      for (const [mint, accs] of Object.entries(j.tokens || {})) {
        const ui = accs.reduce((s, a) => s + Number(a.uiAmount || 0), 0);
        const raw = accs.reduce((s, a) => s + BigInt(a.amount || 0), 0n);
        if (ui > 0) list.push({ mint, amount: ui, raw: raw.toString(), decimals: accs[0]?.decimals ?? 0 });
      }
      return { sol: Number(j.uiAmount ?? (j.amount || 0) / 1e9), tokens: list };
    } catch (e) { /* fall back */ }
    const [sol, a, b] = await Promise.all([
      F.solBalance(owner),
      F.rpc("getTokenAccountsByOwner", [owner, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed", commitment: "confirmed" }]),
      F.rpc("getTokenAccountsByOwner", [owner, { programId: TOKEN_2022 }, { encoding: "jsonParsed", commitment: "confirmed" }]).catch(() => ({ value: [] })),
    ]);
    const map = new Map();
    for (const acc of [...a.value, ...b.value]) {
      const info = acc.account.data.parsed.info;
      const t = info.tokenAmount;
      const cur = map.get(info.mint) || { mint: info.mint, amount: 0, raw: 0n, decimals: t.decimals };
      cur.amount += Number(t.uiAmount || 0); cur.raw += BigInt(t.amount);
      map.set(info.mint, cur);
    }
    return { sol, tokens: [...map.values()].filter((t) => t.amount > 0).map((t) => ({ ...t, raw: t.raw.toString() })) };
  };

  F.tokenBalance = async (owner, mint) => {
    const { tokens } = await F.tokenBalances(owner);
    return tokens.find((t) => t.mint === mint) || { mint, amount: 0, raw: "0", decimals: null };
  };

  /* ================= Watchlist ================= */
  F.watch = {
    list: () => F.store.get("watch", []),
    has: (m) => F.watch.list().includes(m),
    toggle(m) {
      const l = F.watch.list(); const i = l.indexOf(m);
      if (i >= 0) l.splice(i, 1); else l.unshift(m);
      F.store.set("watch", l.slice(0, 200));
      return i < 0;
    },
  };
  F.starBtn = (mint) => `<button class="star ${F.watch.has(mint) ? "on" : ""}" data-star="${mint}" title="Watchlist">${F.watch.has(mint) ? F.icons.starFill : F.icons.star}</button>`;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-star]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const on = F.watch.toggle(b.dataset.star);
    b.classList.toggle("on", on); b.innerHTML = on ? F.icons.starFill : F.icons.star;
    F.toast(on ? "Added to watchlist" : "Removed from watchlist");
    document.dispatchEvent(new CustomEvent("flow:watch"));
  });

  /* ================= Wallet ================= */
  const WALLETS = [
    { id: "phantom", name: "Phantom", color: "#ab9ff2", get: () => window.phantom?.solana?.isPhantom ? window.phantom.solana : null, url: "https://phantom.app/" },
    { id: "solflare", name: "Solflare", color: "#fc7227", get: () => window.solflare?.isSolflare ? window.solflare : null, url: "https://solflare.com/" },
    { id: "backpack", name: "Backpack", color: "#e33e3f", get: () => window.backpack?.isBackpack ? window.backpack : (window.backpack || null), url: "https://backpack.app/" },
  ];
  const tile = (w) => `<span style="width:28px;height:28px;border-radius:8px;background:${w.color};display:grid;place-items:center;color:#111;font-weight:800">${w.name[0]}</span>`;
  F.wallet = {
    provider: null, pubkey: null, id: null,
    get connected() { return !!this.pubkey; },
    async connect(id, silent = false) {
      const w = WALLETS.find((x) => x.id === id);
      const p = w?.get();
      if (!p) { if (!silent) window.open(w.url, "_blank"); return; }
      try {
        const res = silent ? await p.connect({ onlyIfTrusted: true }) : await p.connect();
        const pk = (res?.publicKey || p.publicKey)?.toString();
        if (!pk) throw new Error("No public key");
        this.provider = p; this.pubkey = pk; this.id = id;
        F.store.set("wallet", id);
        p.on?.("accountChanged", (k) => { if (k) { this.pubkey = k.toString(); F.renderWallet(); document.dispatchEvent(new CustomEvent("flow:wallet")); } else this.disconnect(); });
        p.on?.("disconnect", () => this.disconnect(true));
        F.renderWallet();
        document.dispatchEvent(new CustomEvent("flow:wallet"));
        if (!silent) F.toast("Wallet connected", F.short(pk, 6));
      } catch (e) { if (!silent) F.toast("Connection cancelled", F.esc(e.message || ""), "warn"); }
    },
    async disconnect(fromEvent) {
      try { if (!fromEvent) await this.provider?.disconnect?.(); } catch {}
      this.provider = null; this.pubkey = null; this.id = null;
      F.store.set("wallet", null);
      F.renderWallet();
      document.dispatchEvent(new CustomEvent("flow:wallet"));
    },
    /* Sign + send a base64 versioned transaction from Jupiter. Returns signature. */
    async sendBase64Tx(b64) {
      if (!this.provider) throw new Error("Connect a wallet first");
      if (!window.solanaWeb3) throw new Error("Solana library failed to load — refresh the page");
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const tx = solanaWeb3.VersionedTransaction.deserialize(bytes);
      const p = this.provider;
      // Preferred: let the wallet send through its own RPC (works without an RPC key)
      if (p.signAndSendTransaction) {
        try {
          const r = await p.signAndSendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
          const sig = typeof r === "string" ? r : r?.signature;
          if (sig) return typeof sig === "string" ? sig : F.b58(sig);
        } catch (e) {
          if (/reject|cancel|denied|declin/i.test(e.message || "")) throw new Error("Transaction rejected in wallet");
          if (!p.signTransaction) throw e;
        }
      }
      const signed = await p.signTransaction(tx);
      const raw = signed.serialize();
      let bin = ""; raw.forEach((b) => (bin += String.fromCharCode(b)));
      return F.rpc("sendTransaction", [btoa(bin), { encoding: "base64", skipPreflight: true, maxRetries: 3 }]);
    },
    async confirm(sig, timeoutMs = 60000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        try {
          const r = await F.rpc("getSignatureStatuses", [[sig], { searchTransactionHistory: false }]);
          const s = r.value[0];
          if (s?.err) return { ok: false, err: s.err };
          if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return { ok: true };
        } catch (e) { return { ok: null }; } // RPC unavailable — can't confirm
        await F.sleep(1500);
      }
      return { ok: null };
    },
  };

  F.openWalletModal = () => {
    const m = F.h(`<div class="modal-bg"><div class="modal">
      <h3>Connect a wallet</h3><p>Choose a Solana wallet. FLOW never holds your funds — every trade is signed by you.</p>
      <div class="wallet-list">${WALLETS.map((w) => `<button class="wallet-opt" data-w="${w.id}">${tile(w)}<b>${w.name}</b><span class="tag ${w.get() ? "ok" : ""}">${w.get() ? "Detected" : "Install"}</span></button>`).join("")}</div>
      <p class="note">On mobile, open this site inside your wallet app's built-in browser.</p>
    </div></div>`);
    m.addEventListener("click", (e) => {
      const b = e.target.closest("[data-w]");
      if (b) { m.remove(); F.wallet.connect(b.dataset.w); }
      else if (e.target === m) m.remove();
    });
    document.body.appendChild(m);
  };

  F.renderWallet = () => {
    const slot = F.$("#wallet-slot"); if (!slot) return;
    if (!F.wallet.connected) {
      slot.innerHTML = `<button class="btn btn-primary" id="connect-btn">${F.icons.wallet}<span class="btn-connect-label">Connect wallet</span></button>`;
      F.$("#connect-btn").onclick = F.openWalletModal;
      return;
    }
    const pk = F.wallet.pubkey;
    slot.innerHTML = `<div class="wallet-chip" id="wchip"><span class="dot"></span><span class="mono">${F.short(pk)}</span><span class="muted mono addr-long" id="wbal"></span></div>`;
    F.solBalance(pk).then((b) => { const e = F.$("#wbal"); if (e) e.textContent = b.toFixed(3) + " SOL"; }).catch(() => {});
    F.$("#wchip").onclick = (e) => {
      e.stopPropagation();
      const ex = F.$("#wdrop"); if (ex) return ex.remove();
      const d = F.h(`<div class="dropdown" id="wdrop">
        <a href="profile.html?a=${pk}">${F.icons.user}My profile</a>
        <button data-act="copy">${F.icons.copy}Copy address</button>
        <a href="${F.solscanAcc(pk)}" target="_blank" rel="noopener">${F.icons.ext}View on Solscan</a>
        <button data-act="out">${F.icons.logout}Disconnect</button></div>`);
      d.onclick = (ev) => {
        const a = ev.target.closest("[data-act]")?.dataset.act;
        if (a === "copy") F.copy(pk, "Address copied");
        if (a === "out") F.wallet.disconnect();
      };
      F.$("#wchip").appendChild(d);
      setTimeout(() => document.addEventListener("click", () => d.remove(), { once: true }));
    };
  };

  /* ================= Layout ================= */
  const NAV = [
    { href: "index.html", label: "Home", icon: "home", key: "home" },
    { href: "leaderboard.html", label: "Leaderboard", icon: "trophy", key: "leaderboard" },
    { href: "teams.html", label: "Teams", icon: "users", key: "teams" },
    { href: "post.html", label: "Post", icon: "edit", key: "post" },
    { href: "messages.html", label: "Messages", icon: "chat", key: "messages" },
    { href: "index.html?tab=watchlist", label: "Watchlist", icon: "star", key: "watchlist" },
    { href: "profile.html", label: "Profile", icon: "user", key: "profile" },
    { href: "about.html", label: "How it works", icon: "info", key: "about" },
  ];
  F.layout = (active) => {
    const body = document.body;
    const content = F.$("#page");
    const soc = CFG.socials || {};
    const SOC = { discord: "Discord", instagram: "Instagram", tiktok: "TikTok", x: "X", telegram: "Telegram" };
    const socials = Object.keys(SOC).filter((k) => soc[k]).map((k) => `<a href="${F.esc(soc[k])}" target="_blank" rel="noopener" aria-label="${SOC[k]}" title="${F.esc(CFG.siteName)} on ${SOC[k]}">${F.icons[k]}</a>`).join("");
    const footSocials = Object.keys(SOC).filter((k) => soc[k]).map((k) => `<a href="${F.esc(soc[k])}" target="_blank" rel="noopener">${F.icons[k]}<span>${SOC[k]}</span></a>`).join("");
    const app = F.h(`<div class="app">
      <aside class="sidebar" id="sidebar">
        <a class="brand" href="index.html"><span class="brand-mark">${F.logo}</span><span class="brand-name">${F.esc(CFG.siteName)}</span></a>
        <nav class="nav">${NAV.map((n) => `<a href="${n.href}" class="${n.key === active ? "active" : ""}" data-nav="${n.key}">${F.icons[n.icon]}${n.label}</a>`).join("")}</nav>
        <div class="sidebar-foot">
          ${socials ? `<div class="socials">${socials}</div>` : ""}
          <div class="links"><a href="about.html#faq">FAQ</a><a href="about.html#terms">Terms</a><a href="about.html#risk">Risk</a></div>
          <div>© ${new Date().getFullYear()} ${F.esc(CFG.siteName)}</div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="menu-btn" id="menu-btn" aria-label="Menu">${F.icons.menu}</button>
          <div class="search" id="search">${F.icons.search}<input id="search-input" placeholder="Search coins or paste a contract / wallet address" autocomplete="off"><kbd>/</kbd></div>
          <div class="topbar-right"><div id="bell-slot" class="bell-slot"></div><div id="wallet-slot"></div></div>
        </header>
        <main class="content" id="content"></main>
        <footer class="footer">${footSocials ? `<div class="foot-socials"><b>Follow ${F.esc(CFG.siteName)}</b>${footSocials}</div>` : ""}<span>Market data: DEX Screener & GeckoTerminal · Swaps routed by Jupiter</span><span>Meme coins are extremely risky. Only trade what you can afford to lose.</span></footer>
      </div></div>`);
    F.$("#content", app).appendChild(content);
    body.prepend(app);
    content.classList.remove("hidden");

    // mobile menu
    const sb = F.$("#sidebar");
    F.$("#menu-btn").onclick = () => {
      sb.classList.add("open");
      const s = F.h('<div class="scrim"></div>'); s.onclick = () => { sb.classList.remove("open"); s.remove(); }; body.appendChild(s);
    };
    F.renderWallet();
    setupSearch();
    welcome();
    // eager reconnect
    const last = F.store.get("wallet", null);
    if (last) setTimeout(() => F.wallet.connect(last, true), 300);
  };

  /* ---------------- search ---------------- */
  function setupSearch() {
    const wrap = F.$("#search"), inp = F.$("#search-input");
    let box = null, timer = null, sel = -1, items = [];
    const close = () => { box?.remove(); box = null; sel = -1; };
    const show = (html) => { if (!box) { box = F.h('<div class="search-results"></div>'); wrap.appendChild(box); } box.innerHTML = html; items = F.$$("a", box); };
    const run = async () => {
      const q = inp.value.trim();
      if (!q) return close();
      if (F.isAddress(q)) {
        show(`<a href="coin.html?c=${q}"><span class="badge blue">Coin</span><span class="mono">${F.short(q, 8)}</span><span class="muted" style="margin-left:auto">Open coin</span></a>
              <a href="profile.html?a=${q}"><span class="badge">Wallet</span><span class="mono">${F.short(q, 8)}</span><span class="muted" style="margin-left:auto">Open profile</span></a>`);
        return;
      }
      show('<div class="empty">Searching…</div>');
      try {
        const coins = F.toCoins(await F.dex.search(q)).sort((a, b) => (b.liq || 0) - (a.liq || 0)).slice(0, 10);
        if (inp.value.trim() !== q) return;
        show(coins.length ? coins.map((c) => `<a href="coin.html?c=${c.mint}"><img src="${F.img(c.image, c.mint)}" alt="${F.esc(c.symbol)}" style="width:32px;height:32px;border-radius:8px;object-fit:cover"><div style="min-width:0"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${F.esc(c.name)} <span class="muted">$${F.esc(c.symbol)}</span></div><div class="muted" style="font-size:12px">MC ${F.usd(c.mcap)} · ${F.esc(c.dexId)}</div></div><div style="margin-left:auto;text-align:right;font-size:12px">${F.pct(c.chg.h24)}</div></a>`).join("") : '<div class="empty">No Solana coins found</div>');
      } catch (e) { show(`<div class="empty">Search failed: ${F.esc(e.message)}</div>`); }
    };
    inp.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 280); });
    inp.addEventListener("focus", () => inp.value && run());
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { close(); inp.blur(); }
      if (!items.length) { if (e.key === "Enter") run(); return; }
      if (e.key === "ArrowDown") { sel = Math.min(items.length - 1, sel + 1); e.preventDefault(); }
      if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); e.preventDefault(); }
      if (e.key === "Enter") { location.href = (items[sel] || items[0]).href; }
      items.forEach((a, i) => a.classList.toggle("sel", i === sel));
    });
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) close(); });
    document.addEventListener("keydown", (e) => { if ((e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) && document.activeElement !== inp && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); inp.focus(); } });
  }

  /* ---------------- first-visit risk notice ---------------- */
  function welcome() {
    if (F.store.get("ack", false)) return;
    const m = F.h(`<div class="modal-bg"><div class="modal">
      <div class="welcome-art">${F.logo.replace('viewBox="0 0 32 32"', 'viewBox="0 0 32 32" width="120"')}</div>
      <h3>Welcome to ${F.esc(CFG.siteName)}</h3>
      <p>Trade live Solana meme coins straight from your own wallet. Prices move extremely fast and most meme coins go to zero — only trade what you can afford to lose.</p>
      <button class="btn btn-primary" style="width:100%" id="ack">I understand — continue</button>
      <p class="note" style="margin-top:12px">By continuing you agree to the <a href="about.html#terms" style="text-decoration:underline">Terms</a> and confirm you are 18 or older and allowed to trade crypto assets where you live.</p>
    </div></div>`);
    F.$("#ack", m).onclick = () => { F.store.set("ack", true); m.remove(); };
    document.body.appendChild(m);
  }

  /* ---------------- shared coin card ---------------- */
  F.coinCard = (c) => `<a class="card" href="coin.html?c=${c.mint}">
    <img class="thumb" loading="lazy" src="${F.img(c.image, c.mint)}" alt="${F.esc(c.symbol)}">
    <div class="info">
      <div class="name">${F.esc(c.name)}</div>
      <div class="ticker">$${F.esc(c.symbol)}</div>
      <div class="meta">
        ${c.featured ? '<span class="badge blue">Featured</span>' : ""}
        ${c.onCurve ? '<span class="badge blue">Bonding curve</span>' : c.isPump ? '<span class="badge">Graduated</span>' : `<span class="badge">${F.esc(c.dexId)}</span>`}
        ${c.cto ? '<span class="badge warn">CTO</span>' : ""}
        <span>${F.ago(c.createdAt)} ago</span>
        <span>· ${F.pct(c.chg.h24)}</span>
      </div>
      ${c.description ? `<div class="desc">${F.esc(c.description)}</div>` : ""}
      <div class="mc"><span class="muted">MC</span><b>${F.usd(c.mcap)}</b>${c.progress != null ? `<div class="progress" title="${c.progress.toFixed(0)}% to graduation"><i style="width:${c.progress}%"></i></div>` : `<span class="muted" style="margin-left:auto">Vol ${F.usd(c.vol.h24)}</span>`}</div>
    </div>${F.starBtn(c.mint)}${F.qbBtn ? F.qbBtn(c) : ""}</a>`;

  F.coinRow = (c, i) => `<tr data-href="coin.html?c=${c.mint}" style="cursor:pointer">
    <td class="rank-num">${i + 1}</td>
    <td><div class="coin-cell"><img loading="lazy" src="${F.img(c.image, c.mint)}" alt="${F.esc(c.symbol)}"><div><div class="n">${F.esc(c.name)}</div><div class="s">$${F.esc(c.symbol)} · ${F.ago(c.createdAt)}</div></div></div></td>
    <td class="num">${F.price(c.priceUsd)}</td>
    <td class="num">${F.pct(c.chg.h1)}</td>
    <td class="num">${F.pct(c.chg.h24)}</td>
    <td class="num">${F.usd(c.mcap)}</td>
    <td class="num">${F.usd(c.vol.h24)}</td>
    <td class="num">${F.usd(c.liq)}</td>
    <td class="num">${((c.txns.h24?.buys || 0) + (c.txns.h24?.sells || 0)).toLocaleString()}</td>
  </tr>`;
  F.coinTable = (coins) => `<div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Coin</th><th class="num">Price</th><th class="num">1h</th><th class="num">24h</th><th class="num">Market cap</th><th class="num">Volume 24h</th><th class="num">Liquidity</th><th class="num">Txns 24h</th></tr></thead><tbody>${coins.map(F.coinRow).join("")}</tbody></table></div>`;
  document.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-href]");
    if (tr && !e.target.closest("a,button")) location.href = tr.dataset.href;
  });
})();
