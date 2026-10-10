'use strict';

// Optional progress sync via Supabase (email sign-in).
// Synced: start date, read checkmarks, translation, auto-mark. Theme, voice and
// speed stay per device. Local state is the source of truth while offline; we
// push after every change and pull when the app is opened or refocused.

const SUPABASE_URL = 'https://rnpuwanpgundhfmvzrne.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bBXg37-lo3GlX-uQorMfDA_0PKEsVwJ'; // publishable: safe in the browser, access is enforced by RLS
const SYNC_KEY = 'daily-reading:sync';
const SYNCED_FIELDS = ['start', 'read', 'translation', 'automark', 'meetDay', 'marks', 'onboarded', 'ai'];

window.SUPABASE_KEY = SUPABASE_KEY;

const sb = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

let user = null;
let signingOut = false; // distinguishes a deliberate sign-out from an expired session
let pushTimer = null;
let syncing = false;
// { remoteAt: ISO timestamp of the last remote version we've seen, pushed: JSON of what we last pushed }
let meta = loadMeta();

function loadMeta() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); } catch { return {}; }
}

function saveMeta() {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(meta)); } catch {}
}

function syncedSnapshot(s = state) {
  const out = {};
  SYNCED_FIELDS.forEach((k) => { out[k] = s[k]; });
  return out;
}

const isDirty = () => JSON.stringify(syncedSnapshot()) !== meta.pushed;

// Called by app.js after every local save.
window.onStateSaved = () => {
  if (!user || syncing) return;
  if (!isDirty()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 800);
};

async function push() {
  if (!user) return;
  const data = syncedSnapshot();
  setStatus('Syncing…');
  const { data: row, error } = await sb
    .from('progress')
    .upsert({ user_id: user.id, data }, { onConflict: 'user_id' })
    .select('updated_at')
    .single();
  if (error) return setStatus("Couldn't sync — will retry", true);
  meta.pushed = JSON.stringify(data);
  meta.remoteAt = row.updated_at;
  saveMeta();
  setStatus();
}

// Pull the account's copy and reconcile with this device.
async function pull({ firstSignIn = false } = {}) {
  if (!user) return;
  const { data: row, error } = await sb.from('progress').select('data, updated_at').maybeSingle();
  if (error) return setStatus("Couldn't reach sync server", true);

  if (!row) {
    // Nothing in the account yet: this device's progress becomes the account's.
    return push();
  }

  // Keep only valid synced fields from the server copy.
  const clean = sanitizeState(row.data);
  const remote = {};
  SYNCED_FIELDS.forEach((k) => { if (row.data && k in row.data) remote[k] = clean[k]; });
  const remoteNewer = !meta.remoteAt || row.updated_at > meta.remoteAt;

  if (!firstSignIn && isDirty() && !remoteNewer) {
    // Only this device changed: it wins (this keeps un-checks intact).
    return push();
  }

  if (firstSignIn || isDirty()) {
    // Both sides changed: keep every reading checked on either side; account settings win.
    syncing = true;
    state.read = { ...(remote.read || {}), ...state.read };
    state.marks = { ...(remote.marks || {}), ...state.marks };
    ['start', 'translation', 'automark', 'meetDay', 'ai'].forEach((k) => { if (k in remote) state[k] = remote[k]; });
    const returning = Boolean(remote.onboarded);
    state.onboarded = state.onboarded || returning;
    save();
    syncing = false;
    render();
    meta.remoteAt = row.updated_at;
    // Signed in to an account that was already set up: no need to finish onboarding.
    if (firstSignIn && returning) window.onAccountRestored?.();
    return push();
  }

  if (remoteNewer) {
    syncing = true;
    SYNCED_FIELDS.forEach((k) => { if (k in remote) state[k] = remote[k]; });
    save();
    syncing = false;
    meta.pushed = JSON.stringify(syncedSnapshot());
    meta.remoteAt = row.updated_at;
    saveMeta();
    render();
  }
  setStatus();
}

// Access token for calling our Supabase functions (licensed Bible text).
window.getAccessToken = async () => {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
};

// ---------- UI ----------

