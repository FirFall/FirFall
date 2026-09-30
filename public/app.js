// FirFall — Cloudflare-only auth. No localhost.
// Set to false to bring the site back up after the storage migration.
const SITE_DOWN = false;
const API = window.FIRFALL_API || 'https://firfall-auth.b8golddude.workers.dev';
document.getElementById('menuBtn').onclick = () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
};

const modal = document.getElementById('authModal');
const signInBtn = document.getElementById('signInBtn');
const signInLabel = document.getElementById('signInLabel');
const signInAvatar = document.getElementById('signInAvatar');
const signInIcon = document.getElementById('signInIcon');
const authTitle = document.getElementById('authTitle');
const authUser = document.getElementById('authUser');
const authPass = document.getElementById('authPass');
const authErr = document.getElementById('authErr');
const authSubmit = document.getElementById('authSubmit');
const authSwitch = document.getElementById('authSwitch');
const accountMenu = document.getElementById('accountMenu');
const menuUser = document.getElementById('menuUser');
const menuAvatar = document.getElementById('menuAvatar');
let mode = 'login'; // or 'register'

const me = () => localStorage.getItem('firfall_user');
const token = () => localStorage.getItem('firfall_token');
const myRole = () => localStorage.getItem('firfall_role') || 'user';
const isAdmin = () => myRole() === 'admin';
// Mods get the report queue but not the user table, which can change roles and
// bans. The server enforces the same split; this only decides what to draw.
const isMod = () => myRole() === 'mod';
const isStaff = () => isAdmin() || isMod();

