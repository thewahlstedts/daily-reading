'use strict';

const STORE_KEY = 'daily-reading:v1';
const $ = (sel) => document.querySelector(sel);

// ---------- State ----------

const defaults = {
  start: '2026-09-01',  // default plan start; change in Settings
  read: {},            // plan index -> ISO date it was marked read
  translation: 'leb',   // bundled, so it works offline from day one
  narrator: 'hays',
  voice: '',
  rate: 1,
  automark: true,
  showCompleted: false,
  theme: 'auto',
  font: 'classic',
  textSize: 2,         // index into SIZES
  leading: 'normal',
  meetDay: null,       // 0 = Sunday … 6 = Saturday; null = not in a group
  onboarded: false,    // finished (or skipped) the getting-started walkthrough
  ai: 'claude',        // which AI the "Ask" links open (AI_TOOLS id)
  claudeProject: '',   // optional Claude project id; Claude links then open it in the Claude app
  marks: {},           // verses marked for the group: 'PSA.23.1' -> { i: plan index, at: ISO date, t: translation id, n?: note }
};
const MAX_NOTE = 1000;
// "Ask" links open the person's own AI with the question filled in (their own account).
const AI_TOOLS = [
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new?q=' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/?q=' },
  { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app?q=' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?udm=50&q=', hint: 'AI Mode' },
  { id: 'none', name: 'Off' },
];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    // People who used the app before onboarding existed don't need it.
    if (Object.keys(raw).length && !('onboarded' in raw)) raw.onboarded = true;
    return sanitizeState(raw);
  } catch {
    return { ...defaults };
  }
}

// Saved state can come from this device, an imported backup file, or the sync
// server. Treat it all as untrusted: keep only known fields with sane values.
// Bibles from the free HelloAO API (bible.helloao.org). `src` is its translation id.
const BIBLES = [
  { id: 'bsb', name: 'Berean Standard (BSB)', src: 'BSB', narrated: true },
  { id: 'net', name: 'NET Bible', src: 'eng_net' },
  { id: 'web', name: 'World English (WEB)', src: 'ENGWEBP' },
  { id: 'lsv', name: 'Literal Standard (LSV)', src: 'eng_lsv' },
  { id: 'kjv', name: 'King James (KJV)', src: 'eng_kjv' },
  { id: 'asv', name: 'American Standard (ASV)', src: 'eng_asv' },
  { id: 'ylt', name: "Young's Literal (YLT)", src: 'eng_ylt' },
  { id: 'gnv', name: 'Geneva 1599', src: 'eng_gnv' },
  { id: 'darby', name: 'Darby', src: 'eng_dby' },
  { id: 'bbe', name: 'Basic English (BBE)', src: 'eng_bbe' },
  // Bundled with the app (converted from the SWORD module by tools/sword_to_json.py).
  { id: 'leb', name: 'Lexham English Bible (LEB)', local: 'bibles/leb' },
  // Licensed via API.Bible through our Supabase function; signed-in users only.
  { id: 'niv', name: 'New International Version (NIV)', licensed: true },
  { id: 'nlt', name: 'New Living Translation (NLT)', licensed: true },
  { id: 'amp', name: 'Amplified Bible (AMP)', licensed: true },
];
const TRANSLATIONS = BIBLES.map((b) => b.id);

// Human narrators for narrated Bibles (all have per-verse timings), or the device's voice.
const NARRATORS = [
  { id: 'hays', name: 'Hays' },
  { id: 'souer', name: 'Souer' },
  { id: 'david', name: 'David' },
  { id: 'device', name: 'Device voice' },
];

function sanitizeState(raw) {
  const s = { ...defaults };
  if (!raw || typeof raw !== 'object') return s;
  const str = (v, re) => typeof v === 'string' && re.test(v);
  if (str(raw.start, /^\d{4}-\d{2}-\d{2}$/) && !isNaN(Date.parse(raw.start))) s.start = raw.start;
  if (raw.read && typeof raw.read === 'object') {
    s.read = {};
    for (const [k, v] of Object.entries(raw.read)) {
      if (/^\d{1,4}$/.test(k) && typeof v === 'string' && v.length <= 32) s.read[k] = v;
    }
  }
  if (TRANSLATIONS.includes(raw.translation)) s.translation = raw.translation;
  if (NARRATORS.some((n) => n.id === raw.narrator)) s.narrator = raw.narrator;
  if (typeof raw.voice === 'string' && raw.voice.length <= 300) s.voice = raw.voice;
  if (typeof raw.rate === 'number' && raw.rate >= 0.5 && raw.rate <= 2) s.rate = raw.rate;
  if (typeof raw.automark === 'boolean') s.automark = raw.automark;
  if (typeof raw.showCompleted === 'boolean') s.showCompleted = raw.showCompleted;
  if (typeof raw.onboarded === 'boolean') s.onboarded = raw.onboarded;
  if (str(raw.theme, /^[a-z]{1,20}$/)) s.theme = raw.theme;
  if (str(raw.font, /^[a-z-]{1,20}$/)) s.font = raw.font;
  if (Number.isInteger(raw.textSize) && raw.textSize >= 0 && raw.textSize <= 4) s.textSize = raw.textSize;
  if (str(raw.leading, /^[a-z]{1,20}$/)) s.leading = raw.leading;
  if (Number.isInteger(raw.meetDay) && raw.meetDay >= 0 && raw.meetDay <= 6) s.meetDay = raw.meetDay;
  if (AI_TOOLS.some((t) => t.id === raw.ai)) s.ai = raw.ai;
  if (typeof raw.claudeProject === 'string' && new RegExp(`^${UUID.source}$`, 'i').test(raw.claudeProject)) s.claudeProject = raw.claudeProject.toLowerCase();
  if (raw.marks && typeof raw.marks === 'object') {
    s.marks = {};
    for (const [k, v] of Object.entries(raw.marks)) {
      if (/^[1-3A-Z]{3}\.\d{1,3}\.\d{1,3}$/.test(k) && v && Number.isInteger(v.i) && v.i >= 0 && v.i < 1000 && typeof v.at === 'string' && v.at.length <= 32) {
        const note = typeof v.n === 'string' ? v.n.trim().slice(0, MAX_NOTE) : '';
        s.marks[k] = { i: v.i, at: v.at, ...(TRANSLATIONS.includes(v.t) && { t: v.t }), ...(note && { n: note }) };
      }
    }
  }
  return s;
}

const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let state = load();
let plan = [];         // [{ ref, book, chapters: [n...] }]

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

