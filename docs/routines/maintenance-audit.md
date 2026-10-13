# Maintenance audit (routine)

A read-only health check of the repo against the rules in `CLAUDE.md`. It runs on a schedule in a Claude Code cloud session and **reports only**: the result goes in the session reply, nothing else.

## Hard rules

- **Change nothing.** No edits, commits, branches, pushes, PRs, issues, comments, emails, or database writes. Don't run `supabase` commands that write (`db push`, `config push`, `functions deploy`, `secrets set/unset`).
- **Never call the `scripture` Edge Function.** It spends the API.Bible Starter quota (5,000 requests/month).
- **Never make up findings.** Every finding cites a `file:line` or the exact command output it came from. If something can't be checked, mark it `SKIPPED` and say why. Don't guess.
- **Network is limited.** Cloud sessions may not reach the live site, `bible.helloao.org`, or Supabase (`connect_rejected` from the proxy). The npm registry is reachable. A blocked host counts as `SKIPPED (network blocked)`, not `FAIL`.
- Keep scratch files in the session's scratchpad directory, never in the repo.

## Steps

Run them in order from the repo root. Give each one a status: `PASS`, `WARN` (worth a look, not broken), `FAIL` (breaks a `CLAUDE.md` rule or the app), or `SKIPPED`.

### 0. Baseline

1. `git fetch origin main` and audit `origin/main` (`git checkout --detach origin/main`). Record the commit hash and date (`git log -1 --format='%h %cs %s'`).
2. Read `CLAUDE.md`. It's the spec every check below is measured against.

### 1. Syntax

```sh
node --check app.js sync.js reminder.js onboarding.js sw.js theme-init.js
```
Any error is a `FAIL`.

### 2. Service worker cache consistency

1. Every path in `SHELL_FILES` (`sw.js`) exists in `git ls-files`, except `./`. A missing file is a `FAIL`, because `cache.addAll` rejects and the service worker won't install.
2. Every local `<script src>`, `<link href>` (stylesheet, manifest, icons) in `index.html`, plus the fonts referenced in `styles.css`, is in `SHELL_FILES`. A missing entry is a `WARN`, since it won't work offline.
3. **SHELL bump:** find the last commit that changed the `const SHELL =` line (`git log -L '/const SHELL =/,+1:sw.js' --format='%h %cs' -s | head -1`). List the shell files changed after it (`git diff --name-only <that commit>..origin/main -- <SHELL_FILES>`). If any changed, it's a `FAIL`, because installed apps keep serving the old copy.
4. If `bibles/leb/*.json` changed after the last change to the `const BIBLES =` line, it's a `FAIL` (the bundled-Bible cache name needs a bump).

### 3. Content Security Policy