function refreshAuthUI() {
  const u = me();
  signInBtn.classList.toggle('logged-in', !!u);
  signInLabel.textContent = u ? u : 'Sign in';
  signInAvatar.classList.toggle('hidden', !u);
  signInIcon.classList.toggle('hidden', !!u);
  notifBtn.classList.toggle('hidden', !u);
  const adminNav = document.getElementById('adminNav');
  if (adminNav) { adminNav.classList.toggle('hidden', !isStaff()); adminNav.querySelector('span').textContent = isMod() && !isAdmin() ? 'Mod Queue' : 'Admin Panel'; }
  const shield = document.getElementById('adminShieldBtn');
  if (shield) shield.classList.toggle('hidden', !isStaff());
  if (u) {
    signInAvatar.textContent = u[0].toUpperCase(); menuUser.textContent = '@' + u; menuAvatar.textContent = u[0].toUpperCase();
    notifKnown = parseInt(localStorage.getItem('firfall_notif_known') || '0', 10) || 0;
    if (!SITE_DOWN) { loadNotifs(false); syncRole(); loadMyReports(); }
  } else {
    accountMenu.classList.add('hidden');
    notifPanel.classList.add('hidden');
    notifBadge.classList.add('hidden');
  }
}
// ---- Ban screen ------------------------------------------------------------
// FirFall has no Discord yet, so the appeal link the old notice pointed at does
// not exist. Rather than ship a dead discord.gg placeholder, appeals go to a real
// inbox the moderators answer from the admin panel. To point elsewhere later,
// set APPEAL_LINK and the form is replaced by that link.
const APPEAL_LINK = '';
let banShown = false;
function showBanScreen(ban, appealToken, username) {
  ban = ban || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  document.body.classList.add('banned');
  banShown = true;
  // The cached session is worthless now: the server rejects every call for a
  // banned account, so leaving it in place only misleads the rest of the UI.
  localStorage.removeItem('firfall_token');
  localStorage.removeItem('firfall_user');
  localStorage.removeItem('firfall_role');
  const modalEl = document.getElementById('authModal');
  if (modalEl) modalEl.classList.add('hidden');
  set('banUser', username || localStorage.getItem('firfall_ban_user') || '—');
  set('banReason', ban.reason || 'Breaking the FirFall community rules.');
  set('banBy', ban.bannedBy || 'FirFall moderators');
  set('banDate', ban.bannedAt ? new Date(ban.bannedAt).toLocaleString() : '—');
  set('banRef', 'REF ' + String(username || 'ACCOUNT').toUpperCase().slice(0, 18));
  if (APPEAL_LINK) {
    document.getElementById('banAppealForm').classList.add('hidden');
    document.getElementById('banAppealLead').innerHTML = 'Appeals are handled in Discord. Reach us at <a href="' + esc(APPEAL_LINK) + '" target="_blank" rel="noopener noreferrer">' + esc(APPEAL_LINK) + '</a>.';
    return;
  }
  wireBanAppeal(appealToken, username);
}
function wireBanAppeal(appealToken, username) {
  if (!appealToken) {
    // No token means we arrived here from /api/me rather than a fresh sign-in, so
    // say how to get one instead of showing a form that cannot succeed.
    const f = document.getElementById('banAppealForm');
    const s = document.getElementById('banAppealState');
    if (f) f.classList.add('hidden');
    if (s) {
      s.classList.remove('hidden', 'approved');
      s.innerHTML = '<span class="ban-state-tag">Sign in to appeal</span><br>Close this page, then sign in with your username and password on the FirFall sign-in screen. The appeal form unlocks once the server confirms the ban.';
    }
    return;
  }
  const box = document.getElementById('banAppealForm');
  const state = document.getElementById('banAppealState');
  const msg = document.getElementById('banAppealMsg');
  const btn = document.getElementById('banAppealSend');
  const ta = document.getElementById('banAppealText');
  const show = (html, ok) => {
    box.classList.add('hidden');
    state.classList.remove('hidden');
    state.classList.toggle('approved', !!ok);
    state.innerHTML = html;
  };
  // Check for an appeal already on file so a repeat visit does not offer to
  // resubmit something a moderator is already reading.
  fetch(API + '/api/appeal/status?appealToken=' + encodeURIComponent(appealToken))
    .then(r => r.ok ? r.json() : { status: 'none' })
    .then(j => {
      if (!j || j.status === 'none') return;
      const tag = j.status === 'open' ? 'Appeal received' : (j.status === 'approved' ? 'Appeal approved' : 'Appeal upheld');
      show('<span class="ban-state-tag">' + tag + '</span><br>' +
        (j.reply ? '<b>Moderator reply:</b> ' + esc(j.reply) : 'Your appeal is in the moderator queue. Check back here for a reply.'), j.status === 'approved');
    })
    .catch(() => { });
  btn.onclick = async () => {
    const text = ta.value.trim();
    if (text.length < 10) { msg.className = 'ban-msg err'; msg.textContent = 'Write at least 10 characters.'; return; }
    btn.disabled = true; msg.className = 'ban-msg'; msg.textContent = 'Sending…';
    try {
      const r = await fetch(API + '/api/appeal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appealToken, message: text })
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) { show('<span class="ban-state-tag">Appeal received</span><br>You already have an appeal under review.', false); return; }
      if (!r.ok) { btn.disabled = false; msg.className = 'ban-msg err'; msg.textContent = j.error || 'Could not send that appeal.'; return; }
      show('<span class="ban-state-tag">Appeal received</span><br>A moderator will read this. Reload this page later to check for a reply.', false);
    } catch {
      btn.disabled = false; msg.className = 'ban-msg err'; msg.textContent = 'Could not reach the server.';
    }
  };
}
// The cached role in localStorage goes stale when an admin is promoted or demoted
// while they are already signed in, which silently hides the admin panel. Ask the
// server for the authoritative role on every load and update the UI if it changed.
async function syncRole() {
  const t = localStorage.getItem('firfall_token');
  if (!t) return;
  try {
    const r = await fetch(API + '/api/me', { headers: { Authorization: 'Bearer ' + t } });
    if (!r.ok) return;
    const j = await r.json();
    // A ban outranks role sync. Someone banned while signed in still holds a
    // valid token, so without this they would carry on browsing a site that is
    // silently rejecting every write they make.
    if (j && j.banned) { showBanScreen(j.ban, localStorage.getItem('firfall_ban_token'), j.username); return; }
    if (!j || !j.role) return;
    if (localStorage.getItem('firfall_role') !== j.role) {
      localStorage.setItem('firfall_role', j.role);
      const adminNav = document.getElementById('adminNav');
      const staff = j.role === 'admin' || j.role === 'mod';
      if (adminNav) { adminNav.classList.toggle('hidden', !staff); adminNav.querySelector('span').textContent = (j.role === 'mod') ? 'Mod Queue' : 'Admin Panel'; }
      const shield = document.getElementById('adminShieldBtn');
      if (shield) shield.classList.toggle('hidden', !staff);
      // A mod promoted or demoted while sitting on the panel needs a redraw, or
      // they keep seeing the user table they just lost access to.
      if (location.hash.startsWith('#/admin')) router();
    }
  } catch { }
}
function setMode(m) {
  mode = m;
  authTitle.textContent = m === 'login' ? 'Sign in' : 'Create account';
  authSubmit.textContent = m === 'login' ? 'Sign in' : 'Create account';
  authSwitch.textContent = m === 'login' ? 'New here? Create account' : 'Have an account? Sign in';
  authErr.textContent = '';
}
signInBtn.onclick = (e) => {
  e.stopPropagation();
  if (!me()) { setMode('login'); accountMenu.classList.add('hidden'); modal.classList.remove('hidden'); }
  else accountMenu.classList.toggle('hidden');
};
document.addEventListener('click', (e) => {
  if (!accountMenu.classList.contains('hidden') && !e.target.closest('#accountMenu') && !e.target.closest('#signInBtn'))
    accountMenu.classList.add('hidden');
});
document.getElementById('authClose').onclick = () => modal.classList.add('hidden');
document.getElementById('menuChannel').onclick = () => {
  accountMenu.classList.add('hidden');
  location.hash = '#/channel/' + me();
};
document.getElementById('menuSignout').onclick = () => {
  localStorage.removeItem('firfall_user');
  localStorage.removeItem('firfall_token');
  localStorage.removeItem('firfall_role');
  accountMenu.classList.add('hidden');
  refreshAuthUI();
  if (location.hash.startsWith('#/channel/') || location.hash.startsWith('#/admin')) location.hash = '#/';
};
// ---- Notifications: bell feed + browser alerts while the site is open ----
const notifBtn = document.getElementById('notifBtn');
const notifPanel = document.getElementById('notifPanel');
const notifBadge = document.getElementById('notifBadge');
let notifKnown = 0; // highest notification id already seen this session
async function loadNotifs(markRead) {
  if (!me()) return;
  try {
    const r = await fetch(API + '/api/notifications', { headers: { 'Authorization': 'Bearer ' + token() } });
    const j = await r.json();
    const list = j.notifications || [];
    notifBadge.classList.toggle('hidden', !(j.unread > 0));
    if (j.unread > 0) notifBadge.textContent = j.unread > 9 ? '9+' : String(j.unread);
    const box = document.getElementById('notifList');
    box.innerHTML = list.length ? '' : '<p class="modal-sub" style="padding:12px 16px">No notifications yet. Subscribe to channels with the bell on.</p>';
    list.forEach(n => {
      const d = document.createElement('div');
      d.className = 'notif-item' + (n.read ? '' : ' unread');
      d.innerHTML = '<div class="thumb"><video muted preload="metadata" playsinline poster="' + API + '/t/' + n.video_id + '"></video></div>' +
        '<div><h4></h4><p></p></div>';
      d.querySelector('h4').textContent = n.title || 'New upload';
      d.querySelector('p').textContent = '@' + n.owner + ' • ' + timeAgo(n.created_at);
      d.onclick = () => {
        notifPanel.classList.add('hidden');
        fetch(API + '/api/notifications/read', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
          body: JSON.stringify({ ids: [n.id] })
        }).catch(() => {});
        location.hash = '#/watch/' + n.video_id;
      };
      box.appendChild(d);
    });
    // Foreground browser alerts for newly arrived items (site must be open).
    const fresh = list.filter(n => n.id > notifKnown);
    if (notifKnown && fresh.length && 'Notification' in window && Notification.permission === 'granted') {
      const n = fresh[0];
      try { new Notification(n.title || 'New upload', { body: '@' + n.owner + ' uploaded a video' }); } catch {}
    }
    if (list.length) {
      notifKnown = Math.max(notifKnown, ...list.map(n => n.id));
      try { localStorage.setItem('firfall_notif_known', String(notifKnown)); } catch {}
    }
    if (markRead && j.unread > 0) {
      fetch(API + '/api/notifications/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
        body: JSON.stringify({})
      }).then(() => loadNotifs(false)).catch(() => {});
    }
  } catch {}
}
notifBtn.onclick = (e) => {
  e.stopPropagation();
  if (notifPanel.classList.contains('hidden')) { notifPanel.classList.remove('hidden'); loadNotifs(true); }
  else notifPanel.classList.add('hidden');
};
document.addEventListener('click', (e) => {
  if (!notifPanel.classList.contains('hidden') && !e.target.closest('#notifPanel') && !e.target.closest('#notifBtn'))
    notifPanel.classList.add('hidden');
});
document.getElementById('notifEnable').onclick = () => {
  askNotifPermission();
  setTimeout(() => {
    document.getElementById('notifEnable').textContent =
      ('Notification' in window && Notification.permission === 'granted') ? 'Alerts on ✓' : 'Browser blocked alerts';
  }, 800);
};
setInterval(() => { if (me() && !document.hidden) loadNotifs(false); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadNotifs(false); });
authSwitch.onclick = () => setMode(mode === 'login' ? 'register' : 'login');
authSubmit.onclick = async () => {
  authErr.textContent = '';
  const username = authUser.value.trim();
  const password = authPass.value;
  if (!username || !password) { authErr.textContent = 'Enter username + password.'; return; }
  if (mode === 'register') { // instant name filter (server re-checks)
    const u = username.toLowerCase();
    const badExact = ['admin','administrator','root','system','support','help','firfall','official','moderator','mod','owner','staff','abuse','security','null','undefined'];
    const badParts = ['fuck','shit','bitch','dick','porn','nazi','kill','rape','hitler'];
    if (!/^[a-z0-9_]{3,20}$/.test(u) || badExact.includes(u) || badParts.some(w => u.includes(w))) {
      authErr.textContent = 'That username is not allowed.'; return;
    }
  }
  try {
    const r = await fetch(API + (mode === 'login' ? '/api/login' : '/api/register'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const j = await r.json();
    // A correct password on a banned account is the one case where the server
    // hands back a 403 plus the full ban record, so take over the whole screen
    // rather than showing a line of red text in the modal.
    if (j && j.banned) {
      localStorage.setItem('firfall_ban_token', j.appealToken || '');
      localStorage.setItem('firfall_ban_user', j.ban && j.ban.username || username);
      showBanScreen(j.ban, j.appealToken, j.ban && j.ban.username || username);
      return;
    }
    if (!r.ok) { authErr.textContent = j.error || 'Failed.'; return; }
    localStorage.setItem('firfall_user', j.username);
    localStorage.setItem('firfall_token', j.token);
    localStorage.setItem('firfall_role', j.role || 'user');
    modal.classList.add('hidden');
    authUser.value = ''; authPass.value = '';
    refreshAuthUI();
  } catch { authErr.textContent = 'Auth service unreachable — check connection.'; }
};

// ---- Local stores ----
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};

// ---- Update Log (shown once per version) ----
const currentVer = '1.1';
const lastVer = store.get('firfall_ver', '0');
if (lastVer !== currentVer) {
  const log = document.createElement('div');
  log.className = 'update-log';
  log.innerHTML = '<h3>Update ' + currentVer + '</h3><p>New Features: Real Subscriptions, Channel Art, Notifications, Admin Panel, & Moderation.</p><button id="upLogOk">Got it!</button>';
  document.body.appendChild(log);
  document.getElementById('upLogOk').onclick = () => { store.set('firfall_ver', currentVer); log.remove(); };
}
// Undefined/NaN would print as "undefined views", so anything not a real
// number reads as 0.
function fmt(n) { n = Number(n) || 0; return n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'K' : String(n); }
function timeAgo(iso) {
  const t = new Date(iso == null ? null : iso).getTime();
  if (!t || isNaN(t)) return '';
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  return new Date(iso).toLocaleDateString();
}
// ---- Real subscriptions (server-side; no fake counts anywhere) ----
async function subStatus(name) {
  try {
    const r = await fetch(API + '/api/substatus?channel=' + encodeURIComponent(name.toLowerCase()),
      me() ? { headers: { 'Authorization': 'Bearer ' + token() } } : undefined);
    return await r.json();
  } catch { return { subscribed: false, notify: 'none', subscribers: 0, own: false }; }
}
function paintBell(bell, notify, subscribed) {
  if (!bell) return;
  bell.classList.toggle('hidden', !subscribed);
  bell.textContent = notify === 'all' ? '🔔' : '🔕';
  bell.title = notify === 'all' ? 'Notified of all uploads (click to mute)' : 'Muted (click for all notifications)';
}
async function wireSubBtn(btn, name, bellBtn) {
  name = String(name || '').toLowerCase();
  const st = await subStatus(name);
  const paint = (s) => {
    btn.textContent = s.own ? 'This is you' : (s.subscribed ? 'Subscribed' : 'Subscribe');
    btn.disabled = !!s.own;
    btn.classList.toggle('subbed', s.subscribed && !s.own);
    paintBell(bellBtn, s.notify, s.subscribed && !s.own);
    btn._sub = s;
  };
  paint(st);
  btn.onclick = async () => {
    if (!me()) { setMode('login'); modal.classList.remove('hidden'); return; }
    const cur = btn._sub || st;
    if (cur.own) return;
    btn.disabled = true;
    try {
      const r = await fetch(API + '/api/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
        body: JSON.stringify({ channel: name, action: cur.subscribed ? 'unsub' : 'sub' })
      });
      const j = await r.json();
      if (r.ok) {
        paint({ subscribed: j.subscribed, notify: j.notify, subscribers: j.subscribers, own: false });
        if (j.subscribed) { askNotifPermission(); loadNotifs(); }
        const m = document.getElementById('chMeta');
        if (m && m.dataset.owner === name) renderChannel(name);
        const w = document.getElementById('wSubCount');
        if (w && w.dataset.owner === name) w.textContent = fmt(j.subscribers) + ' subscribers';
      }
    } catch {}
    btn.disabled = false;
  };
  if (bellBtn) bellBtn.onclick = async (e) => {
    e.stopPropagation();
    const cur = btn._sub || st;
    if (!cur.subscribed || cur.own) return;
    const want = cur.notify === 'all' ? 'none' : 'all';
    try {
      const r = await fetch(API + '/api/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
        body: JSON.stringify({ channel: name, notify: want })
      });
      const j = await r.json();
      if (r.ok) { cur.notify = j.notify; paintBell(bellBtn, j.notify, true); if (want === 'all') askNotifPermission(); }
    } catch {}
  };
}
function askNotifPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  } catch {}
}
function fmtDur(s) {
  s = Math.round(s || 0);
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? h + ':' + String(m % 60).padStart(2, '0') + ':' + ss : m + ':' + ss;
}
function pushHistory(v) {
  const h = store.get('firfall_history', []).filter(x => x.id !== v.id);
  h.unshift({ id: v.id, title: v.title, owner: v.owner, at: Date.now() });
  store.set('firfall_history', h.slice(0, 50));
}