// ---------- Group weeks ----------

// With a meeting day set, the goal is weekly: a week runs from the day after
// one meeting through the next meeting day. Only readings from before the
// current week count as behind.
let weekOffset = 0;   // 0 = current week; -1 = last week, etc.

function weekWindow(offset = 0) {
  if (state.meetDay == null) return null;
  const now = new Date();
  const toMeet = (state.meetDay - now.getDay() + 7) % 7;
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + toMeet + offset * 7);
  const endIdx = dayNumber(isoDate(end)) - dayNumber(state.start);
  return { startIdx: endIdx - 6, endIdx, meet: end, daysToMeet: toMeet + offset * 7 };
}

// Index before which unread readings count as behind.
function dueBefore() {
  const w = weekWindow(0);
  return w ? w.startIdx : todayIndex();
}

const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function renderWeek(t) {
  const w = weekWindow(weekOffset);
  $('#week').hidden = !w;
  if (!w) return null;
  const idxs = [];
  for (let i = Math.max(0, w.startIdx); i <= Math.min(plan.length - 1, w.endIdx); i++) idxs.push(i);
  const done = idxs.filter(isRead).length;

  $('#week-title').textContent = weekOffset === 0 ? 'This week' : weekOffset === -1 ? 'Last week' : weekOffset === 1 ? 'Next week' : `Week of ${fmtShort.format(dateForIndex(w.startIdx))}`;
  $('#week-today').hidden = weekOffset === 0;
  const range = `${fmtDay.format(dateForIndex(w.startIdx))} – ${fmtDay.format(w.meet)}`;
  let when;
  if (w.daysToMeet === 0) when = 'Meeting today';
  else if (w.daysToMeet === 1) when = 'Meeting tomorrow';
  else if (w.daysToMeet > 1) when = `Meeting in ${w.daysToMeet} days`;
  else when = `Met ${fmtDay.format(w.meet)}`;
  $('#week-meta').innerHTML = idxs.length
    ? `${range} · <strong>${done} of ${idxs.length} read</strong> · ${when}`
    : `${range} · Outside the plan`;
  $('#week-fill').style.width = idxs.length ? `${(done / idxs.length) * 100}%` : '0';
  $('#week-list').innerHTML = idxs.map((i) => itemHtml(i, t, dueBefore())).join('');
  const marked = marksIn(w.startIdx, w.endIdx).length;
  $('#review-btn').textContent = marked ? `Marked verses (${marked})` : 'No marked verses yet';
  $('#review-btn').disabled = !marked;
  return weekWindow(0);
}

// ---------- Marked verses ----------

// Marks whose reading falls in plan indexes [from, to], sorted in reading order.
function marksIn(from = 0, to = Infinity) {
  const order = (ref) => ref.split('.').slice(1).map(Number);
  return Object.entries(state.marks)
    .filter(([, m]) => m.i >= from && m.i <= to)
    .sort(([ra, a], [rb, b]) => a.i - b.i || order(ra)[0] - order(rb)[0] || order(ra)[1] - order(rb)[1]);
}

// Consecutive marked verses around `ref` (same reading, chapter and translation)
// are shown, noted and unmarked as one group, e.g. 23:2–5.
function markRun(ref) {
  const m = state.marks[ref];
  if (!m) return [];
  const [b, c, v] = ref.split('.');
  const same = (n) => { const x = state.marks[`${b}.${c}.${n}`]; return x && x.i === m.i && x.t === m.t; };
  let lo = +v, hi = +v;
  while (lo > 1 && same(lo - 1)) lo--;
  while (same(hi + 1)) hi++;
  return Array.from({ length: hi - lo + 1 }, (_, k) => `${b}.${c}.${lo + k}`);
}

function runRange(run) {
  const [, c, first] = run[0].split('.');
  const last = run[run.length - 1].split('.')[2];
  return `${c}:${first}${run.length > 1 ? `–${last}` : ''}`;
}

const runLabel = (run) => `${plan[state.marks[run[0]].i]?.book ?? ''} ${runRange(run)}`;

// A group's note lives on its first verse; notes from groups that merged are shown together.
const runNote = (run) => [...new Set(run.map((r) => state.marks[r]?.n).filter(Boolean))].join('\n\n');

function setRunNote(run, text) {
  const note = text.trim().slice(0, MAX_NOTE);
  run.forEach((r, k) => {
    const m = state.marks[r];
    if (k === 0 && note) m.n = note;
    else delete m.n;
  });
  save();
}

// Unmarking one verse of a group hands its note to the rest of the group.
function unmarkVerse(ref) {
  const m = state.marks[ref];
  const keep = markRun(ref).find((r) => r !== ref);
  delete state.marks[ref];
  if (m?.n && keep) {
    const k = state.marks[keep];
    k.n = (k.n ? `${k.n}\n\n${m.n}` : m.n).slice(0, MAX_NOTE);
  }
}

const aiTool = () => AI_TOOLS.find((t) => t.id === state.ai);

// Opens the chosen AI (web or app) with a question about the group, on the person's own account.
// Only the reference goes in the link, never the text, so licensed translations aren't copied out.
function askQuestion(run) {
  const b = BIBLES.find((x) => x.id === state.marks[run[0]].t) || bible();
  return `Help me understand ${runLabel(run)} (${b.name}): its context, what it means, and related passages. I'm reading it with a weekly Bible reading group.`;
}

// claude.ai/project links don't open the iOS app, but the app's own claude:// scheme does.
// It opens the project without starting a chat, so the question is copied to paste instead.
const useClaudeProject = () => state.ai === 'claude' && Boolean(state.claudeProject);

function askUrl(run) {
  const tool = aiTool();
  if (!tool?.url) return null;
  if (useClaudeProject()) return `claude://claude.ai/project/${state.claudeProject}`;
  return tool.url + encodeURIComponent(askQuestion(run));
}

// Points an Ask link at the group's question; app links (claude://) open in place rather than in a blank tab.
function setAskLink(a, run) {
  a.href = askUrl(run);
  a.textContent = useClaudeProject() ? 'Copy & ask Claude' : `Ask ${aiTool().name}`;
  if (useClaudeProject()) {
    a.removeAttribute('target');
    a.dataset.copy = askQuestion(run);
  } else {
    a.target = '_blank';
    a.rel = 'noopener';
    delete a.dataset.copy;
  }
}

// Copy before the link opens the app (clipboard writes need the tap's user gesture).
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-copy]');
  if (a) navigator.clipboard?.writeText(a.dataset.copy).catch(() => {});
});

