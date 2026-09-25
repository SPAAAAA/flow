/* FLOW safety: report anything, admin link, coin risk scoring, suspended notice */
(function () {
  const F = FLOW;
  const me = () => F.auth?.profile;

  F.icons.flag = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>`;
  F.icons.shield = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>`;

  /* ---------------- reporting ---------------- */
  const REASONS = {
    post: ["spam", "scam", "abuse", "nsfw", "other"],
    comment: ["spam", "scam", "abuse", "nsfw", "other"],
    chat: ["spam", "scam", "abuse", "nsfw", "other"],
    dm: ["spam", "scam", "abuse", "nsfw", "other"],
    user: ["impersonation", "scam", "spam", "abuse", "nsfw", "other"],
    coin: ["scam", "other"],
  };
  const LABEL = { spam: "Spam or shilling", scam: "Scam / rug / phishing link", abuse: "Harassment or hate", nsfw: "NSFW content", impersonation: "Pretending to be someone else", other: "Something else" };
  const WHAT = { post: "post", comment: "comment", chat: "chat message", dm: "message", user: "member", coin: "coin" };
  const done = new Set(F.store.get("reported", []));

  F.report = (kind, id) => {
    if (!F.auth?.enabled) return;
    if (!me()) return F.auth.signIn();
    if (me().banned) return F.toast("Account suspended", "Suspended accounts can't send reports.", "warn");
    const key = kind + ":" + id;
    if (done.has(key)) return F.toast("Already reported", "Thanks — the team will take a look.");
    const m = F.h(`<div class="modal-bg"><div class="modal" style="max-width:420px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><h3 style="margin:0">Report ${WHAT[kind]}</h3><button class="icon-btn" data-x>${F.icons.close}</button></div>
      <p style="margin:0 0 12px;font-size:13px">${kind === "coin" ? "Flag this coin as a scam so other members are warned. Reports are anonymous." : "Reports are anonymous. The team reviews every one."}</p>
      <div class="report-reasons">${REASONS[kind].map((r, i) => `<label class="report-opt"><input type="radio" name="rr" value="${r}" ${i ? "" : "checked"}><span>${LABEL[r]}</span></label>`).join("")}</div>
      <textarea class="input" id="rnote" maxlength="200" rows="2" placeholder="Anything we should know? (optional)" style="width:100%;height:auto;padding:10px 12px;margin-top:10px;resize:vertical"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" id="rsend">${F.icons.flag}Send report</button></div>
    </div></div>`);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); });
    document.body.appendChild(m);
    F.$("#rsend", m).onclick = async () => {
      const b = F.$("#rsend", m); b.disabled = true; b.textContent = "Sending…";
      const reason = F.$('input[name="rr"]:checked', m).value;
      const note = F.$("#rnote", m).value.trim() || null;
      const { error } = await F.sb.from("reports").insert({ reporter_id: me().id, kind, target_id: String(id), reason, note });
      if (error && error.code !== "23505") { b.disabled = false; b.innerHTML = `${F.icons.flag}Send report`; return F.toast("Report not sent", F.esc(error.message.replace(/^.*?: /, "")), "warn"); }
      done.add(key); F.store.set("reported", [...done].slice(-300));
      m.remove();
      F.toast("Report sent ✓", kind === "coin" ? "Thanks for warning other members." : "Thanks — the team will review it.");
      document.dispatchEvent(new CustomEvent("flow:reported", { detail: { kind, id: String(id) } }));
    };
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-report]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const [kind, ...rest] = b.dataset.report.split(":");
    F.report(kind, rest.join(":"));
  }, true);
  F.reportBtn = (kind, id, cls = "pa pa-report") => `<button class="${cls}" data-report="${kind}:${F.esc(String(id))}" title="Report">${F.icons.flag}</button>`;

  /* ---------------- admin link + suspended notice ---------------- */
  let warned = false;
  function onAuth() {
    const p = me();
    const nav = F.$(".nav");
    let a = F.$('.nav a[data-nav="admin"]');
    if (p?.is_admin && nav && !a) {
      a = F.h(`<a href="admin.html" data-nav="admin" class="${/admin\.html$/.test(location.pathname) ? "active" : ""}">${F.icons.shield}Admin</a>`);
      nav.appendChild(a);
      F.sb.rpc("admin_overview").then(({ data }) => { if (data?.open_reports) { const s = F.h(`<span class="nav-badge">${data.open_reports}</span>`); a.appendChild(s); } });
    } else if (!p?.is_admin && a) a.remove();
    if (p?.banned && !warned) {
      warned = true;
      F.toast("Your account is suspended", "You can still browse and trade, but you can't post, chat, like, follow or message.", "warn");
    }
  }
  document.addEventListener("flow:auth", onAuth);
  setTimeout(onAuth, 1500);

  /* ---------------- coin risk ---------------- */
  // returns { level: "high" | "medium" | "low" | "unknown", flags: [{ sev, title, text }] }
  F.coinRisk = (c, info, reports) => {
    const flags = [];
    const add = (sev, title, text) => flags.push({ sev, title, text });
    const a = info?.audit || {};
    if (a.mintAuthorityDisabled === false) add("high", "Creator can mint more", "The mint authority is still on, so new tokens can be printed and dumped on holders.");
    if (a.freezeAuthorityDisabled === false) add("high", "Your tokens can be frozen", "The freeze authority is on. The creator could freeze wallets so you can't sell.");
    const top = a.topHoldersPercentage;
    if (top != null) { if (top >= 50) add("high", `Top 10 wallets hold ${top.toFixed(0)}%`, "A few wallets control most of the supply and could crash the price."); else if (top >= 30) add("medium", `Top 10 wallets hold ${top.toFixed(0)}%`, "Supply is fairly concentrated."); }
    const dev = a.devBalancePercentage;
    if (dev != null) { if (dev >= 10) add("high", `Dev holds ${dev.toFixed(1)}%`, "The creator still holds a big bag they could sell."); else if (dev >= 5) add("medium", `Dev holds ${dev.toFixed(1)}%`, "The creator still holds a noticeable share."); }
    if (c && !c.onCurve && c.liq != null) { if (c.liq < 5000) add("high", `Very low liquidity (${F.usd(c.liq)})`, "Big price swings and you may not be able to sell without losing most of it."); else if (c.liq < 20000) add("medium", `Low liquidity (${F.usd(c.liq)})`, "Larger trades will move the price a lot."); }
    if (c?.createdAt && Date.now() - c.createdAt < 60 * 60 * 1000) add("medium", "Brand new coin", `Created ${F.ago(c.createdAt)} ago. Most new coins go to zero.`);
    if (info?.organicScoreLabel === "low") add("medium", "Low organic activity", "Much of the trading looks like bots or wash trading.");
    if (c?.chg?.h24 != null && c.chg.h24 <= -80) add("medium", `Down ${Math.abs(c.chg.h24).toFixed(0)}% in 24h`, "This can be a sign the coin was rugged.");
    if (reports >= 3) add("high", `Flagged as a scam by ${reports} members`, "Several FLOW members reported this coin.");
    else if (reports > 0) add("medium", `Flagged by ${reports} member${reports > 1 ? "s" : ""}`, "A FLOW member reported this coin as a scam.");
    const level = flags.some((f) => f.sev === "high") ? "high" : flags.length ? "medium" : info ? "low" : "unknown";
    return { level, flags };
  };
  F.coinReports = async (mint) => {
    if (!F.auth?.enabled || !F.sb) return 0;
    try { const { data } = await F.sb.rpc("coin_reports", { m: mint }); return Number(data) || 0; } catch { return 0; }
  };
})();