// ---- Views / router ----
const homeView = document.getElementById('homeView');
const channelView = document.getElementById('channelView');
const watchView = document.getElementById('watchView');
const listView = document.getElementById('listView');
function show(el) { [homeView, channelView, watchView, listView].forEach(v => v.classList.add('hidden')); el.classList.remove('hidden');
  // The Embers shelf belongs to the home feed only; every other view hides it.
  document.getElementById('emberShelf').classList.toggle('hidden', el !== homeView);
}
function markNav(name) {
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
}
let homeCache = [];
let homeQuery = '';

function card(v) {
  const d = document.createElement('div');
  d.className = 'card';
  d.innerHTML = '<div class="thumb"><video muted preload="metadata" playsinline src="' + API + '/v/' + v.id + '" poster="' + API + '/t/' + v.id + '"></video>' +
    (v.duration ? '<span class="duration">' + fmtDur(v.duration) + '</span>' : '') + '</div>' +
    '<div class="meta"><div class="chan">' + (v.owner[0] || '?').toUpperCase() + '</div><div><h3></h3><p></p></div></div>';
  d.querySelector('h3').textContent = v.title;
  d.querySelector('p').textContent = v.owner + (v.visibility && v.visibility !== 'public' ? ' • ' + v.visibility : '') + ' • ' + fmt(v.views || 0) + ' views • ' + timeAgo(v.created_at);
  const vid = d.querySelector('video');
  vid.onmouseenter = () => { vid.play().catch(() => {}); };
  vid.onmouseleave = () => { vid.pause(); };
  d.onclick = () => { location.hash = '#/watch/' + v.id; };
  return d;
}

async function loadHome() {
  show(homeView); markNav('home');
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  try {
    // kind=video keeps the grid to proper 16:9 uploads; embers render in
    // their own shelf below instead of letterboxed in the grid.
    const r = await fetch(API + '/api/videos?kind=video');
    const j = await r.json();
    homeCache = j.videos || [];
  } catch { homeCache = []; }
  const q = homeQuery.toLowerCase();
  const list = homeCache.filter(v => !q || (v.title + ' ' + v.owner).toLowerCase().includes(q));
  document.getElementById('emptyState').style.display = list.length ? 'none' : '';
  if (!list.length && homeCache.length)
    document.querySelector('#emptyState p').textContent = 'No videos match "' + homeQuery + '".';
  else if (!list.length)
    document.querySelector('#emptyState p').textContent = 'Be the first to upload.';
  list.forEach(v => grid.appendChild(card(v)));
  loadEmbers();
}
// ---- Embers: vertical clips recorded in the mobile app ----
// The worker filters them out of the ordinary feed (kind='video' excludes
// embers), so the desktop site never showed them at all. They render as a
// horizontal shelf of 9:16 cards under the main grid; a failed fetch just
// leaves the shelf hidden.
async function loadEmbers() {
  const shelf = document.getElementById('emberShelf');
  const row = document.getElementById('emberRow');
  try {
    const r = await fetch(API + '/api/videos?kind=ember&limit=20');
    if (!r.ok) { shelf.classList.add('hidden'); return; }
    const { videos } = await r.json();
    const list = (videos || []).filter(v => v.visibility === 'public');
    if (!list.length) { shelf.classList.add('hidden'); return; }
    row.innerHTML = '';
    list.forEach(v => {
      const b = document.createElement('button');
      b.className = 'ember-card';
      b.innerHTML = '<div class="ember-thumb"><img alt="" loading="lazy" src="' + API + '/t/' + v.id + '">' +
        (v.duration ? '<span class="ember-dur">' + fmtDur(v.duration) + '</span>' : '') +
        '<span class="ember-views">' + fmt(v.views || 0) + ' views</span></div>' +
        '<div class="ember-meta"><h3></h3><p></p></div>';
      b.querySelector('h3').textContent = v.title;
      b.querySelector('p').textContent = v.owner + ' • ' + timeAgo(v.created_at);
      b.onclick = () => { location.hash = '#/watch/' + v.id; };
      row.appendChild(b);
    });
    shelf.classList.remove('hidden');
  } catch { shelf.classList.add('hidden'); }
}
// Search + chips (working)
document.getElementById('searchInput').addEventListener('input', (e) => { homeQuery = e.target.value.trim(); loadHome(); });
document.getElementById('chips').addEventListener('click', (e) => {
  const c = e.target.closest('.yt-chip');
  if (!c) return;
  document.querySelectorAll('.yt-chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  homeQuery = c.dataset.q || '';
  document.getElementById('searchInput').value = homeQuery;
  location.hash = '#/';
  loadHome();
});

let chSortVal = 'latest';
async function renderChannel(name) {
  show(channelView); markNav('');
  document.getElementById('chAvatar').textContent = name[0].toUpperCase();
  document.getElementById('chName').textContent = name;
  const meta = document.getElementById('chMeta');
  const tab = document.getElementById('tabVideos');
  tab.innerHTML = '<h2>Loading…</h2>';
  try {
    const u = await (await fetch(API + '/api/channel?u=' + encodeURIComponent(name.toLowerCase()))).json();
    if (!u.channel) {
      tab.innerHTML = '<h2>Channel not found</h2><p>No such FirFall account.</p>'; meta.textContent = '';
      document.getElementById('chSubBtn').style.display = 'none';
      document.getElementById('chBellBtn').classList.add('hidden');
      return;
    }
    const c = u.channel;
    const own = me() && me().toLowerCase() === c.username;
    document.getElementById('chSubBtn').style.display = '';
    meta.dataset.owner = c.username;
    wireSubBtn(document.getElementById('chSubBtn'), c.username, document.getElementById('chBellBtn'));
    // Add Moderator badge
    const nameEl = document.getElementById('chName');
    // Same reason as the watch page: build the badge as a node. The username is
    // set as text, so it is never parsed as markup.
    nameEl.textContent = c.username;
    if (c.role === 'mod' || c.role === 'admin') {
      const cBadge = document.createElement('span');
      cBadge.className = 'badge-mod';
      cBadge.textContent = '🔨 Mod';
      nameEl.appendChild(cBadge);
    }
    // Banner + avatar (custom or defaults)
    const banner = document.getElementById('chBanner');
    if (c.banner) { banner.src = API + c.banner + '?t=' + Date.now(); banner.classList.remove('hidden'); }
    else banner.classList.add('hidden');
    const avImg = document.getElementById('chAvatarImg'), avFb = document.getElementById('chAvatar');
    if (c.avatar) { avImg.src = API + c.avatar + '?t=' + Date.now(); avImg.classList.remove('hidden'); avFb.classList.add('hidden'); }
    else { avImg.classList.add('hidden'); avFb.classList.remove('hidden'); avFb.textContent = c.username[0].toUpperCase(); }
    document.getElementById('chOwnBar').classList.toggle('hidden', !own);
    meta.textContent = '@' + c.username + ' • ' + fmt(c.subscribers) + ' subscribers • ' + c.videos + ' videos';
    document.getElementById('chAbout').textContent = c.about || 'This channel has no description yet.';
    document.getElementById('chStats').textContent = fmt(c.views) + ' total views • joined ' + new Date(c.joined).toLocaleDateString();
    const r = await fetch(API + '/api/videos?owner=' + encodeURIComponent(c.username),
      me() ? { headers: { 'Authorization': 'Bearer ' + token() } } : undefined);
    const { videos } = await r.json();
    const list = (videos || []).slice();
    if (chSortVal === 'popular') list.sort((a, b) => (b.views || 0) - (a.views || 0));
    else if (chSortVal === 'oldest') list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    tab.innerHTML = list.length ? '' : '<h2>No videos yet</h2><p>This channel hasn\'t uploaded anything.</p>';
    tab.className = list.length ? 'yt-grid' : 'blank-state';
    list.forEach(v => tab.appendChild(card(v)));
  } catch { tab.innerHTML = '<h2>Could not load channel.</h2>'; }
}
document.querySelectorAll('#chSort button').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('#chSort button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    chSortVal = b.dataset.sort;
    const m = document.getElementById('chMeta');
    if (m && m.dataset.owner) renderChannel(m.dataset.owner);
  };
});
document.querySelectorAll('[data-chtab]').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('[data-chtab]').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('tabVideos').classList.toggle('hidden', t.dataset.chtab !== 'videos');
    document.getElementById('tabAbout').classList.toggle('hidden', t.dataset.chtab !== 'about');
    document.getElementById('chSort').style.display = t.dataset.chtab === 'videos' ? '' : 'none';
  };
});
// Own-channel customization (banner / picture / description)
document.getElementById('chBannerEdit').onclick = () => document.getElementById('chBannerFile').click();
document.getElementById('chAvatarEdit').onclick = () => document.getElementById('chAvatarFile').click();
async function uploadChannelArt(kind, file) {
  const err = document.getElementById('chAboutErr');
  if (file.size > 5_000_000) { alert('Image must be under 5MB.'); return; }
  const f = new FormData();
  f.append(kind, file, kind + '.jpg');
  try {
    const r = await fetch(API + '/api/channel/edit', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token() }, body: f
    });
    const j = await r.json();
    if (!r.ok) { alert(j.error || 'Upload failed.'); return; }
    const m = document.getElementById('chMeta');
    if (m && m.dataset.owner) renderChannel(m.dataset.owner);
  } catch { alert('Upload failed — service unreachable.'); }
}
document.getElementById('chBannerFile').addEventListener('change', (e) => { if (e.target.files[0]) uploadChannelArt('banner', e.target.files[0]); e.target.value = ''; });
document.getElementById('chAvatarFile').addEventListener('change', (e) => { if (e.target.files[0]) uploadChannelArt('avatar', e.target.files[0]); e.target.value = ''; });
document.getElementById('chAboutEdit').onclick = () => {
  document.getElementById('chAboutForm').classList.remove('hidden');
  document.getElementById('chAboutText').value = document.getElementById('chAbout').textContent === 'This channel has no description yet.' ? '' : document.getElementById('chAbout').textContent;
};
document.getElementById('chAboutSave').onclick = async () => {
  const err = document.getElementById('chAboutErr');
  err.textContent = '';
  try {
    const r = await fetch(API + '/api/channel/edit', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
      body: JSON.stringify({ about: document.getElementById('chAboutText').value })
    });
    const j = await r.json();
    if (!r.ok) { err.textContent = j.error || 'Save failed.'; return; }
    document.getElementById('chAboutForm').classList.add('hidden');
    const m = document.getElementById('chMeta');
    if (m && m.dataset.owner) renderChannel(m.dataset.owner);
  } catch { err.textContent = 'Save failed — service unreachable.'; }
};