// Shared by Settings and onboarding: accepts a project id, or a pasted project link containing one.
function saveClaudeProject(input, msg) {
  const value = input.value.trim();
  const id = value ? value.match(UUID)?.[0].toLowerCase() : '';
  msg.hidden = id !== undefined;
  if (id === undefined) {
    msg.textContent = "That isn't a project id. Open the project in Claude; the id is the last part of its link (claude.ai/project/…).";
    return;
  }
  state.claudeProject = id;
  input.value = id;
  save();
}

const noteDialog = $('#note-dialog');
let noteRun = null;
let noteDone = null;

function editNote(ref, onDone) {
  noteRun = markRun(ref);
  if (!noteRun.length) return;
  noteDone = onDone;
  $('#note-ref').textContent = runLabel(noteRun);
  $('#note-text').value = runNote(noteRun);
  noteDialog.showModal();
  $('#note-text').focus();
}

$('#note-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (noteRun.every((r) => state.marks[r])) setRunNote(noteRun, $('#note-text').value);
  noteDialog.close();
  noteDone?.();
});
$('#note-cancel').addEventListener('click', () => noteDialog.close());

const review = $('#review');
let reviewRange = null; // { from, to, label } or null for all

$('#review-btn').addEventListener('click', () => {
  const w = weekWindow(weekOffset);
  openReview({ from: w.startIdx, to: w.endIdx, label: `${$('#week-title').textContent} · ${fmtDay.format(dateForIndex(w.startIdx))} – ${fmtDay.format(w.meet)}` });
});
$('#review-all-btn').addEventListener('click', () => openReview(null));
$('#review-close').addEventListener('click', () => review.close());

function openReview(range) {
  reviewRange = range;
  if (!review.open) review.showModal();
  renderReview();
}

async function renderReview() {
  const body = $('#review-body');
  const marks = reviewRange ? marksIn(reviewRange.from, reviewRange.to) : marksIn();
  $('#review-sub').textContent = reviewRange ? reviewRange.label : 'All readings';
  if (!marks.length) {
    body.innerHTML = '<p class="status">No marked verses here. Tap a verse while reading to mark it.</p>';
    return;
  }
  body.innerHTML = '<p class="status">Loading…</p>';

  // Group by reading, then by runs of consecutive verses (marks are in reading order).
  const groups = new Map();
  const seen = new Set();
  marks.forEach(([ref, m]) => {
    if (seen.has(ref)) return;
    const run = markRun(ref);
    run.forEach((r) => seen.add(r));
    if (!groups.has(m.i)) groups.set(m.i, []);
    groups.get(m.i).push(run);
  });
  const frag = document.createDocumentFragment();
  const usedChapters = new Map(); // translation id -> fetched chapters (for notices / FUMS)
  for (const [i, runs] of groups) {
    const item = plan[i];
    if (!item) continue;
    const section = document.createElement('section');
    section.className = 'review-group';
    const head = document.createElement('button');
    head.className = 'review-head';
    head.dataset.open = i;
    head.textContent = item.ref;
    const when = document.createElement('span');
    when.textContent = fmtDay.format(dateForIndex(i));
    head.append(when);
    section.append(head);

    for (const run of runs) {
      const ch = Number(run[0].split('.')[1]);
      const nums = run.map((r) => Number(r.split('.')[2]));
      const row = document.createElement('div');
      row.className = 'review-verse';
      const label = document.createElement('span');
      label.className = 'review-ref';
      // Show each group in the translation it was marked in.
      const b = BIBLES.find((x) => x.id === state.marks[run[0]].t) || bible();
      const abbr = b.name.match(/\(([^)]+)\)$/)?.[1] || b.name;
      label.textContent = `${item.book === 'Psalm' ? 'Ps ' : ''}${runRange(run)}`;
      const tag = document.createElement('small');
      tag.textContent = abbr;
      label.append(tag);
      const content = document.createElement('div');
      const text = document.createElement('p');
      try {
        const chapter = await fetchChapter(item.book, ch, b);
        if (!usedChapters.has(b.id)) usedChapters.set(b.id, []);
        usedChapters.get(b.id).push(chapter);
        nums.forEach((n) => {
          const v = chapter.verses.find((x) => x.n === n);
          if (run.length > 1) {
            const sup = document.createElement('sup');
            sup.textContent = n;
            text.append(sup);
          }
          text.append(document.createTextNode(`${v?.text ?? '(verse not found in this translation)'} `));
        });
      } catch (err) {
        text.textContent = err.signIn ? err.message : `Couldn't load the text (${err.message}).`;
        text.className = 'muted';
      }
      content.append(text);
      const note = runNote(run);
      const noteBtn = document.createElement('button');
      noteBtn.className = note ? 'review-note' : 'link-btn review-add-note';
      noteBtn.dataset.note = run[0];
      noteBtn.textContent = note || '+ Add note';
      if (note) noteBtn.setAttribute('aria-label', `Edit note: ${note}`);
      const url = askUrl(run);
      const ask = document.createElement('a');
      ask.className = 'link-btn review-ask';
      if (url) setAskLink(ask, run);
      if (note) content.append(noteBtn, ...(url ? [ask] : []));
      else {
        const actions = document.createElement('div');
        actions.className = 'review-actions';
        actions.append(noteBtn, ...(url ? [ask] : []));
        content.append(actions);
      }
      const unmark = document.createElement('button');
      unmark.className = 'icon-btn';
      unmark.dataset.unmark = run.join(' ');
      unmark.setAttribute('aria-label', `Unmark ${item.book} ${runRange(run)}`);
      unmark.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      row.append(label, content, unmark);
      section.append(row);
    }
    frag.append(section);
  }
  // Required attribution for copyrighted text shown here, and licensed-view reporting.
  for (const chapters of usedChapters.values()) {
    const notice = renderNotice(chapters);
    if (notice) frag.append(notice);
    reportFums(chapters.map((ch) => ch.fumsToken));
  }
  body.replaceChildren(frag);
}

$('#review-body').addEventListener('click', (e) => {
  const note = e.target.closest('[data-note]');
  if (note) {
    editNote(note.dataset.note, renderReview);
    return;
  }
  const un = e.target.closest('[data-unmark]');
  if (un) {
    un.dataset.unmark.split(' ').forEach((r) => delete state.marks[r]);
    save();
    render();
    renderReview();
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open) {
    e.stopPropagation(); // handled here so the reader opens above the review
    review.close();
    openReader(+open.dataset.open, false);
  }
});

