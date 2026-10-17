#!/usr/bin/env python3
"""Narrate the bundled LEB with Kokoro: one AAC file per chapter plus per-verse start times.

Output, per chapter (same timings shape as HelloAO's *.audioTimings.json):
  OUT/<BOOK>/<chapter>.m4a
  OUT/<BOOK>/<chapter>.json   {"verses": [start seconds of verse 1, verse 2, ...]}

By default only the chapters in plan.txt are narrated; --all does the whole LEB.
Finished chapters are skipped, so it can be stopped and restarted at any time.

--summaries narrates summaries/week-NN.txt in the same voice instead:
  OUT/summaries/week-NN.m4a
  OUT/summaries/week-NN.json  {"paragraphs": [start seconds of each paragraph], "sha1": text hash}
A week is redone only when its text has changed (the hash differs).

Setup, once (in a venv outside the repo; espeak-ng from Homebrew because the copy
bundled with misaki can't find its data on macOS):
  brew install espeak-ng
  uv venv --python 3.12 ~/.local/share/daily-reading/kokoro-venv
  VIRTUAL_ENV=~/.local/share/daily-reading/kokoro-venv uv pip install kokoro==0.9.4 soundfile \
    "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"

Run from the repo root (caffeinate keeps the Mac awake):
  caffeinate -i ~/.local/share/daily-reading/kokoro-venv/bin/python -I tools/narrate_leb.py ~/leb-audio
  ... --only 1SA.30 PSA.23   # just these chapters
  ... --summaries [--only 7 12]   # week summaries (all, or just these weeks)

Upload (R2 bucket daily-reading-audio; chapters under leb/, summaries under summaries/):
  npx wrangler@4 r2 object put daily-reading-audio/leb/<BOOK>/<file> --file … --remote
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time

import numpy as np
import soundfile as sf

# Use Homebrew's espeak-ng (must be patched in before kokoro imports misaki).
import espeakng_loader
espeakng_loader.get_library_path = lambda: '/opt/homebrew/opt/espeak-ng/lib/libespeak-ng.dylib'
espeakng_loader.get_data_path = lambda: '/opt/homebrew/opt/espeak-ng/share/espeak-ng-data'
from kokoro import KPipeline  # noqa: E402

RATE = 24000
HEADING_PAUSE = 0.9  # seconds after "Genesis, chapter 1."
VERSE_PAUSE = 0.3


def book_codes():
    """Plan book names -> USFM codes, read from app.js so there's one source of truth."""
    src = open('app.js', encoding='utf-8').read()
    body = re.search(r'const BOOK_CODES = \{(.*?)\};', src, re.S).group(1)
    return {name.strip(): code for name, code in re.findall(r"'?([\w ]+?)'?: '(\w+)'", body)}


def plan_chapters(codes):
    seen = []
    for line in open('plan.txt', encoding='utf-8'):
        m = re.match(r'(.+?) (\d+)(?:-(\d+))?$', line.strip())
        if not m:
            continue
        for c in range(int(m[2]), int(m[3] or m[2]) + 1):
            if (codes[m[1]], c) not in seen:
                seen.append((codes[m[1]], c))
    return seen


def verse_text(parts):
    # Rows are [verse, part, ...]; skip stanza breaks, section headings and psalm titles.
    return ' '.join(p if isinstance(p, str) else p[1] for p in parts
                    if isinstance(p, str) or p[0] not in ('b', 's', 'd'))


def clean(text):
    # LEB marks idioms ⌞like this⌟ and doubtful passages 〚like this〛; neither should be read.
    return re.sub(r'\s+', ' ', re.sub('[⌞⌟〚〛]', '', text)).strip()


def spoken(text):
    # References as a narrator would read them: "Psalm 95:7-11" -> "Psalm 95, verses 7 to 11".
    text = re.sub(r'(\d+):(\d+)[-–](\d+)', r'\1, verses \2 to \3', text)
    text = re.sub(r'(\d+):(\d+)', r'\1, verse \2', text)
    return re.sub(r'(\d+)[-–](\d+)', r'\1 to \2', text)


def write_m4a(audio, path, bitrate):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'audio.wav')
        sf.write(wav, audio, RATE)
        m4a = os.path.join(tmp, 'audio.m4a')
        subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', str(bitrate), wav, m4a], check=True)
        os.replace(m4a, path)


