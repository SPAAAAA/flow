/* FLOW extras 2: quick-buy + copy-trade, holder tags, verified tips & supporters,
   cosmetics, seasons & ranks, live coin rooms */
(function () {
  const F = FLOW;
  const me = () => F.auth?.profile;
  const CFG = F.cfg;

  /* ================= quick buy (coin cards + "Buy too" in notifications) ================= */
  F.qb = { amt: Number(F.store.get("qbAmt", 0.1)) || 0.1 };
  F.setQuickAmt = (v) => { v = Number(v); if (!(v > 0)) return; F.qb.amt = v; F.store.set("qbAmt", v); document.dispatchEvent(new CustomEvent("flow:qb")); };
  const busyMints = new Set();
  function qbConfirm(sym, amt) {
    if (F.store.get("qbOk", false)) return Promise.resolve(true);
    return new Promise((res) => {
      const m = F.h(`<div class="modal-bg"><div class="modal" style="max-width:400px">
        <h3 style="margin:0 0 6px">⚡ Quick buy</h3>
        <p style="margin:0 0 12px;font-size:13px">Buy <b>${amt} SOL</b> of <b>$${F.esc(sym)}</b> right away at the best price from Jupiter. Your wallet will still ask you to approve.</p>
        <label class="report-opt"><input type="checkbox" id="qb-skip"><span>Don't ask again — go straight to my wallet next time</span></label>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" id="qb-go">Buy ${amt} SOL</button></div></div></div>`);
      const done = (v) => { m.remove(); res(v); };
      m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-x]")) done(false); });
      document.body.appendChild(m);
      F.$("#qb-go", m).onclick = () => { if (F.$("#qb-skip", m).checked) F.store.set("qbOk", true); done(true); };
    });
  }
  F.quickBuy = async (mint, symbol, amt = F.qb.amt, btn) => {
    if (!F.wallet.connected) return F.openWalletModal();
    if (busyMints.has(mint)) return;
    const sym = symbol || "coin";
    if (!(await qbConfirm(sym, amt))) return;
    busyMints.add(mint);
    const label = btn?.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = "…"; }
    try {
      await F.loadWeb3();
      const bal = await F.solBalance(F.wallet.pubkey).catch(() => null);
      if (bal != null && amt > bal - 0.005) throw new Error(`Not enough SOL — you have ${bal.toFixed(4)} SOL (keep ~0.005 for fees)`);
      const slip = Number(F.store.get("slip", CFG.defaultSlippageBps || 1000));
      const q = await F.jup.quote(F.SOL, mint, String(Math.round(amt * 1e9)), slip);
      const { swapTransaction } = await F.jup.swapTx(q, F.wallet.pubkey);
      if (btn) btn.innerHTML = "✍";
      const sig = await F.wallet.sendBase64Tx(swapTransaction);
      const t = F.toast(`Buying $${F.esc(sym)}…`, `<a href="${F.solscanTx(sig)}" target="_blank" rel="noopener">View on Solscan</a>`);
      const res = await F.wallet.confirm(sig);
      t.remove();
      if (res.ok === false) F.toast("Buy failed", `Usually the price moved past your slippage. <a href="${F.solscanTx(sig)}" target="_blank" rel="noopener">Details</a>`, "err");
      else { F.toast(`Bought ${amt} SOL of $${F.esc(sym)} ⚡`, `<a href="coin.html?c=${mint}">Open coin</a> · <a href="${F.solscanTx(sig)}" target="_blank" rel="noopener">Solscan</a>`); F.logTrade && F.logTrade({ mint, symbol: sym, side: "buy", signature: sig }); }
    } catch (e) {
      F.toast("Quick buy not completed", F.esc(e.message || String(e)), "err");
    } finally {
      busyMints.delete(mint);
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
    }
  };
  F.qbBtn = (c) => `<button class="qb-btn" data-qbuy="${c.mint}" data-sym="${F.esc(c.symbol)}" title="Quick buy ${F.qb.amt} SOL">⚡<span>${F.qb.amt}</span></button>`;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-qbuy]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    F.quickBuy(b.dataset.qbuy, b.dataset.sym, Number(b.dataset.amt) || F.qb.amt, b);
  }, true);
  document.addEventListener("flow:qb", () => F.$$("[data-qbuy] span").forEach((s) => (s.textContent = F.qb.amt)));
  F.qbSetting = () => `<div class="qb-set" title="Quick-buy amount for the ⚡ buttons"><span>⚡ Quick buy</span>${[0.05, 0.1, 0.25, 0.5, 1].map((v) => `<button class="${F.qb.amt === v ? "active" : ""}" data-qbamt="${v}">${v}</button>`).join("")}<span class="muted">SOL</span></div>`;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-qbamt]"); if (!b) return;
    F.setQuickAmt(b.dataset.qbamt);
    F.$$("[data-qbamt]").forEach((x) => x.classList.toggle("active", Number(x.dataset.qbamt) === F.qb.amt));
  });

  /* ================= holder tags: who actually holds the coin ================= */
  const holdCache = new Map(); // wallet -> Promise<{mint: amount}>
  const buyersCache = new Map(); // mint -> Promise<Set(user_id)>
  let inflight = 0; const queue = [];
  const limited = (fn) => new Promise((res, rej) => { const run = () => { inflight++; fn().then(res, rej).finally(() => { inflight--; queue.length && queue.shift()(); }); }; inflight < 4 ? run() : queue.push(run); });
  function holdingsOf(w) {
    const c = holdCache.get(w);
    if (c && Date.now() - c.at < 90000) return c.p;
    const p = limited(() => F.jup.holdings(w)).then((j) => { const out = {}; for (const [m, accs] of Object.entries(j.tokens || {})) out[m] = accs.reduce((s, a) => s + Number(a.uiAmount || 0), 0); return out; }).catch(() => null);
    holdCache.set(w, { p, at: Date.now() });
    return p;
  }
  function buyersOf(mint) {
    if (!buyersCache.has(mint)) buyersCache.set(mint, F.sb.from("trades").select("user_id").eq("mint", mint).eq("verified", true).eq("side", "buy").limit(2000).then(({ data }) => new Set((data || []).map((r) => r.user_id))).catch(() => new Set()));
    return buyersCache.get(mint);
  }
  const compact = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n >= 1 ? n.toFixed(0) : n.toPrecision(2));
  F.htag = (wallet, uid, mint) => (wallet && mint ? `<span class="htag" data-htag="${F.esc(wallet)}" data-hu="${F.esc(uid || "")}" data-hm="${F.esc(mint)}"></span>` : "");
  async function fillTags() {
    const els = F.$$("[data-htag]:not([data-done])"); if (!els.length || !F.sb) return;
    els.forEach((e) => (e.dataset.done = 1));
    for (const e of els) {
      const w = e.dataset.htag, m = e.dataset.hm;
      Promise.all([holdingsOf(w), buyersOf(m), F.coinsByMint([m])]).then(([h, buyers, coins]) => {
        if (!h) return;
        const amt = h[m] || 0, c = coins.get(m);
        if (amt > 0) {
          const usd = c?.priceUsd ? amt * c.priceUsd : null;
          if (usd != null && usd < 1) { e.className = "htag h-dust"; e.textContent = "dust"; e.title = "Holds a tiny amount"; return; }
          e.className = "htag h-on"; e.innerHTML = `🟢 holds ${compact(amt)}${usd != null ? ` · ${F.usd(usd)}` : ""}`; e.title = `Holds ${amt.toLocaleString()} $${c?.symbol || ""} right now (checked on-chain)`;
        } else if (e.dataset.hu && buyers.has(e.dataset.hu)) { e.className = "htag h-sold"; e.textContent = "🔴 sold"; e.title = "Bought on FLOW, doesn't hold it any more"; }
        else { e.className = "htag h-none"; e.textContent = "no bag"; e.title = "Doesn't hold this coin"; }
      });
    }
  }
  let tagT; new MutationObserver(() => { clearTimeout(tagT); tagT = setTimeout(fillTags, 300); }).observe(document.body, { childList: true, subtree: true });

  /* ================= verified tips & top supporters ================= */
  F.logTip = async (signature, to) => {
    for (let i = 0; i < 3; i++) {
      try {
        const { data, error } = await F.sb.functions.invoke("log-trade", { body: { kind: "tip", signature, to } });
        if (!error && data?.ok) { document.dispatchEvent(new CustomEvent("flow:tip", { detail: { to } })); return data.tip; }
        const st = error?.context?.status; if (st && st !== 404 && st !== 500) return null;
      } catch {}
      await F.sleep(6000);
    }
    return null;
  };
  F.renderSupporters = async (el, wallet) => {
    if (!el || !F.sb) return;
    const [{ data: sum }, { data: top }] = await Promise.all([F.sb.rpc("tips_summary", { w: wallet }), F.sb.rpc("top_supporters", { w: wallet, lim: 5 })]).catch(() => [{}, {}]);
    const rows = top || [];
    if (!sum || !Number(sum.received_n)) { el.innerHTML = ""; return; }
    const { data: profs } = await F.sb.from("profiles").select("id,wallet,name,avatar_url").in("id", rows.map((r) => r.sender_id));
    const P = new Map((profs || []).map((p) => [p.id, p]));
    const sol = await F.solUsd();
    el.innerHTML = `<div class="sup-card"><div class="sup-head"><b>💸 Top supporters</b><span class="muted">${(+sum.received_sol).toFixed(3)} SOL${sol ? ` (${F.usd(sum.received_sol * sol)})` : ""} from ${sum.supporters} supporter${sum.supporters > 1 ? "s" : ""}</span></div>
      ${rows.map((r, i) => { const p = P.get(r.sender_id) || { id: r.sender_id, wallet: "" }; return `<a class="sup-row" href="profile.html?a=${F.esc(p.wallet)}"><span class="sup-rank">${["🥇", "🥈", "🥉"][i] || i + 1}</span><img src="${F.avatarOf(p)}" alt=""><span class="sup-n">${F.displayName(p)}</span><b>${(+r.sol).toFixed(3)} SOL</b></a>`; }).join("")}
      <p class="note" style="margin:8px 0 0">Every tip is checked on the Solana blockchain.</p></div>`;
  };

  /* ================= cosmetics (unlocked by achievements) ================= */
  const COS = {
    frame: [
      { id: "wave", name: "Wave", req: "Unlock 5 achievements", t: (c) => c.all >= 5 },
      { id: "emerald", name: "Emerald", req: "Unlock 3 Common (green) achievements", t: (c) => c.c >= 3 },
      { id: "sapphire", name: "Sapphire", req: "Unlock 3 Rare (blue) achievements", t: (c) => c.r >= 3 },
      { id: "amethyst", name: "Amethyst", req: "Unlock 2 Epic (purple) achievements", t: (c) => c.e >= 2 },
      { id: "gold", name: "Golden", req: "Unlock a Legendary achievement", t: (c) => c.l >= 1 },
      { id: "prism", name: "Prism", req: "Unlock 30 achievements", t: (c) => c.all >= 30 },
      { id: "founder", name: "Founder", req: "Founder only", t: (c, w) => (CFG.founders || []).includes(w) },
    ],
    name: [
      { id: "blue", name: "Ocean blue", req: "Unlock 3 achievements", t: (c) => c.all >= 3 },
      { id: "green", name: "Mint green", req: "Unlock 5 Common (green) achievements", t: (c) => c.c >= 5 },
      { id: "ice", name: "Ice", req: "Unlock 2 Rare (blue) achievements", t: (c) => c.r >= 2 },
      { id: "violet", name: "Violet", req: "Unlock an Epic (purple) achievement", t: (c) => c.e >= 1 },
      { id: "gold", name: "Gold shimmer", req: "Unlock a Legendary achievement", t: (c) => c.l >= 1 },
      { id: "rainbow", name: "Rainbow", req: "Unlock 40 achievements", t: (c) => c.all >= 40 },
    ],
    fx: [
      { id: "sparkle", name: "Sparkles", req: "Unlock 10 achievements", t: (c) => c.all >= 10 },
      { id: "waves", name: "Waves", req: "Unlock 5 Rare (blue) achievements", t: (c) => c.r >= 5 },
      { id: "aurora", name: "Aurora", req: "Unlock 3 Epic (purple) achievements", t: (c) => c.e >= 3 },
      { id: "goldrays", name: "Gold rays", req: "Unlock 2 Legendary achievements", t: (c) => c.l >= 2 },
    ],
  };
  F.COS = COS;
  const cosCache = new Map(); // wallet -> {cos_frame, cos_name, cos_fx}
  F.cosOf = (w) => cosCache.get(w) || null;
  F.cosRemember = (p) => { if (p?.wallet) cosCache.set(p.wallet, { cos_frame: p.cos_frame || null, cos_name: p.cos_name || null, cos_fx: p.cos_fx || null }); };
  const pendingW = new Set(); let cosT;
  function applyCos(root = document) {
    F.$$('a[href*="profile.html?a="]', root).forEach((a) => {
      let w; try { w = new URL(a.href).searchParams.get("a"); } catch { return; }
      if (!w) return;
      const c = cosCache.get(w);
      if (!c) { pendingW.add(w); return; }
      if (a.dataset.cos === (c.cos_frame || "") + "|" + (c.cos_name || "")) return;
      a.className = a.className.replace(/\b(cf|cn)-\S+/g, "").trim();
      if (c.cos_frame && a.querySelector("img")) a.classList.add("cf-" + c.cos_frame);
      if (c.cos_name) a.classList.add("cn-" + c.cos_name);
      a.dataset.cos = (c.cos_frame || "") + "|" + (c.cos_name || "");
    });
    if (pendingW.size) loadCos();
  }
  let loadingCos = false;
  async function loadCos() {
    if (loadingCos || !F.sb) return; loadingCos = true;
    const ws = [...pendingW].slice(0, 150); ws.forEach((w) => pendingW.delete(w));
    try { const { data } = await F.sb.from("profiles").select("wallet,cos_frame,cos_name,cos_fx").in("wallet", ws); ws.forEach((w) => cosCache.set(w, { cos_frame: null, cos_name: null, cos_fx: null })); (data || []).forEach(F.cosRemember); } catch {}
    loadingCos = false; applyCos();
  }
  new MutationObserver(() => { clearTimeout(cosT); cosT = setTimeout(() => applyCos(), 200); }).observe(document.body, { childList: true, subtree: true });
  F.applyCos = applyCos;

  function counts(list) {
    const c = { all: 0, u: 0, c: 0, r: 0, e: 0, l: 0 };
    list.filter((a) => a.done).forEach((a) => { c.all++; c[a.r]++; });
    return c;
  }
  F.unlockedCos = async (p) => {
    const list = F.achievements.evaluate(await F.achievements.statsFor(p.id));
    const c = counts(list), out = {};
    for (const k of Object.keys(COS)) out[k] = new Set(COS[k].filter((x) => x.t(c, p.wallet)).map((x) => x.id));
    return { c, out };
  };
  F.openCustomize = async () => {
    const p = me(); if (!p) return F.auth.signIn();
    const m = F.h(`<div class="modal-bg"><div class="modal cos-modal"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h3 style="margin:0">🎨 Customize your look</h3><button class="icon-btn" data-x>${F.icons.close}</button></div>
      <p style="margin:0 0 12px;font-size:13px">Unlock frames, name colors and banner effects by earning achievements. Everyone sees them in chat, posts and on your profile.</p><div id="cos-body"><div class="skeleton" style="height:240px"></div></div></div></div>`);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); });
    document.body.appendChild(m);
    let un; try { un = await F.unlockedCos(p); } catch (e) { F.$("#cos-body", m).innerHTML = `<p class="muted">Couldn't load: ${F.esc(e.message || "")}</p>`; return; }
    const sel = { frame: p.cos_frame || null, name: p.cos_name || null, fx: p.cos_fx || null };
    const av = F.avatarOf(p), nm = F.displayName(p);
    const draw = () => {
      const tile = (k, x) => { const ok = !x || un.out[k].has(x.id), on = (sel[k] || null) === (x ? x.id : null);
        const prev = k === "frame" ? `<span class="cos-av ${x ? "cf-" + x.id : ""}"><img src="${av}" alt=""></span>` : k === "name" ? `<span class="cos-nm ${x ? "cn-" + x.id : ""}"><b>${nm}</b></span>` : `<span class="cos-fx ${x ? "fx-" + x.id : ""}"></span>`;
        return `<button class="cos-tile ${on ? "on" : ""} ${ok ? "" : "locked"}" data-ck="${k}" data-cv="${x ? x.id : ""}" ${ok ? "" : "disabled"} title="${x ? F.esc(x.req) : "None"}">${prev}<span class="cos-t-n">${x ? F.esc(x.name) : "None"}</span>${ok ? "" : `<span class="cos-lock">🔒 ${F.esc(x.req)}</span>`}</button>`; };
      F.$("#cos-body", m).innerHTML = [["frame", "Avatar frames"], ["name", "Name colors"], ["fx", "Banner effects"]].map(([k, t]) => `<div class="cos-sec"><b>${t}</b><div class="cos-grid">${tile(k, null)}${COS[k].filter((x) => x.id !== "founder" || un.out.frame.has("founder")).map((x) => tile(k, x)).join("")}</div></div>`).join("")
        + `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:14px"><span class="muted" style="font-size:12px">${un.c.all} achievements unlocked</span><button class="btn btn-primary" id="cos-save">Save look</button></div>`;
      F.$("#cos-save", m).onclick = save;
    };
    m.addEventListener("click", (e) => { const t = e.target.closest("[data-ck]"); if (!t || t.disabled) return; sel[t.dataset.ck] = t.dataset.cv || null; draw(); });
    async function save() {
      const b = F.$("#cos-save", m); b.disabled = true;
      const { data, error } = await F.sb.from("profiles").update({ cos_frame: sel.frame, cos_name: sel.name, cos_fx: sel.fx }).eq("id", p.id).select().single();
      if (error) { b.disabled = false; return F.toast("Not saved", F.esc(error.message), "warn"); }
      Object.assign(p, data); F.cosRemember(data);
      F.$$("[data-cos]").forEach((a) => delete a.dataset.cos); applyCos();
      document.dispatchEvent(new CustomEvent("flow:cos"));
      m.remove(); F.toast("Look saved ✨", "");
    }
    draw();
  };

  /* ================= seasons & ranks ================= */
  const RANKS = [
    { id: "bronze", name: "Bronze", min: 0, ic: "🥉" },
    { id: "silver", name: "Silver", min: 250, ic: "🥈" },
    { id: "gold", name: "Gold", min: 750, ic: "🥇" },
    { id: "diamond", name: "Diamond", min: 2000, ic: "💎" },
    { id: "legend", name: "FLOW Legend", min: 5000, ic: "🌊" },
  ];
  const seasonStart = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
  const seasonEnd = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
  F.season = {
    RANKS, start: seasonStart, end: seasonEnd,
    label: (t = seasonStart()) => new Date(t).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }),
    rankOf: (p) => { let r = RANKS[0]; for (const x of RANKS) if (p >= x.min) r = x; const i = RANKS.indexOf(r), next = RANKS[i + 1] || null; return { ...r, next, pct: next ? Math.min(100, ((p - r.min) / (next.min - r.min)) * 100) : 100 }; },
    pill: (p) => { const r = F.season.rankOf(p); return `<span class="rk rk-${r.id}" title="${r.name} this season · ${p} season points">${r.ic} ${r.name}</span>`; },
    _board: null, _at: 0,
    async board() { if (!this._board || Date.now() - this._at > 60000) { this._at = Date.now(); this._board = F.sb.rpc("season_board", { ss: null, lim: 1000 }).then((r) => r.data || []).catch(() => []); } return this._board; },
    async of(uid) { const b = await this.board(); const i = b.findIndex((r) => r.user_id === uid); return i >= 0 ? { ...b[i], place: i + 1 } : { user_id: uid, points: 0, place: null }; },
  };

  /* ================= live coin rooms ================= */
  F.mountRoom = (el, mint, symbol) => {
    if (!el || !F.auth?.enabled) { if (el) el.style.display = "none"; return; }
    const S = { msgs: [], seen: new Set(), online: 0 };
    el.innerHTML = `<div class="room-head"><b><span class="live-dot"></span>Live room</b><span class="muted" id="room-on"></span></div>
      <div class="room-list" id="room-list"><div class="muted" style="margin:auto;font-size:13px">Loading…</div></div>
      <div id="room-foot"></div>`;
    const list = F.$("#room-list", el);
    const SELR = "id,body,created_at,user_id,profiles!coin_chat_user_id_fkey(id,wallet,name,avatar_url)";
    const row = (m) => { const p = m.profiles || {}; const mine = me()?.id === m.user_id;
      return `<div class="room-msg" data-rid="${m.id}"><a href="profile.html?a=${F.esc(p.wallet || "")}"><img src="${F.avatarOf(p)}" alt=""></a><div class="room-b">
        <div class="room-top"><a href="profile.html?a=${F.esc(p.wallet || "")}" class="room-n">${F.displayName(p)}</a>${F.founderBadge(p.wallet, true)}${F.htag(p.wallet, m.user_id, mint)}<span class="room-t">${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>${mine || me()?.is_admin ? `<button class="msg-del" data-rdel="${m.id}" title="Delete">×</button>` : ""}</div>
        <div class="room-txt">${F.esc(m.body).replace(/\$([A-Za-z][A-Za-z0-9]{1,11})\b/g, '<b class="msg-tk">$$$1</b>')}</div></div></div>`; };
    const near = () => list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const draw = (stick) => { list.innerHTML = S.msgs.length ? S.msgs.map(row).join("") : `<div class="room-empty">No messages yet.<br><span class="muted">Start the conversation about $${F.esc(symbol || "")} 🚀</span></div>`; if (stick) list.scrollTop = list.scrollHeight; };
    const foot = () => {
      const f = F.$("#room-foot", el);
      if (me()) {
        f.innerHTML = `<form class="room-form" id="room-form"><input maxlength="280" placeholder="Talk about $${F.esc(symbol || "this coin")}…" autocomplete="off"><button class="btn btn-primary btn-sm">${F.icons.send}</button></form>`;
        F.$("#room-form", el).onsubmit = async (e) => {
          e.preventDefault(); const inp = F.$("input", e.target); const body = inp.value.trim(); if (!body) return;
          inp.value = "";
          const { data, error } = await F.sb.from("coin_chat").insert({ mint, user_id: me().id, body }).select(SELR).single();
          if (error) { inp.value = body; return F.toast("Not sent", F.esc(error.message.replace(/^.*?: /, "")), "warn"); }
          add(data, true);
        };
      } else f.innerHTML = `<button class="btn btn-ghost btn-sm" style="width:100%" id="room-in">${F.wallet.connected ? "Sign in to chat" : "Connect wallet to chat"}</button>`;
      const b = F.$("#room-in", el); if (b) b.onclick = F.auth.signIn;
    };
    const add = (m, stick) => { if (S.seen.has(m.id)) return; S.seen.add(m.id); const st = stick || near(); S.msgs.push(m); if (S.msgs.length > 120) S.msgs.shift(); draw(st); };
    list.addEventListener("click", async (e) => {
      const d = e.target.closest("[data-rdel]"); if (!d) return;
      const { error } = await F.sb.from("coin_chat").delete().eq("id", Number(d.dataset.rdel));
      if (error) F.toast("Couldn't delete", F.esc(error.message), "err");
      else { S.msgs = S.msgs.filter((x) => x.id !== Number(d.dataset.rdel)); draw(false); }
    });
    (async () => {
      const { data } = await F.sb.from("coin_chat").select(SELR).eq("mint", mint).order("created_at", { ascending: false }).limit(60);
      S.msgs = (data || []).reverse(); S.msgs.forEach((m) => S.seen.add(m.id)); draw(true);
    })();
    const ch = F.sb.channel("room-" + mint, { config: { presence: { key: me()?.id || "anon-" + Math.random().toString(36).slice(2) } } })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "coin_chat", filter: `mint=eq.${mint}` }, async ({ new: m }) => {
        if (S.seen.has(m.id)) return;
        const { data } = await F.sb.from("coin_chat").select(SELR).eq("id", m.id).single(); if (data) add(data, false);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "coin_chat" }, ({ old }) => { if (S.seen.has(old.id)) { S.msgs = S.msgs.filter((x) => x.id !== old.id); draw(false); } })
      .on("presence", { event: "sync" }, () => { const n = Object.keys(ch.presenceState()).length; F.$("#room-on", el).textContent = `${n} here now`; })
      .subscribe((st) => { if (st === "SUBSCRIBED") ch.track({ at: Date.now() }); });
    foot();
    document.addEventListener("flow:auth", foot);
    document.addEventListener("flow:wallet", foot);
  };
})();
