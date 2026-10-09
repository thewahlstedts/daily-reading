'use strict';

const STORE_KEY = 'daily-reading:v1';
const API = 'https://bible-api.com/';
const $ = (sel) => document.querySelector(sel);

// ---------- State ----------

const defaults = {
  start: '2026-09-01',  // default plan start; change in Settings
  read: {},            // plan index -> ISO date it was marked read
  translation: 'web',
  voice: '',
  rate: 1,
  automark: true,
  showCompleted: false,
  theme: 'auto',
};

let state = load();
let plan = [];         // [{ ref, book, chapters: [n...] }]

function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  window.onStateSaved?.();
}

// ---------- Dates (day granularity, DST-safe) ----------

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

function dateForIndex(i) {
  const [y, m, d] = state.start.split('-').map(Number);
  return new Date(y, m - 1, d + i);
}

function todayIndex() {
  return dayNumber(isoDate(new Date())) - dayNumber(state.start);
}

const fmtShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

// ---------- Plan ----------

function parseRef(line) {
  const m = line.match(/^(.*\D)\s+(\d+)(?:-(\d+))?$/);
  if (!m) return { ref: line, book: line, chapters: [] };
  const [, book, a, b] = m;
  const chapters = [];
  for (let c = +a; c <= +(b || a); c++) chapters.push(c);
  return { ref: line, book, chapters };
}

async function loadPlan() {
  const res = await fetch('plan.txt');
  const text = await res.text();
  plan = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(parseRef);
}

const isRead = (i) => Boolean(state.read[i]);

function setRead(i, value) {
  if (value) state.read[i] = isoDate(new Date());
  else delete state.read[i];
  save();
  render();
}

// ---------- Rendering ----------

const checkSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';

function render() {
  const t = todayIndex();
  const total = plan.length;
  const doneCount = Object.keys(state.read).length;
  const behind = [];
  for (let i = 0; i < Math.min(t, total); i++) if (!isRead(i)) behind.push(i);

  $('#today-date').textContent = fmtLong.format(new Date());

  // Progress
  $('#progress-fill').style.width = `${(doneCount / total) * 100}%`;
  let progress = `${doneCount} of ${total} read`;
  if (t >= 0 && t < total) progress = `Day ${t + 1} of ${total} · ` + progress;
  if (behind.length) progress += ` · ${behind.length} behind`;
  $('#progress-text').textContent = progress;

  // Featured card: always the earliest reading not yet done.
  const next = plan.findIndex((_, i) => !isRead(i));
  const card = $('#today-card');
  if (next === -1) {
    card.innerHTML = `<p class="eyebrow done">Plan complete</p>
      <p class="ref">Well done</p>
      <p class="note">You've finished every reading in the plan.</p>`;
  } else {
    const when = fmtLong.format(dateForIndex(next));
    let label;
    if (next < t) label = `<p class="eyebrow late">Catch up · ${when}</p>`;
    else if (next === t) label = `<p class="eyebrow">Today's reading</p>`;
    else if (t < 0) label = `<p class="eyebrow">Plan starts ${when}</p>`;
    else label = `<p class="eyebrow done">✓ Today's done · Up next ${when}</p>`;
    card.innerHTML = `${label}
      <p class="ref">${plan[next].ref}</p>
      <div class="actions">
        <button class="btn primary" data-open="${next}">Read</button>
        <button class="btn primary" data-listen="${next}">Listen</button>
        <button class="btn ghost" data-toggle="${next}">Mark read</button>
      </div>`;
  }

  // Catch up (the featured reading is already shown above)
  const others = behind.filter((i) => i !== next);
  $('#behind').hidden = others.length === 0;
  $('#behind-list').innerHTML = others.map((i) => itemHtml(i, t)).join('');

  // Plan list: upcoming unread readings, or everything when showing completed
  const show = state.showCompleted
    ? plan.map((_, i) => i)
    : plan.map((_, i) => i).filter((i) => !isRead(i) && i !== next && i >= t);
  $('#plan-heading').textContent = state.showCompleted ? 'Full plan' : 'Up next';
  $('#completed-btn').textContent = state.showCompleted ? 'Hide completed' : `Show completed (${doneCount})`;
  $('#jump-btn').hidden = !state.showCompleted;

  const groups = new Map();
  show.forEach((i) => {
    const key = fmtMonth.format(dateForIndex(i));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  $('#plan-list').innerHTML = groups.size
    ? [...groups].map(([month, idxs]) =>
        `<div class="month"><h3>${month}</h3><ul class="list">${idxs.map((i) => itemHtml(i, t)).join('')}</ul></div>`
      ).join('')
    : '<p class="empty">Nothing left after this one.</p>';
}

function itemHtml(i, t) {
  const cls = ['item'];
  if (isRead(i)) cls.push('read');
  if (i === t) cls.push('is-today');
  if (i < t && !isRead(i)) cls.push('late');
  return `<li class="${cls.join(' ')}" data-index="${i}">
    <button class="tick" data-toggle="${i}" aria-label="${isRead(i) ? 'Mark unread' : 'Mark read'}">${checkSvg}</button>
    <span class="date">${fmtShort.format(dateForIndex(i))}</span>
    <button class="open" data-open="${i}">${plan[i].ref}</button>
  </li>`;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-open],[data-listen],[data-toggle]');
  if (!el) return;
  if (el.dataset.toggle != null) {
    const i = +el.dataset.toggle;
    setRead(i, !isRead(i));
  } else if (el.dataset.open != null) {
    openReader(+el.dataset.open, false);
  } else if (el.dataset.listen != null) {
    openReader(+el.dataset.listen, true);
  }
});