$('#week-prev').addEventListener('click', () => { weekOffset--; render(); });
$('#week-next').addEventListener('click', () => { weekOffset++; render(); });
$('#week-today').addEventListener('click', () => { weekOffset = 0; render(); });

function render() {
  const t = todayIndex();
  const total = plan.length;
  const doneCount = Object.keys(state.read).length;
  const due = dueBefore();
  const behind = [];
  for (let i = 0; i < Math.min(due, total); i++) if (!isRead(i)) behind.push(i);

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
    const thisWeek = weekWindow(0);
    if (next < due) label = `<p class="eyebrow late">Catch up · ${when}</p>`;
    else if (thisWeek && next !== t && next <= thisWeek.endIdx) label = `<p class="eyebrow">This week · ${when}</p>`;
    else if (next === t) label = `<p class="eyebrow">Today's reading</p>`;
    else if (t < 0) label = `<p class="eyebrow">Plan starts ${when}</p>`;
    else label = `<p class="eyebrow done">✓ Today's done · Up next ${when}</p>`;
    card.innerHTML = `${label}
      <p class="ref">${escapeHtml(plan[next].ref)}</p>
      <div class="actions">
        <button class="btn primary" data-open="${next}">Read</button>
        <button class="btn primary" data-listen="${next}">Listen</button>
        <button class="btn ghost" data-toggle="${next}">Mark read</button>
      </div>`;
  }

  // Catch up (the featured reading is already shown above)
  const others = behind.filter((i) => i !== next);
  $('#behind').hidden = others.length === 0;
  $('#behind-list').innerHTML = others.map((i) => itemHtml(i, t, due)).join('');

  // Group week (its readings aren't repeated in the list below)
  const week = renderWeek(t);
  const markCount = Object.keys(state.marks).length;
  $('#marks-entry').hidden = Boolean(week) || !markCount;
  $('#review-all-btn').textContent = `Marked verses (${markCount})`;
  const after = week ? week.endIdx + 1 : t;

  // Plan list: kept short so the current week stays the focus. In a group the
  // week section covers what's next; otherwise preview a few readings.
  const upcoming = plan.map((_, i) => i).filter((i) => !isRead(i) && i !== next && i >= after);
  const preview = week ? 0 : 6;
  let show;
  if (state.showCompleted) show = plan.map((_, i) => i);
  else if (expandUpcoming) show = upcoming;
  else show = upcoming.slice(0, preview);
  const hiddenCount = upcoming.length - show.length;

  $('#plan-heading').textContent = state.showCompleted ? 'Full plan' : week ? 'After this week' : 'Up next';
  $('#more-btn').hidden = state.showCompleted || upcoming.length <= preview;
  $('#more-btn').textContent = expandUpcoming ? 'Show less' : `Show all upcoming (${hiddenCount})`;
  $('#completed-btn').hidden = !state.showCompleted && !expandUpcoming && doneCount === 0;
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
        `<div class="month"><h3>${month}</h3><ul class="list">${idxs.map((i) => itemHtml(i, t, due)).join('')}</ul></div>`
      ).join('')
    : upcoming.length || state.showCompleted ? '' : '<p class="empty">Nothing left after this one.</p>';
}

function itemHtml(i, t, lateBefore = t) {
  const cls = ['item'];
  if (isRead(i)) cls.push('read');
  if (i === t) cls.push('is-today');
  if (i < lateBefore && !isRead(i)) cls.push('late');
  return `<li class="${cls.join(' ')}" data-index="${i}">
    <button class="tick" data-toggle="${i}" aria-label="${isRead(i) ? 'Mark unread' : 'Mark read'}">${checkSvg}</button>
    <span class="date">${fmtShort.format(dateForIndex(i))}</span>
    <button class="open" data-open="${i}">${escapeHtml(plan[i].ref)}</button>
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
  const t = Math.min(dueBefore(), plan.length);
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

let expandUpcoming = false;
$('#more-btn').addEventListener('click', () => {
  expandUpcoming = !expandUpcoming;
  render();
});

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

const HELLOAO = 'https://bible.helloao.org/api/';
const BOOK_CODES = {
  Genesis: 'GEN', Exodus: 'EXO', Leviticus: 'LEV', Numbers: 'NUM', Deuteronomy: 'DEU', Joshua: 'JOS', Judges: 'JDG', Ruth: 'RUT',
  '1 Samuel': '1SA', '2 Samuel': '2SA', '1 Kings': '1KI', '2 Kings': '2KI', '1 Chronicles': '1CH', '2 Chronicles': '2CH',
  Ezra: 'EZR', Nehemiah: 'NEH', Esther: 'EST', Job: 'JOB', Psalm: 'PSA', Psalms: 'PSA', Proverbs: 'PRO', Ecclesiastes: 'ECC',
  'Song of Solomon': 'SNG', Isaiah: 'ISA', Jeremiah: 'JER', Lamentations: 'LAM', Ezekiel: 'EZK', Daniel: 'DAN', Hosea: 'HOS',
  Joel: 'JOL', Amos: 'AMO', Obadiah: 'OBA', Jonah: 'JON', Micah: 'MIC', Nahum: 'NAM', Habakkuk: 'HAB', Zephaniah: 'ZEP',
  Haggai: 'HAG', Zechariah: 'ZEC', Malachi: 'MAL', Matthew: 'MAT', Mark: 'MRK', Luke: 'LUK', John: 'JHN', Acts: 'ACT',
  Romans: 'ROM', '1 Corinthians': '1CO', '2 Corinthians': '2CO', Galatians: 'GAL', Ephesians: 'EPH', Philippians: 'PHP',
  Colossians: 'COL', '1 Thessalonians': '1TH', '2 Thessalonians': '2TH', '1 Timothy': '1TI', '2 Timothy': '2TI', Titus: 'TIT',
  Philemon: 'PHM', Hebrews: 'HEB', James: 'JAS', '1 Peter': '1PE', '2 Peter': '2PE', '1 John': '1JN', '2 John': '2JN',
  '3 John': '3JN', Jude: 'JUD', Revelation: 'REV',
};

const bible = () => BIBLES.find((b) => b.id === state.translation) || BIBLES.find((b) => b.id === 'leb');
const passageCache = new Map();

function apiBook(book) {
  return book === 'Psalm' ? 'Psalms' : book;
}

// Flatten HelloAO verse content (strings, poem lines, footnote markers) to plain text.
function verseText(content) {
  return content
    .map((part) => (typeof part === 'string' ? part : part.text || ''))
    .join(' ')
    .replace(/¶/g, '') // paragraph marks in some sources (e.g. KJV)
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns { verses: [{ n, text }], audio: { narrator: { url, timings } } | null, copyright?, fumsToken? }
async function fetchChapter(book, chapter, b = bible()) {
  const code = BOOK_CODES[book];
  if (!code) throw new Error(`Unknown book "${book}"`);
  const key = `${b.id}|${code}|${chapter}`;
  if (passageCache.has(key)) return passageCache.get(key);
  if (b.licensed) return fetchLicensedChapter(b, code, chapter, key);
  if (b.local) return fetchLocalChapter(b, code, chapter, key);

  const res = await fetch(`${HELLOAO}${encodeURIComponent(b.src)}/${code}/${chapter}.json`);
  if (!res.ok) throw new Error(`Couldn't load ${book} ${chapter} (${res.status})`);
  const data = await res.json();
  const verses = (data.chapter?.content || [])
    .filter((c) => c.type === 'verse' && Number.isInteger(c.number) && Array.isArray(c.content))
    .map((c) => ({ n: c.number, text: verseText(c.content) }));

  let audio = null;
  if (b.narrated && data.thisChapterAudioLinks) {
    audio = {};
    for (const n of NARRATORS) {
      const url = data.thisChapterAudioLinks[n.id];
      const timingsPath = data.thisChapterAudioTimings?.[n.id];
      if (typeof url === 'string' && url.startsWith('https://') && typeof timingsPath === 'string') {
        audio[n.id] = { url, timingsUrl: new URL(timingsPath, HELLOAO).toString() };
      }
    }
  }
  const result = { verses, audio };
  passageCache.set(key, result);
  return result;
}

