# Security review (routine)

A weekly, read-only security review of `origin/main`, measured against the **Security rules** in `CLAUDE.md` and the design notes there. Each run does two things:

1. **Baseline:** the checks in part B, on the whole tree.
2. **Recent changes:** a close review of everything that changed in the last 8 days. The routine runs weekly; the extra day overlaps runs so nothing slips between them.

The result goes in the session reply, nothing else.

## Hard rules

- **Change nothing.** No edits, commits, branches, pushes, PRs, issues, comments, emails, or database writes. Don't run `supabase` commands, and don't dismiss or resolve GitHub alerts.
- **Don't call any Edge Function** (`scripture`, `remind`, `feedback`), and don't probe the live site or Supabase with crafted requests. This is a code review, not a penetration test. `scripture` also spends the API.Bible quota.
- **Never print a secret.** If you find one, give the file, line and type, and only the first 4 characters of the value.
- **Never make up findings.** Every finding cites a `file:line` (or a commit) and quotes the code. If you can't trace an attack from a real input to a real effect, it's a question, not a finding; put it under *Open questions*. If a check can't run, mark it `SKIPPED` with the reason.
- Keep scratch files in the session's scratchpad directory, never in the repo. Network is limited: the npm registry is reachable, but the live site, `bible.helloao.org` and Supabase usually aren't.

## Severity

- **Critical:** a secret is exposed, or a signed-out or other user can read or change someone's data.
- **High:** XSS or script injection, an auth check is missing on an Edge Function, RLS is missing or wrong, or a known exploited vulnerability is in a shipped dependency.
- **Medium:** a `CLAUDE.md` security rule is broken but no exploit path is shown, the CSP is weakened, or licensed text is cached against the API.Bible terms.
- **Low / Info:** defence in depth, or hygiene.

## A. Recent changes

1. `git fetch origin main`, then `git checkout --detach origin/main`. Record `git log -1 --format='%h %cs'`.
2. `git log --since='8 days ago' --format='%h %cs %s' origin/main`. If nothing changed, write "No changes this week" and go to part B.
3. Read the full diff (`git diff <oldest>^..origin/main`). Concentrate on `*.js`, `index.html`, `copyright.html`, `sw.js`, `supabase/**` and `tools/**`. For each change, ask:
   - Does new data reach the DOM, a URL, `fetch`, storage or the sync server?
   - Is that data untrusted? `CLAUDE.md` defines untrusted as API responses, imported files, synced data, device voice names and error messages, plus anything in the URL or a share link.
   - If so, is it escaped, sanitised and validated?

   Apply the part B checks to the changed code first.
4. Look for secrets in the added lines: `git log -p --since='8 days ago' origin/main` with the patterns in B5. Removing a secret in a later commit doesn't fix it; it's still in history and must be rotated.

## B. Baseline checks

Give each check a status: `PASS`, `FINDING` (with severity) or `SKIPPED`.

### B1. DOM injection (XSS)

1. Ledger: `grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write' *.js`. For every hit built from variables, trace each value to its source. An untrusted value not wrapped in `escapeHtml()` is a finding. Record each hit as `file:line — safe/unsafe — source`.
2. URLs: `grep -nE '\.(href|src|action)\s*=|setAttribute\(.(href|src)' *.js`. A URL built from untrusted data must not be able to become `javascript:` or `data:`. `askUrl()` must put only the reference and the translation name in the query string, never verse text or notes, and the whole query must go through `encodeURIComponent`.
3. Links that open new windows (`target="_blank"`, `window.open`) to third parties: check that `rel="noopener"` is set or that the API used implies it.
4. Share-link and import parsing: find where `location.search`, `location.hash` and imported files are read. Every value must be validated (type, range, allowlist) before use.

### B2. Content Security Policy

From the `<meta http-equiv="Content-Security-Policy">` in `index.html`:
1. `script-src` is exactly `'self'`: no `'unsafe-eval'`, no `'unsafe-inline'`, no hosts, no `data:` or `blob:`.
2. `object-src 'none'`, `base-uri 'none'` and `form-action 'none'` are still present.
3. Every page served (`index.html`, `copyright.html`) has no inline `<script>` bodies and no `on*=` attributes (`grep -nE '<script>|<script [^>]*>[^<]|\son[a-z]+=' *.html`).
4. Every host in `connect-src` and `media-src` is one the code really uses. A host no code uses is Low (stale trust).

### B3. State integrity

1. Every path into `state` goes through `sanitizeState()`: localStorage (`load()`), file import, and the sync server (`sync.js`). Search for `JSON.parse`, `state =`, `Object.assign(state`, `{ ...state`.
2. `sanitizeState()` checks type and bounds for every key of `defaults` and drops unknown keys. Check that `marks` keys are validated, and that note length is capped at 1000 characters.
3. Prototype pollution: no untrusted object is merged by key into another object without checking that the key isn't `__proto__`, `constructor` or `prototype`, or using `Object.create(null)`.

### B4. Edge Functions (`supabase/functions/*`)

For each function:
1. **Caller check comes first:**
   - `scripture` and `feedback` verify the bearer token through `/auth/v1/user` before doing any work.
   - `remind` compares `x-cron-secret` with `secretMatches()`, which compares hashes in constant time and returns false when the secret is unset.

   Any path that does work before the check is High.
2. **CORS:** `Access-Control-Allow-Origin` comes from `ALLOWED_ORIGINS`, never `*`, and never reflects an arbitrary `Origin`.
3. **Input validation:**
   - `scripture` takes Bible IDs and passages only from its `BIBLES` allowlist and a strict reference format; check that user input can't change the upstream URL's path or host.
   - `feedback` caps the message at 2,000 characters and sends it as plain text, and the user can't set To, From or Reply-To beyond their own verified email.
   - `remind` contacts push endpoints only on `PUSH_HOSTS` over HTTPS (`isPushEndpoint`).
