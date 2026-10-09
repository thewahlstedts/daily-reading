# Security

## Reporting a problem

Please report security issues privately via GitHub: **Security → Report a vulnerability** on this repository. Don't open a public issue.

## How data is handled

- Reading progress is stored in your browser. If you choose to sign in, your start date, checkmarks, translation and auto-mark setting are also stored in Supabase, where database row-level security limits each account to its own row.
- The app contains only Supabase's *publishable* key, which is meant to be public; it grants nothing beyond what the row-level security policies allow.
- A Content Security Policy limits the page to its own scripts and to the services it uses: the Free Use Bible API (text and audio), Supabase and Google Fonts.
