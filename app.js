// FirFall — Cloudflare-only auth. No localhost.
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

function refreshAuthUI() {
  const u = me();
  signInBtn.classList.toggle('logged-in', !!u);
  signInLabel.textContent = u ? u : 'Sign in';
  signInAvatar.classList.toggle('hidden', !u);
  signInIcon.classList.toggle('hidden', !!u);
  if (u) { signInAvatar.textContent = u[0].toUpperCase(); menuUser.textContent = '@' + u; menuAvatar.textContent = u[0].toUpperCase(); }
  else accountMenu.classList.add('hidden');
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
  accountMenu.classList.add('hidden');
  refreshAuthUI();
  if (location.hash.startsWith('#/channel/')) location.hash = '#/';
};
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
    if (!r.ok) { authErr.textContent = j.error || 'Failed.'; return; }
    localStorage.setItem('firfall_user', j.username);
    localStorage.setItem('firfall_token', j.token);
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
const getSubs = () => store.get('firfall_subs', {});
const setSubs = (s) => store.set('firfall_subs', s);
function baseSubs(name) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 12 + (h % 4800);
}
function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'K' : String(n); }
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
function wireSubBtn(btn, name) {
  const subs = getSubs();
  const isOwn = me() && me().toLowerCase() === name.toLowerCase();
  const subscribed = !!subs[name.toLowerCase()];
  btn.textContent = isOwn ? 'This is you' : (subscribed ? 'Subscribed' : 'Subscribe');
  btn.disabled = !!isOwn;
  btn.classList.toggle('subbed', subscribed && !isOwn);
  btn.onclick = () => {
    const s = getSubs();
    if (s[name.toLowerCase()]) delete s[name.toLowerCase()]; else s[name.toLowerCase()] = 1;
    setSubs(s); wireSubBtn(btn, name);
    const m = document.getElementById('chMeta');
    if (m && m.dataset.owner === name.toLowerCase()) renderChannel(name);
  };
}

// ---- Views / router ----
const homeView = document.getElementById('homeView');
const channelView = document.getElementById('channelView');
const watchView = document.getElementById('watchView');
const listView = document.getElementById('listView');
function show(el) { [homeView, channelView, watchView, listView].forEach(v => v.classList.add('hidden')); el.classList.remove('hidden'); }
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
  d.querySelector('p').textContent = v.owner + (v.visibility && v.visibility !== 'public' ? ' • ' + v.visibility : '') + ' • ' + fmt(v.views || 0) + ' views • ' + new Date(v.created_at).toLocaleDateString();
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
    const r = await fetch(API + '/api/videos');
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

async function renderChannel(name) {
  show(channelView); markNav('');
  document.getElementById('chAvatar').textContent = name[0].toUpperCase();
  document.getElementById('chName').textContent = name;
  const meta = document.getElementById('chMeta');
  const tab = document.getElementById('tabVideos');
  tab.innerHTML = '<h2>Loading…</h2>';
  try {
    const u = await (await fetch(API + '/api/user?u=' + encodeURIComponent(name.toLowerCase()))).json();
    if (!u.user) { tab.innerHTML = '<h2>Channel not found</h2><p>No such FirFall account.</p>'; meta.textContent = ''; wireSubBtn(document.getElementById('chSubBtn'), name + '_missing_' + Date.now()); document.getElementById('chSubBtn').style.display = 'none'; return; }
    document.getElementById('chSubBtn').style.display = '';
    meta.dataset.owner = u.user.username;
    wireSubBtn(document.getElementById('chSubBtn'), u.user.username);
    document.getElementById('chAbout').textContent = '@' + u.user.username + ' • joined ' + new Date(u.user.joined).toLocaleDateString();
    const r = await fetch(API + '/api/videos?owner=' + encodeURIComponent(u.user.username),
      me() ? { headers: { 'Authorization': 'Bearer ' + token() } } : undefined);
    const { videos } = await r.json();
    const subs = getSubs();
    const count = baseSubs(u.user.username) + (subs[u.user.username] ? 1 : 0);
    meta.textContent = '@' + u.user.username + ' • ' + fmt(count) + ' subscribers • ' + videos.length + ' videos';
    tab.innerHTML = videos.length ? '' : '<h2>No videos yet</h2><p>This channel hasn\'t uploaded anything.</p>';
    tab.className = videos.length ? 'yt-grid' : 'blank-state';
    videos.forEach(v => tab.appendChild(card(v)));
  } catch { tab.innerHTML = '<h2>Could not load channel.</h2>'; }
}

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
    document.getElementById('wTitle').textContent = v.title;
    document.getElementById('wStats').textContent = fmt(v.views || 0) + ' views • ' + new Date(v.created_at).toLocaleDateString() + (v.duration ? ' • ' + fmtDur(v.duration) : '');
    const ch = document.getElementById('wChannelLink');
    document.getElementById('wChannel').textContent = '@' + v.owner;
    document.getElementById('wAvatar').textContent = v.owner[0].toUpperCase();
    ch.href = '#/channel/' + v.owner;
    wireSubBtn(document.getElementById('wSubBtn'), v.owner);
    paintReact(reaction || 'none', likes || 0);
    paintSave();
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
    const r = await fetch(API + '/api/videos');
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
  else later.unshift({ id: currentVideo.id, title: currentVideo.title, owner: currentVideo.owner });
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
      d.querySelector('span').textContent = ' ' + new Date(c.created_at).toLocaleString();
      d.querySelector('p').textContent = c.text;
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

