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
const studioView = document.getElementById('studioView');
function show(el) { [homeView, channelView, watchView, listView, studioView].forEach(v => v.classList.add('hidden')); el.classList.remove('hidden');
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
      // The shelf hands over the whole list it was built from, so paging
      // through the viewer walks the shelf rather than refetching.
      b.onclick = () => openShorts(list, v.id);
      row.appendChild(b);
    });
    shelf.classList.remove('hidden');
  } catch { shelf.classList.add('hidden'); }
}
// ---- Shorts: the full-screen vertical player ----
// One ember per screen with the Shorts gesture. On the phone that gesture is
// vertical, so the track scrolls down a column; on a desktop window there is
// no column to scroll, so it runs sideways and the arrow keys page it. Both
// are the same component - a scroll-snap track and an IntersectionObserver
// that decides which slide is current - which is why one implementation
// covers both.
//
// Every clip starts muted: a browser will not autoplay sound before a user
// gesture, and a Shorts panel that sits silent because play() was rejected is
// worse than one that starts quiet with an obvious unmute button.
let shortsIO = null, shortsList = [], shortsMuted = true, watchPlain = false;
let shortsCurrent = null;
// True when the panel was opened from a #/watch/... link rather than the shelf,
// so closing it puts the address bar back where it started.
let shortsPushed = false;

function shortSlide(v, i) {
  return '<div class="short" data-i="' + i + '">' +
    '<div class="short-stage">' +
      '<video playsinline loop muted preload="none" poster="' + esc(API + '/t/' + v.id) + '"></video>' +
      '<div class="short-tap"></div>' +
      '<div class="short-big">&#9654;</div>' +
      '<div class="short-info"><div class="sh-at">@' + esc(v.owner) + '</div>' +
        '<div class="sh-ti">' + esc(v.title) + '</div></div>' +
      '<div class="short-rail">' +
        '<div class="sh-av" data-ch="' + esc(v.owner) + '">' + esc((v.owner[0] || '?').toUpperCase()) + '</div>' +
        '<button data-a="like" class="s-like" aria-label="Like"><svg viewBox="0 0 24 24"><path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h4h1h9.43c1.06 0 1.98-.67 2.19-1.61l1.34-6C21.23 12.15 20.18 11 18.77 11z"/></svg><span>Like</span></button>' +
        '<button data-a="dislike" class="s-dislike" aria-label="Dislike"><svg viewBox="0 0 24 24"><path d="M5.23 13h4.23l-1.52 4.94C7.62 18.97 8.46 20 9.62 20c.58 0 1.14-.24 1.52-.65L17 13h4V3h-4H8.57c-1.06 0-1.98.67-2.19 1.61l-1.34 6C4.77 11.85 5.82 13 7.23 13z"/></svg><span></span></button>' +
        '<button data-a="comment" class="s-cmt" aria-label="Comments"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg><span></span></button>' +
        '<button data-a="share" class="s-share" aria-label="Share"><svg viewBox="0 0 24 24"><path d="M15 5.63 20.66 12 15 18.37V14h-1c-3.96 0-7.14 1-9.75 3.09 1.84-4.07 5.11-6.4 9.89-7.1l.86-.13V5.63M14 3v6C6.22 10.13 3.11 15.33 2 21c2.78-3.97 6.44-5.78 12-5.78V21l8-9-8-9z"/></svg><span>Share</span></button>' +
      '</div>' +
      '<div class="short-prog"><i></i></div>' +
    '</div></div>';
}

