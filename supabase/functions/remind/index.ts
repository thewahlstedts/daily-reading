// Daily reading reminders (Web Push).
//
// Called every 5 minutes by a pg_cron job (see the reminders migration) with
// the shared secret in `x-cron-secret`. Sends each due reminder once a day,
// naming today's reading, and skips people who are already caught up.
//
// Secrets: REMINDER_CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (optional). Uses the service role key the platform provides.

import { sendPush, type Vapid } from './webpush.ts';
import { isDue, isPushEndpoint, localNow, parsePlan, reminderFor, type Reminder } from './schedule.ts';

const PLAN_URL = 'https://thewahlstedts.github.io/daily-reading/plan.txt';
const APP_URL = 'https://thewahlstedts.github.io/daily-reading/';

const env = (k: string) => Deno.env.get(k) ?? '';

async function db(path: string, init: RequestInit = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error(`DB ${res.status}: ${await res.text()}`);
  return res.status === 204 || init.method === 'PATCH' || init.method === 'DELETE' ? null : res.json();
}

// Compare digests so the check takes the same time however much matches.
async function secretMatches(given: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([hash(given), hash(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!(await secretMatches(req.headers.get('x-cron-secret') ?? '', env('REMINDER_CRON_SECRET')))) {
    return new Response('Forbidden', { status: 403 });
  }

  const vapid: Vapid = {
    publicKey: env('VAPID_PUBLIC_KEY'),
    privateKey: env('VAPID_PRIVATE_KEY'),
    subject: env('VAPID_SUBJECT') || APP_URL,
  };
  const now = new Date();
  const rows: Reminder[] = await db('reminders?select=id,user_id,endpoint,p256dh,auth,at_minute,tz,last_sent');
  const due = rows.flatMap((r) => {
    const local = localNow(now, r.tz);
    return local && isDue(r, local) ? [{ r, today: local.date }] : [];
  });
  if (!due.length) return Response.json({ due: 0 });

  const planRes = await fetch(PLAN_URL);
  if (!planRes.ok) throw new Error(`plan.txt ${planRes.status}`);
  const plan = parsePlan(await planRes.text());
  const ids = [...new Set(due.map(({ r }) => r.user_id))];
  const progress: { user_id: string; data: unknown }[] = await db(`progress?select=user_id,data&user_id=in.(${ids.join(',')})`);
  const dataFor = new Map(progress.map((p) => [p.user_id, p.data]));

  const outcome = { sent: 0, skipped: 0, removed: 0, failed: 0 };
  await Promise.all(due.map(async ({ r, today }) => {
    const markSent = () => db(`reminders?id=eq.${r.id}`, { method: 'PATCH', body: JSON.stringify({ last_sent: today }) });
    const remove = () => db(`reminders?id=eq.${r.id}`, { method: 'DELETE' });
    try {
      if (!isPushEndpoint(r.endpoint)) { outcome.removed++; return await remove(); }
      const message = reminderFor(dataFor.get(r.user_id), plan, today);
      if (!message) { outcome.skipped++; return await markSent(); }
      const status = await sendPush(r, { ...message, url: APP_URL, tag: 'daily-reading' }, vapid);
      if (status === 404 || status === 410) { outcome.removed++; return await remove(); } // unsubscribed
      if (status >= 200 && status < 300) { outcome.sent++; return await markSent(); }
      outcome.failed++; // retried on the next run while still in the window
      console.error(`push ${r.id}: HTTP ${status}`);
    } catch (e) {
      outcome.failed++;
      console.error(`push ${r.id}:`, e instanceof Error ? e.message : e);
    }
  }));
  return Response.json({ due: due.length, ...outcome });
});
