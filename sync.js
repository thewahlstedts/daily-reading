'use strict';

// Optional progress sync via Supabase (email sign-in).
// Synced: start date, read checkmarks, translation, auto-mark. Theme, voice and
// speed stay per device. Local state is the source of truth while offline; we
// push after every change and pull when the app is opened or refocused.

const SUPABASE_URL = 'https://rnpuwanpgundhfmvzrne.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bBXg37-lo3GlX-uQorMfDA_0PKEsVwJ'; // publishable: safe in the browser, access is enforced by RLS
const SYNC_KEY = 'daily-reading:sync';
const SYNCED_FIELDS = ['start', 'read', 'translation', 'automark', 'meetDay', 'marks', 'onboarded', 'ai', 'metOn'];

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

const OFFLINE = "Offline — changes will sync when you're back online";

// Losing this many marks or checkmarks in one push is more likely stale or
// test data on this device than something the person did, so ask first.
function bigLoss(data) {
  let before;
  try { before = JSON.parse(meta.pushed || 'null'); } catch {}
  if (!before) return null;
  const lost = (a, b) => Object.keys(a || {}).filter((k) => !(k in (b || {}))).length;
  const marks = lost(before.marks, data.marks), was = Object.keys(before.marks || {}).length;
  const read = lost(before.read, data.read), wasRead = Object.keys(before.read || {}).length;
  const tooMany = marks >= 8 || (was >= 3 && marks === was) || read >= 14 || (wasRead >= 7 && read > wasRead / 2);
  return tooMany ? { marks, read } : null;
}

const guardDialog = $('#sync-guard');

async function push({ force = false } = {}) {
  if (!user) return;
  if (!navigator.onLine) return setStatus(OFFLINE);
  const data = syncedSnapshot();
  if (!force) {
    if (guardDialog.open) return;
    const loss = bigLoss(data);
    if (loss) return confirmLoss(loss);
  }
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
  if (!navigator.onLine) return setStatus(OFFLINE);
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

  if (remoteNewer) applyRemote(remote, row.updated_at);
  setStatus();
}

// Replace this device's synced fields with the account's copy.
function applyRemote(remote, updatedAt) {
  syncing = true;
  SYNCED_FIELDS.forEach((k) => { if (k in remote) state[k] = remote[k]; });
  save();
  syncing = false;
  meta.pushed = JSON.stringify(syncedSnapshot());
  meta.remoteAt = updatedAt;
  saveMeta();
  render();
}

function confirmLoss({ marks, read }) {
  const parts = [];
  if (marks) parts.push(`${marks} marked ${marks === 1 ? 'verse' : 'verses'}`);
  if (read) parts.push(`${read} ${read === 1 ? 'checkmark' : 'checkmarks'}`);
  $('#sync-guard-text').textContent = `Syncing this device would remove ${parts.join(' and ')} from your account. If you didn't mean to remove them, keep the account's copy.`;
  setStatus('Waiting to sync');
  guardDialog.showModal();
}

$('#sync-guard-replace').addEventListener('click', () => {
  guardDialog.close();
  push({ force: true });
});

$('#sync-guard-keep').addEventListener('click', async () => {
  guardDialog.close();
  const { data: row, error } = await sb.from('progress').select('data, updated_at').maybeSingle();
  if (error || !row) return setStatus("Couldn't reach sync server", true);
  const clean = sanitizeState(row.data);
  const remote = {};
  SYNCED_FIELDS.forEach((k) => { if (row.data && k in row.data) remote[k] = clean[k]; });
  applyRemote(remote, row.updated_at);
  setStatus();
});

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
  $('#feedback-status').textContent = user ? 'Ideas, problems, anything' : 'Sign in first, so you can get a reply';
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
  if (!navigator.onLine) return "You're offline. Connect to the internet to sign in.";
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
  if (!navigator.onLine) return "You're offline. Connect to the internet to sign in.";
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  return error ? "That code didn't work. Check it, or request a new code (codes expire after an hour)." : null;
};

window.currentUserEmail = () => user?.email ?? null;

// For reminder.js, which keeps its own table.
window.supabaseClient = sb;
window.currentUserId = () => user?.id ?? null;

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
  await window.beforeSignOut?.(); // still signed in, so this device's reminder can be removed
  await sb.auth.signOut();
  meta = {};
  saveMeta();
  signingOut = false;
});

