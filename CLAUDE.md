# Daily Reading

Installable web app (PWA) for a one-year Bible reading plan, built for a group that meets weekly to review the week's readings: weekly progress, read-aloud, themes, reading-text options, shareable schedule (start date + meeting day), and optional cross-device sync.

Live: https://thewahlstedts.github.io/daily-reading/ (GitHub Pages, served from `main`, root). Pushing to `main` deploys in about a minute.

## Architecture

Plain static files, no build step, no package manager. Classic `<script>` tags share one global scope, loaded in this order:

| File | Role |
|---|---|
| `theme-init.js` | Runs in `<head>` before paint: applies saved theme, swaps reading fonts in non-blocking |
| `vendor/supabase-2.117.1.js` | Pinned supabase-js UMD build (vendored so it works offline and can't change under us) |
| `app.js` | Everything else: `state` + `save()`, plan parsing, rendering, reader, speech, settings, themes, reading text, sharing |
| `sync.js` | Optional Supabase sync and the Account screen (`#account`); hooks in via `window.onStateSaved`; exposes `sendSignInLink` / `signInWithCode` / `getAccessToken` / `currentUserEmail` |
| `onboarding.js` | First-visit walkthrough (sign-in, meeting day, start date + week preview, translation, look, share). Borrows `#theme-picker` / `#text-options` from Settings while open. Starts via `planReady`; current step persists in `daily-reading:onboard-step` so the email-link round trip resumes it. Arriving from a share link sets `daily-reading:invite`, which turns the welcome into a "You're invited" view. |
| `sw.js` | Service worker: app shell network-first (`cache: 'no-cache'`), bible.helloao.org responses cache-first |
| `plan.txt` | The plan: one reading per line, `Book N` or `Book N-M` |

- **State:** one `state` object in localStorage (`daily-reading:v1`), always passed through `sanitizeState()`. Add new fields to `defaults` *and* `sanitizeState()`.
- **Schedule:** reading `i` is due on `start + i` days. "Next" is the first unread index.
- **Group weeks:** with `meetDay` set (0 = Sun … 6 = Sat), a week runs from the day after one meeting through the next meeting day (`weekWindow()`). Only unread readings *before* the current week count as behind (`dueBefore()`). The home page shows the current week; later readings stay collapsed behind "Show all upcoming".
- **Scripture:** from the Free Use Bible API (bible.helloao.org, no key), one chapter per request; `BIBLES` lists the offered translations (`src` = HelloAO id) and `BOOK_CODES` maps plan book names to USFM codes.
- **Licensed translations (NIV, NLT, AMP):** `licensed: true` in `BIBLES`. Text comes from API.Bible via the Supabase Edge Function `supabase/functions/scripture` (holds `API_BIBLE_KEY`; only serves signed-in users; Bible IDs allowlisted in `BIBLES` there). Starter plan: max 3 licensed Bibles, 5,000 requests/month, non-commercial only. Client must show the returned `copyright` and report `fumsToken` to FUMS (`reportFums()`, GET `https://fums.api.bible/f3`). Licensed text is kept in memory only (never cached to disk or the service worker). ESV is not set up; Lexham (LEB) isn't offered by API.Bible.
- **Bundled Bibles (LEB):** `local: 'bibles/leb'` in `BIBLES`; one JSON per book (`{"<chapter>": [[verse, "text"], ...]}`) generated from a SWORD module with `tools/sword_to_json.py` (run with `python -I` in a throwaway venv with `pysword==0.2.8`). Served and cached offline like the app shell; it's the default translation for new users, and `prefetchBundledBible()` downloads every book the plan uses shortly after load so it truly works offline. Only bundle modules whose license allows free redistribution; check the module's `.conf` (`DistributionLicense`) and add the required notice to `renderNotice()` and `copyright.html`.
- **Copyright:** `renderNotice()` puts the required attribution under copyrighted text, linking to `copyright.html`. API.Bible's Starter plan also requires a visible link to https://api.bible and a linked copyright page.
- **Caching rules:** free/public-domain and bundled text may be cached offline. API.Bible text may only be cached if refreshed at least every 30 days, kept secure against copying, and deleted within 72 hours if the plan ends, so the app keeps it in memory only.
- **Narration:** for `narrated` Bibles (BSB), `thisChapterAudioLinks` gives human-read MP3s per narrator plus per-verse start times (`*.audioTimings.json`, `verses[n-1]`). `narrateFrom()` plays them in one `<audio>` element, highlighting on `timeupdate`; other translations use speech synthesis. Media Session gives lock-screen controls. (Note: Chrome won't load media in a hidden/background tab, so automated browser tests can't hear playback.)
- **Speech:** Web Speech API, one utterance per verse. `gen` counter invalidates stale utterance callbacks.
- **Reader:** tapping a verse marks it (it does not seek audio; use ‹ ›). "Mark read" closes the reader with an Undo toast; auto-mark after listening keeps it open.
- **Account UI:** header shows a "Sign in" pill when signed out, or an accent icon with a green dot when signed in; both open the Account screen. A device that was signed in but lost its session shows the `#signin-banner` on load (not after a deliberate sign-out).
- **Marked verses:** tapping a verse in the reader toggles `state.marks['PSA.23.1'] = { i: planIndex, at, t: translationId }`. Only references are stored (never text, so licensed translations aren't cached); the review sheet (`renderReview()`) fetches each verse in the translation it was marked in and shows the required notices. The week section's "Marked verses" button reviews that week's marks; without a group, `#marks-entry` shows all.
- **Onboarding:** `state.onboarded` (synced). Picking a meeting day sets the start to the day after that weekday, on or before the default start (`alignedStart()`; Wednesday → Thu Aug 27), so each group week is 7 full readings; start dates from a share link are kept. Saved state from before onboarding existed counts as onboarded (`load()`). Finishing or skipping marks every reading before the current week (`dueBefore()`) as read so new users start fresh; signing in during onboarding to an already-set-up account calls `window.onAccountRestored`, which ends it without touching their progress.
- **Sync:** `SYNCED_FIELDS` (start, read, translation, automark, meetDay, marks, onboarded) are synced; marks merge like checkmarks; theme, voice, speed and reading text stay per device. If only the local copy changed, it wins. If both changed, checkmarks are merged (union) and account settings win.

## Conventions

- 2-space indent, single quotes, small functions, sparse comments that explain *why*.
- Colors only via theme tokens (`--bg --surface --ink --muted --line --accent --accent-soft --done --late --highlight`); every UI change must work in all 7 themes, light and dark.
- Phone first: 16px gutters, no horizontal scroll at ~390px wide.
- When changing any cached file, bump `SHELL` in `sw.js`, and add new files to `SHELL_FILES`.

## Security rules (must follow)

- **Never put untrusted text into `innerHTML`.** Use `textContent` / DOM nodes, or wrap values in `escapeHtml()`. Untrusted means: API responses (HelloAO, Supabase), imported files, synced data, device voice names, error messages.
- **All loaded or received state goes through `sanitizeState()`.** That includes localStorage, imports and the sync server. Never spread raw objects into `state`.
- **Content Security Policy** is a `<meta>` in `index.html`. No inline scripts or inline event handlers (`onclick=` etc.); put code in `.js` files. When adding a new external service, add it to `connect-src` (or the right directive) deliberately. Never add `'unsafe-eval'` or `'unsafe-inline'` to `script-src`.
- **Supabase keys:** only the *publishable* key (`sb_publishable_…`) belongs in client code. Never commit or paste the secret / `service_role` keys or the DB password. The DB password is in macOS Keychain: service "Supabase daily-reading DB", account `daily-reading`.
- **Every table gets RLS** with policies scoped to `(select auth.uid()) = user_id`, `TO authenticated`, and explicit `GRANT`s (the Data API does not expose new tables automatically). UPDATE policies need both `USING` and `WITH CHECK`. No `SECURITY DEFINER` functions in `public`.
- **Third-party JS is vendored and version-pinned** in `vendor/` with its license. To upgrade: `npm pack @supabase/supabase-js@<version>` in a scratch dir, copy `dist/umd/supabase.js`, update the `<script>` tag and `SHELL_FILES`, bump `SHELL`.
- **GitHub:** secret scanning + push protection and Dependabot alerts are on; the "Protect main" ruleset blocks force-push and deletion of `main`. Don't disable these.

## Supabase

- Project ref `rnpuwanpgundhfmvzrne` (org "carlowahlstedt's Org", us-east-1, free plan). This directory is linked (`supabase link`).
- Edge Function `scripture`: deploy with `supabase functions deploy scripture --project-ref rnpuwanpgundhfmvzrne --no-verify-jwt --use-api < /dev/null` (it verifies the user itself via `/auth/v1/user`). Secrets via `supabase secrets set` (never in the repo). To test without a user session, temporarily add a bypass guarded by a random `TEST_TOKEN` secret, then remove the code and `supabase secrets unset TEST_TOKEN`.
- Table `public.progress (user_id uuid pk → auth.users, data jsonb ≤ 64 KB object, updated_at)`. Migrations are in `supabase/migrations/`.
- Auth: email sign-in through custom SMTP (Resend, sender `reading@thewahlstedts.com`, configured by Resend's Supabase integration; not declared in `config.toml`, so `config push` leaves it alone). The `magic_link` and `confirmation` templates (`supabase/templates/sign-in.html`) include a 6-digit code (`{{ .Token }}`) and the link; the app's code box calls `verifyOtp({ email, token, type: 'email' })`, which also works in iPhone home-screen apps (they don't share storage with Safari). The hourly email limit (`auth.rate_limit.email_sent`) is dashboard-only.
- New migration: create the file with `supabase migration new <name> < /dev/null` (it reads SQL from stdin and hangs otherwise), write the SQL, then:
  ```sh
  export SUPABASE_DB_PASSWORD="$(security find-generic-password -a daily-reading -s 'Supabase daily-reading DB' -w)"
  supabase db push --linked --yes < /dev/null
  supabase db advisors --linked < /dev/null   # must report no issues
  ```
  Verify the change actually landed (e.g. `supabase db query --linked "<sql>"`), because an empty migration file still gets recorded as applied.
- `supabase/config.toml` mirrors the remote project. **Always run `supabase config diff` before `supabase config push`**: any value declared in the file overwrites the remote, so keep it matching.
- Sign-in email limit is 30/hour (set in the dashboard under Authentication → Rate Limits) and one email per address per minute (`max_frequency`). Free-plan projects pause after about a week of inactivity.
- API.Bible Starter plan (key in `API_BIBLE_KEY`): the 3 licensed Bibles chosen in its dashboard are NIV (2011), NLT and AMP; IDs are in the function's `BIBLES` map. Swapping one means changing the dashboard and both `BIBLES` lists.

## Testing

No test suite. Verify by hand:
```sh
node --check app.js sync.js onboarding.js sw.js theme-init.js
python3 -m http.server 8787   # http://localhost:8787 (also an allowed auth redirect)
```
In the browser: no console errors or CSP violations; today card, catch-up, mark read/undo; reader loads and read-aloud highlights verses; Settings (themes, reading text, start date, share link, import/export); a light and a dark theme; ~390px width. Getting started only shows for a fresh browser profile (or after clearing `daily-reading:v1`). Clear test data afterwards (`daily-reading:v1`, `daily-reading:sync`, `daily-reading:onboard-step`, `daily-reading:invite`). Don't leave test rows in Supabase.
