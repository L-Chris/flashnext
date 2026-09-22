"""Read-only vocabulary audit; snapshots live in ignored server/scripts/data.
Run: python3 docs/ielts-audit-2026-09-18/compare.py
"""
import collections
import csv
import difflib
import hashlib
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = OUT.parent.parent
DATA = ROOT / 'server/scripts/data'
SNAP = DATA / OUT.name
local = (DATA / 'ielts.txt').read_text().splitlines()
qwerty = [r['name'] for r in json.loads((SNAP / 'IELTSVocabularyBible.json').read_text())]
blog = json.loads((SNAP / 'blog-rows.json').read_text())
manual = []
chapter = ''
for line in (SNAP / 'vocabulary.txt').read_text().splitlines():
    if '|' in line:
        manual.append({'word': line.split('|')[0], 'chapter': chapter})
    elif line and line not in ('---', '+++'):
        chapter = line

def norm(word):
    # Only comparison equivalence; never rewrite local spellings or accent marks.
    return word.strip().lower().replace('ñ', 'n')

def csv_out(name, fields, rows):
    with (OUT / name).open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields, lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)

diffs = []
mapped = {}
for tag, i, j, k, l in difflib.SequenceMatcher(
    None, list(map(norm, qwerty)), [norm(r['word']) for r in blog], autojunk=False
).get_opcodes():
    if tag != 'equal':
        diffs.append({'operation': tag, 'qwerty_row': i + 1,
                      'qwerty': ' | '.join(qwerty[i:j]),
                      'blog': ' | '.join(r['word'] for r in blog[k:l]),
                      'chapter': ' | '.join(dict.fromkeys(r['chapter'] for r in blog[k:l]))})
    if j-i == l-k:
        for x, y in zip(range(i, j), range(k, l)):
            mapped[x] = blog[y]['chapter']
csv_out('reference-differences.csv', ['operation', 'qwerty_row', 'qwerty', 'blog', 'chapter'], diffs)
positions = collections.defaultdict(list)
for i, word in enumerate(qwerty):
    positions[word].append(i)
csv_out('duplicate-occurrences.csv', ['word', 'qwerty_rows', 'chapters'], [
    {'word': word, 'qwerty_rows': ', '.join(str(i+1) for i in ids),
     'chapters': ' | '.join(mapped.get(i, 'unmapped') for i in ids)}
    for word, ids in positions.items() if len(ids) > 1
])
csv_out('chapter-counts.csv', ['chapter', 'qwerty_occurrences', 'blog_occurrences'], [
    {'chapter': ch, 'qwerty_occurrences': sum(v == ch for v in mapped.values()),
     'blog_occurrences': sum(r['chapter'] == ch for r in blog)}
    for ch in dict.fromkeys(r['chapter'] for r in blog)
])
summary = {
    'local_lines': len(local), 'local_unique': len(set(local)),
    'qwerty_occurrences': len(qwerty), 'qwerty_unique': len(set(qwerty)),
    'exact_ordered_dedup_match': local == list(dict.fromkeys(qwerty)),
    'blog_occurrences': len(blog), 'manual_occurrences': len(manual),
    'manual_raw_headword_differences': {
        'local_only': sorted(set(map(norm, local)) - {norm(r['word'].split('/')[0]) for r in manual}),
        'manual_only': sorted({norm(r['word'].split('/')[0]) for r in manual} - set(map(norm, local))),
    },
    'sha256': {str(f.relative_to(ROOT)): hashlib.sha256(f.read_bytes()).hexdigest()
               for f in [DATA / 'ielts.txt', *sorted(SNAP.iterdir())] if f.is_file()},
}
(OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ('sha256', 'manual_raw_headword_differences')}, ensure_ascii=False, indent=2))