// Bundled Bibles: one JSON file per book, served (and cached offline) with the app.
const bookCache = new Map();
async function fetchLocalChapter(b, code, chapter, key) {
  const path = `${b.local}/${code}.json`;
  if (!bookCache.has(path)) {
    bookCache.set(path, fetch(path).then((res) => {
      if (!res.ok) throw new Error(`Couldn't load ${bookName(code)} (${res.status})`);
      return res.json();
    }));
  }
  let data;
  try { data = await bookCache.get(path); } catch (err) { bookCache.delete(path); throw err; }
  const rows = Array.isArray(data[chapter]) ? data[chapter] : [];
  const result = {
    verses: rows.filter((r) => Number.isInteger(r[0]) && typeof r[1] === 'string').map(([n, text]) => ({ n, text })),
    audio: null,
    notice: b.id,
  };
  passageCache.set(key, result);
  return result;
}

// Licensed text is fetched through our Supabase function (which holds the
// API.Bible key) and kept in memory only; it's never written to disk.
const SCRIPTURE_FN = 'https://rnpuwanpgundhfmvzrne.supabase.co/functions/v1/scripture';

async function fetchLicensedChapter(b, code, chapter, key) {
  const token = await window.getAccessToken?.();
  if (!token) throw signInError(`Sign in under Settings → Sync across devices to read the ${b.name.match(/\((\w+)\)/)?.[1] || b.name}.`);
  const res = await fetch(`${SCRIPTURE_FN}?bible=${encodeURIComponent(b.id)}&chapter=${code}.${chapter}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: window.SUPABASE_KEY || '' },
  });
  if (res.status === 401) throw signInError('Your sign-in has expired. Sign in again under Settings → Sync across devices.');
  if (!res.ok) throw new Error(`Couldn't load ${bookName(code)} ${chapter} (${res.status})`);
  const data = await res.json();
  const result = {
    notice: 'apibible',
    verses: (Array.isArray(data.verses) ? data.verses : [])
      .filter((v) => Number.isInteger(v.n) && typeof v.text === 'string')
      .map((v) => ({ n: v.n, text: v.text })),
    audio: null,
    copyright: typeof data.copyright === 'string' ? data.copyright : '',
    fumsToken: typeof data.fumsToken === 'string' ? data.fumsToken : '',
  };
  passageCache.set(key, result);
  return result;
}

// Required attribution under copyrighted text. Built with DOM nodes (API text is untrusted).
function renderNotice(chapters) {
  const kind = chapters[0]?.notice;
  if (!kind) return null;
  const p = document.createElement('p');
  p.className = 'copyright';
  const link = (text, href) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  };
  if (kind === 'leb') {
    p.append(
      'Scripture quotations are from the ', link('Lexham English Bible', 'https://lexhampress.com/'),
      '. Copyright 2012 ', link('Logos Bible Software', 'https://www.logos.com/'),
      '. Lexham is a registered trademark of Logos Bible Software. ',
    );
  } else if (kind === 'apibible') {
    [...new Set(chapters.map((ch) => ch.copyright).filter(Boolean))].forEach((text) => p.append(text, ' '));
    p.append('Scripture provided by ', link('API.Bible', 'https://api.bible'), '. ');
  }
  p.append(link('Copyright & credits', 'copyright.html'));
  return p;
}

const signInError = (message) => Object.assign(new Error(message), { signIn: true });
const bookName = (code) => Object.keys(BOOK_CODES).find((k) => BOOK_CODES[k] === code) || code;

// API.Bible's Fair Use Management System: report each licensed chapter view.
// Uses their plain GET endpoint with anonymous random device/session ids.
const FUMS_SESSION = crypto.randomUUID();
function reportFums(tokens) {
  tokens = tokens.filter(Boolean);
  if (!tokens.length) return;
  let device = '';
  try {
    device = localStorage.getItem('daily-reading:device') || crypto.randomUUID();
    localStorage.setItem('daily-reading:device', device);
  } catch { device = FUMS_SESSION; }
  const q = new URLSearchParams({ dId: device, sId: FUMS_SESSION });
  tokens.forEach((t) => q.append('t', t));
  fetch(`https://fums.api.bible/f3?${q}`, { mode: 'no-cors', keepalive: true }).catch(() => {});
}

async function fetchTimings(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('timings');
  const data = await res.json();
  return Array.isArray(data.verses) ? data.verses.filter((t) => typeof t === 'number') : [];
}

// ---------- Reader + speech ----------

let current = null;      // { index, segments: [{ el, speak, ci, n }], narration: [{ url, timings }] | null }
let pos = 0;             // segment being spoken
let playing = false;
let gen = 0;             // bumps whenever playback is interrupted, to ignore stale utterance events
let wakeLock = null;

