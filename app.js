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

// ---- Channels ----
const homeView = document.getElementById('homeView');
const channelView = document.getElementById('channelView');
const getSubs = () => { try { return JSON.parse(localStorage.getItem('firfall_subs') || '{}'); } catch { return {}; } };
const setSubs = (s) => localStorage.setItem('firfall_subs', JSON.stringify(s));
function baseSubs(name) { // stable pseudo count per channel
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 12 + (h % 4800);
}
function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'K' : String(n); }

function renderChannel(name) {
  const u = me();
  const subs = getSubs();
  const isOwn = u && u.toLowerCase() === name.toLowerCase();
  const subscribed = !!subs[name.toLowerCase()];
  const count = baseSubs(name.toLowerCase()) + (subscribed ? 1 : 0);
  document.getElementById('chAvatar').textContent = name[0].toUpperCase();
  document.getElementById('chName').textContent = name;
  document.getElementById('chMeta').textContent = '@' + name.toLowerCase() + ' • ' + fmt(count) + ' subscribers • 0 videos';
  const btn = document.getElementById('chSubBtn');
  btn.textContent = isOwn ? 'This is you' : (subscribed ? 'Subscribed' : 'Subscribe');
  btn.disabled = !!isOwn;
  btn.classList.toggle('subbed', subscribed && !isOwn);
  btn.onclick = () => {
    const s = getSubs();
    if (s[name.toLowerCase()]) delete s[name.toLowerCase()]; else s[name.toLowerCase()] = 1;
    setSubs(s); renderChannel(name);
  };
  document.getElementById('chAbout').textContent = 'Welcome to ' + name + "'s channel. Videos coming soon — uploads open after backend video support lands.";
  homeView.classList.add('hidden'); channelView.classList.remove('hidden');
}
function router() {
  const m = location.hash.match(/^#\/channel\/([A-Za-z0-9_]+)\/?$/);
  if (m) renderChannel(m[1]);
  else { channelView.classList.add('hidden'); homeView.classList.remove('hidden'); }
}
document.querySelectorAll('[data-chtab]').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('[data-chtab]').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('tabVideos').classList.toggle('hidden', t.dataset.chtab !== 'videos');
    document.getElementById('tabAbout').classList.toggle('hidden', t.dataset.chtab !== 'about');
  };
});
window.addEventListener('hashchange', router);
refreshAuthUI();
router();