// Account screen (header icon, Settings row, expired-session banner).
const accountDialog = $('#account');
function openAccount() {
  openSheet(accountDialog);
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

// Feedback (Settings): emailed to the owner by the `feedback` function, with
// Reply-To set to the sender. Signed-in only, so it can't be sent anonymously.
const FEEDBACK_FN = 'https://rnpuwanpgundhfmvzrne.supabase.co/functions/v1/feedback';
const feedbackDialog = $('#feedback-dialog');

function feedbackHint(text, isError = false) {
  const el = $('#feedback-hint');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

$('#feedback-btn').addEventListener('click', () => {
  if (!user) return openAccount();
  feedbackHint(`We'll reply to ${user.email}.`);
  feedbackDialog.showModal();
  $('#feedback-text').focus();
});
$('#feedback-cancel').addEventListener('click', () => feedbackDialog.close());

$('#feedback-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = $('#feedback-text').value.trim();
  if (!message) return feedbackHint('Write something first.', true);
  if (!navigator.onLine) return feedbackHint("You're offline. Your message is still here; send it when you're connected.", true);
  const token = await window.getAccessToken();
  if (!token) return feedbackHint('Your sign-in has expired. Sign in again under Account & sync.', true);
  const send = $('#feedback-send');
  send.disabled = true;
  feedbackHint('Sending…');
  const context = [
    `Translation: ${state.translation}`,
    `Group meets: ${state.meetDay == null ? 'no group' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][state.meetDay]}`,
    `Home-screen app: ${navigator.standalone || matchMedia('(display-mode: standalone)').matches ? 'yes' : 'no'}`,
  ].join('\n');
  try {
    const res = await fetch(FEEDBACK_FN, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, context }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `Couldn't send (${res.status}).`);
    $('#feedback-text').value = '';
    feedbackDialog.close();
    $('#feedback-status').textContent = 'Sent. Thank you!';
  } catch (err) {
    // fetch() rejects with a TypeError on network failure (wording varies by browser).
    feedbackHint(err instanceof TypeError ? "Couldn't reach the server. Try again." : err.message, true);
  } finally {
    send.disabled = false;
  }
});

// Previously signed in on this device, but the session is gone (expired or revoked).
function showExpired() {
  if (signingOut || !meta.userId) return;
  $('#signin-banner').hidden = false;
}

// ---------- Usage counts ----------

// So the owner can see how many devices use the app, signed in or not: once per
// UTC day per device (and again when the account changes), the live site sends a
// random device ID and whether it's the home-screen app. Nothing else.
const USAGE_FN = `${SUPABASE_URL}/functions/v1/usage`;
const USAGE_KEY = 'daily-reading:usage';
let pinging = false; // load fires several auth events at once

async function pingUsage() {
  if (location.hostname !== 'thewahlstedts.github.io' || !navigator.onLine || pinging) return;
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'); } catch {}
  const day = new Date().toISOString().slice(0, 10);
  const who = user?.id ?? '';
  if (seen.day === day && seen.who === who) return;
  // Keep the ID before sending, so a lost reply doesn't make this a new device.
  const device = /^[0-9a-f-]{36}$/.test(seen.device) ? seen.device : crypto.randomUUID();
  const remember = (v) => { try { localStorage.setItem(USAGE_KEY, JSON.stringify(v)); } catch {} };
  remember({ ...seen, device });
  pinging = true;
  try {
    const token = user ? await window.getAccessToken() : null;
    const res = await fetch(USAGE_FN, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ device, standalone: !!(navigator.standalone || matchMedia('(display-mode: standalone)').matches) }),
    });
    if (res.ok) remember({ device, day, who });
  } catch {} finally { pinging = false; } // offline or blocked: try again next time
}

// Settings shows the dashboard link only to admins. The list lives on the server
// (ADMIN_EMAILS), so ask it, at most once a day per account on this device.
const ADMIN_KEY = 'daily-reading:admin';
let checkingAdmin = false;

async function checkAdmin() {
  let known = {};
  try { known = JSON.parse(localStorage.getItem(ADMIN_KEY) || '{}'); } catch {}
  const mine = Boolean(user) && known.uid === user.id;
  $('#admin-group').hidden = !(mine && known.admin === true);
  if (!user || !navigator.onLine || checkingAdmin || (mine && Date.now() - known.at < 86400000)) return;
  checkingAdmin = true;
  try {
    const token = await window.getAccessToken();
    if (!token) return;
    const res = await fetch(`${USAGE_FN}?check`, { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY } });
    const { admin } = res.ok ? await res.json() : {};
    if (typeof admin !== 'boolean') return; // e.g. a function deployed before ?check existed
    localStorage.setItem(ADMIN_KEY, JSON.stringify({ uid: user.id, admin, at: Date.now() }));
    $('#admin-group').hidden = !admin;
  } catch {} finally { checkingAdmin = false; } // offline or blocked: keep what we knew
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
    document.dispatchEvent(new Event('authchange'));
    if (!user && (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT')) showExpired();
    setTimeout(pingUsage, 0); // deferred, like pull() below
    setTimeout(checkAdmin, 0);
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
    if (!document.hidden) pingUsage();
  });
  setInterval(() => { if (!document.hidden && user) pull(); }, 120000);
  window.addEventListener('online', () => { if (user) pull(); pingUsage(); });
}
