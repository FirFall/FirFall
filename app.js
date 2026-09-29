// FirFall — blank shell + sign-in. Cloudflare Worker hides your home IP.
// Set window.FIRFALL_API to your Worker URL in production.
const API = window.FIRFALL_API || 'http://localhost:3001';
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
let mode = 'login'; // or 'register'

function refreshAuthUI() {
  const u = localStorage.getItem('firfall_user');
  signInLabel.textContent = u ? u : 'Sign in';
}
function setMode(m) {
  mode = m;
  authTitle.textContent = m === 'login' ? 'Sign in' : 'Create account';
  authSubmit.textContent = m === 'login' ? 'Sign in' : 'Create account';
  authSwitch.textContent = m === 'login' ? 'New here? Create account' : 'Have an account? Sign in';
  authErr.textContent = '';
}
signInBtn.onclick = () => {
  const u = localStorage.getItem('firfall_user');
  if (u) { // sign out
    localStorage.removeItem('firfall_user');
    localStorage.removeItem('firfall_token');
    refreshAuthUI();
    return;
  }
  setMode('login');
  modal.classList.remove('hidden');
};
document.getElementById('authClose').onclick = () => modal.classList.add('hidden');
authSwitch.onclick = () => setMode(mode === 'login' ? 'register' : 'login');
authSubmit.onclick = async () => {
  authErr.textContent = '';
  const username = authUser.value.trim();
  const password = authPass.value;
  if (!username || !password) { authErr.textContent = 'Enter username + password.'; return; }
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
  } catch { authErr.textContent = 'Backend offline — run: node backend/server.js'; }
};
refreshAuthUI();
