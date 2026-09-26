/* FLOW teams: up to 50 members, team chat, season team leaderboard */
(function () {
  const F = FLOW;
  F.layout("teams");
  const root = F.$("#teamspage");
  const me = () => F.auth.profile;
  const CAP = 50;
  const EMBLEMS = ["🌊", "🐋", "🦈", "🐸", "🦍", "🐂", "🐻", "🚀", "💎", "🔥", "⚡", "👑", "🎯", "🧠", "🍀", "🌙", "☠️", "🐉", "🦅", "🎰"];
  const COLORS = ["blue", "green", "purple", "gold", "red", "pink", "cyan", "orange"];
  const ROLE = { owner: "👑 Owner", officer: "⭐ Officer", member: "Member" };
  const S = { tab: "board", myTeam: undefined, profs: new Map(), chan: null };

  if (!F.auth.enabled) { root.innerHTML = `<div class="empty-state"><b>Teams aren't set up yet</b></div>`; return; }

  async function loadProfs(ids) {
    const need = [...new Set(ids)].filter((i) => i && !S.profs.has(i));
    for (let i = 0; i < need.length; i += 100) {
      const { data } = await F.sb.from("profiles").select("id,wallet,name,avatar_url").in("id", need.slice(i, i + 100));
      (data || []).forEach((p) => S.profs.set(p.id, p));
    }
  }
  const P = (id) => S.profs.get(id) || { id, wallet: "" };
  const emblem = (t, size = "") => `<span class="t-emb tc-${F.esc(t.color)} ${size}">${F.esc(t.emblem)}</span>`;
  const tagPill = (t) => `<span class="ttag tc-${F.esc(t.color)}">${F.esc(t.tag)}</span>`;
  async function myTeamId() {
    if (!me()) return null;
    const { data } = await F.sb.from("team_members").select("team_id,role").eq("user_id", me().id).maybeSingle();
    S.myTeam = data || null;
    return data?.team_id || null;
  }
  const err = (e) => F.toast("Couldn't do that", F.esc((e?.message || String(e)).replace(/^.*?: /, "")), "warn");

  /* ================= overview: leaderboard + browse ================= */
  async function overview() {
    const tid = await myTeamId();
    root.innerHTML = `<div class="section-title"><h2>${F.icons.users} Teams</h2><span class="muted" style="font-size:12px">Team up with up to ${CAP} members · climb the season together</span></div>
      <div id="t-mine"></div>
      <div class="panel"><div class="subtabs" id="t-tabs"><button data-t="board">🏆 Team leaderboard</button><button data-t="browse">🔎 Find a team</button></div><div id="t-body"></div></div>`;
    const mine = F.$("#t-mine");
    if (tid) {
      const { data: t } = await F.sb.from("teams").select("*").eq("id", tid).single();
      mine.innerHTML = t ? `<a class="t-mine tc-bg-${F.esc(t.color)}" href="teams.html?t=${t.id}">${emblem(t, "lg")}<div style="min-width:0;flex:1"><div class="muted" style="font-size:12px">Your team</div><div class="t-name">${F.esc(t.name)} ${tagPill(t)}</div></div><span class="btn btn-primary btn-sm">Open team →</span></a>` : "";
    } else {
      mine.innerHTML = `<div class="t-cta"><div><b>You're not in a team yet</b><div class="muted" style="font-size:13px">Create your own team or join one below. Team members' season points add up on the team leaderboard.</div></div>
        <button class="btn btn-primary" id="t-create">+ Create a team</button></div>`;
      F.$("#t-create").onclick = () => (me() ? createModal() : F.auth.signIn());
    }
    F.$("#t-tabs").onclick = (e) => { const b = e.target.closest("[data-t]"); if (!b) return; S.tab = b.dataset.t; drawTab(); };
    drawTab();
  }
  function drawTab() {
    F.$$("#t-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.t === S.tab));
    S.tab === "board" ? drawBoard() : drawBrowse();
  }
  async function drawBoard() {
    const box = F.$("#t-body"); box.innerHTML = `<div class="skeleton" style="height:240px"></div>`;
    const { data, error } = await F.sb.rpc("team_board", { lim: 100 });
    if (error) { box.innerHTML = `<p class="muted">${F.esc(error.message)}</p>`; return; }
    const rows = data || [];
    await loadProfs(rows.map((r) => r.top_user));
    if (!rows.length) { box.innerHTML = `<div class="empty-state"><b>No teams yet</b>Be the first — create a team and invite your friends.</div>`; return; }
    box.innerHTML = `<p class="note" style="margin:0 0 10px">${F.esc(F.season?.label() || "This season")} · points from every member add up. Season ends on the 1st.</p>
      <div class="table-wrap" style="border:0;background:none"><table class="t"><thead><tr><th>#</th><th>Team</th><th class="num">Members</th><th class="num">Season points</th><th>MVP</th><th></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr data-href="teams.html?t=${r.team_id}" style="cursor:pointer" class="${S.myTeam?.team_id === r.team_id ? "me-row" : ""}">
        <td class="rank-num">${["🥇", "🥈", "🥉"][i] || i + 1}</td>
        <td><div class="coin-cell">${emblem(r)}<div><div class="n">${F.esc(r.name)} ${tagPill(r)}</div><div class="s">${r.join_mode === "open" ? "Open to join" : "Request to join"}</div></div></div></td>
        <td class="num">${r.members}/${CAP}</td><td class="num"><b>${(+r.points).toLocaleString()}</b></td>
        <td>${r.top_user ? `<span class="muted">${F.displayName(P(r.top_user))}</span>` : "—"}</td>
        <td class="num"><span class="btn btn-ghost btn-sm">View</span></td></tr>`).join("")}</tbody></table></div>`;
  }
  async function drawBrowse() {
    const box = F.$("#t-body");
    box.innerHTML = `<div class="adm-filter"><input class="input" id="t-q" placeholder="Search teams by name or tag…" style="flex:1;min-width:200px;height:38px"></div><div id="t-list"><div class="skeleton" style="height:200px"></div></div>`;
    let t; F.$("#t-q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => list(e.target.value.trim()), 250); };
    list("");
  }
  async function list(q) {
    let qry = F.sb.from("teams").select("id,name,tag,emblem,color,join_mode,description,created_at").order("created_at", { ascending: false }).limit(60);
    if (q) qry = qry.or(`name.ilike.%${q.replace(/[%,()]/g, "")}%,tag.ilike.%${q.replace(/[%,()]/g, "")}%`);
    const { data } = await qry;
    const teams = data || [];
    const counts = new Map();
    if (teams.length) { const { data: m } = await F.sb.from("team_members").select("team_id").in("team_id", teams.map((x) => x.id)); (m || []).forEach((r) => counts.set(r.team_id, (counts.get(r.team_id) || 0) + 1)); }
    const el = F.$("#t-list"); if (!el) return;
    el.innerHTML = teams.length ? `<div class="t-grid">${teams.map((x) => { const n = counts.get(x.id) || 0; return `<a class="t-card tc-bd-${F.esc(x.color)}" href="teams.html?t=${x.id}">
        <div class="t-card-top">${emblem(x, "md")}<div style="min-width:0"><div class="t-name">${F.esc(x.name)}</div>${tagPill(x)}</div></div>
        <div class="t-desc">${x.description ? F.esc(x.description) : '<span class="muted">No description</span>'}</div>
        <div class="t-card-foot"><span>${F.icons.users} ${n}/${CAP}</span><span class="${n >= CAP ? "down" : "muted"}">${n >= CAP ? "Full" : x.join_mode === "open" ? "Open" : "Request"}</span></div></a>`; }).join("")}</div>`
      : `<div class="empty-state"><b>No teams found</b>${q ? "Try another search." : "Create the first one!"}</div>`;
  }

  /* ================= create / settings ================= */
  function teamForm(t) {
    const isEdit = !!t; t = t || { name: "", tag: "", description: "", emblem: "🌊", color: "blue", join_mode: "open" };
    const sel = { emblem: t.emblem, color: t.color, mode: t.join_mode };
    const m = F.h(`<div class="modal-bg"><div class="modal" style="max-width:480px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0">${isEdit ? "Team settings" : "Create a team"}</h3><button class="icon-btn" data-x>${F.icons.close}</button></div>
      <div class="t-preview" id="t-prev"></div>
      <label class="label">Team name</label><input class="input" id="tf-name" maxlength="24" value="${F.esc(t.name)}" placeholder="e.g. Solana Sharks">
      ${isEdit ? "" : `<label class="label" style="margin-top:10px">Tag (2–5 letters/numbers, shown next to names)</label><input class="input" id="tf-tag" maxlength="5" value="${F.esc(t.tag)}" placeholder="e.g. SHARK" style="text-transform:uppercase">`}
      <label class="label" style="margin-top:10px">Description</label><textarea class="input" id="tf-desc" maxlength="200" rows="2" style="height:auto;padding:10px 12px;resize:vertical" placeholder="What is your team about?">${F.esc(t.description || "")}</textarea>
      <label class="label" style="margin-top:10px">Emblem</label><div class="t-pick" id="tf-emb">${EMBLEMS.map((e) => `<button data-emb="${e}">${e}</button>`).join("")}</div>
      <label class="label" style="margin-top:10px">Color</label><div class="t-pick" id="tf-col">${COLORS.map((c) => `<button class="tc-sw tc-${c}" data-col="${c}" title="${c}"></button>`).join("")}</div>
      <label class="label" style="margin-top:10px">Who can join?</label><div class="t-pick wide" id="tf-mode"><button data-mode="open">🔓 Anyone</button><button data-mode="request">✋ Request to join</button></div>
      <button class="btn btn-primary" style="width:100%;margin-top:16px" id="tf-go">${isEdit ? "Save" : "Create team"}</button></div></div>`);
    m.addEventListener("click", (e) => {
      if (e.target === m || e.target.closest("[data-x]")) return m.remove();
      const a = e.target.closest("[data-emb]"), c = e.target.closest("[data-col]"), d = e.target.closest("[data-mode]");
      if (a) sel.emblem = a.dataset.emb; if (c) sel.color = c.dataset.col; if (d) sel.mode = d.dataset.mode;
      if (a || c || d) paint();
    });
    const paint = () => {
      F.$$("[data-emb]", m).forEach((b) => b.classList.toggle("on", b.dataset.emb === sel.emblem));
      F.$$("[data-col]", m).forEach((b) => b.classList.toggle("on", b.dataset.col === sel.color));
      F.$$("[data-mode]", m).forEach((b) => b.classList.toggle("on", b.dataset.mode === sel.mode));
      const nm = F.$("#tf-name", m).value.trim() || "Team name", tg = (isEdit ? t.tag : F.$("#tf-tag", m).value.trim().toUpperCase()) || "TAG";
      F.$("#t-prev", m).innerHTML = `${emblem({ emblem: sel.emblem, color: sel.color }, "md")}<div><div class="t-name">${F.esc(nm)}</div><span class="muted" style="font-size:13px">${F.esc(F.auth.profile?.name || "You")} ${tagPill({ tag: tg, color: sel.color })}</span></div>`;
    };
    m.addEventListener("input", paint);
    document.body.appendChild(m); paint();
    F.$("#tf-go", m).onclick = async () => {
      const name = F.$("#tf-name", m).value.trim(), desc = F.$("#tf-desc", m).value.trim();
      if (name.length < 3 || !/^[A-Za-z0-9 _.\-]+$/.test(name)) return F.toast("Check the name", "3–24 characters: letters, numbers, spaces, _ . -", "warn");
      const b = F.$("#tf-go", m); b.disabled = true;
      if (isEdit) {
        const { error } = await F.sb.rpc("team_update", { p_name: name, p_desc: desc, p_emblem: sel.emblem, p_color: sel.color, p_mode: sel.mode });
        b.disabled = false; if (error) return err(error);
        m.remove(); F.toast("Team updated ✓", ""); teamPage(t.id); return;
      }
      const tag = F.$("#tf-tag", m).value.trim().toUpperCase();
      if (!/^[A-Z0-9]{2,5}$/.test(tag)) { b.disabled = false; return F.toast("Check the tag", "2–5 letters or numbers, like SHARK", "warn"); }
      const { data, error } = await F.sb.rpc("team_create", { p_name: name, p_tag: tag, p_desc: desc, p_emblem: sel.emblem, p_color: sel.color, p_mode: sel.mode });
      b.disabled = false; if (error) return err(error);
      m.remove(); F.toast(`Team ${F.esc(name)} created 🎉`, "Share the link so friends can join."); F.teamsForget && F.teamsForget(); location.href = "teams.html?t=" + data;
    };
  }
  const createModal = () => teamForm(null);

  /* ================= team page ================= */
  async function teamPage(tid) {
    root.innerHTML = `<div class="skeleton" style="height:180px;border-radius:16px"></div>`;
    const [{ data: t }, { data: mem }, mine] = await Promise.all([
      F.sb.from("teams").select("*").eq("id", tid).maybeSingle(),
      F.sb.from("team_members").select("user_id,role,joined_at").eq("team_id", tid),
      myTeamId(),
    ]);
    if (!t) { root.innerHTML = `<div class="empty-state"><b>Team not found</b>It may have been closed. <div style="margin-top:12px"><a class="btn btn-ghost" href="teams.html">All teams</a></div></div>`; return; }
    document.title = `${t.name} [${t.tag}] — ${F.cfg.siteName}`;
    const members = mem || [];
    await loadProfs(members.map((m) => m.user_id));
    const board = F.season ? await F.season.board() : [];
    const pts = new Map(board.map((r) => [r.user_id, +r.points]));
    const total = members.reduce((a, m) => a + (pts.get(m.user_id) || 0), 0);
    const myRole = mine === t.id ? S.myTeam.role : null;
    const isMgr = myRole === "owner" || myRole === "officer";
    let requested = false;
    if (me() && !myRole) { const { data: rq } = await F.sb.from("team_requests").select("team_id").eq("team_id", t.id).eq("user_id", me().id).maybeSingle(); requested = !!rq; }
    const full = members.length >= CAP;
    const act = !me() ? `<button class="btn btn-primary" id="t-signin">Sign in to join</button>`
      : myRole ? `<button class="btn btn-ghost" id="t-leave">Leave team</button>${myRole === "owner" ? `<button class="btn btn-ghost" id="t-edit">⚙️ Settings</button>` : ""}`
      : mine ? `<span class="muted" style="font-size:13px">You're already in another team</span>`
      : full ? `<span class="down" style="font-weight:700">Team is full</span>`
      : requested ? `<button class="btn btn-ghost" id="t-cancel">Request sent · Cancel</button>`
      : `<button class="btn btn-primary" id="t-join">${t.join_mode === "open" ? "Join team" : "Request to join"}</button>`;
    root.innerHTML = `<a class="linkish" href="teams.html" style="font-size:13px">← All teams</a>
      <div class="t-hero tc-bg-${F.esc(t.color)}">${emblem(t, "xl")}
        <div class="t-hero-main"><div class="t-hero-name">${F.esc(t.name)} ${tagPill(t)}</div>
          <div class="t-hero-desc">${t.description ? F.esc(t.description) : ""}</div>
          <div class="t-stats"><span><b>${members.length}</b>/${CAP} members</span><span><b>${total.toLocaleString()}</b> season points</span><span>${t.join_mode === "open" ? "🔓 Open" : "✋ Request to join"}</span></div>
          <div class="t-bar"><i style="width:${(members.length / CAP) * 100}%"></i></div></div>
        <div class="t-hero-act">${act}<button class="btn btn-ghost" id="t-share">${F.icons.copy}Invite link</button></div></div>
      <div class="panel"><div class="subtabs" id="tp-tabs"><button data-t="members">Members</button>${myRole ? `<button data-t="calls">🎯 Calls</button><button data-t="chat">💬 Team chat</button><button data-t="voice">🎙️ Voice <span class="tab-count" id="v-n"></span></button>` : ""}${isMgr ? `<button data-t="requests">Requests <span class="tab-count" id="rq-n"></span></button>` : ""}</div><div id="tp-body"></div></div>`;
    const ids = { join: F.$("#t-join"), leave: F.$("#t-leave"), cancel: F.$("#t-cancel"), edit: F.$("#t-edit"), signin: F.$("#t-signin") };
    if (ids.signin) ids.signin.onclick = F.auth.signIn;
    if (ids.join) ids.join.onclick = async () => { const { data, error } = await F.sb.rpc("team_join", { tid: t.id }); if (error) return err(error); F.toast(data === "joined" ? `Welcome to ${F.esc(t.name)} 🎉` : "Request sent ✋", data === "joined" ? "" : "An owner or officer will review it."); F.teamsForget && F.teamsForget(); teamPage(t.id); };
    if (ids.cancel) ids.cancel.onclick = async () => { await F.sb.rpc("team_cancel_request", { tid: t.id }); teamPage(t.id); };
    if (ids.leave) ids.leave.onclick = async () => {
      const b = ids.leave; if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = myRole === "owner" && members.length > 1 ? "Leave? Ownership passes on — click again" : "Click again to leave"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Leave team"; } }, 3500); return; }
      const { error } = await F.sb.rpc("team_leave"); if (error) return err(error); F.toast("You left the team", ""); F.teamsForget && F.teamsForget(); location.href = "teams.html"; };
    if (ids.edit) ids.edit.onclick = () => teamForm(t);
    F.$("#t-share").onclick = () => F.copy(new URL("teams.html?t=" + t.id, location.href).href, "Team link copied");
    let tab = ["chat", "calls", "voice"].includes(F.qs("tab")) && myRole ? F.qs("tab") : "members";
    const tabs = F.$("#tp-tabs");
    const draw = () => {
      F.$$("button", tabs).forEach((b) => b.classList.toggle("active", b.dataset.t === tab));
      if (tab === "members") drawMembers(t, members, pts, myRole);
      else if (tab === "chat") drawChat(t);
      else if (tab === "calls") drawCalls(t);
      else if (tab === "voice") drawVoice(t);
      else drawRequests(t);
    };
    tabs.onclick = (e) => { const b = e.target.closest("[data-t]"); if (!b) return; tab = b.dataset.t; draw(); };
    draw();
    if (myRole) voiceWatch(t);
    if (isMgr) { const { count } = await F.sb.from("team_requests").select("user_id", { count: "exact", head: true }).eq("team_id", t.id); const n = F.$("#rq-n"); if (n && count) n.textContent = count; }
  }

  function drawMembers(t, members, pts, myRole) {
    const box = F.$("#tp-body");
    const order = { owner: 0, officer: 1, member: 2 };
    const list = members.slice().sort((a, b) => order[a.role] - order[b.role] || (pts.get(b.user_id) || 0) - (pts.get(a.user_id) || 0));
    box.innerHTML = `<div class="t-members">${list.map((m) => { const p = P(m.user_id), p2 = pts.get(m.user_id) || 0, rk = F.season ? F.season.rankOf(p2) : null, self = me()?.id === m.user_id;
      const canKick = !self && (myRole === "owner" || (myRole === "officer" && m.role === "member"));
      const own = myRole === "owner" && !self;
      return `<div class="t-mem" data-u="${m.user_id}"><a class="t-mem-who" href="profile.html?a=${F.esc(p.wallet)}"><img src="${F.avatarOf(p)}" alt=""><span class="n">${F.displayName(p)}</span></a>
        <span class="t-role r-${m.role}">${ROLE[m.role]}</span>${rk ? `<span class="rk rk-${rk.id}">${rk.ic} ${p2.toLocaleString()}</span>` : ""}
        <span style="flex:1"></span>
        ${own ? (m.role === "member" ? `<button class="btn btn-ghost btn-sm" data-ma="officer">Make officer</button>` : `<button class="btn btn-ghost btn-sm" data-ma="member">Remove officer</button>`) + `<button class="btn btn-ghost btn-sm" data-ma="owner">Make owner</button>` : ""}
        ${canKick ? `<button class="btn btn-ghost btn-sm danger" data-ma="kick">Remove</button>` : ""}</div>`; }).join("")}</div>`;
    box.onclick = async (e) => {
      const b = e.target.closest("[data-ma]"); if (!b) return;
      const uid = b.closest("[data-u]").dataset.u, a = b.dataset.ma;
      if ((a === "kick" || a === "owner") && !b.dataset.armed) { b.dataset.armed = 1; const txt = b.textContent; b.textContent = "Click again to confirm"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = txt; } }, 3500); return; }
      const { error } = a === "kick" ? await F.sb.rpc("team_kick", { uid }) : await F.sb.rpc("team_set_role", { uid, new_role: a });
      if (error) return err(error);
      teamPage(t.id);
    };
  }

  async function drawRequests(t) {
    const box = F.$("#tp-body"); box.innerHTML = `<div class="skeleton" style="height:100px"></div>`;
    const { data } = await F.sb.from("team_requests").select("user_id,created_at").eq("team_id", t.id).order("created_at");
    const rows = data || [];
    await loadProfs(rows.map((r) => r.user_id));
    box.innerHTML = rows.length ? `<div class="t-members">${rows.map((r) => { const p = P(r.user_id); return `<div class="t-mem" data-u="${r.user_id}"><a class="t-mem-who" href="profile.html?a=${F.esc(p.wallet)}"><img src="${F.avatarOf(p)}" alt=""><span class="n">${F.displayName(p)}</span></a><span class="muted" style="font-size:12px">${F.ago(Date.parse(r.created_at))} ago</span><span style="flex:1"></span><button class="btn btn-ghost btn-sm" data-rq="0">Decline</button><button class="btn btn-primary btn-sm" data-rq="1">Accept</button></div>`; }).join("")}</div>`
      : `<p class="muted" style="padding:10px">No pending requests.</p>`;
    box.onclick = async (e) => {
      const b = e.target.closest("[data-rq]"); if (!b) return;
      const { error } = await F.sb.rpc("team_answer", { uid: b.closest("[data-u]").dataset.u, accept: b.dataset.rq === "1" });
      if (error) return err(error);
      teamPage(t.id);
    };
  }

  function drawChat(t) {
    const box = F.$("#tp-body");
    box.innerHTML = `<div class="t-chat"><div class="room-list" id="tc-list" style="height:420px"><div class="muted" style="margin:auto">Loading…</div></div>
      <form class="room-form" id="tc-form"><input maxlength="500" placeholder="Message your team…" autocomplete="off"><button class="btn btn-primary btn-sm">${F.icons.send}</button></form></div>`;
    const list = F.$("#tc-list"), seen = new Set(); let msgs = [];
    const SELC = "id,body,created_at,user_id,profiles!team_chat_user_id_fkey(id,wallet,name,avatar_url)";
    const row = (m) => { const p = m.profiles || P(m.user_id); return `<div class="room-msg"><a href="profile.html?a=${F.esc(p.wallet || "")}"><img src="${F.avatarOf(p)}" alt=""></a><div class="room-b"><div class="room-top"><a href="profile.html?a=${F.esc(p.wallet || "")}" class="room-n">${F.displayName(p)}</a><span class="room-t">${new Date(m.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</span></div><div class="room-txt">${F.esc(m.body)}</div></div></div>`; };
    const draw = (stick) => { list.innerHTML = msgs.length ? msgs.map(row).join("") : `<div class="room-empty">Say hi to your team 👋</div>`; if (stick) list.scrollTop = list.scrollHeight; };
    const add = (m) => { if (seen.has(m.id)) return; seen.add(m.id); const near = list.scrollHeight - list.scrollTop - list.clientHeight < 80; msgs.push(m); draw(near); };
    F.sb.from("team_chat").select(SELC).eq("team_id", t.id).order("created_at", { ascending: false }).limit(100).then(({ data }) => { msgs = (data || []).reverse(); msgs.forEach((m) => seen.add(m.id)); draw(true); });
    if (S.chan) F.sb.removeChannel(S.chan);
    S.chan = F.sb.channel("team-" + t.id).on("postgres_changes", { event: "INSERT", schema: "public", table: "team_chat", filter: `team_id=eq.${t.id}` }, async ({ new: m }) => {
      if (seen.has(m.id)) return; const { data } = await F.sb.from("team_chat").select(SELC).eq("id", m.id).single(); if (data) add(data);
    }).subscribe();
    F.$("#tc-form").onsubmit = async (e) => {
      e.preventDefault(); const inp = F.$("input", e.target), body = inp.value.trim(); if (!body) return; inp.value = "";
      const { data, error } = await F.sb.from("team_chat").insert({ team_id: t.id, user_id: me().id, body }).select(SELC).single();
      if (error) { inp.value = body; return err(error); }
      add(data); list.scrollTop = list.scrollHeight;
    };
  }

  /* ================= team calls ================= */
  async function drawCalls(t) {
    const box = F.$("#tp-body");
    box.innerHTML = `<form class="tcall-form" id="tcall-form"><input class="input" id="tcall-ca" placeholder="Paste a coin contract address to call it to your team…" autocomplete="off">
        <input class="input" id="tcall-note" maxlength="140" placeholder="Why? (optional)"><button class="btn btn-primary">🎯 Call</button></form>
      <div class="tcall-top" id="tcall-top"></div><div id="tcall-list"><div class="skeleton" style="height:160px"></div></div>`;
    F.$("#tcall-form").onsubmit = async (e) => {
      e.preventDefault();
      const ca = F.$("#tcall-ca").value.trim(), note = F.$("#tcall-note").value.trim();
      if (!F.isAddress(ca)) return F.toast("Paste a valid contract address", "", "warn");
      const c = (await F.coinsByMint([ca])).get(ca);
      const { error } = await F.sb.from("team_calls").insert({ team_id: t.id, user_id: me().id, mint: ca, symbol: (c?.symbol || "").slice(0, 20) || null, note: note || null });
      if (error) return err(error);
      F.toast("Called to your team 🎯", c ? `$${F.esc(c.symbol)}` : ""); F.$("#tcall-ca").value = ""; F.$("#tcall-note").value = ""; loadCalls(t);
    };
    loadCalls(t);
  }
  async function loadCalls(t) {
    const { data } = await F.sb.from("team_calls").select("id,mint,symbol,note,created_at,user_id,profiles!team_calls_user_id_fkey(id,wallet,name,avatar_url)").eq("team_id", t.id).order("created_at", { ascending: false }).limit(50);
    const rows = data || [], el = F.$("#tcall-list"); if (!el) return;
    if (!rows.length) { el.innerHTML = `<div class="empty-state" style="padding:28px"><b>No calls yet</b>Found a coin? Call it to your team — everyone gets notified. You can also use “🎯 Call to team” on any coin page.</div>`; F.$("#tcall-top").innerHTML = ""; return; }
    const coins = await F.coinsByMint(rows.map((r) => r.mint));
    const myRoleNow = S.myTeam?.role;
    el.innerHTML = `<div class="tcalls">${rows.map((r) => { const c = coins.get(r.mint), p = r.profiles || P(r.user_id);
      return `<div class="tcall" data-cid="${r.id}"><a href="coin.html?c=${F.esc(r.mint)}"><img class="tcall-img" src="${F.img(c?.image, r.mint)}" alt=""></a>
        <div class="tcall-main"><div class="tcall-top-row"><a href="coin.html?c=${F.esc(r.mint)}" class="tcall-sym">$${F.esc(c?.symbol || r.symbol || F.short(r.mint))}</a><span class="muted" style="font-size:12px">${c ? F.usd(c.mcap) + " MC now" : ""}</span><span class="tcall-perf" data-m="${F.esc(r.mint)}" data-at="${Date.parse(r.created_at)}"></span></div>
          <div class="tcall-by"><img src="${F.avatarOf(p)}" alt=""><a href="profile.html?a=${F.esc(p.wallet || "")}">${F.displayName(p)}</a><span class="muted">· ${F.ago(Date.parse(r.created_at))} ago</span></div>
          ${r.note ? `<div class="tcall-note">“${F.esc(r.note)}”</div>` : ""}</div>
        <div class="tcall-act">${c && F.qbBtn ? F.qbBtn(c).replace('class="qb-btn"', 'class="qb-btn inline"') : ""}${r.user_id === me()?.id || ["owner", "officer"].includes(myRoleNow) ? `<button class="msg-del" style="opacity:1" data-cdel="${r.id}" title="Delete">×</button>` : ""}</div></div>`; }).join("")}</div>`;
    el.onclick = async (e) => { const d = e.target.closest("[data-cdel]"); if (!d) return; await F.sb.from("team_calls").delete().eq("id", Number(d.dataset.cdel)); loadCalls(t); };
    // performance since the call, from public price history (can't be faked)
    const perf = {};
    for (const pe of F.$$(".tcall-perf", el)) {
      const at = Number(pe.dataset.at);
      if (Date.now() - at < 5 * 60e3) { pe.innerHTML = `<span class="call-pill neutral">📍 new</span>`; continue; }
      const r = await F.callResult(pe.dataset.m, at).catch(() => null);
      if (!r) continue;
      const up = r.chg >= 0; pe.innerHTML = `<span class="call-pill ${up ? "up" : "down"}">${up ? "📈" : "📉"} <b>${F.fmtPct(r.chg)}</b></span>`;
      const row = rows.find((x) => String(x.id) === pe.closest("[data-cid]").dataset.cid);
      if (row) { const q = perf[row.user_id] || (perf[row.user_id] = { n: 0, best: -Infinity, sum: 0 }); q.n++; q.sum += r.chg; q.best = Math.max(q.best, r.chg); }
    }
    const top = Object.entries(perf).sort((a, b) => b[1].best - a[1].best).slice(0, 3);
    const tt = F.$("#tcall-top");
    if (tt) tt.innerHTML = top.length ? `<div class="tcall-leaders"><b>Best callers</b>${top.map(([u, q], i) => `<span>${["🥇", "🥈", "🥉"][i]} ${F.displayName(P(u))} <b class="${q.best >= 0 ? "up" : "down"}">${F.fmtPct(q.best)}</b> <span class="muted">(${q.n} call${q.n > 1 ? "s" : ""})</span></span>`).join("")}</div>` : "";
  }

  /* ================= team voice (WebRTC, peer-to-peer, private channel) ================= */
  const VMAX = 10;
  const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }];
  const V = { ch: null, team: null, joined: false, stream: null, peers: new Map(), muted: false, state: {}, ctx: null, meters: new Map(), raf: null };
  function vPeople() { return Object.entries(V.state).map(([id, arr]) => ({ id, ...(arr[0] || {}) })); }
  function voiceWatch(t) {
    if (V.ch && V.team === t.id) return;
    V.team = t.id;
    V.ch = F.sb.channel("voice-team-" + t.id, { config: { private: true, broadcast: { self: false }, presence: { key: me().id } } });
    V.ch.on("presence", { event: "sync" }, onSync)
      .on("broadcast", { event: "sig" }, ({ payload }) => onSignal(payload))
      .subscribe((st) => { if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") { V.err = true; paintVoice(); } });
    window.addEventListener("beforeunload", voiceLeave);
  }
  function onSync() {
    V.state = V.ch.presenceState();
    const ids = Object.keys(V.state);
    const n = F.$("#v-n"); if (n) n.textContent = ids.length || "";
    if (V.joined) {
      ids.filter((id) => id !== me().id && !V.peers.has(id) && me().id < id).forEach((id) => makePeer(id, true));
      [...V.peers.keys()].filter((id) => !ids.includes(id)).forEach(dropPeer);
    }
    paintVoice();
  }
  function send(to, data) { V.ch?.send({ type: "broadcast", event: "sig", payload: { from: me().id, to, ...data } }); }
  function makePeer(id, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = { pc, q: [], audio: null };
    V.peers.set(id, peer);
    V.stream.getTracks().forEach((tr) => pc.addTrack(tr, V.stream));
    pc.onicecandidate = (e) => { if (e.candidate) send(id, { ice: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      if (!peer.audio) { peer.audio = new Audio(); peer.audio.autoplay = true; peer.audio.setAttribute("playsinline", ""); }
      peer.audio.srcObject = e.streams[0]; peer.audio.play().catch(() => {});
      meter(id, e.streams[0]);
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") { dropPeer(id); if (initiator && V.joined) setTimeout(() => { if (V.state[id] && !V.peers.has(id)) makePeer(id, true); }, 1500); } paintVoice(); };
    if (initiator) pc.onnegotiationneeded = async () => { try { await pc.setLocalDescription(await pc.createOffer()); send(id, { sdp: pc.localDescription.toJSON() }); } catch {} };
    return peer;
  }
  async function onSignal(p) {
    if (!V.joined || p.to !== me().id) return;
    let peer = V.peers.get(p.from);
    if (!peer) peer = makePeer(p.from, false);
    const pc = peer.pc;
    try {
      if (p.sdp) {
        await pc.setRemoteDescription(p.sdp);
        if (p.sdp.type === "offer") { await pc.setLocalDescription(await pc.createAnswer()); send(p.from, { sdp: pc.localDescription.toJSON() }); }
        for (const c of peer.q.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (p.ice) { pc.remoteDescription ? await pc.addIceCandidate(p.ice).catch(() => {}) : peer.q.push(p.ice); }
    } catch {}
  }
  function dropPeer(id) { const p = V.peers.get(id); if (!p) return; try { p.pc.close(); } catch {} if (p.audio) p.audio.srcObject = null; V.peers.delete(id); V.meters.delete(id); }
  function meter(id, stream) {
    try {
      V.ctx = V.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const src = V.ctx.createMediaStreamSource(stream), an = V.ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      V.meters.set(id, { an, buf: new Uint8Array(an.fftSize) });
      if (!V.raf) { const loop = () => { V.meters.forEach((m, k) => { m.an.getByteTimeDomainData(m.buf); let s = 0; for (const v of m.buf) s += (v - 128) ** 2; const on = Math.sqrt(s / m.buf.length) > 6; const el = document.querySelector(`[data-vu="${k}"]`); if (el) el.classList.toggle("speaking", on && !(k === me().id && V.muted)); }); V.raf = requestAnimationFrame(loop); }; V.raf = requestAnimationFrame(loop); }
    } catch {}
  }
  async function voiceJoin() {
    if (V.joined) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return F.toast("Voice isn't supported in this browser", "Try Chrome, Edge, Brave or Safari.", "warn");
    if (Object.keys(V.state).length >= VMAX) return F.toast(`Voice room is full (${VMAX})`, "Try again when someone leaves.", "warn");
    try { V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { return F.toast("Microphone blocked", "Allow microphone access in your browser to talk.", "warn"); }
    V.joined = true; V.muted = false;
    meter(me().id, V.stream);
    const p = me();
    await V.ch.track({ name: p.name || F.short(p.wallet), avatar: p.avatar_url || null, wallet: p.wallet, muted: false, at: Date.now() });
    F.toast("You joined voice 🎙️", "Your teammates can hear you now.");
    paintVoice();
  }
  async function voiceLeave() {
    if (!V.joined) return;
    V.joined = false;
    [...V.peers.keys()].forEach(dropPeer);
    V.stream?.getTracks().forEach((t) => t.stop()); V.stream = null; V.meters.clear();
    try { await V.ch?.untrack(); } catch {}
    paintVoice();
  }
  async function voiceMute() {
    V.muted = !V.muted;
    V.stream?.getAudioTracks().forEach((t) => (t.enabled = !V.muted));
    const p = me();
    await V.ch.track({ name: p.name || F.short(p.wallet), avatar: p.avatar_url || null, wallet: p.wallet, muted: V.muted, at: Date.now() });
    paintVoice();
  }
  function drawVoice() { paintVoice(true); }
  function paintVoice(force) {
    const box = F.$("#tp-body"); if (!box || (!force && !box.querySelector(".voice"))) return;
    const people = vPeople();
    box.innerHTML = `<div class="voice">
      <div class="voice-head"><div><b>🎙️ Team voice</b><div class="muted" style="font-size:12px">${people.length}/${VMAX} in voice · peer-to-peer, only your team can join</div></div>
        <div class="voice-ctl">${V.joined ? `<button class="btn btn-ghost" id="v-mute">${V.muted ? "🔇 Unmute" : "🎤 Mute"}</button><button class="btn btn-danger" id="v-leave">Leave voice</button>` : `<button class="btn btn-primary" id="v-join" ${people.length >= VMAX ? "disabled" : ""}>🎙️ Join voice</button>`}</div></div>
      ${V.err ? `<p class="down" style="font-size:13px">Couldn't connect to the voice room. Refresh the page and try again.</p>` : ""}
      <div class="voice-grid">${people.length ? people.map((u) => { const self = u.id === me().id, conn = self ? "" : V.peers.get(u.id)?.pc.connectionState;
        return `<div class="voice-tile ${u.muted ? "muted" : ""}" data-vu="${F.esc(u.id)}"><div class="voice-av"><img src="${F.esc(u.avatar || F.avatar(u.wallet || u.id))}" alt=""></div>
          <div class="voice-n">${F.esc(u.name || "Member")}${self ? " (you)" : ""}</div>
          <div class="voice-s">${u.muted ? "🔇 muted" : V.joined && !self && conn && conn !== "connected" ? "connecting…" : "🎤"}</div></div>`; }).join("")
        : `<div class="empty-state" style="padding:24px;grid-column:1/-1"><b>Nobody's talking yet</b>Join voice and your teammates will see you here.</div>`}</div>
      <p class="note" style="margin-top:10px">Stay on this page while you talk — leaving the team page ends your call. Up to ${VMAX} people can talk at once.</p></div>`;
    const j = F.$("#v-join"), mu = F.$("#v-mute"), lv = F.$("#v-leave");
    if (j) j.onclick = voiceJoin; if (mu) mu.onclick = voiceMute; if (lv) lv.onclick = voiceLeave;
  }

  /* ================= boot ================= */
  let booted = null;
  function boot() {
    const t = Number(F.qs("t"));
    const key = (me()?.id || "anon") + ":" + (t || "");
    if (booted === key) return; booted = key;
    t ? teamPage(t) : overview();
  }
  document.addEventListener("flow:auth", () => { booted = null; boot(); });
  setTimeout(boot, 900);
})();
