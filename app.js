// FirFall — Cloudflare-only auth. No localhost.
const API = window.FIRFALL_API || 'https://firfall-auth.b8golddude.workers.dev';
document.getElementById('menuBtn').onclick = () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
};

const modal = document.getElementById('authModal');
const signInBtn = document.getElementById('signInBtn');
const signInLabel = document.getElementById('signInLabel');
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
  if (u) { menuUser.textContent = '@' + u; menuAvatar.textContent = u[0].toUpperCase(); }
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

// ---- Subscriptions ----
const getSubs = () => { try { return JSON.parse(localStorage.getItem('firfall_subs') || '{}'); } catch { return {}; } };
const setSubs = (s) => localStorage.setItem('firfall_subs', JSON.stringify(s));
function baseSubs(name) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 12 + (h % 4800);
}
function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'K' : String(n); }
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
function show(el) { [homeView, channelView, watchView].forEach(v => v.classList.add('hidden')); el.classList.remove('hidden'); }

async function loadHome() {
  show(homeView);
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  try {
    const r = await fetch(API + '/api/videos');
    const { videos } = await r.json();
    document.getElementById('emptyState').style.display = videos.length ? 'none' : '';
    videos.forEach(v => {
      const d = document.createElement('div');
      d.className = 'card';
      d.innerHTML = '<video muted preload="metadata" playsinline src="' + API + '/v/' + v.id + '" poster="' + API + '/t/' + v.id + '"></video>' +
        '<div class="meta"><div class="chan">' + v.owner[0].toUpperCase() + '</div><div><h3></h3><p></p></div></div>';
      d.querySelector('h3').textContent = v.title;
      d.querySelector('p').textContent = v.owner + ' • ' + new Date(v.created_at).toLocaleDateString();
      d.querySelector('video').onmouseenter = (e) => { e.target.play().catch(() => {}); };
      d.querySelector('video').onmouseleave = (e) => { e.target.pause(); };
      d.onclick = () => { location.hash = '#/watch/' + v.id; };
      grid.appendChild(d);
    });
  } catch { document.getElementById('emptyState').style.display = ''; }
}

async function renderChannel(name) {
  show(channelView);
  document.getElementById('chAvatar').textContent = name[0].toUpperCase();
  document.getElementById('chName').textContent = name;
  const meta = document.getElementById('chMeta');
  meta.dataset.owner = name.toLowerCase();
  wireSubBtn(document.getElementById('chSubBtn'), name);
  document.getElementById('chAbout').textContent = '@' + name.toLowerCase() + ' • joined FirFall test version';
  const tab = document.getElementById('tabVideos');
  tab.innerHTML = '<h2>Loading…</h2>';
  try {
    const r = await fetch(API + '/api/videos?owner=' + encodeURIComponent(name.toLowerCase()));
    const { videos } = await r.json();
    const subs = getSubs();
    const count = baseSubs(name.toLowerCase()) + (subs[name.toLowerCase()] ? 1 : 0);
    meta.textContent = '@' + name.toLowerCase() + ' • ' + fmt(count) + ' subscribers • ' + videos.length + ' videos';
    tab.innerHTML = videos.length ? '' : '<h2>No videos yet</h2><p>This channel hasn\'t uploaded anything.</p>';
    videos.forEach(v => {
      const d = document.createElement('div');
      d.className = 'card';
      d.innerHTML = '<video muted preload="metadata" playsinline poster="' + API + '/t/' + v.id + '"></video><div class="meta"><div><h3></h3></div></div>';
      d.querySelector('h3').textContent = v.title;
      d.onclick = () => { location.hash = '#/watch/' + v.id; };
      tab.appendChild(d);
    });
  } catch { tab.innerHTML = '<h2>Could not load channel.</h2>'; }
}