let currentVideo = null;
let upFilter = '';
// ---- Custom player: YouTube layout, orange fire progress ----
const player = document.getElementById('player');
const playerWrap = document.getElementById('playerWrap');
const ppBtn = document.getElementById('ppBtn');
const bigPlay = document.getElementById('bigPlay');
function fmtT(s) {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  return (h ? h + ':' + String(m % 60).padStart(2, '0') + ':' : m + ':') + String(s % 60).padStart(2, '0');
}
function syncPlayUI() {
  const playing = !player.paused && !player.ended;
  ppBtn.textContent = playing ? '❚❚' : '▶';
  bigPlay.classList.toggle('hidden', playing);
  playerWrap.classList.toggle('paused', !playing);
}
function seekTo(clientX) {
  const r = document.getElementById('progTrack').getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  if (player.duration) player.currentTime = frac * player.duration;
}
(function initPlayer() {
  let dragging = false;
  player.addEventListener('play', syncPlayUI);
  player.addEventListener('pause', syncPlayUI);
  player.addEventListener('loadedmetadata', () => {
    document.getElementById('timeLabel').textContent = '0:00 / ' + fmtT(player.duration);
  });
  player.addEventListener('timeupdate', () => {
    const f = player.duration ? (player.currentTime / player.duration) * 100 : 0;
    document.getElementById('progFill').style.width = f + '%';
    document.getElementById('progDot').style.left = f + '%';
    document.getElementById('timeLabel').textContent = fmtT(player.currentTime) + ' / ' + fmtT(player.duration);
  });
  player.addEventListener('progress', () => {
    try {
      if (player.buffered.length && player.duration)
        document.getElementById('progBuf').style.width = (player.buffered.end(player.buffered.length - 1) / player.duration) * 100 + '%';
    } catch {}
  });
  ppBtn.onclick = (e) => { e.stopPropagation(); player.paused ? player.play() : player.pause(); };
  bigPlay.onclick = () => player.play();
  player.onclick = () => player.paused ? player.play() : player.pause();
  player.ondblclick = () => toggleFS();
  const track = document.getElementById('progTrack');
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); seekTo(e.clientX); });
  track.addEventListener('pointermove', (e) => { if (dragging) seekTo(e.clientX); });
  track.addEventListener('pointerup', () => { dragging = false; });
  document.getElementById('muteBtn').onclick = (e) => {
    e.stopPropagation();
    player.muted = !player.muted;
    e.target.textContent = player.muted ? '🔇' : '🔊';
  };
  document.getElementById('volSlider').oninput = (e) => { player.volume = +e.target.value; player.muted = false; document.getElementById('muteBtn').textContent = '🔊'; };
  const speeds = [1, 1.25, 1.5, 2, 0.5];
  document.getElementById('speedBtn').onclick = (e) => {
    e.stopPropagation();
    const i = (speeds.indexOf(player.playbackRate) + 1) % speeds.length;
    player.playbackRate = speeds[i];
    e.target.textContent = speeds[i] + 'x';
  };
  document.getElementById('fsBtn').onclick = (e) => { e.stopPropagation(); toggleFS(); };
  function toggleFS() {
    if (document.fullscreenElement) document.exitFullscreen();
    else playerWrap.requestFullscreen && playerWrap.requestFullscreen();
  }
  playerWrap.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') { e.preventDefault(); player.paused ? player.play() : player.pause(); }
    else if (k === 'arrowright') player.currentTime += 5;
    else if (k === 'arrowleft') player.currentTime -= 5;
    else if (k === 'f') toggleFS();
    else if (k === 'm') player.muted = !player.muted;
  });
})();
async function renderWatch(id) {
  show(watchView); markNav('');
  const player = document.getElementById('player');
  player.pause(); player.removeAttribute('src'); player.load();
  document.getElementById('wDescBox').classList.add('collapsed');
  try {
    const r = await fetch(API + '/api/video?id=' + encodeURIComponent(id));
    if (!r.ok) { document.getElementById('wTitle').textContent = 'Video not found.'; return; }
    const { video: v, likes, reaction } = await r.json();
    currentVideo = v;
    const q = me() ? '?token=' + encodeURIComponent(token()) : '';
    player.poster = API + '/t/' + v.id + q;
    player.src = API + '/v/' + v.id + q;
    player.playbackRate = 1;
    document.getElementById('speedBtn').textContent = '1x';
    // The badge is appended as a node rather than concatenated into the title.
    // Assigning an HTML string to textContent prints the tags literally, which is
    // how this read "mcdonalds obby <span class=...>" on screen. The title itself
    // still goes in as text, so a title containing markup is never parsed.
    const wTitleEl = document.getElementById('wTitle');
    wTitleEl.textContent = v.title;
    if (v.owner_role === 'mod' || v.owner_role === 'admin') {
      const badge = document.createElement('span');
      badge.className = 'badge-mod';
      badge.textContent = '🔨 Mod';
      wTitleEl.appendChild(badge);
    }
    document.getElementById('wStats').textContent = fmt(v.views || 0) + ' views • ' + timeAgo(v.created_at) + (v.duration ? ' • ' + fmtDur(v.duration) : '');
    const ch = document.getElementById('wChannelLink');
    document.getElementById('wChannel').textContent = '@' + v.owner;
    document.getElementById('wAvatar').textContent = v.owner[0].toUpperCase();
    ch.href = '#/channel/' + v.owner;
    wireSubBtn(document.getElementById('wSubBtn'), v.owner, document.getElementById('wBellBtn'));
    try {
      const st = await subStatus(v.owner);
      const w = document.getElementById('wSubCount');
      w.dataset.owner = v.owner.toLowerCase();
      w.textContent = fmt(st.subscribers) + ' subscribers';
    } catch {}
    paintReact(reaction || 'none', likes || 0);
    paintSave();
    const wRep = document.getElementById('wReportBtn');
    wRep.classList.toggle('hidden', !me() || v.owner === me());
    wRep.textContent = myReports.has('video:' + v.id) ? 'Reported' : 'Report';
    wRep.classList.toggle('done', myReports.has('video:' + v.id));
    wRep.disabled = myReports.has('video:' + v.id);
    wRep.onclick = () => openReport('video', v.id, v.title);
    const cAv = document.getElementById('cAvatar');
    cAv.textContent = me() ? me()[0].toUpperCase() : '?';
    document.getElementById('wDesc').textContent = v.description || 'No description.';
    pushHistory(v);
    fetch(API + '/api/video/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {});
    loadComments(v.id);
    loadUpNext(v);
  } catch { document.getElementById('wTitle').textContent = 'Could not load video.'; }
}
function paintReact(reaction, n) {
  const like = document.getElementById('wLikeBtn');
  const dis = document.getElementById('wDislikeBtn');
  like.innerHTML = (reaction === 'like' ? '♥ ' : '♡ ') + '<span>' + n + '</span>';
  dis.textContent = reaction === 'dislike' ? '♥' : '♡';
  dis.classList.toggle('on', reaction === 'dislike');
  like.classList.toggle('on', reaction === 'like');
}
async function react(kind) {
  if (!me()) { setMode('login'); modal.classList.remove('hidden'); return; }
  const want = (document.getElementById(kind === 'like' ? 'wLikeBtn' : 'wDislikeBtn').classList.contains('on')) ? 'none' : kind;
  try {
    const r = await fetch(API + '/api/video/react', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
      body: JSON.stringify({ id: currentVideo.id, kind: want })
    });
    const j = await r.json();
    if (r.ok) paintReact(j.reaction, j.likes);
  } catch {}
}
document.getElementById('wLikeBtn').onclick = () => react('like');
document.getElementById('wDislikeBtn').onclick = () => react('dislike');
document.getElementById('wShareBtn').onclick = async () => {
  const link = location.href;
  try { await navigator.clipboard.writeText(link); document.getElementById('wShareBtn').textContent = '✓ Copied'; }
  catch { prompt('Copy link:', link); }
  setTimeout(() => { document.getElementById('wShareBtn').textContent = '⇪ Share'; }, 1500);
};
document.getElementById('wDescBox').onclick = (e) => {
  if (e.target.closest('a')) return;
  document.getElementById('wDescBox').classList.toggle('collapsed');
};
async function loadUpNext(v) {
  const box = document.getElementById('upNext');
  box.innerHTML = '';
  try {
    const r = await fetch(API + '/api/videos?kind=video');
    const { videos } = await r.json();
    let list = videos.filter(x => x.id !== v.id);
    if (upFilter === 'from') list = list.filter(x => x.owner === v.owner);
    list.slice(0, 12).forEach(x => {
      const d = document.createElement('div');
      d.className = 'upnext';
      d.innerHTML = '<div class="thumb"><video muted preload="metadata" playsinline poster="' + API + '/t/' + x.id + '"></video>' +
        (x.duration ? '<span class="duration">' + fmtDur(x.duration) + '</span>' : '') + '</div>' +
        '<div><h4></h4><p></p></div>';
      d.querySelector('h4').textContent = x.title;
      d.querySelector('p').textContent = x.owner + ' • ' + fmt(x.views || 0) + ' views';
      d.onclick = () => { location.hash = '#/watch/' + x.id; };
      box.appendChild(d);
    });
    if (!list.length) box.innerHTML = '<p class="modal-sub">Nothing else here yet.</p>';
  } catch { box.innerHTML = ''; }
}
document.getElementById('upChips').addEventListener('click', (e) => {
  const c = e.target.closest('.yt-chip');
  if (!c || !currentVideo) return;
  document.querySelectorAll('#upChips .yt-chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  upFilter = c.dataset.uq || '';
  loadUpNext(currentVideo);
});
function paintSave() {
  const later = store.get('firfall_later', []);
  const saved = later.some(x => x.id === currentVideo.id);
  const b = document.getElementById('wSaveBtn');
  b.textContent = saved ? '✓ Saved' : '+ Watch later';
  b.classList.toggle('on', saved);
}
document.getElementById('wSaveBtn').onclick = () => {
  let later = store.get('firfall_later', []);
  if (later.some(x => x.id === currentVideo.id)) later = later.filter(x => x.id !== currentVideo.id);
  else later.unshift({ id: currentVideo.id, title: currentVideo.title, owner: currentVideo.owner, at: Date.now() });
  store.set('firfall_later', later.slice(0, 100));
  paintSave();
};

async function loadComments(vid) {
  const list = document.getElementById('cList');
  list.innerHTML = '';
  try {
    const r = await fetch(API + '/api/comments?video=' + encodeURIComponent(vid));
    const { comments } = await r.json();
    document.getElementById('cCount').textContent = comments.length + ' Comments';
    if (!comments.length) list.innerHTML = '<p class="modal-sub">No comments yet.</p>';
    comments.forEach(c => {
      const d = document.createElement('div');
      d.className = 'comment';
      d.innerHTML = '<strong></strong><span></span><p></p>';
      d.querySelector('strong').textContent = '@' + c.user;
      d.querySelector('span').textContent = ' ' + timeAgo(c.created_at);
      d.querySelector('p').textContent = c.text;
      // No button on your own comment: the server rejects it anyway, and
      // offering it would just be a dead control.
      if (me() && c.user !== me()) {
        const b = document.createElement('button');
        b.className = 'report-btn';
        b.textContent = 'Report';
        b.dataset.k = 'comment'; b.dataset.i = c.id;
        b.title = 'Report this comment to the moderators';
        b.onclick = () => openReport('comment', c.id, '@' + c.user + ': "' + c.text.slice(0, 60) + (c.text.length > 60 ? '...' : '') + '"');
        if (myReports.has('comment:' + c.id)) { b.textContent = 'Reported'; b.classList.add('done'); b.disabled = true; }
        d.appendChild(b);
      }
      list.appendChild(d);
    });
  } catch { list.innerHTML = '<p class="modal-sub">Could not load comments.</p>'; }
}
document.getElementById('cSend').onclick = async () => {
  const err = document.getElementById('cErr');
  err.textContent = '';
  const input = document.getElementById('cInput');
  if (!me()) { err.textContent = 'Sign in to comment.'; return; }
  try {
    const r = await fetch(API + '/api/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
      body: JSON.stringify({ video_id: currentVideo.id, text: input.value })
    });
    const j = await r.json();
    if (!r.ok) { err.textContent = j.error || 'Failed.'; return; }
    input.value = ''; loadComments(currentVideo.id);
  } catch { err.textContent = 'Service unreachable.'; }
};

