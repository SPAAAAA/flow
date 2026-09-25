/* FLOW social: wallet sign-in (Supabase), profiles, online presence, global chat */
(function () {
  const F = FLOW, CFG = F.cfg;
  const enabled = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase?.createClient);
  const A = (F.auth = { enabled, session: null, profile: null, busy: false });
  F.online = new Map(); // wallet -> {wallet,name,avatar}
  let unread = 0;
  const seen = new Set(), cacheById = new Map();

  /* ---------------- display helpers ---------------- */
  const cache = new Map(); // wallet -> profile|null
  F.handleOf = (p) => (p?.name ? p.name.replace(/ /g, "_") : null);
  F.displayName = (p, wallet) => F.esc(p?.name || F.short(p?.wallet || wallet));
  F.avatarOf = (p, wallet) => F.esc(p?.avatar_url || F.avatar(p?.wallet || wallet));
  F.profiles = {
    async byWallets(list) {
      if (!enabled) return {};
      const need = [...new Set(list)].filter((w) => w && !cache.has(w));
      for (let i = 0; i < need.length; i += 100) {
        const chunk = need.slice(i, i + 100);
        const { data } = await F.sb.from("profiles").select("id,wallet,name,avatar_url,last_seen,created_at,bio,banner_url,x_handle,tiktok_handle").in("wallet", chunk);
        chunk.forEach((w) => cache.set(w, null));
        (data || []).forEach((p) => cache.set(p.wallet, p));
      }
      return Object.fromEntries(list.map((w) => [w, cache.get(w) || null]));
    },
    async byWallet(w) { return (await this.byWallets([w]))[w]; },
    remember(p) { if (p?.wallet) cache.set(p.wallet, p); },
  };
  /* Replace short addresses with member names/avatars inside a container.
     Markup: <span data-wname="WALLET">…</span>  <img data-wavatar="WALLET"> */
  F.fillNames = async (root = document) => {
    if (!enabled) return;
    const els = F.$$("[data-wname],[data-wavatar]", root);
    if (!els.length) return;
    const ws = els.map((e) => e.dataset.wname || e.dataset.wavatar);
    try {
      const map = await F.profiles.byWallets(ws);
      els.forEach((e) => {
        const p = map[e.dataset.wname || e.dataset.wavatar]; if (!p) return;
        if (e.dataset.wname && p.name) { e.textContent = p.name; e.classList.remove("mono"); e.classList.add("member-name"); }
        if (e.dataset.wavatar && p.avatar_url) e.src = p.avatar_url;
      });
    } catch {}
  };

  if (!enabled) {
    F.auth.signIn = async () => F.toast("Chat isn't set up yet", "Add your Supabase URL and key in config.js.", "warn");
    return mountChat();
  }

  F.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "flow_auth" },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  /* ---------------- auth ---------------- */
  const emit = () => document.dispatchEvent(new CustomEvent("flow:auth"));
  async function loadProfile() {
    if (!A.session) { A.profile = null; return; }
    const { data, error } = await F.sb.rpc("ensure_profile");
    if (error) { console.warn(error); A.profile = null; return; }
    A.profile = data; F.profiles.remember(data);
  }
  A.signedInWallet = () => A.profile?.wallet || null;
  A.isMe = (wallet) => !!A.profile && A.profile.wallet === wallet;

  A.signIn = async () => {
    if (A.busy) return;
    if (!F.wallet.connected) { F.openWalletModal(); F.toast("Connect your wallet first", "Then sign in to chat and edit your profile."); return; }
    A.busy = true; emit();
    try {
      const { error } = await F.sb.auth.signInWithWeb3({
        chain: "solana",
        statement: `Sign in to ${CFG.siteName}. This only proves you own this wallet. It is free and cannot move funds.`,
        wallet: F.wallet.provider,
      });
      if (error) throw error;
      const { data } = await F.sb.auth.getSession();
      A.session = data.session;
      await loadProfile();
      if (A.profile && A.profile.wallet !== F.wallet.pubkey) { await A.signOut(); throw new Error("Signed-in wallet doesn't match the connected wallet"); }
      F.toast("Signed in", A.profile ? `Welcome${A.profile.name ? ", " + F.esc(A.profile.name) : ""}!` : "");
      trackPresence();
    } catch (e) {
      console.error("[FLOW] sign-in failed", e);
      const m = e.message || String(e);
      F.toast("Sign-in not completed", /reject|cancel|denied|declin/i.test(m) ? "You cancelled the signature." : F.esc(m), /reject|cancel/i.test(m) ? "warn" : "err");
    } finally { A.busy = false; emit(); }
  };
  A.signOut = async () => { try { await F.sb.auth.signOut(); } catch {} A.session = null; A.profile = null; trackPresence(); emit(); };

  A.updateProfile = async (fields) => {
    const { data, error } = await F.sb.from("profiles").update(fields).eq("id", A.profile.id).select().single();
    if (error) {
      if (error.code === "23505") throw new Error("That name is already taken");
      if (error.code === "23514") throw new Error("Names must be 2–20 characters: letters, numbers, spaces, _ . -");
      throw new Error(error.message);
    }
    A.profile = data; F.profiles.remember(data); trackPresence(); emit();
    return data;
  };
  A.uploadAvatar = async (file) => {
    const blob = await resizeImage(file, 256);
    const path = `${A.profile.id}/avatar-${Date.now()}.webp`;
    const { error } = await F.sb.storage.from("avatars").upload(path, blob, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
    if (error) throw new Error(error.message);
    return F.sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  };
  A.uploadBanner = async (file) => {
    const blob = await resizeCover(file, 1200, 300);
    const path = `${A.profile.id}/banner-${Date.now()}.webp`;
    const { error } = await F.sb.storage.from("avatars").upload(path, blob, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
    if (error) throw new Error(error.message);
    return F.sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  };
  F.resizeCover = resizeCover;
  function resizeCover(file, w, h, quality = 0.85) {
    return new Promise((res, rej) => {
      if (!/^image\//.test(file.type)) return rej(new Error("Please choose an image file"));
      if (file.size > 10 * 1024 * 1024) return rej(new Error("Image is too large (max 10 MB)"));
      const img = new Image();
      img.onload = () => {
        const scale = Math.max(w / img.width, h / img.height);
        const sw = w / scale, sh = h / scale;
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
        c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't process image"))), "image/webp", quality);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => rej(new Error("Couldn't read that image"));
      img.src = URL.createObjectURL(file);
    });
  }
  function resizeImage(file, size) {
    return new Promise((res, rej) => {
      if (!/^image\//.test(file.type)) return rej(new Error("Please choose an image file"));
      if (file.size > 10 * 1024 * 1024) return rej(new Error("Image is too large (max 10 MB)"));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = c.height = size;
        const s = Math.min(img.width, img.height);
        c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't process image"))), "image/webp", 0.88);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => rej(new Error("Couldn't read that image"));
      img.src = URL.createObjectURL(file);
    });
  }

  /* keep session in sync with the connected wallet */
  document.addEventListener("flow:wallet", async () => {
    if (A.profile && F.wallet.pubkey && A.profile.wallet !== F.wallet.pubkey) { await A.signOut(); F.toast("Signed out", "You switched wallets — sign in again to chat."); }
    emit();
  });

  /* ---------------- presence (who's online) ---------------- */
  const anonKey = "v_" + Math.random().toString(36).slice(2);
  let presence = null, presenceReady = false;
  function presencePayload() {
    return A.profile ? { wallet: A.profile.wallet, name: A.profile.name || null, avatar: A.profile.avatar_url || null, at: Date.now() } : null;
  }
  function startPresence() {
    presence = F.sb.channel("flow-online", { config: { presence: { key: anonKey } } });
    presence.on("presence", { event: "sync" }, () => {
      const st = presence.presenceState();
      F.online.clear(); F.onlineVisitors = Object.keys(st).length;
      Object.values(st).forEach((arr) => arr.forEach((m) => { if (m.wallet) F.online.set(m.wallet, m); }));
      document.dispatchEvent(new CustomEvent("flow:online"));
    });
    presence.subscribe((s) => { if (s === "SUBSCRIBED") { presenceReady = true; trackPresence(); } });
  }
  async function trackPresence() {
    if (!presence || !presenceReady) return;
    const p = presencePayload();
    try { await presence.track(p || { visitor: true }); } catch {}
  }
  setInterval(() => { if (A.profile && !document.hidden) F.sb.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", A.profile.id).then(() => {}); }, 4 * 60 * 1000);

  /* ---------------- boot ---------------- */
  (async () => {
    const { data } = await F.sb.auth.getSession();
    A.session = data.session;
    if (A.session) await loadProfile();
    emit();
    startPresence();
  })();
  F.sb.auth.onAuthStateChange((_e, session) => { A.session = session; if (!session) { A.profile = null; emit(); } });

  mountChat();

  /* ================= Global chat panel ================= */
  function mountChat() {
    const start = () => {
      if (!F.$(".app")) return setTimeout(start, 30);
      const open = window.innerWidth >= 1100 && F.store.get("chatOpen", window.innerWidth >= 1600);
      const panel = F.h(`<aside class="chat ${open ? "open" : ""}" id="chat">
        <div class="chat-head">
          <div><b>Global chat</b><div class="muted" id="chat-online" style="font-size:12px">${enabled ? "Connecting…" : "Not set up"}</div></div>
          <button class="icon-btn" id="chat-close" title="Hide chat">${F.icons.close}</button>
        </div>
        <div class="chat-list" id="chat-list">${enabled ? '<div class="chat-empty">Loading messages…</div>' : '<div class="chat-empty">Chat needs Supabase. Add <code>supabaseUrl</code> and <code>supabaseAnonKey</code> in config.js.</div>'}</div>
        <div class="chat-new hidden" id="chat-new">New messages ↓</div>
        <div class="chat-foot" id="chat-foot"></div>
      </aside>`);
      const fab = F.h(`<button class="chat-fab" id="chat-fab" title="Open chat">${F.icons.chat}<span class="chat-badge hidden" id="chat-badge"></span></button>`);
      document.body.append(panel, fab);
      document.body.classList.toggle("chat-open", open);
      const setOpen = (v) => {
        panel.classList.toggle("open", v); document.body.classList.toggle("chat-open", v);
        F.store.set("chatOpen", v);
        if (v) { unread = 0; badge(); scrollBottom(true); }
      };
      F.$("#chat-close").onclick = () => setOpen(false);
      fab.onclick = () => setOpen(true);
      renderFoot();
      document.addEventListener("flow:auth", renderFoot);
      document.addEventListener("flow:wallet", renderFoot);
      const showOnline = () => {
        if (F.onlineVisitors == null) return;
        const n = F.online.size, v = F.onlineVisitors || 0;
        F.$("#chat-online").innerHTML = `<span class="online-dot"></span>${n} member${n === 1 ? "" : "s"} online · ${v} viewing`;
      };
      document.addEventListener("flow:online", showOnline);
      showOnline();
      if (enabled) loadMessages();
    };
    start();
  }

  function badge() { const b = F.$("#chat-badge"); if (!b) return; b.textContent = unread > 99 ? "99+" : unread; b.classList.toggle("hidden", !unread); }
  function nearBottom() { const l = F.$("#chat-list"); return l.scrollHeight - l.scrollTop - l.clientHeight < 80; }
  function scrollBottom(force) { const l = F.$("#chat-list"); if (l && (force || nearBottom())) l.scrollTop = l.scrollHeight; }

  function renderFoot() {
    const el = F.$("#chat-foot"); if (!el) return;
    if (!enabled) { el.innerHTML = ""; return; }
    if (A.profile) {
      el.innerHTML = `<form class="chat-form" id="chat-form">
        <img src="${F.avatarOf(A.profile)}" alt="" class="chat-me" title="${F.displayName(A.profile)}">
        <input id="chat-input" maxlength="400" placeholder="Say something…" autocomplete="off">
        <button class="btn btn-primary btn-sm" id="chat-send" aria-label="Send">${F.icons.send}</button></form>
        <div class="chat-hint">Chatting as <a href="profile.html?a=${A.profile.wallet}"><b>${F.displayName(A.profile)}</b></a>${A.profile.name ? "" : ' · <a href="profile.html?a=' + A.profile.wallet + '&edit=1">set a name</a>'}</div>`;
      F.$("#chat-form").onsubmit = send;
    } else {
      el.innerHTML = `<button class="btn btn-primary" style="width:100%" id="chat-signin" ${A.busy ? "disabled" : ""}>${A.busy ? "Check your wallet…" : F.wallet.connected ? "Sign in with wallet to chat" : "Connect wallet to chat"}</button>
        <div class="chat-hint">Signing is free and only proves you own the wallet.</div>`;
      F.$("#chat-signin").onclick = A.signIn;
    }
  }

  function msgHtml(m) {
    const p = m.profiles || cacheById.get(m.user_id) || {};
    const mine = A.profile && m.user_id === A.profile.id;
    const canDel = A.profile && (mine || A.profile.is_admin);
    const t = new Date(m.created_at);
    return `<div class="msg ${mine ? "mine" : ""}" data-id="${m.id}">
      <a href="profile.html?a=${F.esc(p.wallet || "")}"><img src="${F.avatarOf(p)}" alt=""></a>
      <div class="msg-body"><div class="msg-top"><a href="profile.html?a=${F.esc(p.wallet || "")}" class="msg-name">${F.displayName(p)}</a>${F.founderBadge(p.wallet, true)}${F.lvlTag ? F.lvlTag(p.id || m.user_id) : ""}${F.online.has(p.wallet) ? '<span class="online-dot" title="Online"></span>' : ""}
        <span class="msg-time" title="${t.toLocaleString()}">${t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>${canDel ? `<button class="msg-del" data-del="${m.id}" title="Delete">×</button>` : ""}</div>
        <div class="msg-text">${linkify(F.esc(m.body))}</div></div></div>`;
  }
  function linkify(s) {
    return s.replace(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g, (a) => `<a href="coin.html?c=${a}" class="msg-ca">${F.short(a)}</a>`)
      .replace(/\$([A-Za-z][A-Za-z0-9]{1,11})\b/g, '<b class="msg-tk">$$$1</b>');
  }
  async function loadMessages() {
    const list = F.$("#chat-list");
    const { data, error } = await F.sb.from("messages").select("id,body,created_at,user_id,profiles(id,wallet,name,avatar_url)").order("created_at", { ascending: false }).limit(80);
    if (error) { list.innerHTML = `<div class="chat-empty">Couldn't load chat: ${F.esc(error.message)}</div>`; return; }
    data.forEach((m) => { if (m.profiles) { cacheById.set(m.user_id, m.profiles); F.profiles.remember(m.profiles); } seen.add(m.id); });
    list.innerHTML = data.length ? data.reverse().map(msgHtml).join("") : '<div class="chat-empty">No messages yet — say gm 👋</div>';
    scrollBottom(true);
    list.onclick = async (e) => {
      const d = e.target.closest("[data-del]"); if (!d) return;
      const { error } = await F.sb.from("messages").delete().eq("id", d.dataset.del);
      if (error) F.toast("Couldn't delete", F.esc(error.message), "err"); else F.$(`.msg[data-id="${d.dataset.del}"]`)?.remove();
    };
    list.onscroll = () => { if (nearBottom()) F.$("#chat-new").classList.add("hidden"); };
    F.$("#chat-new").onclick = () => { scrollBottom(true); F.$("#chat-new").classList.add("hidden"); };

    F.sb.channel("flow-chat")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async ({ new: m }) => {
        if (seen.has(m.id)) return; seen.add(m.id);
        if (!cacheById.has(m.user_id)) {
          const { data: p } = await F.sb.from("profiles").select("id,wallet,name,avatar_url").eq("id", m.user_id).single();
          if (p) { cacheById.set(m.user_id, p); F.profiles.remember(p); }
        }
        const atBottom = nearBottom();
        F.$(".chat-empty", list)?.remove();
        list.insertAdjacentHTML("beforeend", msgHtml(m));
        while (list.children.length > 200) list.firstElementChild.remove();
        if (atBottom || (A.profile && m.user_id === A.profile.id)) scrollBottom(true); else F.$("#chat-new").classList.remove("hidden");
        if (!F.$("#chat").classList.contains("open")) { unread++; badge(); }
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, ({ old }) => F.$(`.msg[data-id="${old.id}"]`)?.remove())
      .subscribe();
  }

  async function send(e) {
    e.preventDefault();
    const inp = F.$("#chat-input"), body = inp.value.trim();
    if (!body || !A.profile) return;
    const btn = F.$("#chat-send"); btn.disabled = true;
    const { data, error } = await F.sb.from("messages").insert({ user_id: A.profile.id, body }).select("id,body,created_at,user_id").single();
    btn.disabled = false;
    if (error) {
      const msg = /Slow down/.test(error.message) ? "Slow mode — wait a few seconds." : /row-level security/i.test(error.message) ? "You can't post right now." : error.message;
      return F.toast("Message not sent", F.esc(msg), "warn");
    }
    inp.value = ""; inp.focus();
    if (!seen.has(data.id)) {
      seen.add(data.id); cacheById.set(A.profile.id, A.profile);
      F.$(".chat-empty")?.remove();
      F.$("#chat-list").insertAdjacentHTML("beforeend", msgHtml(data)); scrollBottom(true);
    }
  }
})();
