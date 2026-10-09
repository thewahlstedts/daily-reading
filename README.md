# Daily Reading

A small installable web app for a one-year Bible reading plan: shows today's reading, tracks what you've read, lists anything you're behind on, and reads the passage aloud with verse-by-verse highlighting.

- **Plan:** `plan.txt`, one reading per line (`Book N` or `Book N-M`). Swap it out for a new year's plan.
- **Text:** fetched from [bible-api.com](https://bible-api.com) (WEB, KJV, ASV, BBE, YLT, Darby). Chapters you open are cached for offline use.
- **Audio:** the device's built-in text-to-speech voices.
- **Sharing:** the share button sends a link like `?start=2026-09-01` so others follow the same schedule. New visitors adopt it automatically; anyone with their own start date is asked first.
- **Progress:** stored in the browser on each device. Optionally sign in (Settings → Sync across devices) to sync it via Supabase, or use Export/Import.
- **Security:** see [SECURITY.md](SECURITY.md). Contributor notes are in [CLAUDE.md](CLAUDE.md).

## Run locally

```sh
python3 -m http.server 8787
# open http://localhost:8787
```

## Host it

It's plain static files, so any static host works (for example GitHub Pages: push the repo and enable Pages on the main branch). On iPhone, open the URL in Safari → Share → **Add to Home Screen**.