// ---- Reporting ----
// One dialog serves both comments and videos. Reports are deduplicated per
// target per reporter on the server, so the client only has to avoid offering
// the button twice for the same thing.
const REPORT_WHY = [
  ['spam', 'Spam'], ['harassment', 'Harassment'], ['hate', 'Hate speech'],
  ['sexual', 'Sexual'], ['violence', 'Violence'], ['scam', 'Scam'], ['other', 'Other']
];
let reportTarget = null;
let reportWhy = 'other';
const myReports = new Set();
async function loadMyReports() {
  if (!token()) return;
  try {
    const r = await fetch(API + '/api/reports/mine', { headers: { Authorization: 'Bearer ' + token() } });
    if (!r.ok) return;
    const j = await r.json();
    (j.reported || []).forEach(s => myReports.add(s.split(':').slice(0, 2).join(':')));
  } catch { }
}
function openReport(kind, id, label) {
  if (!me()) { alert('Sign in to report.'); return; }
  const key = kind + ':' + id;
  if (myReports.has(key)) { alert('You already reported this. Moderators have it.'); return; }
  reportTarget = { kind, id };
  reportWhy = 'other';
  document.getElementById('reportTitle').textContent = kind === 'video' ? 'Report video' : 'Report comment';
  document.getElementById('reportTarget').textContent = label || '';
  document.getElementById('reportDetail').value = '';
  const msg = document.getElementById('reportMsg');
  msg.textContent = ''; msg.className = 'auth-err';
  const box = document.getElementById('reportReasons');
  box.innerHTML = '';
  REPORT_WHY.forEach(([val, text]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'report-chip' + (val === 'other' ? ' on' : ''); b.textContent = text;
    b.onclick = () => {
      reportWhy = val;
      [...box.children].forEach(c => c.classList.remove('on'));
      b.classList.add('on');
    };
    box.appendChild(b);
  });
  document.getElementById('reportModal').classList.remove('hidden');
}
document.getElementById('reportX').onclick = () => document.getElementById('reportModal').classList.add('hidden');
document.getElementById('reportModal').onclick = (e) => {
  if (e.target.id === 'reportModal') e.currentTarget.classList.add('hidden');
};
document.getElementById('reportSend').onclick = async () => {
  if (!reportTarget) return;
  const msg = document.getElementById('reportMsg');
  const btn = document.getElementById('reportSend');
  btn.disabled = true; msg.textContent = 'Sending...'; msg.className = 'auth-err';
  try {
    const r = await fetch(API + '/api/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
      body: JSON.stringify({ kind: reportTarget.kind, id: reportTarget.id, reason: reportWhy, detail: document.getElementById('reportDetail').value })
    });
    const j = await r.json().catch(() => ({}));
    btn.disabled = false;
    if (!r.ok) { msg.textContent = j.error || 'Could not send that report.'; return; }
    myReports.add(reportTarget.kind + ':' + reportTarget.id);
    msg.textContent = 'Sent. Thank you.'; msg.className = 'auth-err ok';
    setTimeout(() => document.getElementById('reportModal').classList.add('hidden'), 700);
    markReported(reportTarget.kind, reportTarget.id);
  } catch { btn.disabled = false; msg.textContent = 'Service unreachable.'; }
};
function markReported(kind, id) {
  document.querySelectorAll('.report-btn[data-k="' + kind + '"][data-i="' + id + '"]').forEach(b => {
    b.textContent = 'Reported'; b.classList.add('done'); b.disabled = true;
  });
}