// ---- Library views: subs / history / later ----
function renderList(title, items, empty) {
  show(listView); markNav(title === 'Subscriptions' ? 'subs' : title === 'History' ? 'history' : 'later');
  document.getElementById('listTitle').textContent = title;
  const g = document.getElementById('listGrid');
  g.innerHTML = items.length ? '' : '<p class="modal-sub">' + empty + '</p>';
  items.forEach(v => g.appendChild(card(v)));
}
async function renderSubs() {
  const names = Object.keys(getSubs());
  if (!names.length) { renderList('Subscriptions', [], 'Channels you subscribe to will show up here.'); return; }
  try {
    const all = await (await fetch(API + '/api/videos')).json();
    renderList('Subscriptions', (all.videos || []).filter(v => names.includes(v.owner)), 'No uploads from your subscriptions yet.');
  } catch { renderList('Subscriptions', [], 'Could not load.'); }
}
function renderHistory() {
  renderList('History', store.get('firfall_history', []), 'Videos you watch will show up here.');
}
function renderLater() {
  renderList('Watch later', store.get('firfall_later', []), 'Save videos with + Watch later to find them here.');
}

function router() {
  let m = location.hash.match(/^#\/watch\/([A-Za-z0-9-]+)\/?$/);
  if (m) { renderWatch(m[1]); return; }
  m = location.hash.match(/^#\/channel\/([A-Za-z0-9_]+)\/?$/);
  if (m) { renderChannel(m[1]); return; }
  if (location.hash === '#/subs') { renderSubs(); return; }
  if (location.hash === '#/history') { renderHistory(); return; }
  if (location.hash === '#/later') { renderLater(); return; }
  loadHome();
}
document.querySelectorAll('[data-chtab]').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('[data-chtab]').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('tabVideos').classList.toggle('hidden', t.dataset.chtab !== 'videos');
    document.getElementById('tabAbout').classList.toggle('hidden', t.dataset.chtab !== 'about');
  };
});

// ---- Studio-style upload: file → details → elements → checks → visibility ----
const uploadModal = document.getElementById('uploadModal');
const UP_STEPS = ['details', 'elements', 'checks', 'visibility'];
let upStage = -1; // -1 = file picker
let upVisibility = 'private';
let upStaged = null; // {file, thumb, duration, scan}
function upShow(i) {
  upStage = i;
  document.getElementById('upNext').disabled = false;
  ['upStepFile', 'upStepDetails', 'upStepElements', 'upStepChecks', 'upStepVis'].forEach((id, k) =>
    document.getElementById(id).classList.toggle('hidden', k - 1 !== i));
  document.querySelectorAll('#upSteps span').forEach(s => {
    const k = UP_STEPS.indexOf(s.dataset.step);
    s.classList.toggle('on', k === i);
    s.classList.toggle('done', k < i);
  });
  document.getElementById('upBack').classList.toggle('hidden', i <= 0);
  document.getElementById('upNext').textContent = 'Next';
}
function upSetVis(v) {
  upVisibility = v;
  document.getElementById('upSavedPill').textContent = 'Saved as ' + v;
  document.querySelectorAll('#upVisPills button').forEach(b => b.classList.toggle('on', b.dataset.vis === v));
}
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
  const nb = document.getElementById('upNext');
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
document.getElementById('upNext').onclick = () => {
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
window._upNextDefault = document.getElementById('upNext').onclick;
async function publishStaged() {
  const err = document.getElementById('upErr');
  err.textContent = '';
  if (!upStaged) { err.textContent = 'Still preparing your file — wait for "Checks complete" then try again.'; btn.disabled = false; return; }
  const title = document.getElementById('upTitle').value.trim();
  const desc = document.getElementById('upDesc').value.trim();
  if (!title) { err.textContent = 'Title is required.'; return; }
  const btn = document.getElementById('upNext');
  btn.disabled = true;
  const fail = (m) => { btn.disabled = false; err.textContent = m; };
  document.getElementById('upProgOuter').classList.remove('hidden');
  const fill = document.getElementById('upProgFill');
  const status = (t) => { document.getElementById('upStatus').textContent = t; document.getElementById('upFootStatus').textContent = t; };
  status('Starting upload session…');
  let start;
  try {
    const r = await fetch(API + '/api/uploads/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
      body: JSON.stringify({ filename: upStaged.file.name, mime: upStaged.file.type, size: upStaged.file.size,
        title, description: desc, duration: upStaged.duration, visibility: upVisibility, scan: upStaged.scan })
    });
    start = await r.json();
    if (!r.ok) { fail(start.error || 'Upload rejected.'); return; }
  } catch { fail('Upload failed — service unreachable.'); return; }
  const sessionId = start.sessionId, chunkSize = start.chunkSize || 6000000;
  const file = upStaged.file;
  status('Uploading 0%…');
  for (let off = 0; off < file.size; off += chunkSize) {
    const chunk = file.slice(off, Math.min(off + chunkSize, file.size));
    const f = new FormData();
    f.append('sessionId', sessionId);
    f.append('chunk', chunk, 'part');
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const r = await fetch(API + '/api/uploads/chunk', {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + token() }, body: f
        });
        const j = await r.json();
        if (!r.ok) { fail(j.error || 'Chunk failed.'); return; }
        ok = true;
        const pct = Math.round((j.uploaded / file.size) * 100);
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
router();
