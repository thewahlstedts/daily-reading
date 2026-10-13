# Weekly summaries

One summary per plan week (`week-01.txt` … `week-52.txt`). Plan week N is readings 7(N−1)…7N−1 of `plan.txt`, the same for every group, so the app shows the file for the plan week a group is on (the one holding most of its 7 readings when the start isn't aligned). `week-07.txt` is the reference for tone and shape.

Get a week's readings and text with `python3 -I tools/week_text.py <N>` (`--refs` for the list only). It prints the bundled Lexham English Bible (LEB) verse by verse; every claim must be checkable against it.

## Format

- Plain UTF-8 text, no Markdown. Paragraphs separated by one blank line; no headings, lists, links or quotes longer than a few words.
- 2–4 paragraphs, about 400–650 words (a week is seven or more chapters).
- No title line; the app shows "Week N" and the readings.

## Content

- Cover every reading of the week, in plan order. Say which chapter or psalm you're in ("In chapter 9…", "Psalm 77…"). A reading that spans chapters (e.g. "2 Samuel 4-5") counts as one reading but both chapters get covered.
- Retell what happens and what is said: people, places, actions, promises, prayers, turns in the story. Keep to the main line; skip lists and measurements unless they matter.
- Every factual statement must be true of the LEB text of this week's readings. Numbers, names, who-said-what and order of events are checked against it. If a number differs between translations or between parallel accounts (Samuel/Kings vs Chronicles), leave it out or say "the text gives".
- Say "God" (or "the LORD" when the text's use of the name matters); don't use "Yahweh". Paraphrase; don't quote other translations.
- Cross-references to other books, or to earlier/later weeks, are allowed only when they are accurate and help (e.g. Deuteronomy 17:16-17 on a king's horses, wives and gold). Give the reference, and check it in `bibles/leb/<BOOK>.json`.
- Connections the text doesn't state (why a psalm is paired with a story, what a detail "shows", typology, application) must be marked as interpretation, e.g. "one way to read this…", "the plan pairs…, which invites…". Never write in the first person ("I", "my reading"); the reader doesn't know who "I" is.
- No doctrinal side-taking where Christian traditions differ, no claims about authorship or dating, no historical or archaeological claims from outside the text.
- Neutral, plain, warm tone. No exclamation marks, no "amazing", no sermonizing, no questions to the reader (the group brings its own).

## Checks before a summary ships

1. **Accuracy:** every sentence checked against the LEB verses it describes; wrong or unsupported claims fixed or removed.
2. **Coverage and framing:** every reading covered in order; interpretation labeled; cross-references verified; no first person; format and length rules met.
3. After fixes, re-check the changed sentences.