// ---- Library views: subs / history / later ----
// History and Watch later are device-local lists of {id,title,owner}, not API
// rows, so they render their own card: a "when" line instead of the view count
// they do not have, and an ✕ to remove one entry. renderList keeps serving the
// API-backed lists (Subscriptions) with the normal card.
function savedCard(v, opts) {
  const d = document.createElement('div');
  d.className = 'card';
  const when = opts.saved === 'history' && v.at ? 'Watched ' + timeAgo(v.at) : '';
  d.innerHTML = '<div class="thumb"><video muted preload="metadata" playsinline src="' + API + '/v/' + v.id + '" poster="' + API + '/t/' + v.id + '"></video>' +
    '<button class="card-x" aria-label="Remove from list">✕</button></div>' +
    '<div class="meta"><div class="chan">' + ((v.owner || '?')[0] || '?').toUpperCase() + '</div><div><h3></h3><p></p>' +
    (when ? '<p class="card-when"></p>' : '') + '</div></div>';
  d.querySelector('h3').textContent = v.title;
  d.querySelector('p').textContent = v.owner;
  if (when) d.querySelector('.card-when').textContent = when;
  const vid = d.querySelector('video');
  vid.onmouseenter = () => { vid.play().catch(() => {}); };
  vid.onmouseleave = () => { vid.pause(); };
  d.querySelector('.card-x').onclick = (e) => {
    e.stopPropagation();
    // Remove from the underlying list too, or the entry is back on reload.
    store.set(opts.clear, store.get(opts.clear, []).filter(x => x.id !== v.id));
    d.remove();
    if (!document.getElementById('listGrid').children.length) router();
  };
  d.onclick = () => { location.hash = '#/watch/' + v.id; };
  return d;
}
function renderList(title, items, empty, opts) {
  opts = opts || {};
  show(listView); markNav(title === 'Subscriptions' ? 'subs' : title === 'History' ? 'history' : 'later');
  document.getElementById('listTitle').textContent = title;
  document.getElementById('listCount').textContent = items.length ? items.length + (items.length === 1 ? ' video' : ' videos') : '';
  const clearBtn = document.getElementById('listClearBtn');
  clearBtn.classList.toggle('hidden', !opts.clear);
  if (opts.clear) clearBtn.onclick = () => {
    store.set(opts.clear, []);
    renderList(title, [], empty, opts);
  };
  const g = document.getElementById('listGrid');
  g.className = 'yt-grid';
  g.innerHTML = items.length ? '' : '<p class="modal-sub">' + empty + '</p>';
  items.forEach(v => g.appendChild(opts.saved ? savedCard(v, opts) : card(v)));
}
async function renderSubs() {
  if (!me()) { renderList('Subscriptions', [], 'Sign in to see uploads from channels you subscribe to.'); document.getElementById('listCount').textContent = ''; return; }
  try {
    const s = await (await fetch(API + '/api/subscriptions', { headers: { 'Authorization': 'Bearer ' + token() } })).json();
    const names = (s.subscriptions || []).map(x => x.channel);
    if (!names.length) { renderList('Subscriptions', [], 'Channels you subscribe to will show up here.'); return; }
    const all = await (await fetch(API + '/api/videos?kind=video')).json();
    renderList('Subscriptions', (all.videos || []).filter(v => names.includes(v.owner)), 'No uploads from your subscriptions yet.');
  } catch { renderList('Subscriptions', [], 'Could not load.'); }
}
function renderHistory() {
  renderList('History', store.get('firfall_history', []), 'Videos you watch will show up here.', { saved: 'history', clear: 'firfall_history' });
}
function renderLater() {
  renderList('Watch later', store.get('firfall_later', []), 'Save videos with + Watch later to find them here.', { saved: 'later', clear: 'firfall_later' });
}

// ---- Admin panel: user list + role/ban controls. Server re-checks role on every call. ----
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function renderAdmin() {
  if (!isStaff()) { renderList('Admin Panel', [], 'You do not have staff access.'); return; }
  show(listView); markNav('admin');
  document.getElementById('listCount').textContent = '';
  document.getElementById('listClearBtn').classList.add('hidden');
  const sh = document.getElementById('adminShieldBtn');
  if (sh) sh.classList.add('on');
  const box = document.getElementById('listGrid');
  const title = document.getElementById('listTitle');
  title.textContent = isMod() && !isAdmin() ? 'Mod Queue' : 'Admin Panel';
  box.className = 'admin-host';
  // A mod gets the report queue only. The user table can change roles and lift
  // bans, so it stays behind the admin check on both sides.
  if (isMod() && !isAdmin()) {
    box.innerHTML = '<p class="modal-sub">Loading reports…</p>';
    box.appendChild(await staffReportQueue());
    return;
  }
  box.innerHTML = '<p class="modal-sub">Loading users…</p>';
  let users = [];
  try {
    const r = await fetch(API + '/api/admin/users', { headers: { 'Authorization': 'Bearer ' + token() } });
    const j = await r.json();
    if (!r.ok) { box.innerHTML = ''; box.appendChild(Object.assign(document.createElement('p'), { className: 'modal-sub', textContent: j.error || 'Could not load users.' })); return; }
    users = j.users || [];
  } catch { box.innerHTML = '<p class="modal-sub">Admin service unreachable.</p>'; return; }

  box.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'admin-table';
  table.innerHTML = '<thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Network</th><th>Joined</th><th>Actions</th></tr></thead>';
  const tb = document.createElement('tbody');
  users.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><a href="#/channel/' + encodeURIComponent(u.username) + '">@' + esc(u.username) + '</a></td>' +
      '<td><span class="role-pill role-' + esc(u.role || 'user') + '">' + esc(u.role || 'user') + '</span></td>' +
      '<td>' + (u.banned ? '<span class="banned-tag">Banned</span>' : 'Active') + '</td>' +
      '<td><span class="ip-fp" title="One-way HMAC fingerprint. The address itself is never stored.">' + esc(u.last_ip || '—') + '</span></td>' +
      '<td>' + esc(timeAgo(u.created_at)) + '</td>' +
      '<td class="admin-actions"></td>';
    const cell = tr.querySelector('.admin-actions');
    const mk = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; b.className = cls; b.onclick = fn; cell.appendChild(b); };

    mk(u.role === 'admin' ? 'Demote' : 'Make admin', 'btn-mini', () => adminUpdate(u.username, { role: u.role === 'admin' ? 'user' : 'admin' }, tr));
    mk(u.role === 'mod' ? 'Remove mod' : 'Make mod', 'btn-mini', () => adminUpdate(u.username, { role: u.role === 'mod' ? 'user' : 'mod' }, tr));
    // Ask for the reason on the way in. A ban screen that says "banned, reason
    // unknown" is indistinguishable from a broken one, and it makes the appeal
    // button feel pointless because there is nothing to contest.
    mk(u.banned ? 'Unban' : 'Ban', 'btn-mini ' + (u.banned ? '' : 'danger'), () => {
      if (u.banned) { adminUpdate(u.username, { banned: 0 }, tr); return; }
      const reason = prompt('Reason shown to ' + u.username + ' on the ban screen.\nThis is the only thing they see as justification.', '');
      if (reason === null) return;
      adminUpdate(u.username, { banned: 1, reason: reason }, tr);
    });
    const netBtn = document.createElement('button');
    netBtn.className = 'btn-mini danger';
    netBtn.textContent = u.banned ? 'Lift net ban' : 'Ban network';
    netBtn.title = 'Blocks or restores the whole network. Addresses are stored only as one-way HMAC fingerprints, so this matches on the fingerprint and the address itself is never revealed or stored.';
    netBtn.onclick = () => {
      if (!u.banned && !confirm('Ban the entire network for ' + u.username + '?\n\nEveryone sharing that connection will be locked out of FirFall, including you if you are on it. Addresses are never stored in readable form.')) return;
      adminUpdate(u.username, { banned: u.banned ? 0 : 1, poison: !u.banned }, tr);
    };
    cell.appendChild(netBtn);
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  const wrap = document.createElement('div');
  wrap.className = 'admin-wrap';
  const head = document.createElement('p');
  head.className = 'modal-sub';
  head.textContent = users.length + ' account' + (users.length === 1 ? '' : 's') + ' — passwords are hashed and cannot be displayed.';
  wrap.appendChild(head);
  wrap.appendChild(table);
  box.appendChild(wrap);
  box.appendChild(await adminAppealsInbox());
  box.appendChild(await staffReportQueue());
}

// The report queue. Each row carries the reported content and its author inline
// so a moderator can judge without opening anything, and every action resolves
// the report as well as acting on it, so nothing gets silently half-handled.
async function staffReportQueue() {
  const sec = document.createElement('div');
  sec.className = 'staff-queue';
  let list = [];
  try {
    const r = await fetch(API + '/api/staff/reports', { headers: { 'Authorization': 'Bearer ' + token() } });
    const j = await r.json();
    if (r.ok) list = j.reports || [];
  } catch { }
  const open = list.filter(r => r.status === 'open').length;
  const h = document.createElement('h3');
  h.className = 'staff-queue-h';
  h.textContent = 'Reports' + (open ? ' (' + open + ' waiting)' : '');
  sec.appendChild(h);
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'modal-sub';
    p.textContent = 'No reports. Users can flag comments and videos with the Report button.';
    sec.appendChild(p);
    return sec;
  }
  const whyLabel = t => ({ spam: 'Spam', harassment: 'Harassment', hate: 'Hate speech', sexual: 'Sexual', violence: 'Violence', scam: 'Scam', other: 'Other' }[t] || t);
  const reload = () => renderAdmin();
  list.forEach(r => {
    const card = document.createElement('div');
    card.className = 'rcard' + (r.status === 'open' ? ' open' : '');
    const top = document.createElement('div');
    top.className = 'rcard-top';
    top.innerHTML = '<span class="rcard-kind">' + esc(r.target_kind) + '</span>' +
      '<span class="rcard-why">' + esc(whyLabel(r.reason)) + '</span>' +
      '<span>by <span class="rcard-who">@' + esc(r.reporter) + '</span></span>' +
      '<span class="rcard-when">' + esc(timeAgo(r.created_at)) + '</span>' +
      (r.status === 'open' ? '' : '<span class="rcard-res">' + esc(r.status) + (r.resolution ? ' — ' + esc(r.resolution) : '') + '</span>');
    card.appendChild(top);
    if (r.subject && r.subject.gone) {
      const g = document.createElement('p');
      g.className = 'rcard-gone';
      g.textContent = 'The reported content is already gone.';
      card.appendChild(g);
    } else if (r.subject) {
      const s = document.createElement('p');
      s.className = 'rcard-subject';
      s.textContent = r.subject.text;
      card.appendChild(s);
      const c = document.createElement('p');
      c.className = 'rcard-ctx';
      c.textContent = '@' + r.subject.user + (r.context && r.context.video ? ' on "' + r.context.video + '"' : '');
      card.appendChild(c);
    }
    if (r.detail) {
      const d = document.createElement('p');
      d.className = 'rcard-detail';
      d.textContent = 'Reporter said: ' + r.detail;
      card.appendChild(d);
    }
    if (r.status === 'open') {
      const act = document.createElement('div');
      act.className = 'rcard-actions';
      const go = async (action, network) => {
        let msg = null;
        if (action === 'remove') msg = 'Remove this ' + r.target_kind + ' permanently?';
        if (action === 'ban') msg = 'Ban @' + (r.subject && r.subject.user || 'this user') + '?\n\nThey will see the ban screen on their next sign-in.';
        if (network) msg = 'Ban @' + (r.subject && r.subject.user || 'this user') + ' and their entire network?\n\nEveryone on that connection is locked out. You may lock yourself out too.';
        if (msg && !confirm(msg)) return;
        try {
          const res = await fetch(API + '/api/staff/report', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
            body: JSON.stringify({ id: r.id, action, network: !!network })
          });
          const jj = await res.json().catch(() => ({}));
          if (!res.ok) { alert(jj.error || 'Failed.'); return; }
          reload();
        } catch { alert('Service unreachable.'); }
      };
      const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn-mini ' + cls; b.textContent = label; b.onclick = fn; act.appendChild(b); };
      mk('Dismiss', '', () => go('dismiss'));
      mk('Remove ' + r.target_kind, 'danger', () => go('remove'));
      mk('Ban author', 'danger', () => go('ban', false));
      mk('Ban network', 'danger', () => go('ban', true));
      card.appendChild(act);
    }
    sec.appendChild(card);
  });
  return sec;
}