4. **Secrets:**
   - `SUPABASE_SERVICE_ROLE_KEY` is used only in `remind`, and only for its own table queries.
   - No function logs headers, tokens, env values, or upstream error bodies that could contain them.
   - Error responses to the client are generic.
5. **Cost and abuse:** `feedback` keeps its per-user cooldown, and nothing lets one caller trigger unbounded upstream requests.
6. **Dependencies:** list the `jsr:`, `npm:` and `https://` imports with their version specs. An unpinned range (`^`) is Low (a redeploy can pull different code).

### B5. Secrets in the repo

1. `git grep -nIE` on `origin/main` for:
   - `service_role`
   - `sb_secret_`
   - `eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}` (JWTs)
   - `-----BEGIN [A-Z ]*PRIVATE KEY`
   - `re_[A-Za-z0-9]{20,}` (Resend)
   - `sk-[A-Za-z0-9]{20,}`
   - `AKIA[0-9A-Z]{16}`
   - `api[_-]?key\s*[:=]\s*['"][^'"]{16,}`
   - `password\s*[:=]\s*['"][^'"]+`

   Allowed: the `sb_publishable_…` key, the VAPID **public** key in `reminder.js`, the public R2 bucket URL, and the comment that names the Keychain entry.
2. `.gitignore` still covers `.env`, `.env.*`, `.claude/`, and `supabase/.gitignore` covers `.env.keys` / `.env.local`.
3. Any secret found is Critical, even if it was later removed. Say it must be rotated.

### B6. Database (`supabase/migrations/*.sql`)

For every table:
1. Row level security is enabled.
2. Every policy is `to authenticated` and scoped with `(select auth.uid()) = user_id`.
3. Every `update` policy has both `using` and `with check`.
4. Grants are explicit and no wider than the policies; `anon` gets nothing.
5. There are size and shape checks where `CLAUDE.md` promises them (`progress.data` ≤ 64 KB object; `reminders` at most 10 per account).

Also:
- There's no `security definer` function in `public`.
- No migration file is empty.
- Every function sets `search_path`.

The live advisors (`supabase db advisors`) need the DB password, which isn't available here, so that part is `SKIPPED`: say the owner should run it locally.

### B7. Service worker and caching

1. `notificationclick` opens only `self.registration.scope`, never a URL from the push payload.
2. The `push` handler shows text only through the Notification API (no HTML) and caps its length.
3. Licensed text (the `scripture` function's responses) and anything from `*.supabase.co` are never put in any cache. Check every `cache.put`, `cache.add` and `addAll` call and the URL matching in the `fetch` handler.
4. The `fetch` handler caches only `GET` requests, and only same-origin, `bible.helloao.org` or `bibles/` responses.

### B8. Supply chain

1. **Vendored supabase-js integrity:** take the version from `vendor/supabase-<version>.js`. In a fresh scratch directory, run `npm pack @supabase/supabase-js@<version>`, extract `package/dist/umd/supabase.js`, and compare `sha256sum` with the vendored file. A mismatch is Critical (the file was changed by hand or tampered with).
2. **Known vulnerabilities:** in another fresh scratch directory, run `npm init -y >/dev/null && npm install --package-lock-only --ignore-scripts @supabase/supabase-js@<version> && npm audit --json`.
   - A high or critical advisory is High, if the vulnerable code is in the UMD bundle the app ships.
   - Moderate is Low.
   - Also run `npm view @supabase/supabase-js@<version> deprecated`.
3. **Other external code:** check that no `<script>` or stylesheet loads from outside the origin (`grep -nE '<script[^>]+src="https?:|<link[^>]+href="https?:' *.html`).
4. **`tools/` scripts:** these aren't shipped, so only note any that download and run code without pinning.

### B9. Privacy

1. The data sent to third parties is only what `CLAUDE.md` describes:
   - AI links carry the reference and the translation name.
   - FUMS gets the token only.
   - `feedback` context is the translation, the meeting day, and whether it's a home-screen app.
2. No notes, marks or emails go into URLs, logs, or analytics.
3. The `#signin-banner` and account UI show only the signed-in user's own email.

### B10. GitHub security (best effort, read-only)

If the GitHub MCP tools are available for `thewahlstedts/daily-reading`, list:
- open Dependabot alerts
- open secret-scanning alerts
- open code-scanning alerts

Also run `run_secret_scanning` on the files changed this week, if that tool is available. Report counts and titles; don't change anything. If the tools are unavailable, mark this `SKIPPED` and say the owner should check *Security → Overview* on GitHub.

## Report format

Reply with exactly this, and nothing else:

```
## Security review — <YYYY-MM-DD> — origin/main <hash>

**Verdict:** <No findings | N findings: X critical, Y high, Z medium, W low>

### Changes reviewed (last 8 days)
- <hash> <date> <subject> — <one line: security-relevant or not, and why>

### Findings
#### [<Severity>] <title>
- **Where:** `file:line` (commit <hash> if new this week)
- **Evidence:** <quoted code or command output>
- **Exploit path:** <input → code → effect, concretely>
- **Fix (not applied):** <smallest change>

### Baseline
| Check | Status | Note |
|---|---|---|
| B1 DOM injection | … | … |
… one row per B1–B10 …

### Open questions
- <things that look wrong but have no traced exploit path>

### innerHTML ledger
- `file:line` — safe/unsafe — source
```

Order findings by severity, worst first. If there are none, say so in one line; don't pad the report.