const reader = $('#reader');

async function openReader(index, autoplay) {
  stopSpeech();
  narrationChapter = -1;
  const item = plan[index];
  current = { index, segments: [] };
  pos = 0;
  $('#reader-title').textContent = item.ref;
  $('#reader-sub').textContent = fmtLong.format(dateForIndex(index));
  updateMarkBtn();
  updateReaderHint();
  updateRateBtn();
  const body = $('#reader-body');
  body.innerHTML = '<p class="status">Loading…</p>';
  body.scrollTop = 0;
  if (!reader.open) reader.showModal();

  try {
    const chapters = await Promise.all(item.chapters.map((c) => fetchChapter(item.book, c)));
    if (current?.index !== index) return;
    current.narration = useNarration() && chapters.every((ch) => ch.audio?.[state.narrator])
      ? chapters.map((ch) => ({ ...ch.audio[state.narrator], timings: null }))
      : null;
    $('#reader-sub').textContent = `${fmtLong.format(dateForIndex(index))} · ${bible().name}${current.narration ? ` · read by ${narratorName()}` : ''}`;
    body.innerHTML = '';
    chapters.forEach(({ verses }, ci) => {
      const heading = document.createElement('h3');
      heading.textContent = `${item.book} ${item.chapters[ci]}`;
      body.append(heading);
      current.segments.push({ el: heading, ci, n: 0, speak: `${apiBook(item.book) === 'Psalms' ? 'Psalm' : item.book} chapter ${item.chapters[ci]}.` });
      const p = document.createElement('p');
      verses.forEach((v) => {
        const span = document.createElement('span');
        span.className = 'verse';
        const sup = document.createElement('sup');
        sup.textContent = v.n;
        span.append(sup);
        span.append(document.createTextNode(v.text + ' '));
        span.dataset.seg = current.segments.length;
        span.dataset.ref = `${BOOK_CODES[item.book]}.${item.chapters[ci]}.${v.n}`;
        current.segments.push({ el: span, ci, n: v.n, speak: v.text.replace(/[⌞⌟]/g, '') });
        p.append(span);
      });
      body.append(p);
    });
    refreshVerseMarks();
    // Copyrighted translations: show the required notice and links; report licensed views.
    const notice = renderNotice(chapters);
    if (notice) body.append(notice);
    reportFums(chapters.map((ch) => ch.fumsToken));
    if (autoplay) play();
  } catch (err) {
    const status = document.createElement('p');
    status.className = 'status';
    status.textContent = err.signIn ? err.message : `${err.message}. Check your connection and try again.`;
    body.replaceChildren(status);
  }
}

function closeReader() {
  stopSpeech();
  hideMarkBar();
  current = null;
  reader.close();
}

$('#reader-close').addEventListener('click', closeReader);
reader.addEventListener('cancel', (e) => { e.preventDefault(); closeReader(); });

// Tapping a verse marks it to share with the group (tap again to unmark).
$('#reader-body').addEventListener('click', (e) => {
  const v = e.target.closest('.verse');
  if (!v || !current) return;
  const ref = v.dataset.ref;
  const before = Object.fromEntries(markRun(ref).map((r) => [r, { ...state.marks[r] }]));
  if (state.marks[ref]) unmarkVerse(ref);
  else state.marks[ref] = { i: current.index, at: isoDate(new Date()), t: bible().id };
  save();
  render();
  refreshVerseMarks();
  updateReaderHint();
  showMarkBar(ref, before);
});

function refreshVerseMarks() {
  $('#reader-body').querySelectorAll('.verse').forEach((span) => {
    const ref = span.dataset.ref;
    span.classList.toggle('marked', Boolean(state.marks[ref]));
    span.classList.toggle('has-note', Boolean(state.marks[ref]) && markRun(ref).at(-1) === ref && Boolean(runNote(markRun(ref))));
  });
}

// After a tap: offer a note for the group just marked, or undo an unmark.
let markBarRef = null;
let markBarUndo = null;
let markBarTimer;

function showMarkBar(ref, before) {
  const marked = Boolean(state.marks[ref]);
  markBarRef = ref;
  markBarUndo = marked ? null : before;
  const [, c, n] = ref.split('.');
  $('#mark-bar-text').textContent = marked ? `Marked ${runRange(markRun(ref))}` : `Unmarked ${c}:${n}`;
  $('#mark-bar-note').hidden = !marked;
  $('#mark-bar-note').textContent = marked && runNote(markRun(ref)) ? 'Edit note' : 'Add note';
  $('#mark-bar-undo').hidden = marked;
  const url = marked && askUrl(markRun(ref));
  $('#mark-bar-ask').hidden = !url;
  if (url) {
    setAskLink($('#mark-bar-ask'), markRun(ref));
  }
  $('#mark-bar').hidden = false;
  clearTimeout(markBarTimer);
  markBarTimer = setTimeout(hideMarkBar, 8000);
}

function hideMarkBar() {
  clearTimeout(markBarTimer);
  $('#mark-bar').hidden = true;
  markBarUndo = null;
}

$('#mark-bar-note').addEventListener('click', () => {
  const ref = markBarRef;
  hideMarkBar();
  editNote(ref, () => { render(); refreshVerseMarks(); });
});

$('#mark-bar-undo').addEventListener('click', () => {
  if (markBarUndo) Object.assign(state.marks, markBarUndo);
  hideMarkBar();
  save();
  render();
  refreshVerseMarks();
  updateReaderHint();
});

function updateReaderHint() {
  $('#reader-hint').hidden = Object.keys(state.marks).length > 0;
}

$('#play-btn').addEventListener('click', () => (playing ? pause() : play()));
$('#prev-verse').addEventListener('click', () => skip(-1));
$('#next-verse').addEventListener('click', () => skip(1));

