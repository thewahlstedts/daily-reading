"""Convert a SWORD Bible module into per-book JSON for the app.

Usage: python -I tools/sword_to_json.py <sword-library-dir> <MODULE> <out-dir>
Writes <out-dir>/<USFM>.json = {"<chapter>": [[verse, "text"], ...], ...}
Headings, footnotes and other markup are dropped; only verse text is kept.
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

DROP = re.compile(r'<(note|title)\b[^>]*>.*?</\1>', re.S)   # footnotes, headings, psalm titles
TAG = re.compile(r'<[^>]+>')


def clean(raw):
    text = DROP.sub(' ', raw)
    text = TAG.sub(' ', text)
    text = html.unescape(text)
    text = TAG.sub(' ', text)  # stray escaped markers in some sources, e.g. &lt;block&gt;
    text = re.sub(r'\s+([,.;:!?’”)\]])', r'\1', text)  # no space before punctuation
    return re.sub(r'\s+', ' ', text).strip()


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
                for v in range(1, count + 1):
                    text = clean(bible.get(books=[book.osis_name], chapters=[c], verses=[v], clean=False))
                    if text:
                        verses.append([v, text])
                if verses:
                    chapters[str(c)] = verses
                    total += len(verses)
            with open(os.path.join(out_dir, f'{code}.json'), 'w', encoding='utf-8') as f:
                json.dump(chapters, f, ensure_ascii=False, separators=(',', ':'))
    print('verses written:', total)


if __name__ == '__main__':
    main(*sys.argv[1:4])
