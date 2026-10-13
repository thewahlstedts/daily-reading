"""Print a plan week's readings from the bundled LEB, for writing and checking summaries.

Usage: python3 -I tools/week_text.py <week 1-52> [--refs]
Plan week N is readings 7(N-1) .. 7N-1 of plan.txt (one per line). Each verse is
printed as "<Book> <ch>:<v> <text>", so claims can be checked by reference.
Section headings (not Scripture) are dropped; psalm titles are kept.
--refs prints only the week's reading list.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CODES = {
    '1 Samuel': '1SA', '2 Samuel': '2SA', '1 Kings': '1KI', '2 Kings': '2KI', '1 Chronicles': '1CH',
    '2 Chronicles': '2CH', 'Ezra': 'EZR', 'Nehemiah': 'NEH', 'Esther': 'EST', 'Job': 'JOB', 'Psalm': 'PSA',
    'Ecclesiastes': 'ECC', 'Song of Solomon': 'SNG', 'Isaiah': 'ISA', 'Hosea': 'HOS', 'Haggai': 'HAG',
    'Malachi': 'MAL', 'Luke': 'LUK', 'Acts': 'ACT', 'Hebrews': 'HEB',
}


def readings(week):
    lines = [l.strip() for l in (ROOT / 'plan.txt').read_text().splitlines() if l.strip()]
    return lines[7 * (week - 1):7 * week]


def chapters(ref):
    m = re.match(r'^(.*\D)\s+(\d+)(?:-(\d+))?$', ref)
    book, a, b = m.group(1), int(m.group(2)), int(m.group(3) or m.group(2))
    return book, range(a, b + 1)


def verse_text(parts):
    out = []
    for p in parts:
        if isinstance(p, str):
            out.append(p)
        elif p[0] != 's':
            out.append(('[title] ' if p[0] == 'd' else '') + p[1])
    return ' '.join(x.strip() for x in out if x.strip())


def main():
    week = int(sys.argv[1])
    if not 1 <= week <= 52:
        sys.exit('week must be 1-52')
    refs = readings(week)
    if '--refs' in sys.argv:
        print('\n'.join(refs))
        return
    for ref in refs:
        book, chs = chapters(ref)
        data = json.loads((ROOT / 'bibles/leb' / f'{CODES[book]}.json').read_text())
        print(f'=== {ref} ===')
        for ch in chs:
            for v in data[str(ch)]:
                print(f'{book} {ch}:{v[0]} {verse_text(v[1:])}')
        print()


main()
