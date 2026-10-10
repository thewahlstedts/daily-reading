'use strict';

// Getting-started walkthrough for first-time visitors: sign in (optional),
// meeting day, start date, translation, AI for questions, look, and sharing with the group.
// Theme and text controls are borrowed from Settings while it's open, so
// there's one implementation of each.

const OB_STEP_KEY = 'daily-reading:onboard-step';
const OB_STEPS = ['welcome', 'group', 'start', 'translation', 'ai', 'look', 'share'];
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
  try { obFromLink = localStorage.getItem('daily-reading:invite') === '1'; } catch {} // arrived via a group's share link
  borrowControls();
  onboarding.showModal();
  showStep();
};

// Joining mid-plan: count earlier weeks as done so they start fresh this week.
function clearEarlierReadings() {
  const upTo = Math.min(dueBefore(), plan.length);
  const today = isoDate(new Date());
  let count = 0;
  for (let i = 0; i < upTo; i++) {
    if (!isRead(i)) { state.read[i] = today; count++; }
  }
  return count;
}

function finishOnboarding(message, { fresh = true } = {}) {
  const cleared = fresh ? clearEarlierReadings() : 0;
  if (cleared) message = `${message} Earlier readings are marked done, so you start fresh this week.`;
  state.onboarded = true;
  save();
  try { localStorage.removeItem(OB_STEP_KEY); localStorage.removeItem('daily-reading:invite'); } catch {}
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
  ({ welcome: renderWelcome, group: renderGroup, start: renderStart, translation: renderTranslations, ai: renderAiChoices, look: () => {}, share: renderShare })[name]();
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
  renderInvite();
  const email = window.currentUserEmail?.();
  $('#ob-signin').hidden = Boolean(email) || !window.sendSignInLink;
  $('#ob-signedin').hidden = !email;
  $('#ob-who').textContent = email || '';
}

// Arrived from a group's share link: celebrate and show what they're joining.
function renderInvite() {
  $('#ob-invite').hidden = !obFromLink;
  $('#ob-celebrate').hidden = !obFromLink;
  $('#ob-logo').hidden = obFromLink;
  if (!obFromLink) return;
  $('#ob-title').textContent = "You're invited to read together!";
  $('#ob-intro').textContent = 'Your group shared their reading plan with you. You\'ll read the same passage each day and come to your meetings ready to talk about the week.';
  $('#ob-invite-start').textContent = fmtLong.format(dateForIndex(0));
  $('#ob-invite-meet-row').hidden = state.meetDay == null;
  if (state.meetDay != null) $('#ob-invite-meet').textContent = `${WEEKDAYS[state.meetDay]}s`;
  const w = weekWindow(0);
  const t = todayIndex();
  const from = Math.max(0, w ? w.startIdx : t);
  const to = Math.min(plan.length - 1, w ? w.endIdx : t);
  $('#ob-invite-week-label').textContent = w ? 'This week' : 'Today';
  $('#ob-invite-week').textContent = from > to ? 'The plan has finished' : from === to ? plan[from].ref : `${plan[from].ref} – ${plan[to].ref}`;
}

function renderGroup() {
  $('#ob-from-link').hidden = !obFromLink;
  $('#ob-aligned').hidden = obFromLink || state.meetDay == null;
  if (state.meetDay != null) {
    const [y, m, d] = state.start.split('-').map(Number);
    $('#ob-aligned').textContent = `Your plan will start ${fmtLong.format(new Date(y, m - 1, d))}, the day after a ${WEEKDAYS[state.meetDay]} meeting, so each week's readings line up with your group. You can adjust it next.`;
  }
  const days = WEEKDAYS.map((d, i) => ({ value: i, label: d }));
  $('#ob-days').innerHTML = [...days, { value: '', label: 'Not in a group', wide: true }].map((d) => {
    const on = d.value === '' ? state.meetDay == null : state.meetDay === d.value;
    return `<button type="button" class="seg${d.wide ? ' wide' : ''}" role="radio" aria-checked="${on}" data-day="${d.value}">${d.label}</button>`;
  }).join('');
}

// Align the plan with the group: day 1 falls on the day after a meeting, on or
// just before the default start, so every group week begins a new set of 7.
function alignedStart(meetDay) {
  const [y, m, d] = defaults.start.split('-').map(Number);
  const anchor = new Date(y, m - 1, d);
  if (meetDay == null) return defaults.start;
  const firstDay = (meetDay + 1) % 7;
  const back = (anchor.getDay() - firstDay + 7) % 7;
  return isoDate(new Date(y, m - 1, d - back));
}

$('#ob-days').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]');
  if (!b) return;
  state.meetDay = b.dataset.day === '' ? null : Number(b.dataset.day);
  // A group's share link already set the real start date; otherwise align it.
  if (!obFromLink) state.start = alignedStart(state.meetDay);
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

function renderAiChoices() {
  $('#ob-ai').innerHTML = AI_TOOLS
    .map((t) => `<button type="button" class="ob-option" role="radio" aria-checked="${t.id === state.ai}" data-id="${t.id}">
      <span class="tags">${t.id === 'none' ? 'No thanks' : t.name}${t.hint ? `<small>${t.hint}</small>` : ''}</span>
    </button>`).join('');
  $('#ob-claude-project').hidden = state.ai !== 'claude';
  $('#ob-claude-project-input').value = state.claudeProject;
}

$('#ob-ai').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  state.ai = b.dataset.id;
  save();
  renderAiChoices();
});
$('#ob-claude-project-input').addEventListener('change', (e) => saveClaudeProject(e.target, $('#ob-claude-project-msg')));

$('#ob-translations').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  state.translation = b.dataset.id;
  save();
  renderTranslations();
  renderListening();
  prefetchBundledBible();
});

function renderShare() {
  $('#ob-share-start').textContent = fmtLong.format(dateForIndex(0));
  $('#ob-share-meet').textContent = state.meetDay != null ? `${WEEKDAYS[state.meetDay]}s` : 'Not set (no group day)';
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
  obMessage(`We emailed a code to ${email}. Enter it below, or tap the link in the email on this device.`);
  $('#ob-paste').hidden = false;
  $('#ob-code').focus();
});

async function obSubmitCode() {
  const error = await window.signInWithCode($('#ob-email').value.trim(), $('#ob-code').value);
  if (error) return obMessage(error, true);
  $('#ob-code').value = '';
  obMessage('');
}
$('#ob-code-btn').addEventListener('click', obSubmitCode);
$('#ob-code').addEventListener('input', (e) => { if (e.target.value.replace(/\D/g, '').length === 6) obSubmitCode(); });

// Called by sync.js whenever the session changes.
window.onAuthChanged = () => {
  if (onboarding.open && OB_STEPS[obStep] === 'welcome') {
    renderWelcome();
    updateNext();
  }
};

// Signed in to an account that was already set up elsewhere: its settings are synced in.
window.onAccountRestored = () => {
  if (onboarding.open) finishOnboarding('Welcome back! Your progress is synced.', { fresh: false });
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