From the `<meta http-equiv="Content-Security-Policy">` in `index.html`:
1. `script-src` contains no `'unsafe-eval'` and no `'unsafe-inline'`. Otherwise `FAIL`.
2. `index.html` and `copyright.html` have no inline `<script>` bodies and no `on*=` attributes (`grep -nE '<script>|<script [^>]*>[^<]|\son[a-z]+=' index.html copyright.html`). Otherwise `FAIL`.
3. Collect every absolute `https://` / `wss://` origin used in `app.js sync.js reminder.js onboarding.js sw.js`.
   - An origin the app fetches or plays from that is missing from `connect-src` or `media-src` is a `FAIL`.
   - An origin in the CSP that no code uses is a `WARN` (it's stale and can be removed).
   - Links that only open in a new tab (AI tools, `api.bible`) don't need CSP entries. Don't flag them.

### 4. Untrusted text in `innerHTML`

`grep -nE 'innerHTML|insertAdjacentHTML|outerHTML' *.js`. For every hit that builds HTML from a variable, trace where each interpolated value comes from. A value from an API response, synced or imported data, a device voice name, or an error message that isn't wrapped in `escapeHtml()` is a `FAIL`. Values that are constants or numbers computed by the app are fine. List every hit you checked as `file:line — safe/unsafe — reason`, so the next run can compare.

### 5. State handling

1. Every key of `defaults` (`app.js`) is handled in `sanitizeState()`. A missing key is a `FAIL`.
2. Every name in `SYNCED_FIELDS` (`sync.js`) is a key of `defaults`. A missing name is a `FAIL`.
3. Every place that reads localStorage, an imported file or the sync server passes the result through `sanitizeState()` before it reaches `state`. Look for `JSON.parse` and `Object.assign(state` / `{ ...state` / `state = `. A path that skips it is a `FAIL`.

### 6. Secrets

Search the tracked files (`git grep -nE ...`) for `service_role`, `sb_secret_`, `eyJ[A-Za-z0-9_-]{20,}\.` (JWTs), `-----BEGIN`, `re_[A-Za-z0-9]{20,}` (Resend), and long hex or base64 strings assigned to `*key*` / `*secret*` / `*token*` names. Only `sb_publishable_…` and the VAPID **public** key are allowed. Anything else is a `FAIL`. Report the location, **not the value**.

### 7. Dependencies

1. **supabase-js:** take the pinned version from `vendor/supabase-<version>.js` and compare it with `npm view @supabase/supabase-js version`.
   - Behind by a minor or major version: `WARN`.
   - Behind by a patch version only: note it, no status change.
2. **Known vulnerabilities:** in a fresh scratch directory, run `npm init -y >/dev/null && npm install --package-lock-only --ignore-scripts @supabase/supabase-js@<pinned> && npm audit --json`. Any high or critical advisory is a `FAIL`; moderate is a `WARN`. Also run `npm view @supabase/supabase-js@<pinned> deprecated`.
3. The `<script>` tag in `index.html`, the `SHELL_FILES` entry, and the vendored filename all name the same version. A mismatch is a `FAIL`.
4. `vendor/supabase-js-LICENSE` and the two font `*-OFL.txt` files exist. A missing file is a `FAIL`.
5. **Edge Function imports:** list every `jsr:`, `npm:`, `https://` import in `supabase/functions/**` with its version spec. Ranges (`^`) are a `WARN`, because a redeploy can pull a different version. Don't change them.

### 8. Database migrations

For every `create table` in `supabase/migrations/*.sql`:
1. A matching `enable row level security` exists.
2. Policies are `to authenticated` and scoped with `(select auth.uid()) = user_id`.
3. Every `for update` policy has both `using` and `with check`.
4. There's an explicit `grant … to authenticated`.

Also check that no migration has `security definer` on a function in `public`, and that no migration file is empty. Any violation is a `FAIL`. (`supabase db advisors` needs the DB password, which isn't available here, so it's `SKIPPED`.)

### 9. Plan and bundled Bible

1. Every non-empty line of `plan.txt` matches `^.+ \d+(-\d+)?$`. Report the count of readings. Don't assume a number.
2. Every book name in the plan is a key in `BOOK_CODES` (`app.js`).
3. For each USFM code the plan uses, `bibles/leb/<CODE>.json` exists, parses as JSON, and contains every chapter the plan references. A missing book or chapter is a `FAIL`, because offline reading breaks.

### 10. Attribution

These are licence requirements. A missing item is a `FAIL`.
1. `copyright.html` credits the LEB (with the notice its module requires), the Tyndale Open Study Notes (CC BY-SA 4.0), API.Bible with a link to `https://api.bible`, and the Free Use Bible API.
2. `renderNotice()` and `commentaryNotice()` in `app.js` still link to `copyright.html`.
3. `reportFums()` still exists and is called where licensed text is shown.

### 11. Docs drift

Check these `CLAUDE.md` claims against the code. A mismatch is a `WARN`; quote both sides.
- The file table matches the `<script>` order in `index.html`.
- The vendored supabase-js version.
- The `SYNCED_FIELDS` list.
- The licensed translations (NIV, NLT, AMP) are the `licensed: true` entries in `BIBLES` (`app.js`) and the keys of `BIBLES` in `supabase/functions/scripture/index.ts`.
- `AI_TOOLS` has the options listed (Claude, ChatGPT, Gemini, Google AI Mode, off).
- The `node --check` file list under Testing names every top-level `.js` file.

### 12. Live checks (best effort)

Try each with `curl -sS -m 15`. If a host is blocked or times out, mark it `SKIPPED (network blocked)`.
1. `https://thewahlstedts.github.io/daily-reading/sw.js`: its `SHELL` value equals the one on `origin/main`. Otherwise `WARN`, since Pages may not have deployed.
2. `https://bible.helloao.org/api/available_translations.json` responds with 200.
3. `https://rnpuwanpgundhfmvzrne.supabase.co/auth/v1/health` responds. A paused free-plan project is a `FAIL` and needs a manual restore.

### 13. Repo hygiene (read-only)

1. Remote branches: list `git branch -r --merged origin/main` (safe to delete) and unmerged branches with their last commit date (`git for-each-ref --format='%(committerdate:short) %(refname:short)' refs/remotes`). Only report them; anything untouched for 30 days or more is a `WARN`.
2. If the GitHub MCP tools are available, list open PRs and open Dependabot / secret-scanning alerts for `thewahlstedts/daily-reading`. Don't comment on or change them. If the tools aren't available, mark this `SKIPPED`.

## Report format

Reply with exactly this, and nothing else:

```
## Maintenance audit — <YYYY-MM-DD> — origin/main <hash>

| # | Check | Status | Summary |
|---|---|---|---|
| 1 | Syntax | PASS | … |
… one row per step 1–13 …

### Failures
- **<check>** — `file:line` — what's wrong, the evidence (command output or quoted line), and the smallest fix. (Not applied.)

### Warnings
- same shape

### Skipped
- <check> — why

### innerHTML ledger
- `file:line` — safe/unsafe — reason
```

If there are no failures or warnings, say so in one line under each heading. Don't pad the report.
