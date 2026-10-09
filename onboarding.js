'use strict';

// Getting-started walkthrough for first-time visitors: sign in (optional),
// meeting day, start date, translation, look, and sharing with the group.
// Theme and text controls are borrowed from Settings while it's open, so
// there's one implementation of each.

const OB_STEP_KEY = 'daily-reading:onboard-step';
const OB_STEPS = ['welcome', 'group', 'start', 'translation', 'look', 'share'];
const onboarding = $('#onboarding');
let obStep = 0;
let obFromLink = false;

function obSaveStep() {
  try { localStorage.setItem(OB_STEP_KEY, String(obStep)); } catch {}
}

window.startOnboarding = () => {
  if (state.onboarded || onboarding.open) return;
  let saved = 0;
  try { saved = Number(localStorage.getItem(OB_STEP_KEY)) || 0; } catch {}
  obStep = Math.min(Math.max(saved, 0), OB_STEPS.length - 1);
  obFromLink = state.meetDay != null; // a shared link may have set the schedule already
  borrowControls();
  onboarding.showModal();
  showStep();
};

function finishOnboarding(message) {
  state.onboarded = true;
  save();
  try { localStorage.removeItem(OB_STEP_KEY); } catch {}
  returnControls();
  if (onboarding.open) onboarding.close();
  render();
  if (message) {
    undoCatchUp = null;
    showToast(message);
  }
}

// ---------- Borrowed Settings controls ----------

const obHomes = new Map();
function borrowControls() {
  [[$('#theme-picker'), $('#ob-slot-theme')], [$('#text-options'), $('#ob-slot-text')]].forEach(([el, slot]) => {
    if (obHomes.has(el)) return;
    const home = document.createComment('settings home');
    el.before(home);
    obHomes.set(el, home);
    slot.append(el);
  });
}
function returnControls() {
  obHomes.forEach((home, el) => home.replaceWith(el));
  obHomes.clear();
}

// ---------- Steps ----------

function showStep() {
  const name = OB_STEPS[obStep];
  document.querySelectorAll('.ob-step').forEach((s) => { s.hidden = s.dataset.step !== name; });
  $('#ob-dots').innerHTML = OB_STEPS.map((_, i) => `<i class="${i === obStep ? 'on' : ''}"></i>`).join('');
  $('#ob-back').hidden = obStep === 0;
  $('#ob-body').scrollTop = 0;
  ({ welcome: renderWelcome, group: renderGroup, start: renderStart, translation: renderTranslations, look: () => {}, share: renderShare })[name]();
  updateNext();
  obSaveStep();
}

function updateNext() {
  const name = OB_STEPS[obStep];
  let label = 'Continue';
  if (name === 'welcome' && !window.currentUserEmail?.()) label = 'Continue without signing in';
  if (name === 'share') label = 'Finish';
  $('#ob-next').textContent = label;
}

function renderWelcome() {
  const email = window.currentUserEmail?.();
  $('#ob-signin').hidden = Boolean(email) || !window.sendSignInLink;
  $('#ob-signedin').hidden = !email;
  $('#ob-who').textContent = email || '';
}

function renderGroup() {
  $('#ob-from-link').hidden = !obFromLink;
  const days = WEEKDAYS.map((d, i) => ({ value: i, label: d }));
  $('#ob-days').innerHTML = [...days, { value: '', label: 'Not in a group', wide: true }].map((d) => {
    const on = d.value === '' ? state.meetDay == null : state.meetDay === d.value;
    return `<button type="button" class="seg${d.wide ? ' wide' : ''}" role="radio" aria-checked="${on}" data-day="${d.value}">${d.label}</button>`;
  }).join('');
}

$('#ob-days').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]');
  if (!b) return;
  state.meetDay = b.dataset.day === '' ? null : Number(b.dataset.day);
  weekOffset = 0;
  save();
  render();
  renderGroup();
});

function renderStart() {
  $('#ob-start').value = state.start;
  renderPreview();
}

$('#ob-start').addEventListener('change', (e) => {
  if (!e.target.value) return;
  state.start = e.target.value;
  save();
  render();
  renderPreview();
});

