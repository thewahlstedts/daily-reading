#!/usr/bin/env python3
"""Narrate the bundled LEB with Kokoro: one AAC file per chapter plus per-verse start times.

Output, per chapter (same timings shape as HelloAO's *.audioTimings.json):
  OUT/<BOOK>/<chapter>.m4a
  OUT/<BOOK>/<chapter>.json   {"verses": [start seconds of verse 1, verse 2, ...]}

By default only the chapters in plan.txt are narrated; --all does the whole LEB.
Finished chapters are skipped, so it can be stopped and restarted at any time.

Setup, once (in a venv outside the repo; espeak-ng from Homebrew because the copy
bundled with misaki can't find its data on macOS):
  brew install espeak-ng
  uv venv --python 3.12 ~/.local/share/daily-reading/kokoro-venv
  VIRTUAL_ENV=~/.local/share/daily-reading/kokoro-venv uv pip install kokoro==0.9.4 soundfile \
    "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"

Run from the repo root (caffeinate keeps the Mac awake):
  caffeinate -i ~/.local/share/daily-reading/kokoro-venv/bin/python -I tools/narrate_leb.py ~/leb-audio
  ... --only 1SA.30 PSA.23   # just these chapters
"""
import argparse
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


def clean(text):
    # LEB marks idioms ⌞like this⌟ and doubtful passages 〚like this〛; neither should be read.
    return re.sub(r'\s+', ' ', re.sub('[⌞⌟〚〛]', '', text)).strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('out', help='output folder (outside the repo)')
    ap.add_argument('--voice', default='am_michael')
    ap.add_argument('--speed', type=float, default=1.0)
    ap.add_argument('--bitrate', type=int, default=32000, help='AAC bitrate, bits/second')
    ap.add_argument('--device', default='cpu', help='cpu was fastest on an M4; mps works too')
    ap.add_argument('--all', action='store_true', help='narrate every LEB chapter, not just the plan')
    ap.add_argument('--only', nargs='+', metavar='BOOK.CH', help='e.g. 1SA.30 PSA.23')
    args = ap.parse_args()

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
        for n, text in verses:
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
        os.makedirs(folder, exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, 'chapter.wav')
            sf.write(wav, audio, RATE)
            m4a = os.path.join(tmp, 'chapter.m4a')
            subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', str(args.bitrate), wav, m4a], check=True)
            os.replace(m4a, os.path.join(folder, f'{c}.m4a'))
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
