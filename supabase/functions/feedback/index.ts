// Feedback form → email to the app's owner through Resend.
//
// Only signed-in users can send (open sign-up still means anyone with an email
// address can, so there's a per-user cooldown too). The message goes out as
// plain text with Reply-To set to the sender, so replying answers them.
//
// POST /functions/v1/feedback   { message, context? }
//   Authorization: Bearer <user access token>
//
// Secrets: RESEND_API_KEY (sending access only), FEEDBACK_TO (where it's delivered).

const FROM = 'Daily Reading <reading@thewahlstedts.com>';
const MAX_MESSAGE = 2000;
const MAX_CONTEXT = 500;
const COOLDOWN_MS = 60_000;

const ALLOWED_ORIGINS = ['https://thewahlstedts.github.io', 'http://localhost:8787'];

function cors(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}

type User = { id: string; email: string };

// The signed-in (non-anonymous) user for the bearer token, or null.
async function currentUser(req: Request): Promise<User | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' },
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user?.id || user.is_anonymous || typeof user.email !== 'string') return null;
  return { id: user.id, email: user.email };
}

// Best effort only: it lives in this worker's memory, so a cold start or a
// second instance resets it. Enough to stop a double tap or a simple loop.
const lastSent = new Map<string, number>();

// Strip control characters (except newlines and tabs) so the text can't
// garble the plain-text email.
const clean = (s: string, max: number) => s.replace(/[^\P{Cc}\n\t]/gu, '').trim().slice(0, max);

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  const user = await currentUser(req);
  if (!user) return json({ error: 'Sign in to send feedback' }, 401, origin);

  let body: { message?: unknown; context?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request' }, 400, origin);
  }
  if (typeof body.message !== 'string') return json({ error: 'Bad request' }, 400, origin);
  if (body.message.length > MAX_MESSAGE) return json({ error: `Keep it under ${MAX_MESSAGE} characters` }, 400, origin);
  const message = clean(body.message, MAX_MESSAGE);
  if (!message) return json({ error: 'Write something first' }, 400, origin);
  const context = typeof body.context === 'string' ? clean(body.context, MAX_CONTEXT) : '';

  const now = Date.now();
  if (now - (lastSent.get(user.id) ?? 0) < COOLDOWN_MS) {
    return json({ error: 'You just sent feedback. Try again in a minute.' }, 429, origin);
  }

  const to = Deno.env.get('FEEDBACK_TO');
  const key = Deno.env.get('RESEND_API_KEY');
  if (!to || !key) return json({ error: 'Feedback isn\'t set up yet' }, 503, origin);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      reply_to: user.email,
      subject: `Daily Reading feedback from ${user.email}`,
      text: `${message}\n\n---\nFrom: ${user.email}\n${context}\nBrowser: ${clean(req.headers.get('User-Agent') ?? '', 300)}\n`,
    }),
  });
  if (!res.ok) {
    console.error('Resend error', res.status, await res.text());
    return json({ error: 'Couldn\'t send right now. Try again later.' }, 502, origin);
  }
  lastSent.set(user.id, now);
  return json({ ok: true }, 200, origin);
});
