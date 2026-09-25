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
          <div class="follow-counts" id="pfollow"></div>
          <div class="plevel" id="plevel"></div>
        </div>
        <div class="actions">
          <span id="pedit"></span><span id="pdm"></span>
          <button class="btn btn-ghost btn-sm" id="share">${F.icons.copy}Share</button>
          <a class="btn btn-ghost btn-sm" href="${F.solscanAcc(addr)}" target="_blank" rel="noopener">Solscan ${F.icons.ext}</a>
        </div>
      </div>
      <div class="kpis" id="kpis">${Array(4).fill('<div class="skeleton" style="height:66px"></div>').join("")}</div>
      <div class="panel">
        <div class="subtabs" id="tabs"><button data-t="coins" class="active">Coins held</button><button data-t="posts">Posts</button><button data-t="activity">Activity</button></div>
        <div id="body"></div>
      </div>`;
    F.$("#cp").onclick = () => F.copy(addr, "Address copied");
    F.$("#share").onclick = () => F.copy(location.origin + location.pathname + "?a=" + addr, "Profile link copied");
    F.$("#tabs").onclick = (e) => {
      const b = e.target.closest("[data-t]"); if (!b) return;
      S.tab = b.dataset.t; F.$$("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
      if (S.tab === "coins") renderCoins();
      else if (S.tab === "posts") showPosts();
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
        <div class="xpbar" title="${i.xp} / ${i.next} XP"><i style="width:${i.pct}%"></i></div><span class="muted" style="font-size:12px">${i.xp} / ${i.next} XP</span>${i.streak ? `<span class="streak-pill" title="Visited ${i.streak} days in a row">🔥 ${i.streak}-day streak</span>` : ""}</div>
      ${b.length ? `<div class="badge-row">${b.map((x) => `<span class="mbadge" title="${F.esc(x.why)}">${x.ic} ${F.esc(x.name)}</span>`).join("")}</div>` : ""}`;
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
    F.$("#pname").innerHTML = `${member?.name ? F.esc(member.name) : F.short(addr, 6)} ${F.founderBadge(addr)} ${me || connectedHere ? '<span class="badge blue">You</span>' : ""}${member?.banned ? ' <span class="badge suspended" title="This account was suspended for breaking the rules">Suspended</span>' : ""}`;
    F.$("#pav").src = member?.avatar_url || F.avatar(addr);
    F.$("#psince").textContent = member ? `Member since ${new Date(member.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : "";
    F.$("#pdot").classList.toggle("hidden", !F.online.has(addr));
    if (member?.name) document.title = `${member.name} — ${F.cfg.siteName}`;
    const bn = F.$("#pbanner");
    if (bn) { bn.style.backgroundImage = member?.banner_url ? `url("${member.banner_url.replace(/"/g, "")}")` : ""; bn.classList.toggle("has", !!member?.banner_url); }
    const bio = F.$("#pbio");
    if (bio) {
      const links = [];
      if (member?.name) links.push(`<span class="muted mono">@${F.esc(F.handleOf(member))}</span>`);
      if (member?.x_handle) links.push(`<a href="https://x.com/${encodeURIComponent(member.x_handle)}" target="_blank" rel="noopener nofollow" class="plink">${F.icons.x}@${F.esc(member.x_handle)}</a>`);
      if (member?.tiktok_handle) links.push(`<a href="https://www.tiktok.com/@${encodeURIComponent(member.tiktok_handle)}" target="_blank" rel="noopener nofollow" class="plink">${F.icons.tiktok}@${F.esc(member.tiktok_handle)}</a>`);
      bio.innerHTML = `${member?.bio ? `<p class="pbio-text">${F.esc(member.bio)}</p>` : ""}${links.length ? `<div class="plinks">${links.join("")}</div>` : ""}`;
    }
    renderFollow(); renderLevel(); renderDmBtn();
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
