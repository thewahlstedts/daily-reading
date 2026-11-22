# iOS app, phase 1: TestFlight

Goal: a native iPhone build of Daily Reading that you, and then the reading group, can install through TestFlight. It's the same web app bundled inside a Capacitor shell, so `app.js` and the rest stay plain static files with no build step. Only the native project uses npm.

Full App Store release work is in [release.md](release.md). This phase only does what a TestFlight build needs to work properly.

## Approach

- **Capacitor** (`@capacitor/ios`) wraps the app in a WKWebView served from `capacitor://localhost`.
- **The files ship inside the app.** `tools/ios_web.mjs` copies everything in `sw.js` `SHELL_FILES`, plus `bibles/`, into `www/` (gitignored), and `npx cap sync ios` copies that into the Xcode project. `SHELL_FILES` stays the single list of what makes up the app.
- **No bundler for plugins.** Capacitor injects `window.Capacitor` before the page's scripts run, and plugins are reached through `Capacitor.Plugins.<Name>`. One helper in `app.js` (`isNative()`) gates the native-only paths.
- **Web updates don't reach the app on their own.** Pushing to `main` still deploys the website. The app changes only when a new build is uploaded.

## Code changes (Claude)

| # | Change | Why |
|---|---|---|
| 1 | `package.json`, `capacitor.config.json`, `ios/` Xcode project, `.gitignore` for `node_modules/` and `www/` | The native shell |
| 2 | `tools/ios_web.mjs`: copies the app files into `www/` | Keeps admin, tools and supabase out of the app |
| 3 | Skip service worker registration and `prefetchForOffline()` when native | No service workers from the app's own origin; the bundled files are already on the device |
| 4 | Share links use the live URL, not `location.href` | `capacitor://localhost/?start=…` is useless to anyone else |
| 5 | Sign-in email link points to the live site; the app relies on the 6-digit code it already supports | The link would open Safari, not the app |
| 6 | **Reminders use local notifications** (`@capacitor/local-notifications`) when native: the next 14 days are scheduled on the device, each naming that day's reading. Rescheduled on every save; today's is dropped once you're caught up. No sign-in or server needed | Web Push doesn't exist in a native web view |
| 7 | `AVAudioSession` set to `.playback`, `UIBackgroundModes: audio` | Narration keeps playing when the phone locks and ignores the silent switch |
| 8 | Status bar text follows the theme (`@capacitor/status-bar`) | `theme-color` has no effect in an app |
| 9 | `capacitor://localhost` added to `ALLOWED_ORIGINS` in the `scripture`, `feedback` and `usage` functions; redeploy them | NIV/NLT/AMP, Feedback and the usage ping are called from the new origin |
| 10 | `capacitor://localhost` added to the R2 bucket's CORS | LEB narration timings are fetched cross-origin |
| 11 | Usage pings and the feedback context recognize the app ("iOS app") | Otherwise the app is invisible in the dashboard |
| 12 | Admin link opens the live `admin.html` in Safari | `admin.html` isn't bundled |
| 13 | App icon (1024 px, opaque, rendered from `icon.svg`) and launch screen in the Parchment color | Required for an upload |
| 14 | Info.plist: display name "Daily Reading", `ITSAppUsesNonExemptEncryption = NO`, iPhone portrait, version 1.0 (1) | Skips the export-compliance question on every upload |
| 15 | `privacy.html`: a short, plain privacy page | Required before external testers can be invited |
| 16 | Notes in `CLAUDE.md`: how to build, run and upload | So future changes keep the app working |

Onboarding: the reminder step will appear in the app for everyone (local notifications need no sign-in and no Home Screen install), so `reminderAvailable()` changes for native. No new steps.

### Left for later (known gaps in the TestFlight build)

- **Group invite links open the website, not the app.** Testers who sign in get their start date and meeting day through sync. Proper handling needs Universal Links (see release plan).
- **HelloAO translations (BSB, KJV, …) aren't saved for offline use in the app.** The bundled LEB works offline as before.
- **Lock-screen play/pause** depends on WKWebView's Media Session support; check it on a device.

## Your part

1. **Apple Developer Program**: enroll at developer.apple.com ($99/year) if you haven't. Enrolling as an individual is quickest; as an organization the store shows "thewahlstedts" as the seller, but you need a D-U-N-S number.
2. **Xcode → Settings → Accounts**: add your Apple ID. Then in the project, set *Signing & Capabilities → Team*.
3. **App Store Connect → Apps → +**: create the app with bundle ID `com.thewahlstedts.dailyreading`. The name must be unique on the store; "Daily Reading" may be taken, so have a fallback ready such as "Daily Reading: Bible Plan".
4. **Install on your phone**: connect it with a cable and run from Xcode, or archive and upload (*Product → Archive → Distribute App → TestFlight & App Store*), then install from the TestFlight app.
5. **Inviting the group (external testing)**: in App Store Connect → TestFlight, fill in *Test Information* (feedback email, short description, privacy policy URL `…/privacy.html`). Add the group, submit the build for Beta App Review (usually a day), then share the public link. Builds expire after 90 days.

## Test checklist (on a real iPhone)

- [ ] First launch: onboarding, sign-in by code, meeting day, start date
- [ ] Reader: LEB loads offline (airplane mode), verse marks, notes, Ask links open Claude/ChatGPT apps or Safari
- [ ] Narration: LEB (Michael) and BSB play, highlight verses, keep playing with the screen locked and the silent switch on; lock-screen controls
- [ ] Device voice (speech synthesis) for other translations
- [ ] NIV/NLT/AMP while signed in (needs the CORS change)
- [ ] Sync between the app and the website on the same account
- [ ] Reminder arrives at the set time with the right reading; none on a caught-up day
- [ ] Share sends a working https link
- [ ] Commentary, summaries (and summary narration), Verses to discuss, Feedback
- [ ] All 7 themes: status bar text readable, safe areas correct (notch, home indicator)