let currentVideo = null;
async function renderWatch(id) {
  show(watchView);
  const player = document.getElementById('player');
  player.pause(); player.removeAttribute('src'); player.load();
  try {
    const r = await fetch(API + '/api/video?id=' + encodeURIComponent(id));
    if (!r.ok) { document.getElementById('wTitle').textContent = 'Video not found.'; return; }
    const { video: v } = await r.json();
    currentVideo = v;
    player.poster = API + '/t/' + v.id;
    player.src = API + '/v/' + v.id;
    document.getElementById('wTitle').textContent = v.title;
    const ch = document.getElementById('wChannel');
    ch.textContent = '@' + v.owner; ch.href = '#/channel/' + v.owner;
    wireSubBtn(document.getElementById('wSubBtn'), v.owner);
    document.getElementById('wDesc').textContent = v.description || '';
    loadComments(v.id);
  } catch { document.getElementById('wTitle').textContent = 'Could not load video.'; }
}

async function loadComments(vid) {
  const list = document.getElementById('cList');
  list.innerHTML = '';
  try {
    const r = await fetch(API + '/api/comments?video=' + encodeURIComponent(vid));
    const { comments } = await r.json();
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

function router() {
  let m = location.hash.match(/^#\/watch\/([A-Za-z0-9-]+)\/?$/);
  if (m) { renderWatch(m[1]); return; }
  m = location.hash.match(/^#\/channel\/([A-Za-z0-9_]+)\/?$/);
  if (m) { renderChannel(m[1]); return; }
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

// ---- Upload with on-device NSFW scan ----
const uploadModal = document.getElementById('uploadModal');
document.getElementById('createBtn').onclick = () => {
  if (!me()) { setMode('login'); modal.classList.remove('hidden'); return; }
  document.getElementById('upErr').textContent = '';
  document.getElementById('upStatus').textContent = '';
  uploadModal.classList.remove('hidden');
};
document.getElementById('uploadClose').onclick = () => uploadModal.classList.add('hidden');

function sampleFrames(file, n) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    const canvas = document.createElement('canvas');
    const shots = [];
    v.onloadedmetadata = async () => {
      canvas.width = 224; canvas.height = 224;
      const ctx = canvas.getContext('2d');
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
      resolve(shots);
    };
    v.onerror = () => { URL.revokeObjectURL(url); resolve([]); };
  });
}
async function scanVideo(file, status) {
  try {
    status('Loading on-device safety scan…');
    const nsfw = await import('https://esm.sh/nsfwjs@4.2.1');
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
        c.toBlob(b => resolve(b), 'image/jpeg', 0.7);
      };
    };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
  });
}
document.getElementById('upSubmit').onclick = async () => {
  const err = document.getElementById('upErr');
  const status = (t) => { document.getElementById('upStatus').textContent = t; };
  err.textContent = '';
  const file = document.getElementById('upFile').files[0];
  const title = document.getElementById('upTitle').value.trim();
  const desc = document.getElementById('upDesc').value.trim();
  if (!file) { err.textContent = 'Choose a video file.'; return; }
  if (!title) { err.textContent = 'Title is required.'; return; }
  if (file.size > 100_000_000) { err.textContent = 'Max 100MB in test version.'; return; }
  const btn = document.getElementById('upSubmit');
  btn.disabled = true;
  try {
    const scan = await scanVideo(file, status);
    if (scan === 'blocked') { err.textContent = 'Blocked: on-device scan flagged explicit content.'; return; }
    status('Capturing thumbnail…');
    const thumb = await captureThumb(file);
    status('Uploading…');
    const form = new FormData();
    form.append('file', file);
    if (thumb) form.append('thumb', thumb, 'thumb.jpg');
    form.append('title', title);
    form.append('description', desc);
    form.append('scan', scan);
    const r = await fetch(API + '/api/videos/upload', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token() }, body: form
    });
    const j = await r.json();
    if (!r.ok) { err.textContent = j.error || 'Upload failed.'; return; }
    uploadModal.classList.add('hidden');
    document.getElementById('upFile').value = '';
    document.getElementById('upTitle').value = '';
    document.getElementById('upDesc').value = '';
    status('');
    if (j.status === 'flagged') alert('Held for review: ' + (j.message || 'auto-filter matched.'));
    else location.hash = '#/watch/' + j.id;
    loadHome();
  } catch { err.textContent = 'Upload failed — service unreachable.'; }
  finally { btn.disabled = false; }
};

window.addEventListener('hashchange', router);
refreshAuthUI();
router();
