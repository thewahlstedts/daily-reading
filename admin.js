'use strict';

// Owner's usage dashboard. The `usage` function only answers for the emails in
// its ADMIN_EMAILS secret. Same origin as the app, so it uses the app's session:
// sign in to the app first.

const SUPABASE_URL = 'https://rnpuwanpgundhfmvzrne.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bBXg37-lo3GlX-uQorMfDA_0PKEsVwJ'; // publishable: safe in the browser
const USAGE_FN = `${SUPABASE_URL}/functions/v1/usage`;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SVG = 'http://www.w3.org/2000/svg';

const $ = (s) => document.querySelector(s);
const sb = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

let data = null;

function status(text, isError = false) {
  $('#status').textContent = text;
  $('#status').classList.toggle('error', isError);
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (text != null) node.textContent = text;
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

// 'YYYY-MM-DD' (a UTC day) or an ISO timestamp → "Oct 19".
const shortDate = (iso) => (iso
  ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(iso.length === 10 && { timeZone: 'UTC' }) })
  : '—');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function load() {
  if (!sb) return status('Couldn’t load Supabase.', true);
  status('Loading…');
  $('#refresh').disabled = true;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      status('');
      const msg = $('#status');
      msg.append('Sign in to ', el('a', { href: './' }, 'Daily Reading'), ' first (Sign in, top right), then come back.');
      return;
    }
    const res = await fetch(USAGE_FN, { headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 403) return status(`${session.user.email} isn’t an admin account.`, true);
    if (!res.ok) return status(typeof body.error === 'string' ? body.error : `Couldn’t load (${res.status}).`, true);
    data = body;
    render();
    status(`Updated ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`);
  } catch (err) {
    status(err instanceof TypeError ? 'Couldn’t reach the server.' : String(err.message), true);
  } finally {
    $('#refresh').disabled = false;
  }
}

function renderTiles() {
  const a = data.accounts;
  $('#t-accounts').textContent = a.total;
  $('#t-accounts-sub').textContent = `+${a.new7} this week · +${a.new30} in 30 days · ${a.synced} have synced`;
  document.querySelectorAll('.tile[data-window]').forEach((tile) => {
    const w = data.active[tile.dataset.window];
    tile.querySelectorAll(':scope > :not(h2)').forEach((n) => n.remove());
    const pair = el('div', { class: 'pair' });
    for (const [n, label] of [[w.accounts, 'signed in'], [w.anonDevices, w.anonDevices === 1 ? 'device not signed in' : 'devices not signed in']]) {
      const cell = el('div');
      cell.append(el('p', { class: 'big' }, n), el('p', { class: 'label' }, label));
      pair.append(cell);
    }
    tile.append(pair, el('p', { class: 'sub' }, `${plural(w.devices, 'device')} · ${w.installed} as installed app`));
  });
}

// Path for a bar with its top corners rounded and its base square on the baseline.
function barPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Axis top: a round, even number, so the halfway tick is a whole count too.
function niceMax(n) {
  if (n <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(n));
  return [2, 4, 6, 8, 10].map((f) => f * mag).find((m) => m >= n);
}

