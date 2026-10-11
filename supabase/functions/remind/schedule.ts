// Which reminders are due and what they say. Pure functions, so they can be
// tested without Deno or a database.

export type Reminder = { id: number; user_id: string; endpoint: string; p256dh: string; auth: string; at_minute: number; tz: string; last_sent: string | null };
export type Local = { date: string; minute: number };

// Push services the browsers we support use. Anything else is refused, so a
// row can't make this function send requests to arbitrary hosts.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

// Date and minute of the day in the reminder's time zone.
export function localNow(now: Date, tz: string): Local | null {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map((p) => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
  } catch {
    return null; // unknown time zone
  }
}

// Due within the hour after its time, once a day. The window lets a late or
// skipped cron run catch up without sending at odd hours.
export const WINDOW = 60;

export function isDue(r: Reminder, local: Local): boolean {
  return local.minute >= r.at_minute && local.minute < r.at_minute + WINDOW && r.last_sent !== local.date;
}

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

export function parsePlan(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The notification for this person today, or null when there's nothing to read
// (plan not started or finished, or they're already caught up).
// `data` is the synced progress row (same shape as the app's state).
export function reminderFor(data: unknown, plan: string[], today: string): { title: string; body: string } | null {
  const fallback = { title: 'Daily reading', body: 'Time for today’s reading.' };
  if (!data || typeof data !== 'object') return fallback;
  const { start, read } = data as { start?: unknown; read?: unknown };
  if (typeof start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start) || isNaN(Date.parse(start))) return fallback;
  const done = read && typeof read === 'object' ? read as Record<string, unknown> : {};

  const t = dayNumber(today) - dayNumber(start);
  if (t < 0 || t >= plan.length) return null;
  let behind = 0;
  for (let i = 0; i < t; i++) if (!done[i]) behind++;

  if (!done[t]) {
    return { title: 'Today’s reading', body: behind ? `${plan[t]}, plus ${plural(behind, 'earlier reading')} to catch up` : plan[t] };
  }
  if (behind) return { title: 'Daily reading', body: `${plural(behind, 'earlier reading')} to catch up` };
  return null;
}