// Mark every overdue reading as read, with a short window to undo.
let undoCatchUp = null;
let toastTimer = null;

$('#catchup-btn').addEventListener('click', () => {
  const t = Math.min(todayIndex(), plan.length);
  const marked = [];
  for (let i = 0; i < t; i++) {
    if (!isRead(i)) {
      state.read[i] = isoDate(new Date());
      marked.push(i);
    }
  }
  if (!marked.length) return;
  save();
  render();
  undoCatchUp = () => {
    marked.forEach((i) => delete state.read[i]);
    save();
    render();
  };
  showToast(`Marked ${marked.length} reading${marked.length > 1 ? 's' : ''} as read`);
});

$('#toast-undo').addEventListener('click', () => {
  undoCatchUp?.();
  hideToast();
});

function showToast(text) {
  $('#toast-text').textContent = text;
  $('#toast-undo').hidden = !undoCatchUp;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
  $('#toast').hidden = true;
  undoCatchUp = null;
}

$('#completed-btn').addEventListener('click', () => {
  state.showCompleted = !state.showCompleted;
  save();
  render();
});

$('#jump-btn').addEventListener('click', () => {
  const t = Math.max(0, Math.min(todayIndex(), plan.length - 1));
  document.querySelector(`#plan-list [data-index="${t}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// ---------- Scripture ----------

const passageCache = new Map();

function apiBook(book) {
  return book === 'Psalm' ? 'Psalms' : book;
}

async function fetchChapter(book, chapter) {
  const key = `${state.translation}|${book}|${chapter}`;
  if (passageCache.has(key)) return passageCache.get(key);
  const url = `${API}${encodeURIComponent(`${apiBook(book)} ${chapter}`)}?translation=${state.translation}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${book} ${chapter} (${res.status})`);
  const data = await res.json();
  const verses = data.verses.map((v) => ({ n: v.verse, text: v.text.replace(/\s+/g, ' ').trim() }));
  passageCache.set(key, verses);
  return verses;
}

// ---------- Reader + speech ----------

let current = null;      // { index, segments: [{ el, speak }] }
let pos = 0;             // segment being spoken
let playing = false;
let gen = 0;             // bumps whenever playback is interrupted, to ignore stale utterance events
let wakeLock = null;

const reader = $('#reader');

async function openReader(index, autoplay) {
  stopSpeech();
  const item = plan[index];
  current = { index, segments: [] };
  pos = 0;
  $('#reader-title').textContent = item.ref;
  $('#reader-sub').textContent = fmtLong.format(dateForIndex(index));
  updateMarkBtn();
  updateRateBtn();
  const body = $('#reader-body');
  body.innerHTML = '<p class="status">Loading…</p>';
  body.scrollTop = 0;
  if (!reader.open) reader.showModal();

  try {
    const chapters = await Promise.all(item.chapters.map((c) => fetchChapter(item.book, c)));
    if (current?.index !== index) return;
    body.innerHTML = '';
    chapters.forEach((verses, ci) => {
      const heading = document.createElement('h3');
      heading.textContent = `${item.book} ${item.chapters[ci]}`;
      body.append(heading);
      current.segments.push({ el: heading, speak: `${apiBook(item.book) === 'Psalms' ? 'Psalm' : item.book} chapter ${item.chapters[ci]}.` });
      const p = document.createElement('p');
      verses.forEach((v) => {
        const span = document.createElement('span');
        span.className = 'verse';
        span.innerHTML = `<sup>${v.n}</sup>`;
        span.append(document.createTextNode(v.text + ' '));
        span.dataset.seg = current.segments.length;
        current.segments.push({ el: span, speak: v.text });
        p.append(span);
      });
      body.append(p);
    });
    if (autoplay) play();
  } catch (err) {
    body.innerHTML = `<p class="status">${err.message}.<br>Check your connection and try again.</p>`;
  }
}

function closeReader() {
  stopSpeech();
  current = null;
  reader.close();
}

$('#reader-close').addEventListener('click', closeReader);
reader.addEventListener('cancel', (e) => { e.preventDefault(); closeReader(); });

$('#reader-body').addEventListener('click', (e) => {
  const v = e.target.closest('.verse');
  if (!v) return;
  pos = +v.dataset.seg;
  if (playing) speakFrom(pos);
  else highlight(pos);
});

$('#play-btn').addEventListener('click', () => (playing ? pause() : play()));
$('#prev-verse').addEventListener('click', () => skip(-1));
$('#next-verse').addEventListener('click', () => skip(1));

$('#mark-btn').addEventListener('click', () => {
  if (!current) return;
  setRead(current.index, !isRead(current.index));
  updateMarkBtn();
});

const RATES = [0.75, 0.9, 1, 1.15, 1.3, 1.5];
$('#rate-btn').addEventListener('click', () => {
  const next = RATES.find((r) => r > state.rate + 0.001) ?? RATES[0];
  setRate(next);
});

function setRate(r) {
  state.rate = r;
  save();
  updateRateBtn();
  $('#set-rate').value = r;
  $('#rate-label').textContent = `${r.toFixed(2)}×`;
  if (playing) speakFrom(pos);
}

function updateMarkBtn() {
  const done = current && isRead(current.index);
  const btn = $('#mark-btn');
  btn.textContent = done ? '✓ Read' : 'Mark read';
  btn.className = `btn ${done ? 'done' : 'ghost'}`;
}

function updateRateBtn() {
  $('#rate-btn').textContent = `${+state.rate.toFixed(2)}×`;
}

function highlight(i) {
  document.querySelectorAll('.verse.speaking').forEach((el) => el.classList.remove('speaking'));
  const seg = current?.segments[i];
  if (!seg) return;
  if (seg.el.classList.contains('verse')) seg.el.classList.add('speaking');
  seg.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function play() {
  if (!current?.segments.length) return;
  if (pos >= current.segments.length) pos = 0;
  speakFrom(pos);
}

function pause() {
  gen++;
  speechSynthesis.cancel();
  setPlaying(false);
}

function stopSpeech() {
  pause();
  pos = 0;
  document.querySelectorAll('.verse.speaking').forEach((el) => el.classList.remove('speaking'));
}

function skip(delta) {
  if (!current?.segments.length) return;
  pos = Math.max(0, Math.min(current.segments.length - 1, pos + delta));
  if (playing) speakFrom(pos);
  else highlight(pos);
}

// Speak one verse at a time: keeps highlighting in sync and avoids the
// browser cutting off long utterances.
function speakFrom(i) {
  gen++;
  const myGen = gen;
  speechSynthesis.cancel();
  setPlaying(true);
  const step = (j) => {
    if (myGen !== gen) return;
    if (!current || j >= current.segments.length) {
      setPlaying(false);
      pos = 0;
      highlight(-1);
      if (current && state.automark && !isRead(current.index)) {
        setRead(current.index, true);
        updateMarkBtn();
      }
      return;
    }
    pos = j;
    highlight(j);
    const u = new SpeechSynthesisUtterance(current.segments[j].speak);
    const voice = pickVoice();
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = state.rate;
    u.onend = () => step(j + 1);
    u.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      // Blocked or broken speech: stop rather than racing to the end (and auto-marking).
      if (myGen === gen) setPlaying(false);
    };
    speechSynthesis.speak(u);
  };
  // Small delay lets cancel() settle (Safari drops an immediate speak otherwise).
  setTimeout(() => step(i), 60);
}

async function setPlaying(on) {
  playing = on;
  $('#play-btn').classList.toggle('playing', on);
  $('#play-btn').setAttribute('aria-label', on ? 'Pause' : 'Listen');
  // Keep the screen on while listening; speech stops on many phones once they lock.
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {}
}

// ---------- Voices ----------

let voices = [];

function loadVoices() {
  voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  const sel = $('#set-voice');
  const chosen = pickVoice();
  sel.innerHTML = voices.map((v) =>
    `<option value="${v.voiceURI}" ${chosen && v.voiceURI === chosen.voiceURI ? 'selected' : ''}>${v.name} (${v.lang})</option>`
  ).join('');
  $('#voice-hint').textContent = voices.length
    ? 'Voices come from your device. On iPhone, download "Enhanced" or "Premium" voices in Settings › Accessibility › Spoken Content › Voices for the most natural sound.'
    : 'No English voices found on this device.';
}

function pickVoice() {
  if (!voices.length) return null;
  const saved = voices.find((v) => v.voiceURI === state.voice);
  if (saved) return saved;
  const score = (v) =>
    (/premium|enhanced|natural|neural/i.test(v.name) ? 4 : 0) +
    (v.lang === 'en-US' ? 2 : 0) +
    (v.localService ? 1 : 0) +
    (v.default ? 1 : 0);
  return [...voices].sort((a, b) => score(b) - score(a))[0];
}

if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

// ---------- Themes ----------

const THEMES = [
  { id: 'auto', name: 'Auto', bg: 'linear-gradient(135deg, #f7f3ec 50%, #1b1916 50%)', ink: '#7a7166', accent: '#b07a45' },
  { id: 'parchment', name: 'Parchment', bg: '#f7f3ec', ink: '#2a2622', accent: '#8a5a2b' },
  { id: 'sage', name: 'Sage', bg: '#eff3ec', ink: '#232d26', accent: '#4a7356' },
  { id: 'ocean', name: 'Ocean', bg: '#edf2f7', ink: '#1e2a35', accent: '#2f6690' },
  { id: 'night', name: 'Night', bg: '#1b1916', ink: '#ece6dc', accent: '#d9a46c' },
  { id: 'midnight', name: 'Midnight', bg: '#0f1620', ink: '#e3e9f0', accent: '#7fb3e0' },
  { id: 'black', name: 'Black', bg: '#000000', ink: '#e8e6e3', accent: '#d9a46c' },
];

function applyTheme() {
  const root = document.documentElement;
  if (state.theme && state.theme !== 'auto') root.dataset.theme = state.theme;
  else delete root.dataset.theme;
  // Match the browser/status bar to the page background.
  $('#theme-color').content = getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-checked', b.dataset.theme === (state.theme || 'auto')));
}

$('#theme-picker').innerHTML = THEMES.map((t) => `
  <button type="button" class="swatch" role="radio" data-theme="${t.id}">
    <span class="preview" style="background:${t.bg}"><i style="background:${t.ink}"></i><i style="background:${t.accent}"></i></span>
    ${t.name}
  </button>`).join('');

$('#theme-picker').addEventListener('click', (e) => {
  const b = e.target.closest('.swatch');
  if (!b) return;
  state.theme = b.dataset.theme;
  save();
  applyTheme();
});

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyTheme();

// ---------- Settings ----------

const settings = $('#settings');

$('#settings-btn').addEventListener('click', () => {
  $('#set-start').value = state.start;
  $('#set-translation').value = state.translation;
  $('#set-rate').value = state.rate;
  $('#rate-label').textContent = `${state.rate.toFixed(2)}×`;
  $('#set-automark').checked = state.automark;
  loadVoices();
  settings.showModal();
});
$('#settings-close').addEventListener('click', () => settings.close());

$('#set-start').addEventListener('change', (e) => {
  if (!e.target.value) return;
  state.start = e.target.value;
  save();
  render();
});
$('#set-translation').addEventListener('change', (e) => { state.translation = e.target.value; save(); });
$('#set-voice').addEventListener('change', (e) => { state.voice = e.target.value; save(); });
$('#set-rate').addEventListener('input', (e) => setRate(+e.target.value));
$('#set-automark').addEventListener('change', (e) => { state.automark = e.target.checked; save(); });

$('#test-voice').addEventListener('click', () => {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance('The Lord is my shepherd; I shall not want.');
  const voice = pickVoice();
  if (voice) { u.voice = voice; u.lang = voice.lang; }
  u.rate = state.rate;
  speechSynthesis.speak(u);
});

$('#export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `daily-reading-progress-${isoDate(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (typeof data.read !== 'object' || !data.start) throw new Error('bad file');
    state = { ...defaults, ...data };
    save();
    applyTheme();
    render();
    settings.close();
  } catch {
    $('#voice-hint').textContent = "That file doesn't look like a Daily Reading backup.";
  }
  e.target.value = '';
});

// ---------- Sharing ----------

// A shared link carries the sharer's start date (?start=YYYY-MM-DD) so the
// recipient's schedule lines up day for day.
function shareUrl() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('start', state.start);
  return url.toString();
}

async function sharePlan() {
  const url = shareUrl();
  const text = `Read through the Bible with me — this plan started ${fmtLong.format(dateForIndex(0))}.`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Daily Reading', text, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  undoCatchUp = null;
  try {
    await navigator.clipboard.writeText(url);
    showToast('Link copied');
  } catch {
    showToast(url);
  }
}

$('#share-btn-settings').addEventListener('click', sharePlan);

function handleSharedLink() {
  const params = new URLSearchParams(location.search);
  const shared = params.get('start');
  if (!shared) return;
  history.replaceState(null, '', location.pathname);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shared) || isNaN(dayNumber(shared))) return;
  if (shared === state.start) return;

  let hasOwnStart = false;
  try { hasOwnStart = 'start' in JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch {}
  const [y, m, d] = shared.split('-').map(Number);
  const sharedLabel = fmtLong.format(new Date(y, m - 1, d));

  if (!hasOwnStart) {
    // First visit: just adopt the sharer's schedule.
    state.start = shared;
    save();
    render();
    undoCatchUp = null;
    showToast(`Plan synced to start ${sharedLabel}`);
    return;
  }

  $('#shared-text').textContent = `This link starts the plan on ${sharedLabel}. Your plan currently starts ${fmtLong.format(dateForIndex(0))}. Switch so your readings line up?`;
  $('#shared-banner').hidden = false;
  $('#shared-use').onclick = () => {
    state.start = shared;
    save();
    render();
    $('#shared-banner').hidden = true;
  };
  $('#shared-keep').onclick = () => { $('#shared-banner').hidden = true; };
}

// ---------- Boot ----------

// Re-render when the app is reopened on a new day.
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

loadPlan().then(() => {
  render();
  handleSharedLink();
});
