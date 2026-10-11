"""Convert a SWORD Bible module into per-book JSON for the app.

Usage: python -I tools/sword_to_json.py <sword-library-dir> <MODULE> <out-dir>
Writes <out-dir>/<USFM>.json = {"<chapter>": [[verse, part, ...], ...], ...}
Each part is a string (continues the current paragraph or line) or [kind, "text"]
for what starts there: "p" paragraph, "q1"-"q3" poetry line at that indent,
"b" stanza break (empty text), "s" section heading, "d" psalm title.
Footnotes and other markup are dropped.
Requires: pip install pysword==0.2.8 (use a throwaway venv).
"""
import html
import json
import os
import re
import sys

from pysword.modules import SwordModules

OSIS_TO_USFM = {
    'Gen': 'GEN', 'Exod': 'EXO', 'Lev': 'LEV', 'Num': 'NUM', 'Deut': 'DEU', 'Josh': 'JOS', 'Judg': 'JDG', 'Ruth': 'RUT',
    '1Sam': '1SA', '2Sam': '2SA', '1Kgs': '1KI', '2Kgs': '2KI', '1Chr': '1CH', '2Chr': '2CH', 'Ezra': 'EZR', 'Neh': 'NEH',
    'Esth': 'EST', 'Job': 'JOB', 'Ps': 'PSA', 'Prov': 'PRO', 'Eccl': 'ECC', 'Song': 'SNG', 'Isa': 'ISA', 'Jer': 'JER',
    'Lam': 'LAM', 'Ezek': 'EZK', 'Dan': 'DAN', 'Hos': 'HOS', 'Joel': 'JOL', 'Amos': 'AMO', 'Obad': 'OBA', 'Jonah': 'JON',
    'Mic': 'MIC', 'Nah': 'NAM', 'Hab': 'HAB', 'Zeph': 'ZEP', 'Hag': 'HAG', 'Zech': 'ZEC', 'Mal': 'MAL',
    'Matt': 'MAT', 'Mark': 'MRK', 'Luke': 'LUK', 'John': 'JHN', 'Acts': 'ACT', 'Rom': 'ROM', '1Cor': '1CO', '2Cor': '2CO',
    'Gal': 'GAL', 'Eph': 'EPH', 'Phil': 'PHP', 'Col': 'COL', '1Thess': '1TH', '2Thess': '2TH', '1Tim': '1TI', '2Tim': '2TI',
    'Titus': 'TIT', 'Phlm': 'PHM', 'Heb': 'HEB', 'Jas': 'JAS', '1Pet': '1PE', '2Pet': '2PE', '1John': '1JN', '2John': '2JN',
    '3John': '3JN', 'Jude': 'JUD', 'Rev': 'REV',
}

NOTE = re.compile(r'<note\b[^>]*>.*?</note>', re.S)
TOKEN = re.compile(r'<title\b([^>]*)>(.*?)</title>|<(\w+)\b([^>]*?)/?>|</\w+>|([^<]+)', re.S)
TAG = re.compile(r'<[^>]+>')


def clean(text):
    text = html.unescape(TAG.sub(' ', text))
    text = TAG.sub(' ', text)  # stray escaped markers in some sources, e.g. &lt;block&gt;
    text = re.sub(r'\s+([,.;:!?’”)\]])', r'\1', text)  # no space before punctuation
    return re.sub(r'\s+', ' ', text).strip()


class Chapter:
    """Turns one chapter's OSIS milestones (which cross verse boundaries) into verse parts."""

    def __init__(self):
        self.brk = 'p'        # what the next text starts: '' continues, 'p' paragraph, 'qN' line
        self.stanza = False   # a line group opened after earlier poetry: gap before the next line
        self.poetry = False

    def verse(self, raw):
        parts = []
        for title_attrs, title, tag, attrs, text in TOKEN.findall(NOTE.sub('', raw)):
            if title:
                heading = clean(title)
                if heading:
                    parts.append(['d' if 'type="psalm"' in title_attrs else 's', heading])
            elif tag == 'div' and 'type="x-p"' in attrs and 'sID=' in attrs:
                self.brk = 'p'
            elif tag == 'lg' and 'sID=' in attrs:
                self.stanza = self.poetry
            elif tag == 'l' and 'sID=' in attrs:
                level = re.search(r'level="(\d)"', attrs)
                self.brk = f'q{min(int(level.group(1)) if level else 1, 3)}'
            elif tag == 'l' and 'eID=' in attrs:
                self.brk = 'p'  # prose after a line that isn't followed by another one
            elif text.strip() or (text and not self.brk and parts):
                self.add(parts, text)
        return [clean(p) if isinstance(p, str) else [p[0], clean(p[1])] for p in parts]

    def add(self, parts, text):
        if self.brk:
            if self.brk.startswith('q'):
                if self.stanza:
                    parts.append(['b', ''])
                self.poetry, self.stanza = True, False
            else:
                self.poetry = self.stanza = False
            parts.append([self.brk, text])
            self.brk = ''
        elif parts and isinstance(parts[-1], str):
            parts[-1] += text
        elif parts and parts[-1][0] not in ('s', 'd', 'b'):
            parts[-1][1] += text
        elif text.strip():
            parts.append(text)


def main(library, module, out_dir):
    mods = SwordModules(library)
    mods.parse_modules()
    bible = mods.get_bible_from_module(module)
    books = bible.get_structure().get_books()
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for testament in ('ot', 'nt'):
        for book in books.get(testament, []):
            code = OSIS_TO_USFM.get(book.osis_name)
            if not code:
                print('skip', book.osis_name)
                continue
            chapters = {}
            for c, count in enumerate(book.chapter_lengths, start=1):
                verses = []
                state = Chapter()
                for v in range(1, count + 1):
                    parts = state.verse(bible.get(books=[book.osis_name], chapters=[c], verses=[v], clean=False))
                    if any(isinstance(p, str) or p[0] not in ('s', 'd', 'b') for p in parts):
                        verses.append([v, *parts])
                if verses:
                    chapters[str(c)] = verses
                    total += len(verses)
            with open(os.path.join(out_dir, f'{code}.json'), 'w', encoding='utf-8') as f:
                json.dump(chapters, f, ensure_ascii=False, separators=(',', ':'))
    print('verses written:', total)


if __name__ == '__main__':
    main(*sys.argv[1:4])
