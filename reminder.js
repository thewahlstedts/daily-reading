'use strict';

// Daily reminder via Web Push. A web app can't schedule its own notification,
// so the `remind` Edge Function sends it; it reads the account's synced progress
// to name today's reading and to skip days that are already read, which is why
// reminders need sign-in. Per device: each browser has its own subscription,
// time and on/off switch (kept in REMINDER_KEY, not in the synced state).

// Public half of the VAPID key pair (the private half is a function secret).
// Leave empty to hide the feature.
const VAPID_PUBLIC_KEY = '';
const REMINDER_KEY = 'daily-reading:reminder';
const DEFAULT_TIME = '07:00';
const SUBSCRIBE_TIMEOUT = 15000;
const BLOCKED = 'Notifications are blocked for this app. Allow them in your browser or system settings, then try again.';

let reminder = loadReminder();

function loadReminder() {
  try {
    const r = JSON.parse(localStorage.getItem(REMINDER_KEY) || '{}');
    return { on: r.on === true, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : DEFAULT_TIME };
  } catch {
    return { on: false, time: DEFAULT_TIME };
  }
}

function saveReminder() {
  try { localStorage.setItem(REMINDER_KEY, JSON.stringify(reminder)); } catch {}
}

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone || matchMedia('(display-mode: standalone)').matches;

function keyBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Unknown counts as the same: re-subscribing on every open would leave a stale row each time.
const sameKey = (a, b) => !a || (a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]));

// Why reminders can't be turned on here, or '' if they can.
function unavailableReason() {
  if (!pushSupported()) {
    return isIos() && !isStandalone()
      ? 'On iPhone and iPad, add this app to your Home Screen first (Share → Add to Home Screen), then turn this on there.'
      : "This browser doesn't support notifications.";
  }
  if (!window.currentUserId()) return 'Sign in (Account & sync) to get reminders. They name the day’s reading and skip days you’ve already read.';
  if (Notification.permission === 'denied') return BLOCKED;
  return '';
}

function renderReminder(message = '', isError = false) {
  const reason = unavailableReason();
  const toggle = $('#set-remind');
  toggle.checked = reminder.on && !reason;
  toggle.disabled = Boolean(reason);
  $('#set-remind-time').value = reminder.time;
  $('#remind-time-row').hidden = !toggle.checked;
  const hint = $('#remind-hint');
  hint.textContent = message || reason || (toggle.checked ? 'On this device. Skipped on days you’re caught up.' : 'A notification on this device with the day’s reading');
  hint.classList.toggle('error', isError || (Boolean(reason) && reason === BLOCKED));
}

async function subscription({ create }) {
  const reg = await navigator.serviceWorker.ready;
  const key = keyBytes(VAPID_PUBLIC_KEY);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe(); // made with an older key; the server can't send to it
    sub = null;
  }
  if (!sub && create) {
    // Can hang when the browser's push service is unreachable, so give up after a while.
    const timeout = new Promise((_, reject) => setTimeout(reject, SUBSCRIBE_TIMEOUT));
    sub = await Promise.race([reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), timeout]).catch(() => {
      throw new Error("This browser couldn't set up notifications (private windows can't). Try again later.");
    });
  }
  return sub;
}

// Store this device's subscription and time on the account (refreshes keys and time zone too).
async function saveRow(sub) {
  const { p256dh, auth } = sub.toJSON().keys || {};
  const [h, m] = reminder.time.split(':').map(Number);
  const { error } = await window.supabaseClient.from('reminders').upsert({
    user_id: window.currentUserId(),
    endpoint: sub.endpoint,
    p256dh,
    auth,
    at_minute: h * 60 + m,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  }, { onConflict: 'user_id,endpoint' });
  if (error) throw new Error("Couldn't save the reminder. Check your connection and try again.");
}

async function deleteRow(sub) {
  if (!window.currentUserId()) return;
  await window.supabaseClient.from('reminders').delete().eq('endpoint', sub.endpoint);
}

async function turnOn() {
  // Ask first, straight from the tap: Safari only prompts in response to a user gesture.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? BLOCKED : 'Notifications weren’t allowed, so reminders are off.');
  if (!navigator.onLine) throw new Error("You're offline. Connect to the internet to turn on reminders.");
  await saveRow(await subscription({ create: true }));
}

async function turnOff() {
  const sub = await subscription({ create: false }).catch(() => null);
  if (!sub) return;
  await deleteRow(sub).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

$('#set-remind').addEventListener('change', async (e) => {
  const on = e.target.checked;
  e.target.disabled = true;
  try {
    if (on) await turnOn();
    else await turnOff();
    reminder.on = on;
    saveReminder();
    renderReminder(on ? `Reminder set for ${fmtTime(reminder.time)} on this device.` : '');
  } catch (err) {
    if (on) await turnOff(); // don't leave a half-made subscription behind
    reminder.on = false;
    saveReminder();
    renderReminder(err.message, true);
  }
});

$('#set-remind-time').addEventListener('change', async (e) => {
  if (!/^\d{2}:\d{2}$/.test(e.target.value)) return;
  reminder.time = e.target.value;
  saveReminder();
  if (!reminder.on) return;
  try {
    const sub = await subscription({ create: false });
    if (!sub) throw new Error('This device’s notification permission was reset. Turn the reminder off and on again.');
    await saveRow(sub);
    renderReminder(`Reminder moved to ${fmtTime(reminder.time)}.`);
  } catch (err) {
    renderReminder(err.message, true);
  }
});

const fmtTime = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

// While signed in, re-save the subscription once per app load: browsers can
// replace it, and the time zone changes when traveling. (Auth events also fire
// on every hourly token refresh, hence `refreshedFor`.)
let refreshedFor = null;

async function refreshReminder() {
  renderReminder();
  const uid = window.currentUserId();
  if (!reminder.on || unavailableReason() || !navigator.onLine || refreshedFor === uid) return;
  refreshedFor = uid;
  if (Notification.permission !== 'granted') {
    reminder.on = false;
    saveReminder();
    return renderReminder();
  }
  try {
    await saveRow(await subscription({ create: true }));
  } catch {
    // Try again next time the app opens.
  }
}

// Reminders depend on the account, so signing out turns this device's off.
window.beforeSignOut = async () => {
  if (!reminder.on) return;
  await turnOff();
  reminder.on = false;
  saveReminder();
};

if (!VAPID_PUBLIC_KEY || !window.supabaseClient) {
  $('#remind-group').hidden = true;
} else {
  renderReminder();
  document.addEventListener('authchange', refreshReminder);
}