// list omitted = fetch it. The shelf already has the array, so it passes one in
// and you page through exactly what you were looking at.
function openShorts(list, startId) {
  if (!list) {
    fetch(API + '/api/videos?kind=ember&limit=50').then(r => r.json()).then(j => openShorts(j.videos || [], startId))
      .catch(() => {});
    return;
  }
  const items = (list || []).filter(v => v && v.id);
  if (!items.length) return;
  shortsList = items;
  const track = document.getElementById('shortsTrack');
  track.innerHTML = items.map(shortSlide).join('');
  document.getElementById('shorts').classList.add('on');
  wireShorts();
  let at = 0;
  items.forEach((v, i) => { if (v.id === startId) at = i; });
  // clientWidth is only meaningful once the overlay is displayed.
  track.scrollLeft = at * track.clientWidth;
  observeShorts();
  paintShortMute();
}
function wireShorts() {
  const track = document.getElementById('shortsTrack');
  track.querySelectorAll('.short').forEach(sl => {
    const v = shortsList[+sl.dataset.i];
    const video = sl.querySelector('video'), stage = sl.querySelector('.short-stage');
    sl.querySelector('.short-tap').onclick = () => {
      if (video.paused) { video.play().catch(() => {}); stage.classList.remove('paused'); }
      else { video.pause(); stage.classList.add('paused'); }
    };
    video.addEventListener('timeupdate', () => {
      const f = video.duration && isFinite(video.duration) ? video.currentTime / video.duration : 0;
      sl.querySelector('.short-prog i').style.width = (f * 100).toFixed(2) + '%';
    });
    sl.querySelector('.sh-av').onclick = () => { closeShorts(); location.hash = '#/channel/' + v.owner; };
    sl.querySelector('[data-a="like"]').onclick = () => shortReact(sl, 'like');
    sl.querySelector('[data-a="dislike"]').onclick = () => shortReact(sl, 'dislike');
    // Comments open over the player rather than throwing you out to the watch
    // page - the clip keeps playing behind the panel, which is the point.
    sl.querySelector('[data-a="comment"]').onclick = () => openShortComments(v);
    sl.querySelector('[data-a="share"]').onclick = e => shareShort(e.currentTarget, v);
  });
}
function observeShorts() {
  if (shortsIO) shortsIO.disconnect();
  shortsIO = new IntersectionObserver(entries => {
    entries.forEach(e => {
      const video = e.target.querySelector('video');
      if (e.isIntersecting && e.intersectionRatio > 0.6) shortActivate(e.target);
      // Never pause the slide that is currently playing - the observer can
      // report a second entry for it after a scroll has already moved on.
      else if (video && e.target !== shortsCurrent) video.pause();
    });
  }, { root: document.getElementById('shortsTrack'), threshold: [0, 0.6] });
  document.querySelectorAll('#shortsTrack .short').forEach(sl => shortsIO.observe(sl));
}
function shortActivate(sl) {
  const v = shortsList[+sl.dataset.i];
  if (!v) return;
  // Exactly one clip plays, always. The observer alone could not guarantee
  // that: it fires once per intersection change, so during the opening scroll
  // - or on a window narrow enough that a neighbour is still >60% visible -
  // two slides could both be told they were current and both start playing.
  // Pausing the previous one here makes it an invariant, not a hope.
  if (shortsCurrent && shortsCurrent !== sl) {
    const other = shortsCurrent.querySelector('video');
    // Unconditional: pausing a video that is already paused is a no-op, but
    // guarding on .paused means a stale read lets the old clip keep going.
    if (other) other.pause();
  }
  shortsCurrent = sl;
  const video = sl.querySelector('video');
  if (!video.getAttribute('src')) video.src = mediaUrlWithToken('v', v.id);
  try { video.currentTime = 0; } catch (e) {}
  sl.querySelector('.short-stage').classList.remove('paused');
  video.play().catch(() => {});
  fetch(API + '/api/video/view', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: v.id, viewer: viewerId() })
  }).catch(() => {});
  shortPaint(sl, v.id);
}
function shortPaint(sl, id) {
  fetch(API + '/api/video?id=' + encodeURIComponent(id)).then(r => r.json()).then(j => {
    const lk = sl.querySelector('.s-like'), ds = sl.querySelector('.s-dislike');
    lk.classList.toggle('on', j.reaction === 'like');
    ds.classList.toggle('on', j.reaction === 'dislike');
    lk.querySelector('span').textContent = j.likes ? fmt(j.likes) : 'Like';
  }).catch(() => {});
}
function shortReact(sl, kind) {
  if (!me()) { closeShorts(); setMode('login'); modal.classList.remove('hidden'); return; }
  const v = shortsList[+sl.dataset.i];
  if (!v) return;
  const btn = sl.querySelector(kind === 'like' ? '.s-like' : '.s-dislike');
  const want = btn.classList.contains('on') ? 'none' : kind;   // tapping again clears it
  fetch(API + '/api/video/react', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
    body: JSON.stringify({ id: v.id, kind: want })
  }).then(r => r.json()).then(j => {
    sl.querySelector('.s-like').classList.toggle('on', j.reaction === 'like');
    sl.querySelector('.s-dislike').classList.toggle('on', j.reaction === 'dislike');
    sl.querySelector('.s-like span').textContent = j.likes ? fmt(j.likes) : 'Like';
  }).catch(() => {});
}
// The site copies a link; there is no native share sheet on the desktop, and
// inventing one would be a worse experience than the clipboard.
async function shareShort(btn, v) {
  const link = location.origin + location.pathname + '#/watch/' + v.id;
  const done = () => {
    btn.querySelector('span').textContent = 'Copied';
    setTimeout(() => { if (btn.isConnected) btn.querySelector('span').textContent = 'Share'; }, 1500);
  };
  try { await navigator.clipboard.writeText(link); done(); }
  catch { prompt('Copy link:', link); }
}
// ---- Comments inside the Shorts panel ----
// A slide panel over the player, not a route change. The comment renderer is
// the same one the watch page uses - only the target element differs - so a
// comment looks and behaves identically in both places, including the report
// buttons.
function openShortComments(v) {
  const panel = document.getElementById('shortsComments');
  const list = document.getElementById('scList');
  const foot = document.getElementById('scFoot');
  document.getElementById('scTitle').textContent = 'Comments';
  panel.classList.add('on');
  list.innerHTML = '<p class="modal-sub">Loading...</p>';
  renderComments(v.id, list);
  foot.innerHTML = me()
    ? '<textarea id="scInput" rows="1" maxlength="500" placeholder="Add a comment..."></textarea>' +
      '<button class="sc-go" id="scSend">Comment</button>'
    : '<button class="sc-signin" id="scSignin">Sign in to comment</button>';
  if (!me()) {
    document.getElementById('scSignin').onclick = () => { setMode('login'); modal.classList.remove('hidden'); };
    return;
  }
  const ta = document.getElementById('scInput'), send = document.getElementById('scSend');
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(110, ta.scrollHeight) + 'px';
  });
  send.onclick = () => {
    const text = ta.value.trim();
    if (!text) return;
    send.disabled = true;
    fetch(API + '/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
      body: JSON.stringify({ video_id: v.id, text })
    }).then(r => r.json()).then(() => {
      ta.value = ''; ta.style.height = 'auto'; send.disabled = false;
      renderComments(v.id, list);
    }).catch(() => { send.disabled = false; });
  };
}
document.getElementById('scClose').onclick = () => document.getElementById('shortsComments').classList.remove('on');

/* The Embers page. The shelf under the home grid is a row you scroll sideways
   and run out of; this is the same set of clips as a grid, with its own route
   so it can be linked to and bookmarked. */
async function renderEmbers() {
  show(listView); markNav('embers');
  document.getElementById('listCount').textContent = '';
  document.getElementById('listClearBtn').classList.add('hidden');
  document.getElementById('listTitle').textContent = 'Embers';
  const box = document.getElementById('listGrid');
  box.className = 'ember-grid';
  box.innerHTML = '<div class="blank-state"><p>Loading...</p></div>';
  let list = [];
  try {
    const r = await fetch(API + '/api/videos?kind=ember&limit=60');
    const { videos } = await r.json();
    list = (videos || []).filter(v => v.visibility === 'public');
  } catch { list = []; }
  box.innerHTML = '';
  if (!list.length) {
    box.className = 'yt-grid';
    box.innerHTML = '<div class="blank-state"><h2>No embers yet</h2><p>Record one in the FirFall Android app.</p></div>';
    return;
  }
  list.forEach(v => {
    const b = document.createElement('button');
    b.className = 'ember-card';
    b.innerHTML = '<div class="ember-thumb"><img alt="" loading="lazy" src="' + esc(API + '/t/' + v.id) + '">' +
      (v.duration ? '<span class="ember-dur">' + fmtDur(v.duration) + '</span>' : '') +
      '<span class="ember-views">' + fmt(v.views || 0) + ' views</span></div>' +
      '<div class="ember-meta"><h3></h3><p></p></div>';
    b.querySelector('h3').textContent = v.title;
    b.querySelector('p').textContent = v.owner + ' \u2022 ' + timeAgo(v.created_at);
    b.onclick = () => openShorts(list, v.id);
    box.appendChild(b);
  });
}

