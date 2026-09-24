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
    const mine = F.wallet.pubkey === addr;
    document.title = `${F.short(addr)} — ${F.cfg.siteName}`;
    root.innerHTML = `
      <div class="profile-head">
        <img class="avatar" src="${F.avatar(addr)}" alt="">
        <div>
          <h1>${F.short(addr, 6)} ${mine ? '<span class="badge blue">You</span>' : ""}</h1>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="copy" id="cp">${F.short(addr, 10)} ${F.icons.copy}</button></div>
        </div>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" id="share">${F.icons.copy}Share</button>
          <a class="btn btn-ghost btn-sm" href="${F.solscanAcc(addr)}" target="_blank" rel="noopener">Solscan ${F.icons.ext}</a>
        </div>
      </div>
      <div class="kpis" id="kpis">${Array(4).fill('<div class="skeleton" style="height:66px"></div>').join("")}</div>
      <div class="panel">
        <div class="subtabs" id="tabs"><button data-t="coins" class="active">Coins held</button><button data-t="activity">Activity</button></div>
        <div id="body"></div>
      </div>`;
    F.$("#cp").onclick = () => F.copy(addr, "Address copied");
    F.$("#share").onclick = () => F.copy(location.origin + location.pathname + "?a=" + addr, "Profile link copied");
    F.$("#tabs").onclick = (e) => {
      const b = e.target.closest("[data-t]"); if (!b) return;
      S.tab = b.dataset.t; F.$$("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
      S.tab === "coins" ? renderCoins() : loadActivity();
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
        <td class="num">${F.num(h.amount)}</td><td class="num">${F.price(c?.priceUsd)}</td><td class="num">${F.pct(c?.chg?.h24)}</td><td class="num"><b>${F.usd(h.value)}</b></td>
        <td class="num"><a class="btn btn-ghost btn-sm" href="coin.html?c=${h.mint}">Trade</a></td></tr>`; }).join("")}
      </tbody></table></div>` : `<div class="empty-state"><b>No coins yet</b>${S.hideDust && S.holdings.length ? "Only small balances — switch off “Hide small balances” to see them." : "This wallet doesn't hold any tokens."}</div>`}`;
    F.$("#dust").onchange = (e) => { S.hideDust = e.target.checked; F.store.set("hideDust", S.hideDust); renderCoins(); };
  }

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

  function start() {
    if (!addr) { if (F.wallet.pubkey) addr = F.wallet.pubkey; else return prompt(); }
    if (!F.isAddress(addr)) { root.innerHTML = `<div class="empty-state"><b>Invalid address</b>That doesn't look like a Solana wallet address.</div>`; return; }
    shell(); renderCoins(); load();
  }
  document.addEventListener("flow:wallet", () => {
    if (!F.qs("a") && F.wallet.pubkey && addr !== F.wallet.pubkey) { addr = F.wallet.pubkey; S.holdings = null; S.sigs = null; start(); }
    else if (addr) { const h = F.$(".profile-head h1"); if (h) h.innerHTML = `${F.short(addr, 6)} ${F.wallet.pubkey === addr ? '<span class="badge blue">You</span>' : ""}`; }
  });
  start();
})();
