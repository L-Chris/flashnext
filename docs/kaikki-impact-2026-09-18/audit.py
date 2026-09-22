"""Read-only scan of the local dictionary and current database; never imports data."""
import collections
import hashlib
import json
import re
import sqlite3
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
DATA = ROOT / 'server/scripts/data'
SAMPLES = set('environment issue address bank mantle crust hydrosphere lithosphere resume résumé bow cricket mean permit record run apple undertake shade-tolerant'.split()) | {
    'El Niño', 'El Nino', 'carbon dioxide', 'hybridisation', 'hybridization', 'jeopardise', 'jeopardize',
    'tyre', 'tire', 'Pacific', 'pacific', 'surprising', 'organise', 'organization', 'organisation',
}
db = sqlite3.connect(f'file:{ROOT}/server/data/flashnext.db?mode=ro', uri=True)
db.row_factory = sqlite3.Row
words = {r['headword']: dict(r) for r in db.execute('select * from words')}
groups = {'all': set(words), 'cards': {r[0] for r in db.execute('select distinct w.headword from words w join cards c on c.word_id=w.id')}}
for scheme in ['coca', 'cet', 'ielts']:
    groups[scheme] = {r[0] for r in db.execute('select w.headword from words w join word_tags t on w.id=t.word_id where t.scheme=?', (scheme,))}
groups['ielts_file'] = set((DATA / 'ielts.txt').read_text().splitlines())
wanted = set(words) | groups['ielts_file'] | SAMPLES
lower_wanted = {w.lower() for w in wanted}
flags = collections.defaultdict(set)
stats = collections.Counter()
sample_records = collections.defaultdict(list)
case_variants = collections.defaultdict(set)
zh_codes = {'zh', 'zh-Hans', 'zh-Hant', 'cmn'}
excluded_tags = {'archaic', 'obsolete', 'historical', 'dated', 'rare', 'nonstandard'}

def has_zh(translations):
    return any((t.get('code') or t.get('lang_code')) in zh_codes and t.get('word') for t in translations)

start = time.time()
digest = hashlib.sha256()
with (DATA / 'kaikki.org-dictionary-English.jsonl').open('rb') as f:
    for n, raw in enumerate(f, 1):
        digest.update(raw)
        e = json.loads(raw)
        w = e.get('word', '')
        if e.get('lang_code') != 'en' or w.lower() not in lower_wanted:
            continue
        case_variants[w.lower()].add(w)
        if w not in wanted:
            continue
        flags['matched'].add(w)
        if e.get('pos'): flags['pos'].add(w)
        if any(s.get('ipa') for s in e.get('sounds', [])): flags['ipa'].add(w)
        root_zh = has_zh(e.get('translations', []))
        if root_zh: flags['root_zh'].add(w)
        if w in SAMPLES: sample_records[w].append(e)
        for s in e.get('senses', []):
            stats['matched_senses'] += 1
            if s.get('glosses'): flags['gloss'].add(w)
            sense_zh = has_zh(s.get('translations', []))
            if sense_zh: flags['sense_zh'].add(w)
            if sense_zh or root_zh: flags['any_zh'].add(w)
            if s.get('examples'): flags['any_examples'].add(w)
            # A candidate filter, not a guarantee of pedagogical quality.
            canonical = not s.get('form_of') and not s.get('alt_of') and not excluded_tags.intersection(s.get('tags', []))
            if canonical and s.get('glosses'):
                flags['candidate_sense'].add(w)
                direct = [x for x in s.get('examples', []) if x.get('type') == 'example'
                          and 15 <= len(x.get('text', '')) <= 140
                          and not re.search(r'^(?:Holonyms|Synonyms|Antonyms|Hyponyms):', x.get('text', ''))]
                if direct: flags['direct_example_candidate'].add(w)
                if sense_zh: flags['candidate_sense_zh'].add(w)
                if direct and sense_zh: flags['same_sense_example_zh'].add(w)
        if n % 10000 == 0:
            print(f'scanned={n} matched={len(flags["matched"])} elapsed={time.time()-start:.1f}s', flush=True)

coverage = {name: {'total': len(keys), **{flag: len(keys & values) for flag, values in flags.items()}}
            for name, keys in groups.items()}
sample_view = {}
for w in sorted(SAMPLES):
    old = words.get(w)
    old_senses = [dict(r) for r in db.execute('select * from word_senses where word_id=? order by sense_idx', (old['id'],))] if old else []
    entries = sample_records[w]
    sample_view[w] = {'current_word': old, 'current_senses': old_senses,
                      'record_count': len(entries), 'pos': sorted({e.get('pos', '') for e in entries}),
                      'sense_count': sum(len(e.get('senses', [])) for e in entries),
                      'flags': [flag for flag, values in flags.items() if w in values]}
snap = DATA / 'kaikki-impact-2026-09-18'
snap.mkdir(exist_ok=True)
(snap / 'sample-records.json').write_text(json.dumps(sample_records, ensure_ascii=False))
result = {'file_bytes': (DATA / 'kaikki.org-dictionary-English.jsonl').stat().st_size,
          'sha256': digest.hexdigest(), 'lines': n, 'elapsed_seconds': round(time.time()-start, 1),
          'coverage': coverage, 'stats': stats,
          'missing_ielts': sorted(groups['ielts'] - flags['matched']),
          'ielts_case_only': {w: sorted(case_variants[w.lower()]) for w in groups['ielts'] - flags['matched'] if case_variants[w.lower()]},
          'samples': sample_view}
(OUT / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k:v for k,v in result.items() if k != 'samples'}, ensure_ascii=False, indent=2), flush=True)