def narrate_summaries(args, speak, silence):
    folder = os.path.join(args.out, 'summaries')
    weeks = [int(w) for w in args.only] if args.only else range(1, 53)
    todo = []
    for n in weeks:
        text = open(f'summaries/week-{n:02}.txt', encoding='utf-8').read()
        sha1 = hashlib.sha1(text.encode()).hexdigest()
        try:
            done = json.load(open(os.path.join(folder, f'week-{n:02}.json'))).get('sha1') == sha1
        except FileNotFoundError:
            done = False
        if not done:
            todo.append((n, text, sha1))
    if not todo:
        print('Nothing to do: every summary is narrated and up to date.')
        return
    began, total = time.time(), 0.0
    for k, (n, text, sha1) in enumerate(todo, 1):
        parts = [speak(f'Week {n}.'), silence(HEADING_PAUSE)]
        at = sum(len(p) for p in parts)
        starts = []
        for para in (p.strip() for p in re.split(r'\n\s*\n', text)):
            if not para:
                continue
            starts.append(round(at / RATE, 2))
            clip = speak(spoken(clean(para)))
            parts += [clip, silence(HEADING_PAUSE)]
            at += len(clip) + int(RATE * HEADING_PAUSE)
        audio = np.concatenate(parts)
        write_m4a(audio, os.path.join(folder, f'week-{n:02}.m4a'), args.bitrate)
        with open(os.path.join(folder, f'week-{n:02}.json'), 'w') as f:
            json.dump({'paragraphs': starts, 'sha1': sha1}, f, separators=(',', ':'))
        total += len(audio) / RATE
        print(f'[{k}/{len(todo)}] week {n}: {len(audio) / RATE / 60:.1f} min'
              f' · {total / (time.time() - began):.1f}x realtime', flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('out', help='output folder (outside the repo)')
    ap.add_argument('--voice', default='am_michael')
    ap.add_argument('--speed', type=float, default=1.0)
    ap.add_argument('--bitrate', type=int, default=32000, help='AAC bitrate, bits/second')
    ap.add_argument('--device', default='cpu', help='cpu was fastest on an M4; mps works too')
    ap.add_argument('--all', action='store_true', help='narrate every LEB chapter, not just the plan')
    ap.add_argument('--only', nargs='+', metavar='BOOK.CH', help='e.g. 1SA.30 PSA.23 (with --summaries: week numbers)')
    ap.add_argument('--summaries', action='store_true', help='narrate the week summaries instead')
    args = ap.parse_args()

    if args.summaries:
        pipe = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M', device=args.device)
        return narrate_summaries(
            args,
            lambda text: np.concatenate([r.audio.numpy() for r in pipe(text, voice=args.voice, speed=args.speed)]),
            lambda seconds: np.zeros(int(RATE * seconds), dtype=np.float32))

    codes = book_codes()
    names = {}
    for name, code in codes.items():
        names.setdefault(code, name)  # first listed wins: 'Psalm' before 'Psalms'
    books = {}

    def chapter(code, c):
        if code not in books:
            books[code] = json.load(open(f'bibles/leb/{code}.json', encoding='utf-8'))
        return books[code][str(c)]

    if args.only:
        todo = [(code, int(c)) for code, c in (x.split('.') for x in args.only)]
    elif args.all:
        todo = [(code, int(c)) for code in sorted(set(codes.values()))
                for c in json.load(open(f'bibles/leb/{code}.json', encoding='utf-8'))]
    else:
        todo = plan_chapters(codes)
    todo = [(code, c) for code, c in todo if not os.path.exists(os.path.join(args.out, code, f'{c}.json'))]
    if not todo:
        print('Nothing to do: every chapter is already narrated.')
        return

    pipe = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M', device=args.device)

    def speak(text):
        return np.concatenate([r.audio.numpy() for r in pipe(text, voice=args.voice, speed=args.speed)])

    def silence(seconds):
        return np.zeros(int(RATE * seconds), dtype=np.float32)

    began, spoken = time.time(), 0.0
    for k, (code, c) in enumerate(todo, 1):
        verses = chapter(code, c)
        parts = [speak(f'{names[code]}, chapter {c}.'), silence(HEADING_PAUSE)]
        at = sum(len(p) for p in parts)
        starts = []
        for n, *verse in verses:
            text = verse_text(verse)
            if n <= len(starts):
                sys.exit(f'{code} {c}: verse {n} is out of order')
            # Verses the LEB omits (e.g. Luke 17:36) share the next verse's start, so
            # starts[n - 1] stays verse n's time, as the app expects.
            while len(starts) < n:
                starts.append(round(at / RATE, 2))
            clip = speak(clean(text))
            parts += [clip, silence(VERSE_PAUSE)]
            at += len(clip) + int(RATE * VERSE_PAUSE)
        audio = np.concatenate(parts)

        folder = os.path.join(args.out, code)
        write_m4a(audio, os.path.join(folder, f'{c}.m4a'), args.bitrate)
        # Timings last: their presence marks the chapter as done.
        with open(os.path.join(folder, f'{c}.json'), 'w') as f:
            json.dump({'verses': starts}, f, separators=(',', ':'))

        spoken += len(audio) / RATE
        elapsed = time.time() - began
        left = elapsed / k * (len(todo) - k)
        print(f'[{k}/{len(todo)}] {code} {c}: {len(audio) / RATE / 60:.1f} min'
              f' · {spoken / elapsed:.1f}x realtime · ~{left / 60:.0f} min left', flush=True)


if __name__ == '__main__':
    main()