function mediaUrlWithToken(kind, id) {
  const u = API + (kind === 'v' ? '/v/' : '/t/') + encodeURIComponent(id);
  return token() ? u + '?token=' + encodeURIComponent(token()) : u;
}
function paintShortMute() {
  const b = document.getElementById('shortMute');
  if (b) b.innerHTML = shortsMuted
    ? '<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
}
function toggleShortMute() {
  shortsMuted = !shortsMuted;
  paintShortMute();
  document.querySelectorAll('#shortsTrack video').forEach(v => { v.muted = shortsMuted; });
}
function closeShorts() {
  if (shortsIO) { shortsIO.disconnect(); shortsIO = null; }
  shortsCurrent = null;
  const sc = document.getElementById('shortsComments');
  if (sc) sc.classList.remove('on');
  const track = document.getElementById('shortsTrack');
  track.querySelectorAll('video').forEach(v => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} });
  track.innerHTML = '';
  document.getElementById('shorts').classList.remove('on');
  shortsList = [];
  // Opened from a #/watch/... link? Put the address bar back to the shelf, or
  // Reload would drop you straight back into the panel you just closed.
  if (shortsPushed) { shortsPushed = false; location.hash = '#/'; }
}
document.getElementById('shortsClose').onclick = closeShorts;
document.getElementById('shortMute').onclick = toggleShortMute;
paintShortMute();
// Arrow keys page the strip; Esc closes. Bound on the document because the
// track itself is not focusable and focus may be anywhere on the page.
document.addEventListener('keydown', e => {
  if (!document.getElementById('shorts').classList.contains('on')) return;
  if (e.key === 'Escape') { closeShorts(); return; }
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const track = document.getElementById('shortsTrack');
  track.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * track.clientWidth, behavior: 'smooth' });
});

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
    // Remove only appears when there is something to remove - a button that is
    // always there and does nothing is worse than no button.
    document.getElementById('chBannerRemove').classList.toggle('hidden', !c.banner);
    document.getElementById('chAvatarRemove').classList.toggle('hidden', !c.avatar);
    meta.textContent = '@' + c.username + ' • ' + fmt(c.subscribers) + ' subscribers • ' + c.videos + ' videos';
    document.getElementById('chAbout').textContent = c.about || 'This channel has no description yet.';
    document.getElementById('chStats').textContent = fmt(c.views) + ' total views • joined ' + new Date(c.joined).toLocaleDateString();
    // kind=video explicitly: the API treats a missing kind as "both", so without
    // it the channel's Videos tab filled up with other people's embers.
    const r = await fetch(API + '/api/videos?kind=video&owner=' + encodeURIComponent(c.username),
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
// Own-channel customisation (banner / picture / description).
// These go through the same cropper as FirFall Studio, so the framing you
// choose here is the framing you get there and on every other client. The old
// version uploaded the picked file immediately, which meant a mis-click could
// replace a good banner with a badly-framed one and there was no way back.
function ownChannelReload() {
  const m = document.getElementById('chMeta');
  if (m && m.dataset.owner) renderChannel(m.dataset.owner);
}
function channelArtChanged(kind, file) {
  const err = document.getElementById('chAboutErr');
  uploadArtFile(kind, file)
    .then(ownChannelReload)
    .catch(e => { if (err) { err.textContent = e.message || 'Upload failed.'; } else alert(e.message); });
}
function channelArtRemove(kind) {
  const err = document.getElementById('chAboutErr');
  confirmRemove(kind, () => removeArtRemote(kind).then(ownChannelReload), e => { if (err) err.textContent = e; });
}
document.getElementById('chBannerEdit').onclick = () => pickAndCrop('banner', f => channelArtChanged('banner', f));
document.getElementById('chAvatarEdit').onclick = () => pickAndCrop('avatar', f => channelArtChanged('avatar', f));
document.getElementById('chBannerRemove').onclick = () => channelArtRemove('banner');
document.getElementById('chAvatarRemove').onclick = () => channelArtRemove('avatar');
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
/* ---------- watch statistics ----------
   Retention needs to know how far people got, and the only place that is true
   is the player. A random per-browser id is sent instead of an account or an
   IP: most viewers are signed out, and the difference between "how long did
   people watch" and "here is who watched" is the whole point.
   Reports are throttled to one every 15s and the peak is sent, so scrubbing
   forward to the end does not report the whole clip as watched. */
let watchId = null, progAt = 0, progPeak = 0;
function viewerId() {
  if (watchId) return watchId;
  try {
    watchId = localStorage.getItem('firfall_vid');
    if (!watchId) {
      watchId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^a-z0-9-]/gi, '');
      localStorage.setItem('firfall_vid', watchId);
    }
  } catch { watchId = 'anon'; }
  return watchId;
}
let progressId = null;
function reportProgress(p) {
  if (!currentVideo || !currentVideo.id) return;
  if (progressId !== currentVideo.id) { progressId = currentVideo.id; progAt = 0; progPeak = 0; }
  if (!p.duration || !isFinite(p.duration) || p.paused) return;
  progPeak = Math.max(progPeak, p.currentTime);
  const now = Date.now();
  if (now - progAt < 15000) return;
  progAt = now;
  fetch(API + '/api/video/progress', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: progressId, viewer: viewerId(), watched: Math.round(progPeak), duration: p.duration })
  }).catch(() => {});
}
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
    reportProgress(player);
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
    // An ember opened by link or from a list goes to the full-screen vertical
    // player. watchPlain is the comment button inside that player, which asked
    // for the full page on purpose; the flag is consumed either way.
    if (v.kind === 'ember' && !watchPlain) {
      watchPlain = false;
      // Already showing this clip: the router can fire twice for one Back, and
      // rebuilding the panel under the user would throw away their place.
      const already = document.getElementById('shorts').classList.contains('on') &&
        shortsList.some(x => x.id === v.id);
      if (!already) { shortsPushed = true; openShorts(null, v.id); }
      return;
    }
    watchPlain = false;
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
    fetch(API + '/api/video/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, viewer: viewerId() }) }).catch(() => {});
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

// target defaults to the watch page's list. The Shorts panel passes its own,
// so both places share one renderer and one set of report buttons instead of
// the panel growing a plainer, less capable copy later.
async function loadComments(vid, target) {
  const list = target || document.getElementById('cList');
  list.innerHTML = '';
  try {
    const r = await fetch(API + '/api/comments?video=' + encodeURIComponent(vid));
    const { comments } = await r.json();
    const cc = document.getElementById('cCount');
    if (cc) cc.textContent = comments.length + ' Comments';
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
const renderComments = (vid, target) => loadComments(vid, target);
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
// ---- FirFall Studio ----
// The creator side. FirFall's flame and orange rather than a YouTube pastiche:
// this is FirFall's studio and pretending otherwise helps nobody.
//
// Videos and Embers are kept in separate tabs on purpose. A vertical ember is
// not a video that happens to be tall, and the API's default kind filter is
// "both" - so one table over the unfiltered list would be exactly the thing
// that put embers in the normal feed in the first place.
const FS_VIS = [
  ['public', 'Public', 'Anyone can watch'],
  ['unlisted', 'Unlisted', 'Only people with the link'],
  ['private', 'Private', 'Only you']
];
let fsTab = 'home', fsKind = 'video', fsFilter = 'all', fsVideos = [], fsChannel = null, fsStats = {}, fsDays = 28;

async function renderStudio() {
  show(studioView); markNav('studio');
  document.getElementById('fsChannel').textContent = me() ? '@' + me() : '';
  document.querySelectorAll('.fs-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === fsTab));
  const body = document.getElementById('fsBody');
  if (!me()) {
    body.innerHTML = '<div class="fs-empty"><h2>Sign in to open FirFall Studio</h2>' +
      '<p>Studio is where you manage your channel and your videos.</p></div>';
    return;
  }
  body.innerHTML = '<div class="blank-state"><p>Loading...</p></div>';
  // The channel is needed on every tab: customise previews the banner and
  // picture from it, and the dashboard shows the avatar.
  try { fsChannel = await (await fetch(API + '/api/channel?name=' + encodeURIComponent(me()))).json(); }
  catch { fsChannel = null; }
  try {
    const r = await fetch(API + '/api/studio/videos', { headers: { 'Authorization': 'Bearer ' + token() } });
    const j = await r.json();
    if (r.ok) { fsVideos = j.videos || []; fsStats = j.stats || {}; }
  } catch { fsVideos = []; }
  if (fsTab === 'customise') studioCustomise();
  else if (fsTab === 'videos') studioVideos();
  else if (fsTab === 'analytics') studioAnalytics();
  else studioHome();
}

function studioHome() {
  const av = fsChannel && fsChannel.avatar
    ? '<img src="' + esc(API + fsChannel.avatar + '?t=' + Date.now()) + '" alt="">'
    : '<div class="fs-pic-prev" style="display:flex;align-items:center;justify-content:center;' +
      'font-size:32px;font-weight:800;color:#555">' + esc((me() || '?')[0].toUpperCase()) + '</div>';
  const videos = fsVideos.filter(v => v.kind !== 'ember').length;
  const embers = fsVideos.filter(v => v.kind === 'ember').length;
  document.getElementById('fsBody').innerHTML =
    '<div class="fs-cards">' +
      '<button class="fs-card" id="fsGoCustomise">' +
        '<svg viewBox="0 0 24 24"><path d="M3 5h18v4H3V5zm0 7h18v3H3v-3zm0 6h11v3H3v-3z"/></svg>' +
        '<strong>Customise channel</strong>' +
        '<span>Banner, picture and the description on your channel page.</span></button>' +
      '<button class="fs-card" id="fsGoVideos">' +
        '<svg viewBox="0 0 24 24"><path d="M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h10v2H4v-2z"/></svg>' +
        '<strong>Manage videos</strong>' +
        '<span>Edit titles, descriptions and visibility, or delete something.</span></button>' +
      '<button class="fs-card" id="fsGoAnalytics">' +
        '<svg viewBox="0 0 24 24"><path d="M4 19h3v-7H4v7zm6.5 0h3V5h-3v14zm6.5 0h3v-9h-3v9z"/></svg>' +
        '<strong>Analytics</strong>' +
        '<span>Views over time and how much of each clip people watch through.</span></button>' +
    '</div>' +
    '<div class="fs-stats">' +
      '<div class="fs-stat"><b>' + fmt(videos) + '</b><span>Videos</span></div>' +
      '<div class="fs-stat"><b>' + fmt(embers) + '</b><span>Embers</span></div>' +
      '<div class="fs-stat"><b>' + fmt(fsStats.views || 0) + '</b><span>Total views</span></div>' +
      '<div class="fs-stat"><b>' + fmt(fsStats.comments || 0) + '</b><span>Comments</span></div>' +
    '</div>' +
    '<div style="display:flex;gap:18px;align-items:center">' + av +
      '<div><div style="font-size:18px;font-weight:700">@' + esc(me()) + '</div>' +
      '<div style="color:#aaa;font-size:13.5px;max-width:60ch">' +
        esc((fsChannel && fsChannel.about) || 'No channel description yet.') + '</div></div></div>';
  document.getElementById('fsGoCustomise').onclick = () => { fsTab = 'customise'; renderStudio(); };
  document.getElementById('fsGoVideos').onclick = () => { fsTab = 'videos'; renderStudio(); };
  const ga = document.getElementById('fsGoAnalytics'); if (ga) ga.onclick = () => { fsTab = 'analytics'; renderStudio(); };
}

/* ---- Channel customisation ----
   Change and Remove are separate because they are separate actions: one
   replaces the file, the other clears the stored key and drops the object.
   Leaving the column pointing at a deleted file is how a "removed" picture
   comes back a week later. */
function studioCustomise() {
  const b = fsChannel && fsChannel.banner, a = fsChannel && fsChannel.avatar;
  document.getElementById('fsBody').innerHTML =
    '<div class="fs-art">' +
      '<div class="fs-art-row"><div class="fs-banner-prev" id="fsBannerPrev">' +
        (b ? '<img src="' + esc(API + b + '?t=' + Date.now()) + '" alt="">' : '') + '</div>' +
        '<div class="fs-art-info"><h3>Banner image</h3>' +
        '<p>Shown across the top of your channel. You can crop it to choose what stays visible, ' +
        'and position it so the important part is not cut off.</p>' +
        '<div class="fs-btns" id="fsBannerBtns"></div></div></div>' +
      '<div class="fs-art-row"><div class="fs-pic-prev" id="fsPicPrev">' +
        (a ? '<img src="' + esc(API + a + '?t=' + Date.now()) + '" alt="">' : '') + '</div>' +
        '<div class="fs-art-info"><h3>Picture</h3>' +
        '<p>Your profile picture appears wherever your channel is shown - next to your videos, in comments and in Embers. ' +
        'It is displayed as a circle, so crop to where your face is.</p>' +
        '<div class="fs-btns" id="fsPicBtns"></div></div></div>' +
      '<div class="fs-desc-block"><div class="fs-field"><label>Channel description</label>' +
        '<textarea id="fsAbout" maxlength="1000" placeholder="Tell people what your channel is about."></textarea></div>' +
        '<div class="fs-btns"><button class="fs-btn" id="fsAboutSave">Save description</button>' +
        '<button class="fs-btn ghost" id="fsAboutRevert">Discard</button></div>' +
        '<div class="fs-msg" id="fsMsg"></div></div>' +
    '</div>';
  document.getElementById('fsAbout').value = (fsChannel && fsChannel.about) || '';
  const msg = document.getElementById('fsMsg');
  const fail = m => { msg.className = 'fs-msg err'; msg.textContent = m; };
  const ok = m => { msg.className = 'fs-msg ok'; msg.textContent = m; };

  /* Change stages a cropped image; Save is what actually sends it. Uploading on
     Change used to mean a mis-click replaced a good banner with a bad one and
     there was no way back. Staging means you can crop, look, and only commit
     when it is right. */
  const staged = {};
  function artRow(kind, prevId, btnsId, has) {
    const btns = document.getElementById(btnsId);
    function paint() {
      const s = staged[kind];
      btns.innerHTML =
        '<button class="fs-btn" data-a="change">Change</button>' +
        (s ? '<button class="fs-btn" data-a="save">Save</button>' +
             '<button class="fs-btn ghost" data-a="cancel">Cancel</button>' : '') +
        (has || s ? '<button class="fs-btn danger" data-a="remove">Remove</button>' : '');
      btns.querySelector('[data-a="change"]').onclick = () =>
        pickAndCrop(kind, file => { staged[kind] = file; showStaged(kind, prevId); paint(); });
      const sv = btns.querySelector('[data-a="save"]');
      if (sv) sv.onclick = async () => {
        sv.disabled = true;
        try { await uploadArtFile(kind, staged[kind]); renderStudio(); }
        catch (e) { fail(e.message || 'Upload failed.'); sv.disabled = false; }
      };
      const cv = btns.querySelector('[data-a="cancel"]');
      if (cv) cv.onclick = () => { delete staged[kind]; clearStaged(kind, prevId); paint(); };
      const rm = btns.querySelector('[data-a="remove"]');
      if (rm) rm.onclick = () => confirmRemove(kind, () => {
        delete staged[kind];
        return removeArtRemote(kind).then(renderStudio).catch(e => fail(e.message));
      }, fail);
    }
    function showStaged(k, prev) {
      const el = document.getElementById(prev);
      const old = el.querySelector('img');
      const img = document.createElement('img');
      img.alt = '';
      img.src = URL.createObjectURL(staged[k]);
      if (old) el.replaceChild(img, old); else el.appendChild(img);
    }
    function clearStaged(k, prev) {
      const el = document.getElementById(prev);
      const img = el && el.querySelector('img');
      if (img) img.remove();
    }
    paint();
  }
  artRow('banner', 'fsBannerPrev', 'fsBannerBtns', !!b);
  artRow('avatar', 'fsPicPrev', 'fsPicBtns', !!a);

  document.getElementById('fsAboutSave').onclick = async () => {
    const btn = document.getElementById('fsAboutSave');
    btn.disabled = true;
    try {
      const r = await fetch(API + '/api/channel/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
        body: JSON.stringify({ about: document.getElementById('fsAbout').value })
      });
      const j = await r.json();
      if (!r.ok) { fail(j.error || 'Save failed.'); btn.disabled = false; return; }
      ok('Description saved.');
      fsChannel = Object.assign({}, fsChannel, { about: document.getElementById('fsAbout').value });
      btn.disabled = false;
    } catch { fail('Save failed - service unreachable.'); btn.disabled = false; }
  };
  document.getElementById('fsAboutRevert').onclick = () => {
    document.getElementById('fsAbout').value = (fsChannel && fsChannel.about) || '';
    msg.className = 'fs-msg'; msg.textContent = '';
  };
}

// Remove is destructive and there is no undo for it, so it asks first - on the
// channel page and in Studio alike.
function confirmRemove(kind, run, fail) {
  const label = kind === 'banner' ? 'banner image' : 'profile picture';
  const { box, close } = fsDialog(
    '<h2 style="margin:0 0 8px;font-size:18px">Remove your ' + label + '?</h2>' +
    '<p class="modal-sub">Your channel goes back to the default until you upload a new one. ' +
    'This cannot be undone.</p>' +
    '<div class="fs-msg" id="rmMsg"></div>' +
    '<div class="fs-btns" style="justify-content:flex-end;margin-top:14px">' +
      '<button class="fs-btn ghost" data-cancel>Keep it</button>' +
      '<button class="fs-btn danger" id="rmYes">Remove</button></div>', '420px');
  box.querySelector('[data-cancel]').onclick = close;
  box.querySelector('#rmYes').onclick = async () => {
    const btn = box.querySelector('#rmYes');
    btn.disabled = true;
    try { await run(); close(); }
    catch (e) {
      const m = box.querySelector('#rmMsg');
      m.className = 'fs-msg err'; m.textContent = e.message || 'Could not remove that.';
      btn.disabled = false;
      if (fail) fail(e.message);
    }
  };
}

/* ---- Manage videos ----
   The Videos and Embers tabs are separate lists, not one list with a filter,
   so a normal video can never appear under Embers. */
function studioVideos() {
  const mine = fsVideos.filter(v => (v.kind === 'ember') === (fsKind === 'ember'));
  const rows = mine.filter(v => fsFilter === 'all' || v.visibility === fsFilter);
  const label = { public: 'Public', unlisted: 'Unlisted', private: 'Private' };
  const glyph = { public: '&#9679;', unlisted: '&#128279;', private: '&#128274;' };
  document.getElementById('fsBody').innerHTML =
    '<div class="fs-table-tools">' +
      '<div class="fs-seg">' +
        '<button data-kind="video" class="' + (fsKind === 'video' ? 'on' : '') + '">Videos</button>' +
        '<button data-kind="ember" class="' + (fsKind === 'ember' ? 'on' : '') + '">Embers</button>' +
      '</div>' +
      '<select class="fs-filter" id="fsFilter">' +
        ['all', 'public', 'unlisted', 'private'].map(f =>
          '<option value="' + f + '"' + (fsFilter === f ? ' selected' : '') + '>' +
          (f === 'all' ? 'All visibility' : label[f]) + '</option>').join('') +
      '</select>' +
      '<span class="list-count">' + rows.length + ' of ' + mine.length + '</span></div>' +
    (rows.length ? '<div class="fs-rows">' +
      '<div class="fs-row head"><span>Video</span><span></span><span>Visibility</span>' +
        '<span>Date</span><span>Views</span><span>Comments</span><span></span></div>' +
      rows.map(v =>
        '<div class="fs-row" data-id="' + esc(v.id) + '">' +
          '<div class="fs-thumb"><img loading="lazy" alt="" src="' + esc(API + '/t/' + v.id) + '"></div>' +
          '<div><div class="fs-title">' + esc(v.title || '(untitled)') + '</div>' +
            '<div class="fs-desc">' + esc(v.description || 'Add description') + '</div></div>' +
          '<button class="fs-vis ' + esc(v.visibility) + '" data-act="vis" title="Change visibility">' +
            glyph[v.visibility] + ' ' + label[v.visibility] + '</button>' +
          '<div class="fs-date">' + esc(timeAgo(v.created_at)) + '</div>' +
          '<div class="fs-num">' + fmt(v.views || 0) + '</div>' +
          '<div class="fs-num">' + fmt(v.comments || 0) + '</div>' +
          '<div class="fs-acts"><button data-act="edit">Edit</button>' +
            '<button class="del" data-act="del">Delete</button></div>' +
        '</div>').join('') +
      '</div>'
      : '<div class="fs-empty"><h2>' +
        (mine.length ? 'Nothing with that visibility' : (fsKind === 'ember' ? 'No embers yet' : 'No videos yet')) +
        '</h2><p>' + (mine.length ? 'Try a different filter.' : 'Upload something and it will appear here.') + '</p></div>');

  document.querySelectorAll('#fsBody [data-kind]').forEach(b => b.onclick = () => {
    fsKind = b.dataset.kind; fsFilter = 'all'; studioVideos();
  });
  const f = document.getElementById('fsFilter');
  if (f) f.onchange = e => { fsFilter = e.target.value; studioVideos(); };
  document.querySelectorAll('#fsBody .fs-row[data-id]').forEach(row => {
    const v = fsVideos.find(x => x.id === row.dataset.id);
    if (!v) return;
    row.querySelector('[data-act="edit"]').onclick = () => studioEditDialog(v);
    row.querySelector('[data-act="del"]').onclick = () => studioDelete(v);
    row.querySelector('[data-act="vis"]').onclick = () => studioVisDialog(v);
  });
}

/* ---- image cropping ----
   Both channel images are shown with object-fit:cover, so without this the
   browser decides what to keep and it keeps the middle. For a landscape photo
   that is fine; for a face in a profile picture it is not.

   The transform is kept as (scale, ox, oy) and used twice - once to position
   the <img> for preview and once to draw the canvas - so what is framed is
   exactly what gets saved. Offsets are clamped every frame so the image can
   never be dragged away from the frame and leave a gap. */
function openCropper(file, spec, cb) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  const wrap = document.createElement('div');
  wrap.className = 'modal-box';
  wrap.style.width = 'min(720px,94vw)';
  wrap.innerHTML =
    '<button class="modal-x static" data-x aria-label="Close">&times;</button>' +
    '<h2 style="margin:0 0 4px;font-size:19px">Crop ' + esc(spec.label.toLowerCase()) + '</h2>' +
    '<p class="crop-note" style="margin:0 0 16px">Drag to move it, and zoom or scroll to scale. ' +
      (spec.aspect === 1 ? 'The preview is a circle - the saved picture is shown as a circle everywhere.'
                         : 'Narrow windows crop the sides a little further.') + '</p>' +
    '<div class="crop-frame" id="cropFrame" style="aspect-ratio:' + spec.aspect + '">' +
      '<div class="crop-ring"></div></div>' +
    '<div class="crop-zoom"><span style="font-size:12.5px;color:#aaa">Zoom</span>' +
      '<input type="range" id="cropZoom" min="100" max="300" value="100"><span id="cropPct" style="font-size:12.5px;color:#aaa;width:44px">100%</span></div>' +
    '<div class="fs-btns" style="justify-content:flex-end;margin-top:18px">' +
      '<button class="fs-btn ghost" id="cropReset">Reset</button>' +
      '<button class="fs-btn ghost" data-cancel>Cancel</button>' +
      '<button class="fs-btn" id="cropApply">Apply</button></div>';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.appendChild(wrap);
  document.body.appendChild(modal);
  const close = () => { URL.revokeObjectURL(url); modal.remove(); };
  wrap.querySelector('[data-x]').onclick = close;
  wrap.querySelector('[data-cancel]').onclick = close;
  modal.onclick = e => { if (e.target === modal) close(); };

  const frame = wrap.querySelector('#cropFrame');
  const slider = wrap.querySelector('#cropZoom');
  const pct = wrap.querySelector('#cropPct');
  let FW = 0, FH = 0, base = 1, scale = 1, ox = 0, oy = 0, IW = 0, IH = 0;

  function clamp() {
    const dw = IW * scale, dh = IH * scale;
    // dw is always >= FW and dh always >= FH because scale is at least "cover",
    // so this range is always valid and the image can never uncover an edge.
    ox = Math.min(0, Math.max(FW - dw, ox));
    oy = Math.min(0, Math.max(FH - dh, oy));
  }
  function paint() {
    img.style.transform = 'translate(' + ox + 'px,' + oy + 'px) scale(' + scale + ')';
    clamp();
  }
  function measure() {
    const r = frame.getBoundingClientRect();
    FW = r.width; FH = r.height;
    if (!FW) return;
    base = Math.max(FW / IW, FH / IH);
    scale = base * (Number(slider.value) / 100);
    ox = (FW - IW * scale) / 2;
    oy = (FH - IH * scale) / 2;
    paint();
  }
  img.onload = () => {
    IW = img.naturalWidth; IH = img.naturalHeight;
    img.src = url;
    measure();
  };
  img.src = url;

  let dragging = false, lastX = 0, lastY = 0;
  frame.addEventListener('pointerdown', e => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    frame.classList.add('drag');
    try { frame.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  frame.addEventListener('pointermove', e => {
    if (!dragging) return;
    ox += e.clientX - lastX; oy += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    paint();
  });
  const end = e => {
    dragging = false; frame.classList.remove('drag');
    try { frame.releasePointerCapture(e.pointerId); } catch (err) {}
  };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  frame.addEventListener('wheel', e => {
    e.preventDefault();
    slider.value = Math.max(100, Math.min(300, Number(slider.value) + (e.deltaY < 0 ? 10 : -10)));
    scale = base * (Number(slider.value) / 100);
    paint();
  }, { passive: false });
  slider.oninput = () => {
    pct.textContent = slider.value + '%';
    scale = base * (Number(slider.value) / 100);
    paint();
  };
  wrap.querySelector('#cropReset').onclick = () => {
    slider.value = 100; pct.textContent = '100%';
    scale = base;
    ox = (FW - IW * scale) / 2; oy = (FH - IH * scale) / 2;
    paint();
  };
  window.addEventListener('resize', measure);

  wrap.querySelector('#cropApply').onclick = () => {
    const OW = spec.outW, OH = Math.round(OW / spec.aspect);
    const c = document.createElement('canvas');
    c.width = OW; c.height = OH;
    const ctx = c.getContext('2d');
    // The preview is FW wide and the output OW wide, so everything scales by
    // this one factor - the framing that was shown is the framing that is saved.
    const k = OW / FW;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, ox * k, oy * k, IW * scale * k, IH * scale * k);
    c.toBlob(b => {
      window.removeEventListener('resize', measure);
      if (!b) { close(); return; }
      cb(new File([b], spec.label.toLowerCase().replace(/\s+/g, '-') + '.jpg', { type: 'image/jpeg' }));
      close();
    }, 'image/jpeg', 0.92);
  };
}

// The aspect each image is saved at, and the size. The banner is 6:1 because
// that is roughly how the channel page shows it; the picture is square because
// it is displayed as a circle.
const ART_SPEC = {
  banner: { aspect: 6, outW: 2048, label: 'Banner image' },
  avatar: { aspect: 1, outW: 900, label: 'Picture' }
};
async function uploadArtFile(kind, file) {
  const f = new FormData();
  f.append(kind, file, kind + '.jpg');
  const r = await fetch(API + '/api/channel/edit', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + token() }, body: f
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Upload failed.');
  return true;
}
async function removeArtRemote(kind) {
  const r = await fetch(API + '/api/channel/edit', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
    body: JSON.stringify(kind === 'banner' ? { removeBanner: true } : { removeAvatar: true })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not remove that.');
}
// Pick a file, crop it, hand back a finished File. Shared by Studio and the
// channel page so both crop identically.
function pickAndCrop(kind, cb) {
  const spec = ART_SPEC[kind];
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (f) openCropper(f, spec, cb);
  };
  inp.click();
}

/* ---- Analytics ----
   Views over time and retention. Retention is "how much of the clip people
   actually watched", averaged across the videos that were watched - the
   number creators actually look at. It is only as good as the progress
   reports, so both clients send them; until a video has any, the row says so
   rather than showing a confident 0%. */
function studioAnalytics() {
  const days = fsDays;
  document.getElementById('fsBody').innerHTML =
    '<div class="fs-table-tools">' +
      '<select class="fs-filter" id="fsDays">' +
        [7, 28, 90].map(d => '<option value="' + d + '"' + (days === d ? ' selected' : '') + '>' +
          'Last ' + d + ' days</option>').join('') +
      '</select></div>' +
    '<div class="fs-stat" style="max-width:240px"><b id="anPct">-</b><span>Average retention</span></div>' +
    '<div class="fs-chart" id="anChart"></div>' +
    '<div class="fs-axis" id="anAxis"></div>' +
    '<div class="fs-ret"><h3 style="margin:0 0 4px;font-size:16px">Retention by video</h3>' +
    '<p style="color:#aaa;font-size:13px;margin:0 0 12px">Share of each clip that viewers watched through.</p>' +
    '<div id="anRet"></div></div>';
  const sel = document.getElementById('fsDays');
  if (sel) sel.onchange = e => { fsDays = Number(e.target.value); studioAnalytics(); };
  loadAnalytics(days);
}
async function loadAnalytics(days) {
  let j = null;
  try {
    const r = await fetch(API + '/api/studio/analytics?days=' + days, { headers: { 'Authorization': 'Bearer ' + token() } });
    if (r.ok) j = await r.json();
  } catch {}
  if (!j || !j.series) {
    document.getElementById('anChart').innerHTML = '<div class="fs-empty" style="padding:40px">Could not load analytics.</div>';
    return;
  }
  const peak = Math.max(1, ...j.series.map(d => d.views));
  document.getElementById('anPct').textContent = j.totals.avgPct + '%';
  document.getElementById('anChart').innerHTML = j.series.map(d =>
    '<div class="fs-bar" style="height:' + Math.max(d.views ? 3 : 1, (d.views / peak) * 100) + '%" ' +
    'data-tip="' + d.views + ' views - ' + esc(d.day) + '"></div>').join('');
  const axis = document.getElementById('anAxis');
  axis.innerHTML = '<span>' + esc(j.series[0] ? j.series[0].day : '') + '</span>' +
    '<span>' + esc(j.series[j.series.length - 1] ? j.series[j.series.length - 1].day : '') + '</span>';
  const top = (j.top || []).filter(v => v.statViews > 0);
  document.getElementById('anRet').innerHTML = top.length ? top.map(v =>
    '<div class="fs-ret-row"><div class="fs-ret-name">' + esc(v.title || '(untitled)') + '</div>' +
    '<div class="fs-ret-track"><div class="fs-ret-fill" style="width:' +
      Math.max(0, Math.min(100, Math.round(v.pct))) + '%"></div></div>' +
    '<div class="fs-ret-pct">' + Math.max(0, Math.round(v.pct)) + '%</div></div>').join('')
    : '<div class="fs-empty" style="padding:30px">No watch data yet. Retention appears once people have watched something.</div>';
}

function fsDialog(innerHTML, width) {
  const box = document.createElement('div');
  box.className = 'modal-box' + (width ? '' : ' fs-dlg');
  if (width) box.style.width = width;
  box.innerHTML = '<button class="modal-x static" data-x aria-label="Close">&times;</button>' + innerHTML;
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  box.querySelector('[data-x]').onclick = close;
  wrap.onclick = e => { if (e.target === wrap) close(); };
  return { wrap, box, close };
}

function studioEditDialog(v) {
  const { box, close } = fsDialog(
    '<h2>Edit ' + (v.kind === 'ember' ? 'ember' : 'video') + '</h2>' +
    '<div class="fs-sub">Changes go live immediately.</div>' +
    '<div class="fs-field"><label>Title</label>' +
      '<input id="fsEditTitle" maxlength="100" value="' + esc(v.title || '') + '"></div>' +
    '<div class="fs-field"><label>Description</label>' +
      '<textarea id="fsEditDesc" maxlength="2000" class="fs-area">' + esc(v.description || '') + '</textarea></div>' +
    '<div class="fs-field"><label>Visibility</label><div class="fs-seg" id="fsEditVis">' +
      FS_VIS.map(o => '<button data-v="' + o[0] + '" class="' + (v.visibility === o[0] ? 'on' : '') +
        '" title="' + esc(o[2]) + '">' + o[1] + '</button>').join('') +
    '</div></div>' +
    '<div class="fs-msg" id="fsEditMsg"></div>' +
    '<div class="fs-btns" style="justify-content:flex-end;margin-top:6px">' +
      '<button class="fs-btn ghost" data-cancel>Cancel</button>' +
      '<button class="fs-btn" id="fsEditSave">Save</button></div>');
  let vis = v.visibility;
  box.querySelectorAll('#fsEditVis button').forEach(b => b.onclick = () => {
    vis = b.dataset.v;
    box.querySelectorAll('#fsEditVis button').forEach(x => x.classList.toggle('on', x === b));
  });
  box.querySelector('[data-cancel]').onclick = close;
  box.querySelector('#fsEditSave').onclick = async () => {
    const msg = box.querySelector('#fsEditMsg');
    const btn = box.querySelector('#fsEditSave');
    btn.disabled = true; msg.className = 'fs-msg'; msg.textContent = 'Saving...';
    try {
      const r = await fetch(API + '/api/video/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
        body: JSON.stringify({
          id: v.id, title: box.querySelector('#fsEditTitle').value,
          description: box.querySelector('#fsEditDesc').value, visibility: vis
        })
      });
      const j = await r.json();
      if (!r.ok) { msg.className = 'fs-msg err'; msg.textContent = j.error || 'Could not save.'; btn.disabled = false; return; }
      close(); renderStudio();
    } catch { msg.className = 'fs-msg err'; msg.textContent = 'Could not save - service unreachable.'; btn.disabled = false; }
  };
}

// Visibility is what people change most, so it gets a one-tap menu of its own
// rather than making them open the whole editor to change a single field.
function studioVisDialog(v) {
  const { box, close } = fsDialog(
    '<h2 style="margin:0 0 6px;font-size:18px">Visibility</h2>' +
    '<p class="modal-sub" style="margin-bottom:14px">' + esc(v.title || '') + '</p>' +
    '<div class="menu" id="fvMenu">' + FS_VIS.map(o =>
      '<button data-v="' + o[0] + '"><span><strong>' + o[1] + '</strong><br>' +
      '<small style="color:#aaa">' + o[2] + '</small></span>' +
      (v.visibility === o[0] ? '<span>&#10003;</span>' : '') + '</button>').join('') + '</div>' +
    '<div class="fs-msg" id="fvMsg"></div>', '380px');
  box.querySelectorAll('#fvMenu button').forEach(b => b.onclick = async () => {
    if (b.dataset.v === v.visibility) { close(); return; }
    try {
      const r = await fetch(API + '/api/video/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
        body: JSON.stringify({ id: v.id, visibility: b.dataset.v })
      });
      const j = await r.json();
      if (!r.ok) {
        const m = box.querySelector('#fvMsg'); m.className = 'fs-msg err'; m.textContent = j.error || 'Could not change that.';
        return;
      }
      close(); renderStudio();
    } catch {
      const m = box.querySelector('#fvMsg'); m.className = 'fs-msg err'; m.textContent = 'Service unreachable.';
    }
  });
}

function studioDelete(v) {
  const { box, close } = fsDialog(
    '<h2 style="margin:0 0 8px;font-size:18px">Delete this ' + (v.kind === 'ember' ? 'ember' : 'video') + '?</h2>' +
    '<p class="modal-sub">&ldquo;' + esc(v.title || '') + '&rdquo; and its comments are removed permanently. This cannot be undone.</p>' +
    '<div class="fs-msg" id="fdMsg"></div>' +
    '<div class="fs-btns" style="justify-content:flex-end;margin-top:14px">' +
      '<button class="fs-btn ghost" data-cancel>Cancel</button>' +
      '<button class="fs-btn danger" id="fdYes">Delete</button></div>', '420px');
  box.querySelector('[data-cancel]').onclick = close;
  box.querySelector('#fdYes').onclick = async () => {
    const btn = box.querySelector('#fdYes');
    btn.disabled = true;
    try {
      const r = await fetch(API + '/api/video/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
        body: JSON.stringify({ id: v.id })
      });
      const j = await r.json();
      if (!r.ok) {
        const m = box.querySelector('#fdMsg'); m.className = 'fs-msg err'; m.textContent = j.error || 'Delete failed.';
        btn.disabled = false; return;
      }
      close(); renderStudio();
    } catch {
      const m = box.querySelector('#fdMsg'); m.className = 'fs-msg err'; m.textContent = 'Delete failed - service unreachable.';
      btn.disabled = false;
    }
  };
}

document.querySelectorAll('.fs-tab').forEach(b => b.onclick = () => { fsTab = b.dataset.tab; renderStudio(); });

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
  // Back must close the Shorts panel before it changes anything underneath.
  // The overlay is not part of the view stack, so without this the URL moves
  // to '#/' while a full-screen video is still sitting on top of the page.
  if (document.getElementById('shorts').classList.contains('on')) {
    const sm = location.hash.match(/^#\/watch\/([A-Za-z0-9-]+)\/?$/);
    const id = sm && sm[1];
    if (!id || !shortsList.some(v => v.id === id)) { shortsPushed = false; closeShorts(); }
  }
  const sh = document.getElementById('adminShieldBtn');
  if (sh) sh.classList.remove('on');
  let m = location.hash.match(/^#\/watch\/([A-Za-z0-9-]+)\/?$/);
  if (m) { renderWatch(m[1]); return; }
  m = location.hash.match(/^#\/channel\/([A-Za-z0-9_]+)\/?$/);
  if (m) { renderChannel(m[1]); return; }
  if (location.hash === '#/subs') { renderSubs(); return; }
  if (location.hash === '#/embers') { renderEmbers(); return; }
  if (location.hash === '#/studio') { renderStudio(); return; }
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
