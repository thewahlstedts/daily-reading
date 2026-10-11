# Daily Reading

A small installable web app for a one-year Bible reading plan: shows today's reading, tracks what you've read, lists anything you're behind on, and reads the passage aloud with verse-by-verse highlighting.

- **Plan:** `plan.txt`, one reading per line (`Book N` or `Book N-M`). Swap it out for a new year's plan.
- **Text:** the Lexham English Bible is bundled with the app; other free translations come from the [Free Use Bible API](https://bible.helloao.org); NIV, NLT and AMP come from API.Bible for signed-in users.
- **Offline:** the app, its fonts and the LEB work fully offline once loaded. For other free translations, up to 30 unread readings through the next two weeks (plus anything you've opened) are saved. NIV, NLT and AMP need a connection (their license doesn't allow storing them).
- **Audio:** human narration for the BSB (online only), otherwise the device's built-in text-to-speech voices.
- **Group weeks:** set the day your group meets (Settings) and the home page shows that week's readings, from the day after one meeting through the next.
- **Sharing:** Settings → Share sends a link like `?start=2026-09-01&meet=2` so others follow the same schedule. New visitors adopt it automatically; anyone with their own start date is asked first.
- **Progress:** stored in the browser on each device. Optionally sign in (Settings → Sync across devices) to sync it via Supabase, or use Export/Import.
- **Security:** see [SECURITY.md](SECURITY.md). Contributor notes are in [CLAUDE.md](CLAUDE.md).

## Run locally

```sh
python3 -m http.server 8787
# open http://localhost:8787
```

## Host it

It's plain static files, so any static host works (for example GitHub Pages: push the repo and enable Pages on the main branch). On iPhone, open the URL in Safari → Share → **Add to Home Screen**.