// Show what this start date means right now, so it can be checked against the group.
function renderPreview() {
  const box = $('#ob-preview');
  const t = todayIndex();
  const total = plan.length;
  const w = weekWindow(0);
  let from, to, heading;
  if (w) {
    from = Math.max(0, w.startIdx);
    to = Math.min(total - 1, w.endIdx);
    heading = `This week (${fmtDay.format(dateForIndex(w.startIdx))} – ${fmtDay.format(w.meet)}) you'll read:`;
  } else {
    from = Math.max(0, t);
    to = Math.min(total - 1, from + 6);
    heading = t < 0 ? `The plan starts ${fmtLong.format(dateForIndex(0))}. First readings:` : `Today is day ${t + 1} of ${total}. Coming up:`;
  }
  if (t >= total || to < from) {
    box.innerHTML = '<p class="set-name">This start date puts the plan in the past. Pick a later date.</p>';
    return;
  }
  const items = [];
  for (let i = from; i <= to; i++) {
    items.push(`<li class="${i === t ? 'today' : ''}"><span>${fmtDay.format(dateForIndex(i))}</span>${escapeHtml(plan[i].ref)}</li>`);
  }
  box.innerHTML = `<p class="set-name">${escapeHtml(heading)}</p><ul class="ob-preview-list">${items.join('')}</ul><small>Does this match your group? If not, adjust the date above.</small>`;
}

function renderTranslations() {
  const tagFor = (b) => (b.narrated ? 'Human narration' : b.licensed ? 'Requires sign-in' : b.local ? 'Works offline' : '');
  $('#ob-translations').innerHTML = [...BIBLES]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => `<button type="button" class="ob-option" role="radio" aria-checked="${b.id === state.translation}" data-id="${b.id}">
      <span class="tags">${escapeHtml(b.name)}${tagFor(b) ? `<small>${tagFor(b)}</small>` : ''}</span>
    </button>`).join('');
}

$('#ob-translations').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  state.translation = b.dataset.id;
  save();
  renderTranslations();
  renderListening();
});

function renderShare() {
  const meets = state.meetDay != null ? `, meeting on ${WEEKDAYS[state.meetDay]}s` : '';
  $('#ob-share-summary').textContent = `Send your group a link so everyone reads the same passages each day. It includes your start date (${fmtLong.format(dateForIndex(0))})${meets}. Your checkmarks and marked verses stay private.`;
}

$('#ob-share').addEventListener('click', sharePlan);

// ---------- Sign-in ----------

function obMessage(text, isError = false) {
  const el = $('#ob-msg');
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('error', isError);
}

$('#ob-send').addEventListener('click', async () => {
  const email = $('#ob-email').value.trim();
  $('#ob-send').disabled = true;
  const error = await window.sendSignInLink(email);
  $('#ob-send').disabled = false;
  if (error) return obMessage(error, true);
  obMessage(`Link sent to ${email}. Open it on this device; you'll come right back here.`);
  $('#ob-paste').hidden = false;
});

$('#ob-paste-btn').addEventListener('click', async () => {
  const error = await window.signInWithPastedLink($('#ob-link').value);
  if (error) return obMessage(error, true);
  $('#ob-link').value = '';
  obMessage('');
});

// Called by sync.js whenever the session changes.
window.onAuthChanged = () => {
  if (onboarding.open && OB_STEPS[obStep] === 'welcome') {
    renderWelcome();
    updateNext();
  }
};

// Signed in to an account that was already set up elsewhere: its settings are synced in.
window.onAccountRestored = () => {
  if (onboarding.open) finishOnboarding('Welcome back! Your progress is synced.');
};

// ---------- Navigation ----------

$('#ob-next').addEventListener('click', () => {
  if (obStep === OB_STEPS.length - 1) return finishOnboarding("You're all set. Happy reading!");
  obStep++;
  showStep();
});

$('#ob-back').addEventListener('click', () => {
  if (obStep === 0) return;
  obStep--;
  showStep();
});

$('#ob-skip').addEventListener('click', () => finishOnboarding('You can change any of this in Settings.'));
onboarding.addEventListener('cancel', (e) => e.preventDefault()); // Esc shouldn't silently dismiss it

planReady.then(() => window.startOnboarding());
