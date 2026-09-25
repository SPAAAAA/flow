/* FLOW direct messages: members who follow each other can chat privately */
(function () {
  const F = FLOW;
  F.layout("messages");
  const root = F.$("#dmpage");
  const me = () => F.auth.profile;
  const S = { threads: [], profiles: new Map(), open: null, msgs: [], booted: false };

  if (!F.auth.enabled) { root.innerHTML = `<div class="empty-state"><b>Messages aren't set up yet</b>Connect Supabase in config.js.</div>`; return; }

  const prof = (id) => S.profiles.get(id) || { id };
  async function loadProfiles(ids) {
    const need = [...new Set(ids)].filter((i) => i && !S.profiles.has(i));
    if (!need.length) return;
    const { data } = await F.sb.from("profiles").select("id,wallet,name,avatar_url").in("id", need);
    (data || []).forEach((p) => S.profiles.set(p.id, p));
  }

  function shell() {
    root.innerHTML = `<div class="dm-wrap">
      <aside class="dm-list"><div class="dm-list-head"><b>Messages</b><button class="btn btn-ghost btn-sm" id="dm-new">+ New</button></div><div id="dm-threads"><div class="skeleton" style="height:64px;margin:8px"></div></div></aside>
      <section class="dm-conv" id="dm-conv"><div class="dm-empty"><div style="font-size:34px">💬</div><b>Your messages</b><p class="muted">Message people who follow you back. Pick a conversation, or start a new one.</p></div></section>
    </div>`;
    F.$("#dm-new").onclick = newMessage;
  }

  async function loadThreads() {
    const { data, error } = await F.sb.rpc("dm_threads");
    if (error) { F.$("#dm-threads").innerHTML = `<p class="muted" style="padding:12px">Couldn't load messages.</p>`; return; }
    S.threads = data || [];
    await loadProfiles(S.threads.map((t) => t.other_id));
    renderThreads();
  }
  function renderThreads() {
    const el = F.$("#dm-threads"); if (!el) return;
    el.innerHTML = S.threads.length ? S.threads.map((t) => { const p = prof(t.other_id); return `<a class="dm-thread ${S.open === t.other_id ? "active" : ""}" href="messages.html?to=${t.other_id}" data-open="${t.other_id}">
        <img src="${F.avatarOf(p)}" alt=""><div class="dm-t-main"><div class="dm-t-top"><b>${F.displayName(p)}</b><span class="muted">${F.ago(Date.parse(t.last_at))}</span></div>
        <div class="dm-t-last ${t.unread ? "unread" : ""}">${t.last_from_me ? "You: " : ""}${F.esc(t.last_body.slice(0, 60))}</div></div>
        ${t.unread ? `<span class="nav-badge">${t.unread}</span>` : ""}</a>`; }).join("")
      : `<p class="muted" style="padding:14px;font-size:13px">No conversations yet. Tap <b>+ New</b> to message someone who follows you back.</p>`;
  }
  F.$("#dmpage").addEventListener("click", (e) => {
    const a = e.target.closest("[data-open]"); if (!a) return;
    e.preventDefault(); openConv(a.dataset.open);
  });

  async function mutuals() {
    await F.follows.load();
    const mine = F.follows.ids(); if (!mine.length) return [];
    const { data } = await F.sb.from("follows").select("follower_id").eq("following_id", me().id).in("follower_id", mine);
    const ids = (data || []).map((r) => r.follower_id);
    await loadProfiles(ids);
    return ids.map(prof);
  }
  async function newMessage() {
    const m = F.h(`<div class="modal-bg"><div class="modal" style="max-width:420px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h3 style="margin:0">New message</h3><button class="icon-btn" data-x>${F.icons.close}</button></div>
      <p style="margin:0 0 10px;font-size:13px">You can message members who follow you back.</p>
      <div class="follow-list"><div class="skeleton" style="height:100px"></div></div></div></div>`);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); const b = e.target.closest("[data-pick]"); if (b) { m.remove(); openConv(b.dataset.pick); } });
    document.body.appendChild(m);
    const list = await mutuals();
    F.$(".follow-list", m).innerHTML = list.length ? list.map((p) => `<button class="follow-row" data-pick="${p.id}" style="width:100%;text-align:left"><span class="follow-who"><img src="${F.avatarOf(p)}" alt=""><span><span class="n">${F.displayName(p)}</span><span class="s mono" style="display:block">${F.short(p.wallet)}</span></span></span><span class="muted">Message →</span></button>`).join("")
      : `<p class="muted">Nobody yet. Follow people, and once they follow you back you can message them.</p>`;
  }

  async function openConv(otherId) {
    if (!otherId) return;
    S.open = otherId; F.dm.openWith = otherId;
    history.replaceState(null, "", "messages.html?to=" + otherId);
    await loadProfiles([otherId]);
    const p = prof(otherId);
    const { data: ok } = await F.sb.rpc("can_dm", { a: me().id, b: otherId });
    const conv = F.$("#dm-conv");
    conv.classList.add("open");
    conv.innerHTML = `<div class="dm-head"><button class="icon-btn dm-back" id="dm-back">←</button>
        <a href="profile.html?a=${F.esc(p.wallet || "")}" class="follow-who"><img src="${F.avatarOf(p)}" alt=""><div><div class="n">${F.displayName(p)} ${F.founderBadge(p.wallet, true)}</div><div class="s mono">${F.short(p.wallet || "")}</div></div></a></div>
      <div class="dm-msgs" id="dm-msgs"><div class="muted" style="margin:auto">Loading…</div></div>
      ${ok ? `<form class="dm-form" id="dm-form"><input maxlength="1000" placeholder="Write a message…" autocomplete="off"><button class="btn btn-primary btn-sm">${F.icons.send}</button></form>`
           : `<div class="dm-locked">You can message each other once you both follow each other. ${F.followBtn(otherId)}</div>`}`;
    F.$("#dm-back").onclick = () => { conv.classList.remove("open"); S.open = null; F.dm.openWith = null; renderThreads(); };
    renderThreads();
    const { data } = await F.sb.from("dm_messages").select("id,sender_id,recipient_id,body,created_at,read")
      .or(`and(sender_id.eq.${me().id},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${me().id})`)
      .order("created_at", { ascending: false }).limit(150);
    S.msgs = (data || []).reverse();
    drawMsgs(true);
    markRead(otherId);
    const f = F.$("#dm-form");
    if (f) { const inp = F.$("input", f); inp.focus(); f.onsubmit = (e) => { e.preventDefault(); send(otherId, inp); }; }
  }
  function msgBubble(m) {
    const mine = m.sender_id === me().id;
    return `<div class="dm-msg ${mine ? "mine" : ""}" title="${new Date(m.created_at).toLocaleString()}"><div class="dm-bubble">${F.esc(m.body)}</div>${!mine && F.reportBtn ? F.reportBtn("dm", m.id, "msg-rep") : ""}<span class="dm-time">${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>`;
  }
  function drawMsgs(scroll) {
    const el = F.$("#dm-msgs"); if (!el) return;
    el.innerHTML = S.msgs.length ? S.msgs.map(msgBubble).join("") : `<div class="muted" style="margin:auto;text-align:center">No messages yet — say hi 👋</div>`;
    if (scroll) el.scrollTop = el.scrollHeight;
  }
  async function markRead(otherId) {
    const unread = S.msgs.some((m) => m.sender_id === otherId && !m.read);
    if (!unread) return;
    await F.sb.from("dm_messages").update({ read: true }).eq("sender_id", otherId).eq("recipient_id", me().id).eq("read", false);
    S.msgs.forEach((m) => { if (m.sender_id === otherId) m.read = true; });
    const t = S.threads.find((x) => x.other_id === otherId); if (t) t.unread = 0;
    renderThreads(); F.dm.refresh && F.dm.refresh();
  }
  async function send(otherId, inp) {
    const body = inp.value.trim(); if (!body) return;
    inp.value = "";
    const { data, error } = await F.sb.from("dm_messages").insert({ sender_id: me().id, recipient_id: otherId, body }).select().single();
    if (error) { inp.value = body; return F.toast("Message not sent", F.esc(/row-level|policy/i.test(error.message) ? "You can only message people who follow you back." : error.message), "warn"); }
    addMsg(data);
  }
  function addMsg(m) {
    const other = m.sender_id === me().id ? m.recipient_id : m.sender_id;
    // thread list
    let t = S.threads.find((x) => x.other_id === other);
    if (!t) { t = { other_id: other, unread: 0 }; S.threads.unshift(t); loadProfiles([other]).then(renderThreads); }
    t.last_body = m.body; t.last_at = m.created_at; t.last_from_me = m.sender_id === me().id;
    S.threads.sort((a, b) => Date.parse(b.last_at) - Date.parse(a.last_at));
    if (S.open === other) {
      if (!S.msgs.some((x) => x.id === m.id)) { S.msgs.push(m); const el = F.$("#dm-msgs"); const near = el && el.scrollHeight - el.scrollTop - el.clientHeight < 120; drawMsgs(near || m.sender_id === me().id); }
      if (m.sender_id === other) markRead(other);
    } else if (m.sender_id === other) t.unread = (t.unread || 0) + 1;
    renderThreads();
  }
  document.addEventListener("flow:dm", (e) => { if (me()) addMsg(e.detail); });

  function signedOut() {
    root.innerHTML = `<div class="empty-state" style="max-width:520px;margin:40px auto"><b>Sign in to see your messages</b>Chat privately with members who follow you back.
      <div style="margin-top:14px"><button class="btn btn-primary" id="dm-signin">${F.wallet.connected ? "Sign in with wallet" : "Connect wallet"}</button></div></div>`;
    F.$("#dm-signin").onclick = F.auth.signIn;
  }
  async function boot() {
    if (!me()) { S.booted = false; return signedOut(); }
    if (S.booted) return;
    S.booted = true;
    shell(); await loadThreads();
    const to = F.qs("to"); if (to) openConv(to);
  }
  document.addEventListener("flow:auth", boot);
  document.addEventListener("flow:wallet", () => { if (!me()) signedOut(); });
  setTimeout(boot, 1200);
})();
