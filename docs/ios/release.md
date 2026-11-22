# iOS app, phase 2: App Store release

Everything still needed after the TestFlight build ([testflight.md](testflight.md)) to pass full App Review and be listed publicly. Items are grouped by what blocks the release.

## Blockers: App Review will reject without these

### Account deletion (guideline 5.1.1(v)) — Claude
Apps that let people create an account must let them delete it from inside the app.
- New Edge Function `delete-account`: verifies the user, then uses the service role to delete their `progress`, `progress_history`, `reminders` and `usage_days` rows and the `auth.users` record.
- Account screen: "Delete account" with a confirm dialog (`#delete-dialog`) explaining that synced progress, marks and notes are removed and this device keeps its local copy.
- The website gets it too, since it's the same code.

### Content licensing — you (Claude can draft the emails)
Each text in the app needs rights to be distributed in an app on the store.
- **NIV / NLT / AMP via API.Bible**: the Starter plan is non-commercial. A free app is probably fine, but confirm with API.Bible that their terms cover a published iOS app. If not, hide licensed translations in the iOS build (one check on `isNative()`).
- **LEB (bundled)**: check the SWORD module's `DistributionLicense` covers redistribution inside an app, not only on the web. Ask Faithlife if unclear.
- **BSB, Tyndale Open Study Notes, HelloAO audio**: public domain / CC BY-SA, so attribution (already in `copyright.html`) is enough.
- App Store Connect asks "Does your app contain, show, or access third-party content?" Answer yes, with the rights confirmed above.

### Privacy — Claude writes, you submit
- `privacy.html` (written for TestFlight) reviewed for completeness: email (account), synced reading progress, marks and notes, the anonymous device ID from usage pings, feedback emails, reminder times. No ads, tracking or selling.
- **App Privacy questionnaire** in App Store Connect: Contact Info → Email (app functionality, linked to user); User Content → other (marks/notes, linked); Identifiers → Device ID (analytics, not linked once signed out). "Used for tracking": no.
- Support URL (the live site or a short support page) and a contact email.

### Enough native value (guidelines 4.2 and 4.3) — both
Bible apps are a crowded category and wrapped websites get rejected. Make the case in the screenshots and the review notes: weekly group pace and meeting-day view, offline bundled Bible, narration, local reminders, verse marks to bring to the meeting. If it gets rejected under 4.2, add native features (widget showing today's reading, Siri shortcut) rather than argue.

## Should do before public release

### Group invite links open the app — Claude + you
Share links point to the website. To open them in the app:
- Universal Links need `/.well-known/apple-app-site-association` at the root of the domain. `thewahlstedts.github.io/daily-reading/` can't serve that (the root belongs to the `thewahlstedts.github.io` repo). Options: create that repo just for the file, or move the app to a custom domain (for example `reading.thewahlstedts.com`, which also gives nicer share links).
- The app handles the incoming URL (`App.addListener('appUrlOpen')`) through the existing `handleSharedLink()`.
- Fallback with no domain work: an "I have an invite link" field in onboarding that accepts a pasted link.

### Offline text for online translations — Claude
Without a service worker, BSB/KJV/etc. aren't saved for offline. Use the Cache API from the page (works in WKWebView) for the same 30 readings `prefetchForOffline()` picks today, or decide that LEB is the offline translation in the app.

### Lock-screen controls — Claude
If Media Session doesn't drive the lock screen in WKWebView (checked during TestFlight), add a small native plugin that sets `MPNowPlayingInfoCenter` and handles remote commands.

### Reviewer access — you
Sign-in is optional, so the reviewer can use almost everything signed out. Say so in the review notes. For sync, provide a test account whose email inbox you can forward codes from, or note that the code arrives by email.

### Supabase capacity — you
Free projects pause after ~a week of inactivity and sign-in email is capped at 30/hour. For a public app: Supabase Pro ($25/month) and a higher Resend/auth email limit.

## Store listing — you (Claude drafts text)

- Name (unique on the store) and subtitle (30 chars), e.g. "Read the Bible in a year, together".
- Description, keywords (100 chars), category (Reference, secondary Books), age rating questionnaire (4+ expected), copyright line.
- Screenshots: 6.9" iPhone required. iPad screenshots only if the app is made universal; recommended to stay iPhone-only for 1.0. Claude can generate them from the simulator.
- Price: free. Availability: choose countries.
- **EU Digital Services Act**: declare trader or non-trader status (non-trader for a free, non-commercial app) or EU countries are unavailable.
- Export compliance is already answered in Info.plist.

## Ongoing release process — Claude documents in CLAUDE.md

- Every app change ships twice: push to `main` for the website, then bump the build number, archive and upload for the app.
- Decide how app releases track the website: release monthly, or whenever something user-facing changes. Bug fixes in bundled files (summaries, plan text) need a new build.
- Keep `SHELL_FILES` the single list of bundled files.
- Optional later: Xcode Cloud or a Fastlane lane to upload builds without opening Xcode.