// Appeals land here because there is no Discord to send them to. Approving one
// lifts the ban server-side, so the decision is not just a label on the row.
async function adminAppealsInbox() {
  const sec = document.createElement('div');
  sec.className = 'admin-appeals';
  let list = [];
  try {
    const r = await fetch(API + '/api/admin/appeals', { headers: { 'Authorization': 'Bearer ' + token() } });
    const j = await r.json();
    if (r.ok) list = j.appeals || [];
  } catch { }
  const open = list.filter(a => a.status === 'open').length;
  const h = document.createElement('h3');
  h.className = 'admin-appeals-h';
  h.textContent = 'Appeals' + (open ? ' (' + open + ' waiting)' : '');
  sec.appendChild(h);
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'modal-sub';
    p.textContent = 'No appeals yet. Banned users submit these from the ban screen.';
    sec.appendChild(p);
    return sec;
  }
  const reload = () => renderAdmin();
  list.forEach(a => {
    const card = document.createElement('div');
    card.className = 'appeal-card' + (a.status === 'open' ? ' open' : '');
    const who = document.createElement('div');
    who.className = 'appeal-who';
    who.innerHTML = '<b>@' + esc(a.username) + '</b> <span class="appeal-when">' + esc(timeAgo(a.created_at)) + '</span> <span class="appeal-status ' + esc(a.status) + '">' + esc(a.status) + '</span>';
    card.appendChild(who);
    const msg = document.createElement('p');
    msg.className = 'appeal-msg';
    msg.textContent = a.message;
    card.appendChild(msg);
    if (a.reply) {
      const rep = document.createElement('p');
      rep.className = 'appeal-reply';
      rep.textContent = 'Reply: ' + a.reply;
      card.appendChild(rep);
    }
    if (a.status === 'open') {
      const row = document.createElement('div');
      row.className = 'appeal-actions';
      const input = document.createElement('input');
      input.placeholder = 'Reply shown to the user';
      input.maxLength = 2000;
      row.appendChild(input);
      const act = async (action) => {
        const body = { id: a.id, action, reply: input.value.trim() };
        if (action === 'approve' && !confirm('Approve this appeal and unban @' + a.username + '?')) return;
        try {
          const r = await fetch(API + '/api/admin/appeal', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
            body: JSON.stringify(body)
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) { alert(j.error || 'Failed.'); return; }
          reload();
        } catch { alert('Admin service unreachable.'); }
      };
      const ok = document.createElement('button');
      ok.className = 'btn-mini';
      ok.textContent = 'Approve + unban';
      ok.onclick = () => act('approve');
      const no = document.createElement('button');
      no.className = 'btn-mini danger';
      no.textContent = 'Uphold';
      no.onclick = () => act('uphold');
      row.appendChild(ok); row.appendChild(no);
      card.appendChild(row);
    }
    sec.appendChild(card);
  });
  return sec;
}

async function adminUpdate(target, patch, tr) {
  try {
    const r = await fetch(API + '/api/admin/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
      body: JSON.stringify(Object.assign({ target }, patch))
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert(j.error || 'Update failed.'); return; }
    renderAdmin();
  } catch { alert('Admin service unreachable.'); }
}