function setStatus(text, isError = false) {
  const el = $('#sync-status');
  if (!el) return;
  if (text) {
    el.textContent = text;
  } else {
    const t = meta.remoteAt ? new Date(meta.remoteAt) : null;
    el.textContent = t ? `Last synced ${t.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Synced';
  }
  el.classList.toggle('error', isError);
}

function renderAccount() {
  $('#sync-signed-out').hidden = Boolean(user);
  $('#sync-signed-in').hidden = !user;
  // Header icon: always shown; highlighted with a dot while signed in.
  const btn = $('#account-btn');
  btn.classList.toggle('signed-in', Boolean(user));
  btn.title = user ? `Signed in as ${user.email} · syncing` : 'Sign in to sync';
  btn.setAttribute('aria-label', user ? `Account: signed in as ${user.email}` : 'Account: sign in to sync');
  $('#settings-account-status').textContent = user ? `Signed in as ${user.email}` : 'Not signed in';
  $('#account-heading').textContent = user ? 'You’re signed in' : 'Sync across your devices';
  $('#account-sub').hidden = Boolean(user);
  if (user) $('#signin-banner').hidden = true;
  if (user) {
    $('#sync-email').textContent = user.email;
    setStatus();
  }
}

function setMessage(text, isError = false) {
  const el = $('#sync-message');
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('error', isError);
}

// Shared by Settings and onboarding. Each returns an error message, or null on success.
window.sendSignInLink = async (email) => {
  if (!sb) return 'Sync is unavailable right now.';
  if (!/^\S+@\S+\.\S+$/.test(email)) return 'Enter a valid email address.';
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  return error ? error.message : null;
};

// Sign in with the 6-digit code from the email (same email the code was sent to).
window.signInWithCode = async (email, code) => {
  if (!sb) return 'Sync is unavailable right now.';
  const token = String(code).replace(/\D/g, '');
  if (token.length !== 6) return 'Enter the 6-digit code from the email.';
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  return error ? "That code didn't work. Check it, or request a new code (codes expire after an hour)." : null;
};

window.currentUserEmail = () => user?.email ?? null;

$('#sync-send').addEventListener('click', async () => {
  const email = $('#sync-email-input').value.trim();
  $('#sync-send').disabled = true;
  const error = await window.sendSignInLink(email);
  $('#sync-send').disabled = false;
  if (error) return setMessage(error, true);
  setMessage(`We emailed a code to ${email}.`);
  $('#sync-paste').hidden = false;
  $('#sync-code-input').focus();
});

async function submitCode() {
  const error = await window.signInWithCode($('#sync-email-input').value.trim(), $('#sync-code-input').value);
  if (error) return setMessage(error, true);
  $('#sync-code-input').value = '';
  setMessage('');
}
$('#sync-code-btn').addEventListener('click', submitCode);
$('#sync-code-input').addEventListener('input', (e) => { if (e.target.value.replace(/\D/g, '').length === 6) submitCode(); });

$('#sync-now').addEventListener('click', async () => {
  setStatus('Syncing…');
  await pull();
});

$('#sync-signout').addEventListener('click', async () => {
  signingOut = true;
  await sb.auth.signOut();
  meta = {};
  saveMeta();
  signingOut = false;
});

// Account screen (header icon, Settings row, expired-session banner).
const accountDialog = $('#account');
function openAccount() {
  if (!accountDialog.open) accountDialog.showModal();
  if (!user) $('#sync-email-input').focus();
}

$('#account-btn').addEventListener('click', openAccount);
$('#settings-account').addEventListener('click', openAccount);
$('#account-close').addEventListener('click', () => accountDialog.close());
$('#signin-again').addEventListener('click', () => {
  $('#signin-banner').hidden = true;
  if (meta.email) $('#sync-email-input').value = meta.email;
  openAccount();
});
$('#signin-dismiss').addEventListener('click', () => { $('#signin-banner').hidden = true; });

// Previously signed in on this device, but the session is gone (expired or revoked).
function showExpired() {
  if (signingOut || !meta.userId) return;
  $('#signin-banner').hidden = false;
}

// ---------- Wiring ----------

if (!sb) {
  $('#account-btn').hidden = true;
  $('#account-group').hidden = true;
} else {
  renderAccount();
  sb.auth.onAuthStateChange((event, session) => {
    const wasSignedOut = !user;
    user = session?.user ?? null;
    renderAccount();
    window.onAuthChanged?.();
    if (!user && (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT')) showExpired();
    if (user && wasSignedOut) {
      // Defer: calling Supabase inside this callback can deadlock the auth client.
      const firstSignIn = meta.userId !== user.id;
      meta.userId = user.id;
      meta.email = user.email;
      saveMeta();
      setTimeout(() => pull({ firstSignIn }), 0);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && user) pull();
  });
  setInterval(() => { if (!document.hidden && user) pull(); }, 120000);
  window.addEventListener('online', () => { if (user) pull(); });
}
