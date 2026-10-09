# Daily Reading

Installable web app (PWA) for a one-year Bible reading plan: today's reading, progress tracking, read-aloud, themes, reading-text options, shareable start date, and optional cross-device sync.

Live: https://thewahlstedts.github.io/daily-reading/ (GitHub Pages, served from `main`, root). Pushing to `main` deploys in about a minute.

## Architecture

Plain static files, no build step, no package manager. Classic `<script>` tags share one global scope, loaded in this order:

| File | Role |
|---|---|
| `theme-init.js` | Runs in `<head>` before paint: applies saved theme, swaps reading fonts in non-blocking |
| `vendor/supabase-2.117.1.js` | Pinned supabase-js UMD build (vendored so it works offline and can't change under us) |
| `app.js` | Everything else: `state` + `save()`, plan parsing, rendering, reader, speech, settings, themes, reading text, sharing |
| `sync.js` | Optional Supabase sync; hooks in via `window.onStateSaved` |
| `sw.js` | Service worker: app shell network-first (`cache: 'no-cache'`), bible-api.com responses cache-first |
| `plan.txt` | The plan: one reading per line, `Book N` or `Book N-M` |

- **State:** one `state` object in localStorage (`daily-reading:v1`), always passed through `sanitizeState()`. Add new fields to `defaults` *and* `sanitizeState()`.
- **Schedule:** reading `i` is due on `start + i` days. "Next" is the first unread index.
- **Scripture:** from bible-api.com, one chapter per request (it rejects chapter ranges). It is public-domain translations only.
- **Speech:** Web Speech API, one utterance per verse. `gen` counter invalidates stale utterance callbacks.
- **Sync:** `SYNCED_FIELDS` (start, read, translation, automark) are synced; theme, voice, speed and reading text stay per device. If only the local copy changed, it wins. If both changed, checkmarks are merged (union) and account settings win.

## Conventions

- 2-space indent, single quotes, small functions, sparse comments that explain *why*.
- Colors only via theme tokens (`--bg --surface --ink --muted --line --accent --accent-soft --done --late --highlight`); every UI change must work in all 7 themes, light and dark.
- Phone first: 16px gutters, no horizontal scroll at ~390px wide.
- When changing any cached file, bump `SHELL` in `sw.js`, and add new files to `SHELL_FILES`.

## Security rules (must follow)

- **Never put untrusted text into `innerHTML`.** Use `textContent` / DOM nodes, or wrap values in `escapeHtml()`. Untrusted means: API responses (bible-api, Supabase), imported files, synced data, device voice names, error messages.
- **All loaded or received state goes through `sanitizeState()`.** That includes localStorage, imports and the sync server. Never spread raw objects into `state`.
- **Content Security Policy** is a `<meta>` in `index.html`. No inline scripts or inline event handlers (`onclick=` etc.); put code in `.js` files. When adding a new external service, add it to `connect-src` (or the right directive) deliberately. Never add `'unsafe-eval'` or `'unsafe-inline'` to `script-src`.
- **Supabase keys:** only the *publishable* key (`sb_publishable_…`) belongs in client code. Never commit or paste the secret / `service_role` keys or the DB password. The DB password is in macOS Keychain: service "Supabase daily-reading DB", account `daily-reading`.
- **Every table gets RLS** with policies scoped to `(select auth.uid()) = user_id`, `TO authenticated`, and explicit `GRANT`s (the Data API does not expose new tables automatically). UPDATE policies need both `USING` and `WITH CHECK`. No `SECURITY DEFINER` functions in `public`.
- **Third-party JS is vendored and version-pinned** in `vendor/` with its license. To upgrade: `npm pack @supabase/supabase-js@<version>` in a scratch dir, copy `dist/umd/supabase.js`, update the `<script>` tag and `SHELL_FILES`, bump `SHELL`.
- **GitHub:** secret scanning + push protection and Dependabot alerts are on; the "Protect main" ruleset blocks force-push and deletion of `main`. Don't disable these.

## Supabase

- Project ref `rnpuwanpgundhfmvzrne` (org "carlowahlstedt's Org", us-east-1, free plan). This directory is linked (`supabase link`).
- Table `public.progress (user_id uuid pk → auth.users, data jsonb ≤ 64 KB object, updated_at)`. Migrations are in `supabase/migrations/`.
- Auth: email magic link (default template; free plan can't customize templates or show OTP codes). iPhone home-screen apps don't share storage with Safari, so Settings offers "paste the sign-in link", which calls `verifyOtp({ token_hash, type })`.
- New migration: create the file with `supabase migration new <name> < /dev/null` (it reads SQL from stdin and hangs otherwise), write the SQL, then:
  ```sh
  export SUPABASE_DB_PASSWORD="$(security find-generic-password -a daily-reading -s 'Supabase daily-reading DB' -w)"
  supabase db push --linked --yes < /dev/null
  supabase db advisors --linked < /dev/null   # must report no issues
  ```
  Verify the change actually landed (e.g. `supabase db query --linked "<sql>"`), because an empty migration file still gets recorded as applied.
- `supabase/config.toml` mirrors the remote project. **Always run `supabase config diff` before `supabase config push`**: any value declared in the file overwrites the remote, so keep it matching.
- Free plan: built-in email sends only a few sign-in emails per hour, and projects pause after about a week of inactivity.

## Testing

No test suite. Verify by hand:
```sh
node --check app.js sync.js sw.js theme-init.js
python3 -m http.server 8787   # http://localhost:8787 (also an allowed auth redirect)
```
In the browser: no console errors or CSP violations; today card, catch-up, mark read/undo; reader loads and read-aloud highlights verses; Settings (themes, reading text, start date, share link, import/export); a light and a dark theme; ~390px width. Clear test data afterwards (`localStorage.removeItem('daily-reading:v1')`, `daily-reading:sync`). Don't leave test rows in Supabase.