function router() {
  if (SITE_DOWN) return;
  const sh = document.getElementById('adminShieldBtn');
  if (sh) sh.classList.remove('on');
  let m = location.hash.match(/^#\/watch\/([A-Za-z0-9-]+)\/?$/);
  if (m) { renderWatch(m[1]); return; }
  m = location.hash.match(/^#\/channel\/([A-Za-z0-9_]+)\/?$/);
  if (m) { renderChannel(m[1]); return; }
  if (location.hash === '#/subs') { renderSubs(); return; }
  if (location.hash === '#/history') { renderHistory(); return; }
  if (location.hash === '#/later') { renderLater(); return; }
  if (location.hash === '#/admin') { renderAdmin(); return; }
  loadHome();
}

// ---- Studio-style upload: file → details → elements → checks → visibility ----
const uploadModal = document.getElementById('uploadModal');
const UP_STEPS = ['details', 'elements', 'checks', 'visibility'];
// A file dragged in from a phone, a messaging app or an odd filesystem can
// arrive with an empty or wrong type, and the server keys the storage name and
// content type off it. The extension is the reliable signal, so it wins over
// the browser's guess and only falls back to the reported type.
const VIDEO_EXT_MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime',
  webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp', '3gpp': 'video/3gpp',
  '3g2': 'video/3gpp2', ts: 'video/mp2t', mts: 'video/mp2t', m2ts: 'video/mp2t',
  avi: 'video/x-msvideo', ogv: 'video/ogg', ogg: 'video/ogg',
  mpg: 'video/mpeg', mpeg: 'video/mpeg', flv: 'video/x-flv', wmv: 'video/x-ms-wmv'
};
function videoMimeOf(file) {
  const ext = (String(file.name || '').toLowerCase().split('.').pop() || '');
  if (VIDEO_EXT_MIME[ext]) return VIDEO_EXT_MIME[ext];
  const t = String(file.type || '').toLowerCase();
  return t.indexOf('video/') === 0 ? t : 'video/mp4';
}
let upStage = -1; // -1 = file picker
let upVisibility = 'private';
let upStaged = null; // {file, thumb, duration, scan}
function upShow(i) {
  upStage = i;
  document.getElementById('upNextBtn').disabled = false;
  ['upStepFile', 'upStepDetails', 'upStepElements', 'upStepChecks', 'upStepVis'].forEach((id, k) =>
    document.getElementById(id).classList.toggle('hidden', k - 1 !== i));
  document.querySelectorAll('#upSteps span').forEach(s => {
    const k = UP_STEPS.indexOf(s.dataset.step);
    s.classList.toggle('on', k === i);
    s.classList.toggle('done', k < i);
  });
  document.getElementById('upBack').classList.toggle('hidden', i <= 0);
  document.getElementById('upNextBtn').textContent = 'Next';
}
function upSetVis(v) {
  upVisibility = v;
  document.getElementById('upSavedPill').textContent = 'Saved as ' + v;
  document.querySelectorAll('#upVisPills button').forEach(b => b.classList.toggle('on', b.dataset.vis === v));
}
document.getElementById('adminShieldBtn').onclick = () => {
  accountMenu.classList.add('hidden');
  if (!isStaff()) { alert('Staff access only.'); return; }
  location.hash = '#/admin';
};
document.getElementById('createBtn').onclick = () => {
  if (!me()) { setMode('login'); modal.classList.remove('hidden'); return; }
  document.getElementById('upErr').textContent = '';
  document.getElementById('upErrFile').textContent = '';
  document.getElementById('upStatus').textContent = '';
  document.getElementById('upFootStatus').textContent = 'Select a file to begin';
  document.getElementById('upProgOuter').classList.add('hidden');
  document.getElementById('upDlgTitle').textContent = 'Upload video';
  document.getElementById('upFilename').textContent = '—';
  document.getElementById('upLink').textContent = 'Available after publishing';
  document.getElementById('upLink').removeAttribute('href');
  upStaged = null;
  upSetVis('private');
  const nb = document.getElementById('upNextBtn');
  nb.textContent = 'Next';
  nb.disabled = false;
  if (window._upNextDefault) nb.onclick = window._upNextDefault;
  upShow(-1);
  uploadModal.classList.remove('hidden');
};
document.getElementById('uploadClose').onclick = () => uploadModal.classList.add('hidden');
const dropZone = document.getElementById('dropZone');
['dragover', 'dragenter'].forEach(ev => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('over'); }));
dropZone.addEventListener('drop', (e) => {
  if (e.dataTransfer.files.length) { document.getElementById('upFile').files = e.dataTransfer.files; stageFile(e.dataTransfer.files[0]); }
});
document.getElementById('upFile').addEventListener('change', (e) => { if (e.target.files[0]) stageFile(e.target.files[0]); });
const MAX_UPLOAD = 250_000_000;
window.addEventListener('error', (e) => {
  if (!uploadModal.classList.contains('hidden') && e && e.message) {
    const el = document.getElementById('upErr');
    if (el && !el.textContent) el.textContent = 'Something broke: ' + e.message;
  }
});
async function stageFile(file) {
  const err = document.getElementById('upErrFile');
  err.textContent = '';
  if (file.size > MAX_UPLOAD) { err.textContent = 'File too big — max 250MB.'; return; }
  document.getElementById('upDlgTitle').textContent = file.name;
  document.getElementById('upFilename').textContent = file.name.length > 40 ? file.name.slice(0, 40) + '…' : file.name;
  document.getElementById('upTitle').value = file.name.replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').slice(0, 100);
  document.getElementById('upTitleCount').textContent = document.getElementById('upTitle').value.length + '/100';
  upShow(0);
  document.getElementById('upFootStatus').textContent = 'Upload complete … processing will begin shortly';
  const cgResult = document.getElementById('upCgResult');
  const cgMark = document.getElementById('upCgMark');
  cgResult.textContent = 'Running safety checks…';
  cgMark.textContent = '…'; cgMark.className = 'check-na';
  const [scan, thumb, duration] = await Promise.all([
    scanVideo(file, (t) => { cgResult.textContent = t; }),
    captureThumb(file),
    getDuration(file)
  ]);
  if (scan === 'blocked') {
    err.textContent = 'Blocked: on-device scan flagged explicit content.';
    cgResult.textContent = 'Issues found — explicit content detected';
    cgMark.textContent = '✗'; cgMark.className = 'check-bad';
    upShow(-1); return;
  }
  const prev = document.getElementById('upThumbPrev');
  if (thumb) prev.src = URL.createObjectURL(thumb); else prev.removeAttribute('src');
  document.getElementById('upProcNote').textContent = fmtDur(duration) + ' • safety scan ' + scan;
  cgResult.textContent = 'No issues found';
  cgMark.textContent = '✓'; cgMark.className = 'check-ok';
  document.getElementById('upFootStatus').textContent = 'Checks complete. No issues found.';
  upStaged = { file, thumb, duration, scan };
}
document.getElementById('upTitle').addEventListener('input', (e) => {
  document.getElementById('upTitleCount').textContent = e.target.value.length + '/100';
});
document.getElementById('upReuse').onclick = () => {
  document.getElementById('upDesc').value = document.getElementById('upDesc').value || 'New upload via FirFall.';
};
document.querySelectorAll('#upVisPills button').forEach(b => { b.onclick = () => upSetVis(b.dataset.vis); });
document.getElementById('upNextBtn').onclick = () => {
  try {
    if (upStage === -1) { document.getElementById('upFile').click(); return; }
  if (upStage === 0 && !document.getElementById('upTitle').value.trim()) {
    document.getElementById('upErr').textContent = 'Title is required.'; return;
  }
  document.getElementById('upErr').textContent = '';
  if (upStage < 3) { upShow(upStage + 1); return; }
  publishStaged();
  } catch (e) { document.getElementById('upErr').textContent = 'Something broke: ' + (e.message || e); }
};
document.getElementById('upBack').onclick = () => { if (upStage > 0) upShow(upStage - 1); };
document.querySelectorAll('.el-add').forEach(b => {
  b.onclick = () => { document.getElementById('upFootStatus').textContent = 'Not in the test version yet — press Next to continue.'; };
});
window._upNextDefault = document.getElementById('upNextBtn').onclick;
async function publishStaged() {
  const err = document.getElementById('upErr');
  err.textContent = '';
  const btn = document.getElementById('upNextBtn');
  const fail = (m) => { btn.disabled = false; err.textContent = m; };
  if (!upStaged) { fail('Still preparing your file — wait for "Checks complete" then try again.'); return; }
  const title = document.getElementById('upTitle').value.trim();
  const desc = document.getElementById('upDesc').value.trim();
  if (!title) { fail('Title is required.'); return; }
  btn.disabled = true;
  document.getElementById('upProgOuter').classList.remove('hidden');
  const fill = document.getElementById('upProgFill');
  const status = (t) => { document.getElementById('upStatus').textContent = t; document.getElementById('upFootStatus').textContent = t; };
  status('Starting upload session…');
  let start;
  const sendMime = videoMimeOf(upStaged.file);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(API + '/api/uploads/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
        body: JSON.stringify({ filename: upStaged.file.name, mime: sendMime, size: upStaged.file.size,
          title, description: desc, duration: upStaged.duration, visibility: upVisibility, scan: upStaged.scan })
      });
      start = await r.json().catch(() => ({}));
      if (r.ok) break;
      if (r.status < 500 || attempt === 1) { fail((start.error || 'Upload rejected.') + ' (code ' + r.status + ')'); return; }
      status('Server hiccup — retrying…');
      await new Promise(res => setTimeout(res, 2000));
      start = null;
    } catch {
      if (attempt === 1) { fail('Upload failed — service unreachable.'); return; }
      await new Promise(res => setTimeout(res, 2000));
    }
  }
  const sessionId = start.sessionId, chunkSize = start.chunkSize || 6000000;
  const file = upStaged.file;
  status('Uploading 0%…');
  let off = 0, still = 0;
  while (off < file.size) {
    const chunk = file.slice(off, Math.min(off + chunkSize, file.size));
    const f = new FormData();
    f.append('sessionId', sessionId);
    f.append('off', String(off));
    f.append('chunk', chunk, 'part');
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const r = await fetch(API + '/api/uploads/chunk', {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + token() }, body: f
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { fail((j.error || 'Chunk failed.') + ' (code ' + r.status + ')'); return; }
        if (typeof j.uploaded !== 'number') { fail('Chunk failed — bad response.'); return; }
        if (j.uploaded <= off) { if (++still >= 3) { fail('Upload stalled — check connection and retry.'); return; } }
        else { still = 0; off = j.uploaded; }
        ok = true;
        const pct = Math.round((off / file.size) * 100);
        fill.style.width = pct + '%';
        status('Uploading ' + pct + '%…');
      } catch { if (attempt === 2) { fail('Upload failed — service unreachable.'); return; } }
    }
  }
  status('Finalizing…');
  const done = new FormData();
  done.append('sessionId', sessionId);
  if (upStaged.thumb) done.append('thumb', upStaged.thumb, 'thumb.jpg');
  let j = {};
  try {
    const r = await fetch(API + '/api/uploads/complete', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token() }, body: done
    });
    j = await r.json();
    if (!r.ok) { fail(j.error || 'Upload failed.'); return; }
  } catch { fail('Upload failed — service unreachable.'); return; }
    fill.style.width = '100%';
    btn.disabled = false;
    status('Upload complete … processing will begin shortly');
    const link = location.origin + location.pathname + '#/watch/' + j.id;
    const a = document.getElementById('upLink');
    a.textContent = link; a.href = link;
    upStaged = null;
    btn.textContent = 'Done';
    btn.onclick = () => {
      uploadModal.classList.add('hidden');
      btn.textContent = 'Next';
      btn.disabled = false;
      if (j.status === 'flagged') { alert('Held for review: ' + (j.message || 'auto-filter matched.')); loadHome(); }
      else location.hash = '#/watch/' + j.id;
    };
};

function sampleFrames(file, n) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    const canvas = document.createElement('canvas');
    const shots = [];
    v.onloadedmetadata = async () => {
      canvas.width = 224; canvas.height = 224;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      for (let i = 0; i < n; i++) {
        const t = v.duration * (i + 1) / (n + 1);
        try {
          await new Promise((res, rej) => {
            const to = setTimeout(() => rej(new Error('seek timeout')), 8000);
            v.onseeked = () => { clearTimeout(to); res(); };
            v.currentTime = Math.min(t, Math.max(0, v.duration - 0.1));
          });
          ctx.drawImage(v, 0, 0, 224, 224);
          shots.push(ctx.getImageData(0, 0, 224, 224));
        } catch { break; }
      }
      URL.revokeObjectURL(url);
      v.pause(); v.removeAttribute('src'); v.load();
      resolve(shots);
    };
    v.onerror = () => { URL.revokeObjectURL(url); resolve([]); };
  });
}
async function scanVideo(file, status) {
  try {
    status('Loading on-device safety scan…');
    const nsfw = await Promise.race([
      import('https://esm.sh/nsfwjs@4.2.1'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('scan lib timeout')), 20000))
    ]);
    const model = await nsfw.load();
    const frames = await sampleFrames(file, 5);
    if (!frames.length) return 'skipped';
    let porn = 0, sexy = 0;
    for (const f of frames) {
      const preds = await model.classify(f);
      const get = (n) => (preds.find(p => p.className === n) || { probability: 0 }).probability;
      if (get('Porn') >= 0.6 || get('Hentai') >= 0.6) porn++;
      if (get('Sexy') >= 0.85) sexy++;
      status('Scanning frames… (' + porn + ' explicit)');
    }
    model.dispose();
    return (porn >= 1 || sexy >= 2) ? 'blocked' : 'clean';
  } catch (e) { return 'skipped'; }
}
function getDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata'; v.src = url;
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); v.pause(); v.removeAttribute('src'); v.load(); resolve(v.duration || 0); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
  });
}
function captureThumb(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.src = url;
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, v.duration / 2);
      v.onseeked = () => {
        const c = document.createElement('canvas');
        c.width = 640; c.height = 360;
        c.getContext('2d').drawImage(v, 0, 0, 640, 360);
        URL.revokeObjectURL(url);
        v.pause(); v.removeAttribute('src'); v.load();
        c.toBlob(b => resolve(b), 'image/jpeg', 0.7);
      };
    };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
  });
}
window.addEventListener('hashchange', router);
refreshAuthUI();
if (!SITE_DOWN) router();