$('#mark-btn').addEventListener('click', () => {
  if (!current) return;
  const i = current.index;
  if (isRead(i)) {
    setRead(i, false);
    updateMarkBtn();
    return;
  }
  // Done with this reading: mark it and return home, with a moment to undo.
  setRead(i, true);
  closeReader();
  undoCatchUp = () => setRead(i, false);
  showToast(`${plan[i].ref} marked as read`);
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
  if (current?.narration) narrationAudio.playbackRate = r;
  else if (playing) speakFrom(pos);
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
  narrationAudio.pause();
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
  if (current?.narration) return narrateFrom(i);
  gen++;
  const myGen = gen;
  speechSynthesis.cancel();
  setPlaying(true);
  const step = (j) => {
    if (myGen !== gen) return;
    if (!current || j >= current.segments.length) return finishListening();
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

function finishListening() {
  setPlaying(false);
  pos = 0;
  highlight(-1);
  if (current && state.automark && !isRead(current.index)) {
    setRead(current.index, true);
    updateMarkBtn();
  }
}

// ---------- Human narration ----------

// One <audio> per chapter recording; per-verse start times drive highlighting.
// Unlike speech synthesis, audio keeps playing with the screen locked.
const narrationAudio = new Audio();
narrationAudio.preload = 'auto';
let narrationChapter = -1;

const useNarration = () => bible().narrated && state.narrator !== 'device';
const narratorName = () => NARRATORS.find((n) => n.id === state.narrator)?.name || '';

async function chapterTimings(ci) {
  const ch = current.narration[ci];
  if (!ch.timings) ch.timings = await fetchTimings(ch.timingsUrl);
  return ch.timings;
}

// Start time for a segment: chapter headings start at 0, verse n at timings[n - 1].
async function segmentStart(i) {
  const seg = current.segments[i];
  if (!seg.n) return 0;
  const t = await chapterTimings(seg.ci);
  return t[seg.n - 1] ?? 0;
}

async function narrateFrom(i) {
  gen++;
  const myGen = gen;
  speechSynthesis.cancel();
  const seg = current.segments[i];
  try {
    const start = await segmentStart(i);
    if (myGen !== gen || !current) return;
    if (narrationChapter !== seg.ci) {
      narrationAudio.src = current.narration[seg.ci].url;
      narrationChapter = seg.ci;
    }
    narrationAudio.playbackRate = state.rate;
    narrationAudio.currentTime = start;
    pos = i;
    highlight(i);
    await narrationAudio.play();
    setPlaying(true);
    updateMediaSession();
  } catch (err) {
    if (myGen === gen) setPlaying(false);
  }
}

narrationAudio.addEventListener('timeupdate', () => {
  if (!playing || !current?.narration) return;
  const timings = current.narration[narrationChapter]?.timings;
  if (!timings) return;
  const t = narrationAudio.currentTime;
  // Last segment in this chapter whose start has passed.
  let at = -1;
  current.segments.forEach((seg, i) => {
    if (seg.ci === narrationChapter && (seg.n ? (timings[seg.n - 1] ?? Infinity) : 0) <= t) at = i;
  });
  if (at !== -1 && at !== pos) {
    pos = at;
    highlight(at);
  }
});

narrationAudio.addEventListener('ended', () => {
  if (!current?.narration) return;
  const nextChapter = narrationChapter + 1;
  if (nextChapter >= current.narration.length) {
    narrationChapter = -1;
    return finishListening();
  }
  narrateFrom(current.segments.findIndex((s) => s.ci === nextChapter));
});

// Lock-screen / headphone controls.
function updateMediaSession() {
  if (!('mediaSession' in navigator) || !current) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: plan[current.index].ref,
    artist: `${bible().name} · ${narratorName()}`,
    album: 'Daily Reading',
    artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
  });
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => play());
  ms.setActionHandler('pause', () => pause());
  ms.setActionHandler('previoustrack', () => skip(-1));
  ms.setActionHandler('nexttrack', () => skip(1));
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
    `<option value="${escapeHtml(v.voiceURI)}" ${chosen && v.voiceURI === chosen.voiceURI ? 'selected' : ''}>${escapeHtml(v.name)} (${escapeHtml(v.lang)})</option>`
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

// ---------- Reading text ----------

const FONTS = [
  { id: 'classic', name: 'Classic', stack: 'var(--serif)' },
  { id: 'book', name: 'Book', stack: 'Literata, var(--serif)' },
  { id: 'modern', name: 'Modern', stack: 'var(--sans)' },
  { id: 'easy', name: 'Easy read', stack: "'Atkinson Hyperlegible', var(--sans)" },
];

const SIZES = [
  { px: 16, name: 'Extra small' },
  { px: 18, name: 'Small' },
  { px: 20, name: 'Medium' },
  { px: 23, name: 'Large' },
  { px: 26, name: 'Extra large' },
];

const LEADINGS = [
  { id: 'compact', name: 'Compact', value: 1.45, gap: 2 },
  { id: 'normal', name: 'Normal', value: 1.7, gap: 4 },
  { id: 'relaxed', name: 'Relaxed', value: 2, gap: 6 },
];

const segBtn = (value, inner, label) =>
  `<button type="button" class="seg" role="radio" data-value="${value}"${label ? ` aria-label="${label}"` : ''}>${inner}</button>`;

$('#font-picker').innerHTML = FONTS.map((f) =>
  segBtn(f.id, `<span class="aa" style="font-family:${f.stack}">Aa</span>${f.name}`)).join('');

$('#size-picker').innerHTML = SIZES.map((s, i) =>
  segBtn(i, `<span class="aa" style="font-size:${s.px - 6}px">A</span>`, s.name)).join('');

$('#leading-picker').innerHTML = LEADINGS.map((l) =>
  segBtn(l.id, `<span class="lines" style="gap:${l.gap}px"><i></i><i></i><i></i></span>${l.name}`)).join('');

function readingText() {
  return {
    font: FONTS.find((f) => f.id === state.font) ?? FONTS[0],
    size: SIZES[state.textSize] ?? SIZES[2],
    leading: LEADINGS.find((l) => l.id === state.leading) ?? LEADINGS[1],
  };
}

function setChecked(picker, value) {
  document.querySelectorAll(`${picker} .seg`).forEach((b) => b.setAttribute('aria-checked', b.dataset.value === String(value)));
}

function applyReadingText() {
  const { font, size, leading } = readingText();
  const style = document.documentElement.style;
  style.setProperty('--read-font', font.stack);
  style.setProperty('--read-size', `${size.px}px`);
  style.setProperty('--read-leading', leading.value);
  setChecked('#font-picker', font.id);
  setChecked('#size-picker', SIZES.indexOf(size));
  setChecked('#leading-picker', leading.id);
}

function onPick(picker, update) {
  $(picker).addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (!b) return;
    update(b.dataset.value);
    save();
    applyReadingText();
  });
}

onPick('#font-picker', (v) => { state.font = v; });
onPick('#size-picker', (v) => { state.textSize = +v; });
onPick('#leading-picker', (v) => { state.leading = v; });

applyReadingText();

// ---------- Settings ----------

$('#settings-form').addEventListener('submit', (e) => e.preventDefault());

const settings = $('#settings');

