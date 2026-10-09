// Licensed Bible text proxy for API.Bible.
//
// Keeps the API.Bible key server-side and only serves signed-in users (protects
// the key and the plan's monthly request quota). Returns plain verses plus the
// copyright notice and the FUMS token the client must report.
//
// GET /functions/v1/scripture?bible=niv&chapter=PSA.23
//   Authorization: Bearer <user access token>

const API = 'https://rest.api.bible/v1';

// The licensed Bibles chosen in the API.Bible dashboard (Starter plan: 3).
const BIBLES: Record<string, string> = {
  niv: '78a9f6124f344018-01',
  nlt: 'd6e14a625393b4da-01',
  amp: 'a81b73293d3080c9-01',
};

const ALLOWED_ORIGINS = ['https://thewahlstedts.github.io', 'http://localhost:8787'];

function cors(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
}

// Is the bearer token a valid session for a real (non-anonymous) user?
async function isSignedIn(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' },
  });
  if (!res.ok) return false;
  const user = await res.json();
  return Boolean(user?.id) && !user.is_anonymous;
}

type Node = { type?: string; name?: string; text?: string; attrs?: Record<string, unknown>; items?: Node[] };

// Flatten API.Bible's JSON content into [{ n, text }], grouping text by verseId.
function toVerses(content: Node[]) {
  const verses = new Map<number, string>();
  let last: number | null = null;
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.type === 'text' && typeof node.text === 'string') {
        const id = node.attrs?.verseId;
        if (typeof id !== 'string') continue; // headings, verse-number labels
        const n = Number(id.split('.').pop());
        if (!Number.isInteger(n)) continue;
        verses.set(n, (verses.get(n) ?? '') + node.text);
        last = n;
      } else if (node.name === 'note') {
        continue; // footnotes
      } else if (Array.isArray(node.items)) {
        walk(node.items);
        // Paragraph / poetry line boundary.
        if (node.name === 'para' && last !== null) verses.set(last, (verses.get(last) ?? '') + ' ');
      }
    }
  };
  walk(content);
  return [...verses].map(([n, text]) => ({ n, text: text.replace(/\s+/g, ' ').trim() }));
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, origin);

  const url = new URL(req.url);
  const bibleId = BIBLES[url.searchParams.get('bible') ?? ''];
  const chapter = url.searchParams.get('chapter') ?? '';
  if (!bibleId || !/^[1-3A-Z]{3}\.\d{1,3}$/.test(chapter)) return json({ error: 'Bad request' }, 400, origin);

  if (!(await isSignedIn(req))) return json({ error: 'Sign in to read this translation' }, 401, origin);

  const res = await fetch(`${API}/bibles/${bibleId}/chapters/${chapter}?content-type=json&include-notes=false&include-titles=false&include-verse-numbers=false`, {
    headers: { 'api-key': Deno.env.get('API_BIBLE_KEY') ?? '' },
  });
  if (!res.ok) return json({ error: `Scripture service error (${res.status})` }, res.status === 404 ? 404 : 502, origin);
  const body = await res.json();

  return json({
    verses: toVerses(body.data?.content ?? []),
    copyright: String(body.data?.copyright ?? ''),
    fumsToken: String(body.meta?.fumsToken ?? ''),
  }, 200, origin);
});
