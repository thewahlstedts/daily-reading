// Usage counts for the owner's dashboard (admin.html).
//
// POST /functions/v1/usage   { device, standalone }
//   From the app, at most once per UTC day per device (and again if the account
//   changes). Authorization: Bearer <user access token> is optional; when it's
//   valid, the day is tied to that account. Records one row in usage_days.
//
// GET /functions/v1/usage
//   Authorization: Bearer <user access token> of an email in ADMIN_EMAILS.
//   Returns totals for the dashboard, plus the list of accounts.
//
// Secrets: ADMIN_EMAILS (comma-separated). Uses the service role key the platform provides.

const ALLOWED_ORIGINS = ['https://thewahlstedts.github.io', 'http://localhost:8787'];
const DAYS = 30;       // daily chart and the longest "active" window
const PAGE = 1000;     // PostgREST's max_rows
const MAX_PAGES = 100;

const env = (k: string) => Deno.env.get(k) ?? '';

function cors(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}

async function service(url: string, init: RequestInit = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const res = await fetch(`${env('SUPABASE_URL')}${url}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error(`${url.split('?')[0]} ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Every row of a table query, a page at a time.
async function allRows(path: string) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await service(`/rest/v1/${path}&limit=${PAGE}&offset=${page * PAGE}`);
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
  throw new Error(`${path.split('?')[0]}: more than ${MAX_PAGES * PAGE} rows`);
}

type User = { id: string; email: string };

// The signed-in (non-anonymous) user for the bearer token, or null.
async function currentUser(req: Request): Promise<User | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: env('SUPABASE_ANON_KEY') },
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user?.id || user.is_anonymous || typeof user.email !== 'string') return null;
  return { id: user.id, email: user.email };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function record(req: Request, origin: string | null) {
  let body: { device?: unknown; standalone?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request' }, 400, origin);
  }
  if (typeof body.device !== 'string' || !UUID.test(body.device)) return json({ error: 'Bad request' }, 400, origin);
  // An expired or bad token still counts the device, just not the account.
  const user = await currentUser(req);
  const row: Record<string, unknown> = { device: body.device, standalone: body.standalone === true };
  if (user) row.user_id = user.id;
  // Signed in: claim the device's day for the account. Signed out: only add the
  // day if it's new, so signing out later in the day doesn't erase the account.
  await service('/rest/v1/usage_days?on_conflict=day,device', {
    method: 'POST',
    headers: { Prefer: `resolution=${user ? 'merge' : 'ignore'}-duplicates,return=minimal` },
    body: JSON.stringify(row),
  });
  return new Response(null, { status: 204, headers: cors(origin) });
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));

type UsageRow = { day: string; device: string; user_id: string | null; standalone: boolean };

// Distinct accounts, and devices never signed in, over the days from `since` on.
function active(rows: UsageRow[], since: string) {
  const users = new Set<string>(), devices = new Set<string>(), signedIn = new Set<string>(), installed = new Set<string>();
  for (const r of rows) {
    if (r.day < since) continue;
    devices.add(r.device);
    if (r.user_id) { users.add(r.user_id); signedIn.add(r.device); }
    if (r.standalone) installed.add(r.device);
  }
  return {
    accounts: users.size,
    anonDevices: [...devices].filter((d) => !signedIn.has(d)).length,
    devices: devices.size,
    installed: installed.size,
  };
}

async function stats(req: Request, origin: string | null) {
  const user = await currentUser(req);
  if (!user) return json({ error: 'Sign in first' }, 401, origin);
  const admins = env('ADMIN_EMAILS').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!admins.includes(user.email.toLowerCase())) return json({ error: 'Not an admin account' }, 403, origin);

  const users = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { users: batch } = await service(`/auth/v1/admin/users?page=${page}&per_page=100`);
    users.push(...batch);
    if (batch.length < 100) break;
  }
  const accounts = users.filter((u) => !u.is_anonymous);

  const progress = await allRows('progress?select=user_id,updated_at,read:data->read,meetDay:data->meetDay,translation:data->translation&order=user_id');
  const byUser = new Map(progress.map((p) => [p.user_id, p]));

  const today = isoDay(new Date());
  const since = daysAgo(DAYS - 1);
  const usage: UsageRow[] = await allRows(`usage_days?select=day,device,user_id,standalone&day=gte.${since}&order=day,device`);
  const first: { day: string }[] = await service('/rest/v1/usage_days?select=day&order=day&limit=1');
  const lastSeen = new Map<string, string>();
  for (const r of usage) if (r.user_id && r.day > (lastSeen.get(r.user_id) ?? '')) lastSeen.set(r.user_id, r.day);

  const daily = Array.from({ length: DAYS }, (_, i) => {
    const day = daysAgo(DAYS - 1 - i);
    const { accounts, anonDevices } = active(usage.filter((r) => r.day === day), day);
    return { day, accounts, anonDevices };
  });

  const joinedSince = (iso: string) => accounts.filter((u) => (u.created_at ?? '') >= iso).length;

  return json({
    today,
    trackingSince: first[0]?.day ?? null,
    accounts: {
      total: accounts.length,
      new7: joinedSince(daysAgo(6)),
      new30: joinedSince(since),
      synced: accounts.filter((u) => byUser.has(u.id)).length,
    },
    active: { d1: active(usage, today), d7: active(usage, daysAgo(6)), d30: active(usage, since) },
    daily,
    people: accounts
      .map((u) => {
        const p = byUser.get(u.id);
        const read = p?.read && typeof p.read === 'object' ? Object.keys(p.read).length : 0;
        return {
          email: u.email ?? '',
          joined: u.created_at ?? null,
          lastSync: p?.updated_at ?? null,
          lastSeen: lastSeen.get(u.id) ?? null,
          read,
          meetDay: Number.isInteger(p?.meetDay) ? p.meetDay : null,
          translation: typeof p?.translation === 'string' ? p.translation : null,
        };
      })
      .sort((a, b) => (b.joined ?? '').localeCompare(a.joined ?? '')),
  }, 200, origin);
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  try {
    if (req.method === 'POST') return await record(req, origin);
    if (req.method === 'GET') return await stats(req, origin);
    return json({ error: 'Method not allowed' }, 405, origin);
  } catch (err) {
    console.error(err);
    return json({ error: 'Something went wrong' }, 500, origin);
  }
});