$('#settings-btn').addEventListener('click', () => {
  $('#set-start').value = state.start;
  $('#set-meet').value = state.meetDay ?? '';
  renderShareSummary();
  $('#set-translation').value = state.translation;
  renderListening();
  $('#set-rate').value = state.rate;
  $('#rate-label').textContent = `${state.rate.toFixed(2)}×`;
  $('#set-automark').checked = state.automark;
  renderAiSetting();
  applyReadingText();
  loadVoices();
  settings.showModal();
});
$('#settings-close').addEventListener('click', () => settings.close());

$('#set-start').addEventListener('change', (e) => {
  if (!e.target.value) return;
  state.start = e.target.value;
  save();
  render();
  renderShareSummary();
});
$('#set-meet').addEventListener('change', (e) => {
  state.meetDay = e.target.value === '' ? null : +e.target.value;
  weekOffset = 0;
  save();
  render();
  renderShareSummary();
});
$('#set-translation').innerHTML = [...BIBLES]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
$('#set-narrator').innerHTML = NARRATORS.map((n) => `<option value="${n.id}">${n.id === 'device' ? n.name : `${n.name} (human)`}</option>`).join('');

// Human narration exists only for narrated Bibles; otherwise the device voice reads.
function renderListening() {
  const narrated = bible().narrated;
  $('#translation-hint').textContent = bible().licensed
    ? 'Licensed translation: sign in under Sync across devices to read it.'
    : '';
  $('#set-narrator').value = state.narrator;
  $('#set-narrator').disabled = !narrated;
  $('#narrator-hint').textContent = narrated
    ? 'Recorded human narration of the Berean Standard Bible'
    : 'Human narration is available with the Berean Standard Bible';
  $('#voice-row').hidden = useNarration();
}

$('#set-ai').innerHTML = AI_TOOLS.map((t) => `<option value="${t.id}">${t.name}${t.hint ? ` (${t.hint})` : ''}</option>`).join('');

function renderAiSetting() {
  $('#set-ai').value = state.ai;
  $('#claude-project-row').hidden = state.ai !== 'claude';
  $('#set-claude-project').value = state.claudeProject;
  $('#claude-project-msg').hidden = true;
}

$('#set-claude-project').addEventListener('change', (e) => saveClaudeProject(e.target, $('#claude-project-msg')));

$('#set-ai').addEventListener('change', (e) => { state.ai = e.target.value; save(); renderAiSetting(); });

$('#set-translation').addEventListener('change', (e) => { state.translation = e.target.value; save(); renderListening(); prefetchBundledBible(); });
$('#set-narrator').addEventListener('change', (e) => { state.narrator = e.target.value; save(); renderListening(); });
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
    state = sanitizeState(data);
    save();
    applyTheme();
    applyReadingText();
    render();
    settings.close();
  } catch {
    undoCatchUp = null;
    showToast("That file doesn't look like a Daily Reading backup.");
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
  if (state.meetDay != null) url.searchParams.set('meet', state.meetDay);
  return url.toString();
}

async function sharePlan() {
  const url = shareUrl();
  const meets = state.meetDay != null ? ` We meet on ${WEEKDAYS[state.meetDay]}s.` : '';
  const text = `Read through the Bible with me — this plan started ${fmtLong.format(dateForIndex(0))}.${meets}`;
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

// Spell out what a shared link carries, next to the share button.
function renderShareSummary() {
  const start = fmtShort.format(dateForIndex(0));
  const meets = state.meetDay != null ? ` and meeting day (${WEEKDAYS[state.meetDay]}s)` : '';
  $('#share-summary').textContent = `Sends your start date (${start})${meets} so everyone reads the same days. Your checkmarks stay private.`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function handleSharedLink() {
  const params = new URLSearchParams(location.search);
  if (!params.has('start') && !params.has('meet')) return;
  history.replaceState(null, '', location.pathname);

  // Validate through the same sanitizer as any other untrusted state.
  const shared = sanitizeState({ start: params.get('start'), meetDay: params.has('meet') ? Number(params.get('meet')) : undefined });
  const changes = {};
  if (params.get('start') === shared.start && shared.start !== state.start) changes.start = shared.start;
  if (params.has('meet') && shared.meetDay != null && shared.meetDay !== state.meetDay) changes.meetDay = shared.meetDay;
  if (!Object.keys(changes).length) return;

  const apply = () => {
    Object.assign(state, changes);
    weekOffset = 0;
    save();
    render();
  };
  const describe = (s) => [
    `starts ${fmtLong.format(new Date(...s.start.split('-').map((n, i) => (i === 1 ? n - 1 : +n))))}`,
    s.meetDay != null ? `meets on ${WEEKDAYS[s.meetDay]}s` : null,
  ].filter(Boolean).join(' and ');
  const theirs = { start: changes.start ?? state.start, meetDay: changes.meetDay ?? state.meetDay };

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch {}
  const hasOwnSchedule = 'start' in saved || saved.meetDay != null;

  if (!hasOwnSchedule) {
    // First visit: adopt the sharer's schedule. Getting started celebrates the invite.
    apply();
    try { localStorage.setItem('daily-reading:invite', '1'); } catch {}
    if (state.onboarded) {
      undoCatchUp = null;
      showToast(`You're reading with your group! Plan ${describe(theirs)}.`);
    }
    return;
  }

  $('#shared-text').textContent = `🎉 You've been invited to read along with a group! Their plan ${describe(theirs)}; yours ${describe(state)}. Switch so you're on the same reading each day?`;
  $('#shared-banner').hidden = false;
  $('#shared-use').onclick = () => { apply(); $('#shared-banner').hidden = true; };
  $('#shared-keep').onclick = () => { $('#shared-banner').hidden = true; };
}

// ---------- Boot ----------

// Re-render when the app is reopened on a new day.
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Resolves once the plan is loaded and rendered (later scripts wait on this).
const planReady = loadPlan().then(() => {
  render();
  handleSharedLink();
  setTimeout(prefetchBundledBible, 3000);
});

// Bundled Bibles work offline: once the app has settled, fetch every book the
// plan uses so the service worker caches them (a few MB at most, once).
function prefetchBundledBible() {
  const b = bible();
  if (!b.local || !navigator.onLine) return;
  const codes = [...new Set(plan.map((item) => BOOK_CODES[item.book]).filter(Boolean))];
  codes.reduce((chain, code) => chain.then(() => fetch(`${b.local}/${code}.json`).catch(() => {})), Promise.resolve());
}
