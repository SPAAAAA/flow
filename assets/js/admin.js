/* FLOW admin: reports queue + member moderation (admins only; every action is checked server-side) */
(function () {
  const F = FLOW;
  F.layout("admin");
  const root = F.$("#adminpage");
  const me = () => F.auth.profile;
  const S = { tab: "reports", status: "open", reports: [], profiles: new Map(), booted: false, q: "" };
  const WHAT = { post: "Post", comment: "Comment", chat: "Chat message", dm: "Direct message", user: "Member", coin: "Coin" };
  const REASON = { spam: "Spam", scam: "Scam", abuse: "Abuse", nsfw: "NSFW", impersonation: "Impersonation", other: "Other" };

  if (!F.auth.enabled) { root.innerHTML = `<div class="empty-state"><b>Not set up</b></div>`; return; }

  const prof = (id) => S.profiles.get(id) || { id };
  async function loadProfiles(ids) {
    const need = [...new Set(ids)].filter((i) => i && !S.profiles.has(i));
    if (!need.length) return;
    const { data } = await F.sb.from("profiles").select("id,wallet,name,avatar_url,banned,is_admin,created_at").in("id", need);
    (data || []).forEach((p) => S.profiles.set(p.id, p));
  }
  const who = (p) => p?.wallet ? `<a class="adm-who" href="profile.html?a=${F.esc(p.wallet)}" target="_blank"><img src="${F.avatarOf(p)}" alt=""><b>${F.displayName(p)}</b>${F.founderBadge(p.wallet, true)}${p.banned ? '<span class="badge suspended">Suspended</span>' : ""}</a>` : `<span class="muted">deleted account</span>`;

  function shell() {
    root.innerHTML = `<div class="section-title"><h2>${F.icons.shield} Admin</h2><span class="muted" style="font-size:12px">Only you can see this page</span></div>
      <div class="kpis" id="adm-kpis">${Array(6).fill('<div class="skeleton" style="height:66px"></div>').join("")}</div>
      <div class="panel" id="adm-awards"></div>
      <div class="panel">
        <div class="subtabs" id="adm-tabs"><button data-t="reports">Reports</button><button data-t="members">Members</button></div>
        <div id="adm-body"></div>
      </div>`;
    F.$("#adm-tabs").onclick = (e) => { const b = e.target.closest("[data-t]"); if (!b) return; S.tab = b.dataset.t; render(); };
    loadOverview(); render(); loadAwards();
  }

  /* ---------------- weekly awards: best call needs price history, so the admin confirms it ---------------- */
  async function loadAwards() {
    const el = F.$("#adm-awards"); if (!el || !F.callResult) return;
    const d = new Date(); const day = (d.getUTCDay() + 6) % 7;
    const thisWk = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day), lastWk = thisWk - 7 * 864e5;
    const wk = new Date(lastWk).toISOString().slice(0, 10);
    await F.sb.rpc("award_last_week").catch(() => {});
    const { data: won } = await F.sb.from("week_winners").select("*").eq("week", wk);
    const has = (k) => (won || []).find((w) => w.category === k);
    const label = new Date(lastWk).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    await loadProfiles((won || []).map((w) => w.user_id));
    const line = (ic, k, t) => { const w = has(k); return `<div class="trade-row"><span>${ic} ${t}</span><b>${w ? `${who(prof(w.user_id))} <span class="muted">${F.esc(w.detail || "")}</span>` : '<span class="muted">—</span>'}</b></div>`; };
    el.innerHTML = `<h3>👑 Last week's winners <span class="muted" style="font-weight:500;font-size:13px">(week of ${label})</span></h3>
      ${line("💰", "trader", "Top trader")}${line("✍️", "poster", "Top poster")}${line("🎯", "call", "Best call")}
      <div id="adm-call"></div>`;
    if (has("call")) return;
    const box = F.$("#adm-call"); box.innerHTML = `<p class="muted" style="font-size:13px">Working out last week's best call…</p>`;
    const { data: calls } = await F.sb.rpc("week_calls", { wk });
    let best = null;
    for (const c of (calls || []).slice(0, 80)) {
      const mint = c.coin_mint || (c.body.match(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/) || [])[1]; if (!mint) continue;
      const r = await F.callResult(mint, Date.parse(c.created_at), thisWk).catch(() => null);
      if (r && (!best || r.chg > best.r.chg)) best = { c, r };
    }
    if (!best || best.r.chg <= 0) { box.innerHTML = `<p class="muted" style="font-size:13px">No winning calls last week.</p>`; return; }
    await loadProfiles([best.c.user_id]);
    box.innerHTML = `<div class="adm-report"><div>🎯 Best call: ${who(prof(best.c.user_id))} — <b class="up">${F.fmtPct(best.r.chg)}</b> on $${F.esc(best.r.coin.symbol)} by the end of the week <a href="post.html?p=${best.c.id}" target="_blank" class="muted">view post</a></div>
      <div class="adm-actions"><button class="btn btn-primary btn-sm" id="adm-crown">👑 Crown winner</button></div></div>`;
    F.$("#adm-crown").onclick = async () => {
      const { error } = await F.sb.rpc("admin_award_call", { wk, uid: best.c.user_id, gain: Number(best.r.chg.toFixed(2)), info: `${F.fmtPct(best.r.chg)} on $${best.r.coin.symbol}` });
      if (error) return F.toast("Couldn't award", F.esc(error.message), "err");
      F.toast("Winner crowned 👑"); loadAwards();
    };
  }
  async function loadOverview() {
    const { data, error } = await F.sb.rpc("admin_overview");
    if (error || !data) return;
    const k = [["Members", data.members], ["New (24h)", data.new24], ["Open reports", data.open_reports], ["Suspended", data.banned], ["Posts (24h)", data.posts24], ["Trades (24h)", data.trades24]];
    F.$("#adm-kpis").innerHTML = k.map(([l, v]) => `<div class="stat"><div class="l">${l}</div><div class="v">${Number(v).toLocaleString()}</div></div>`).join("");
  }
  function render() {
    F.$$("#adm-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.t === S.tab));
    if (S.tab === "reports") renderReportsShell(); else renderMembers();
  }

  /* ---------------- reports ---------------- */
  function renderReportsShell() {
    F.$("#adm-body").innerHTML = `<div class="adm-filter">${["open", "resolved", "dismissed", "all"].map((s) => `<button class="chip ${S.status === s ? "active" : ""}" data-st="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join("")}</div><div id="adm-reports"><div class="skeleton" style="height:120px"></div></div>`;
    F.$(".adm-filter").onclick = (e) => { const b = e.target.closest("[data-st]"); if (!b) return; S.status = b.dataset.st; renderReportsShell(); };
    loadReports();
  }
  async function loadReports() {
    const { data, error } = await F.sb.rpc("admin_reports", { st: S.status });
    const box = F.$("#adm-reports"); if (!box) return;
    if (error) { box.innerHTML = `<div class="empty-state"><b>Couldn't load reports</b>${F.esc(error.message)}</div>`; return; }
    S.reports = data || [];
    await loadProfiles(S.reports.flatMap((r) => [r.reporter_id, r.target_user]));
    drawReports();
  }
  function contentLink(r) {
    if (r.kind === "post") return `post.html?p=${r.target_id}`;
    if (r.kind === "coin") return `coin.html?c=${r.target_id}`;
    const p = prof(r.target_user);
    if (r.kind === "user" && p.wallet) return `profile.html?a=${p.wallet}`;
    return null;
  }
  function drawReports() {
    const box = F.$("#adm-reports"); if (!box) return;
    if (!S.reports.length) { box.innerHTML = `<div class="empty-state"><b>${S.status === "open" ? "All clear 🎉" : "Nothing here"}</b>${S.status === "open" ? "No open reports right now." : ""}</div>`; return; }
    box.innerHTML = S.reports.map((r) => {
      const t = prof(r.target_user), link = contentLink(r);
      const canDelete = ["post", "comment", "chat", "dm"].includes(r.kind) && r.still_exists;
      const isAdminTarget = t.is_admin;
      return `<div class="adm-report ${r.status}" data-r="${r.id}">
        <div class="adm-r-top"><span class="adm-kind">${WHAT[r.kind]}</span><span class="adm-reason ${r.reason}">${REASON[r.reason]}</span>
          ${r.same_target > 1 ? `<span class="adm-count" title="Reports on this same item">×${r.same_target}</span>` : ""}
          <span class="muted" style="margin-left:auto;font-size:12px">${F.ago(Date.parse(r.created_at))} ago · by ${F.displayName(prof(r.reporter_id))}</span></div>
        ${r.kind !== "coin" ? `<div class="adm-r-who">Reported: ${who(t)}</div>` : ""}
        ${r.snapshot ? `<div class="adm-snap">${r.kind === "coin" ? `<span class="mono">${F.esc(r.snapshot)}</span>` : F.esc(r.snapshot)}</div>` : ""}
        ${!r.still_exists ? `<div class="muted" style="font-size:12px">Already deleted</div>` : ""}
        ${r.note ? `<div class="adm-note">“${F.esc(r.note)}”</div>` : ""}
        <div class="adm-actions">
          ${link ? `<a class="btn btn-ghost btn-sm" href="${link}" target="_blank">Open</a>` : ""}
          ${canDelete ? `<button class="btn btn-ghost btn-sm danger" data-a="delete">Delete ${WHAT[r.kind].toLowerCase()}</button>` : ""}
          ${r.target_user && !isAdminTarget ? (t.banned ? `<button class="btn btn-ghost btn-sm" data-a="unban">Unsuspend</button>` : `<button class="btn btn-ghost btn-sm danger" data-a="ban">Suspend member</button>`) : ""}
          ${r.target_user && !isAdminTarget && (r.kind === "user") ? `<button class="btn btn-ghost btn-sm" data-a="reset">Reset profile</button>` : ""}
          ${r.status === "open" ? `<span style="flex:1"></span><button class="btn btn-ghost btn-sm" data-a="dismiss">Dismiss</button><button class="btn btn-primary btn-sm" data-a="resolve">Resolve</button>` : `<span style="flex:1"></span><span class="muted" style="font-size:12px">${r.status}</span><button class="btn btn-ghost btn-sm" data-a="reopen">Reopen</button>`}
        </div></div>`;
    }).join("");
  }
  async function setStatus(r, status) {
    const { error } = await F.sb.from("reports").update({ status }).eq("id", r.id);
    if (error) return F.toast("Couldn't update", F.esc(error.message), "err");
    // resolve/dismiss every report on the same item together
    if (status !== "open") await F.sb.from("reports").update({ status }).eq("kind", r.kind).eq("target_id", r.target_id).eq("status", "open");
    loadReports(); loadOverview(); refreshNavBadge();
  }
  const TABLE = { post: "posts", comment: "post_comments", chat: "messages", dm: "dm_messages" };
  async function act(r, a, btn) {
    const t = prof(r.target_user);
    if (a === "resolve" || a === "dismiss" || a === "reopen") return setStatus(r, a === "resolve" ? "resolved" : a === "dismiss" ? "dismissed" : "open");
    if (a === "delete") {
      if (!confirmBtn(btn)) return;
      const { error } = await F.sb.from(TABLE[r.kind]).delete().eq("id", Number(r.target_id));
      if (error) return F.toast("Couldn't delete", F.esc(error.message), "err");
      F.toast("Deleted ✓"); return setStatus(r, "resolved");
    }
    if (a === "ban" || a === "unban") return banUser(t, a === "ban", btn, () => { loadReports(); });
    if (a === "reset") {
      if (!confirmBtn(btn)) return;
      const { error } = await F.sb.rpc("admin_reset_profile", { uid: t.id });
      if (error) return F.toast("Couldn't reset", F.esc(error.message), "err");
      S.profiles.delete(t.id); F.toast("Profile reset ✓", "Name, picture, bio, banner and links were cleared.");
      return setStatus(r, "resolved");
    }
  }
  // two-step confirm on the button itself
  function confirmBtn(btn) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = "1"; const txt = btn.textContent; btn.textContent = "Click again to confirm";
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = txt; } }, 3500);
    return false;
  }
  async function banUser(p, ban, btn, after) {
    if (!p?.id) return;
    if (ban) return banModal(p, after);
    const { error } = await F.sb.rpc("admin_set_ban", { uid: p.id, ban: false });
    if (error) return F.toast("Couldn't update", F.esc(error.message), "err");
    p.banned = false; F.toast("Member unsuspended ✓"); loadOverview(); after && after();
  }
  function banModal(p, after) {
    const m = F.h(`<div class="modal-bg"><div class="modal" style="max-width:420px">
      <h3 style="margin:0 0 6px">Suspend ${F.displayName(p)}?</h3>
      <p style="margin:0 0 12px;font-size:13px">They can still browse and trade with their own wallet, but can't post, comment, chat, like, follow, vote or send messages. You can undo this any time.</p>
      <label class="report-opt"><input type="checkbox" id="purge"><span>Also delete all their posts, comments and chat messages</span></label>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary danger-bg" id="bango">Suspend</button></div></div></div>`);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); });
    document.body.appendChild(m);
    F.$("#bango", m).onclick = async () => {
      const b = F.$("#bango", m); b.disabled = true;
      const { error } = await F.sb.rpc("admin_set_ban", { uid: p.id, ban: true });
      if (error) { b.disabled = false; return F.toast("Couldn't suspend", F.esc(error.message), "err"); }
      p.banned = true;
      let msg = "";
      if (F.$("#purge", m).checked) {
        const { data, error: e2 } = await F.sb.rpc("admin_purge", { uid: p.id });
        msg = e2 ? "Couldn't delete their content: " + F.esc(e2.message) : `Deleted ${data.posts} posts, ${data.comments} comments, ${data.chat} chat messages.`;
      }
      m.remove(); F.toast("Member suspended ✓", msg); loadOverview(); after && after();
    };
  }
  F.$("#adminpage").addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const card = b.closest("[data-r]");
    if (card) { const r = S.reports.find((x) => String(x.id) === card.dataset.r); if (r) act(r, b.dataset.a, b); return; }
    const row = b.closest("[data-m]");
    if (row) { const p = S.profiles.get(row.dataset.m); if (p) memberAct(p, b.dataset.a, b); }
  });
  function refreshNavBadge() {
    F.sb.rpc("admin_overview").then(({ data }) => {
      const a = F.$('.nav a[data-nav="admin"]'); if (!a) return;
      let s = F.$(".nav-badge", a);
      if (!data?.open_reports) { s && s.remove(); return; }
      if (!s) { s = F.h('<span class="nav-badge"></span>'); a.appendChild(s); }
      s.textContent = data.open_reports;
    });
  }

  /* ---------------- members ---------------- */
  function renderMembers() {
    F.$("#adm-body").innerHTML = `<div class="adm-filter"><input class="input" id="adm-q" placeholder="Search by name or paste a wallet…" value="${F.esc(S.q)}" style="flex:1;min-width:200px">
        <button class="chip ${S.q === ":banned" ? "active" : ""}" data-mf="banned">Suspended</button><button class="chip ${!S.q ? "active" : ""}" data-mf="new">Newest</button></div>
      <div id="adm-members"><div class="skeleton" style="height:120px"></div></div>`;
    let t;
    F.$("#adm-q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value.trim(); loadMembers(); }, 300); };
    F.$$("[data-mf]").forEach((b) => (b.onclick = () => { S.q = b.dataset.mf === "banned" ? ":banned" : ""; renderMembers(); }));
    loadMembers();
  }
  async function loadMembers() {
    let q = F.sb.from("profiles").select("id,wallet,name,avatar_url,banned,is_admin,created_at,last_seen");
    const s = S.q;
    if (s === ":banned") q = q.eq("banned", true).order("created_at", { ascending: false });
    else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) q = q.eq("wallet", s);
    else if (s) q = q.ilike("name", `%${s.replace(/[%_]/g, (c) => "\\" + c)}%`).order("last_seen", { ascending: false });
    else q = q.order("created_at", { ascending: false });
    const { data, error } = await q.limit(50);
    const box = F.$("#adm-members"); if (!box) return;
    if (error) { box.innerHTML = `<p class="muted">${F.esc(error.message)}</p>`; return; }
    (data || []).forEach((p) => S.profiles.set(p.id, p));
    box.innerHTML = (data || []).length ? data.map((p) => `<div class="adm-member" data-m="${p.id}">${who(p)}
        <span class="muted mono" style="font-size:12px">${F.short(p.wallet)}</span>
        <span class="muted" style="font-size:12px">joined ${F.ago(Date.parse(p.created_at))} ago · seen ${F.ago(Date.parse(p.last_seen))} ago</span>
        <span style="flex:1"></span>
        ${p.is_admin ? `<span class="badge blue">Admin</span>` : `
          <button class="btn btn-ghost btn-sm" data-a="reset">Reset profile</button>
          <button class="btn btn-ghost btn-sm" data-a="purge">Delete content</button>
          ${p.banned ? `<button class="btn btn-ghost btn-sm" data-a="unban">Unsuspend</button>` : `<button class="btn btn-ghost btn-sm danger" data-a="ban">Suspend</button>`}`}
      </div>`).join("") : `<p class="muted" style="padding:12px">No members found.</p>`;
  }
  async function memberAct(p, a, btn) {
    if (a === "ban" || a === "unban") return banUser(p, a === "ban", btn, loadMembers);
    if (!confirmBtn(btn)) return;
    if (a === "reset") {
      const { error } = await F.sb.rpc("admin_reset_profile", { uid: p.id });
      if (error) return F.toast("Couldn't reset", F.esc(error.message), "err");
      F.toast("Profile reset ✓"); loadMembers();
    }
    if (a === "purge") {
      const { data, error } = await F.sb.rpc("admin_purge", { uid: p.id });
      if (error) return F.toast("Couldn't delete", F.esc(error.message), "err");
      F.toast("Content deleted ✓", `${data.posts} posts, ${data.comments} comments, ${data.chat} chat messages.`); loadOverview();
    }
  }

  /* ---------------- boot ---------------- */
  function denied() {
    S.booted = false;
    root.innerHTML = `<div class="empty-state" style="max-width:520px;margin:40px auto"><b>Admins only</b>${me() ? "This page is only for FLOW admins." : "Sign in with an admin wallet to continue."}
      ${me() ? "" : `<div style="margin-top:14px"><button class="btn btn-primary" id="adm-signin">${F.wallet.connected ? "Sign in with wallet" : "Connect wallet"}</button></div>`}</div>`;
    const b = F.$("#adm-signin"); if (b) b.onclick = F.auth.signIn;
  }
  function boot() {
    if (!me()?.is_admin) return denied();
    if (S.booted) return;
    S.booted = true; shell();
  }
  document.addEventListener("flow:auth", boot);
  setTimeout(boot, 1200);
})();