function renderChart() {
  const box = $('#chart');
  box.replaceChildren();
  const days = data.daily;
  const W = box.clientWidth || 340, H = 170, left = 26, bottom = 20, top = 6;
  const plotW = W - left, plotH = H - bottom - top;
  const max = niceMax(Math.max(1, ...days.map((d) => d.accounts + d.anonDevices)));
  const y = (v) => top + plotH - (v / max) * plotH;
  const slot = plotW / days.length, barW = Math.max(2, slot - 2);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Daily signed-in accounts and devices not signed in, last 30 days' });

  const grid = svg('g', { class: 'grid' }), axis = svg('g', { class: 'axis' });
  for (const v of [0, max / 2, max]) {
    grid.append(svg('line', { x1: left, x2: W, y1: y(v), y2: y(v) }));
    const t = svg('text', { x: left - 6, y: y(v) + 4, 'text-anchor': 'end' });
    t.textContent = v;
    axis.append(t);
  }
  [0, Math.floor(days.length / 2), days.length - 1].forEach((i, k) => {
    const t = svg('text', { x: left + slot * i + (k === 2 ? slot : 0), y: H - 4, 'text-anchor': ['start', 'middle', 'end'][k] });
    t.textContent = shortDate(days[i].day);
    axis.append(t);
  });
  root.append(grid, axis);

  const hits = svg('g'), bars = svg('g');
  days.forEach((d, i) => {
    const x = left + slot * i + 1;
    hits.append(svg('rect', { class: 'hit', x: left + slot * i, y: top, width: slot, height: plotH, 'data-i': i }));
    const inTop = y(d.accounts), baseline = y(0);
    if (d.accounts) bars.append(svg('path', { class: 'seg-in', d: barPath(x, inTop, barW, baseline - inTop, d.anonDevices ? 0 : 4) }));
    if (d.anonDevices) {
      const gap = d.accounts ? 2 : 0;
      const yTop = y(d.accounts + d.anonDevices);
      const h = inTop - gap - yTop;
      if (h > 1) bars.append(svg('path', { class: 'seg-anon', d: barPath(x + 0.5, yTop + 0.5, barW - 1, h - 0.5, 4) }));
    }
  });
  root.append(hits, bars);
  box.append(root);

  const tip = el('div', { class: 'tip', hidden: '' });
  box.append(tip);
  const show = (e) => {
    const rect = root.getBoundingClientRect();
    const i = Math.min(days.length - 1, Math.max(0, Math.floor(((e.clientX - rect.left) * (W / rect.width) - left) / slot)));
    const d = days[i];
    hits.querySelectorAll('.on').forEach((n) => n.classList.remove('on'));
    hits.children[i].classList.add('on');
    tip.replaceChildren(el('b', {}, shortDate(d.day)), el('br'), `${d.accounts} signed in · ${d.anonDevices} not signed in`);
    tip.hidden = false;
    const px = (left + slot * (i + 0.5)) * (rect.width / W);
    tip.style.left = `${Math.min(Math.max(0, px - tip.offsetWidth / 2), rect.width - tip.offsetWidth)}px`;
    tip.style.top = `${-tip.offsetHeight - 4}px`;
  };
  const hide = () => { tip.hidden = true; hits.querySelectorAll('.on').forEach((n) => n.classList.remove('on')); };
  root.addEventListener('pointermove', show);
  root.addEventListener('pointerdown', show);
  root.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });

  const tbody = $('#daily-table tbody');
  tbody.replaceChildren(...[...days].reverse().map((d) => {
    const tr = el('tr');
    tr.append(el('td', {}, shortDate(d.day)), el('td', { class: 'num' }, d.accounts), el('td', { class: 'num' }, d.anonDevices));
    return tr;
  }));
}

function renderPeople() {
  $('#people tbody').replaceChildren(...data.people.map((p) => {
    const tr = el('tr');
    tr.append(
      el('td', { class: 'email' }, p.email),
      el('td', {}, shortDate(p.joined)),
      el('td', {}, shortDate(p.lastSeen ?? p.lastSync)),
      el('td', { class: 'num' }, p.read),
      el('td', {}, p.meetDay == null ? '—' : DAY_NAMES[p.meetDay] ?? '—'),
    );
    return tr;
  }));
}

function render() {
  $('#dash').hidden = false;
  renderTiles();
  renderChart();
  renderPeople();
  $('#fine').textContent = [
    data.trackingSince ? `Device counts start ${shortDate(data.trackingSince)}; sign-ups are complete.` : 'No device counts yet; they start once the app has been opened on the live site.',
    'A device is one browser or installed app, so a person on a phone and a laptop counts twice, and clearing site data looks like a new device. A device signed in at any point in the period counts as signed in. Days are UTC.',
    '“Last seen” is from device counts, or the last sync before those started.',
  ].join(' ');
}

$('#refresh').addEventListener('click', load);
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (data) renderChart(); }, 150);
});
load();
