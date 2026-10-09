'use strict';

// Optional progress sync via Supabase (email sign-in).
// Synced: start date, read checkmarks, translation, auto-mark. Theme, voice and
// speed stay per device. Local state is the source of truth while offline; we
// push after every change and pull when the app is opened or refocused.

const SUPABASE_URL = 'https://rnpuwanpgundhfmvzrne.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bBXg37-lo3GlX-uQorMfDA_0PKEsVwJ'; // publishable: safe in the browser, access is enforced by RLS
const SYNC_KEY = 'daily-reading:sync';
const SYNCED_FIELDS = ['start', 'read', 'translation', 'automark', 'meetDay'];

const sb = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

let user = null;
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
    ['start', 'translation', 'automark', 'meetDay'].forEach((k) => { if (k in remote) state[k] = remote[k]; });
    save();
    syncing = false;
    render();
    meta.remoteAt = row.updated_at;
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

$('#sync-send').addEventListener('click', async () => {
  const email = $('#sync-email-input').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return setMessage('Enter a valid email address.', true);
  $('#sync-send').disabled = true;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  $('#sync-send').disabled = false;
  if (error) return setMessage(error.message, true);
  setMessage(`Sign-in link sent to ${email}. Open it on this device.`);
  $('#sync-paste').hidden = false;
});

// Home-screen apps on iPhone don't share storage with Safari, so tapping the
// emailed link signs Safari in, not the app. Pasting the link here works anywhere.
$('#sync-paste-btn').addEventListener('click', async () => {
  const raw = $('#sync-link-input').value.trim();
  let url;
  try { url = new URL(raw); } catch { return setMessage("That doesn't look like the sign-in link.", true); }
  const tokenHash = url.searchParams.get('token') || url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') || 'magiclink';
  if (!tokenHash) return setMessage("That link is missing its sign-in code. Copy the whole link from the email.", true);
  const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return setMessage(`${error.message}. Request a new link and try again.`, true);
  $('#sync-link-input').value = '';
  setMessage('');
});

$('#sync-now').addEventListener('click', async () => {
  setStatus('Syncing…');
  await pull();
});

$('#sync-signout').addEventListener('click', async () => {
  await sb.auth.signOut();
  meta = {};
  saveMeta();
});

// ---------- Wiring ----------

if (!sb) {
  $('#sync-section').hidden = true;
} else {
  sb.auth.onAuthStateChange((event, session) => {
    const wasSignedOut = !user;
    user = session?.user ?? null;
    renderAccount();
    if (user && wasSignedOut) {
      // Defer: calling Supabase inside this callback can deadlock the auth client.
      const firstSignIn = meta.userId !== user.id;
      meta.userId = user.id;
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
