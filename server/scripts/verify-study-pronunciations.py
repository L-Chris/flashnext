"""Verify scoped IPA changes and every protected table/column against a backup."""
import argparse
import json
from pathlib import Path
import sqlite3
from lib.study_pronunciations import atomic_json, system_back, SOURCE
from lib.pronunciation import PROFILE

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--before', required=True)
p.add_argument('--after', required=True)
p.add_argument('--plan', required=True, type=Path)
p.add_argument('--report', required=True, type=Path)
a = p.parse_args()
plan = json.loads(a.plan.read_text())
approved = {w['wordId']: w for w in plan['words']}
before = sqlite3.connect(f'file:{Path(a.before).resolve()}?mode=ro', uri=True)
after = sqlite3.connect(f'file:{Path(a.after).resolve()}?mode=ro', uri=True)
before.row_factory = after.row_factory = sqlite3.Row
report = {'scopeWords': len(plan['scopeWordIds']), 'verifiedWords': len(approved),
          'pendingWords': len(plan['scopeWordIds'])-len(approved), 'tables': {}, 'changedWords': 0, 'changedCards': 0}
for (table,) in before.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
    old = [dict(r) for r in before.execute(f'SELECT * FROM "{table}" ORDER BY 1')]
    new = [dict(r) for r in after.execute(f'SELECT * FROM "{table}" ORDER BY 1')]
    if table == 'word_pronunciations':
        new_by_id = {r['id']: r for r in new}
        for r in old:
            updated = new_by_id.pop(r['id'])
            if r['word_id'] in approved:
                assert all(r[k] == updated[k] for k in r if k != 'status'), (table, r['id'])
            else:
                assert r == updated, (table, r['id'])
        assert all(r['word_id'] in approved and r['source'] == SOURCE and r['status'] == 'accepted' and r['accent'] == 'UK' for r in new_by_id.values())
        report['newPronunciations'] = len(new_by_id)
    else:
        assert len(old) == len(new), (table, 'row count changed')
        for r, updated in zip(old, new):
            skip = set()
            if table == 'words' and r['id'] in approved:
                item = approved[r['id']]
                assert updated['phonetic'] == item['primary'] and updated['phonetic_profile'] == PROFILE
                assert updated['phonetic_legacy'] == r['phonetic_legacy'] or (r['phonetic_legacy'] is None and updated['phonetic_legacy'] == r['phonetic'])
                skip = {'phonetic', 'phonetic_legacy', 'phonetic_profile'}
                report['changedWords'] += r != updated
            elif table == 'cards' and r != updated:
                original_word = before.execute('SELECT * FROM words WHERE id=?', (r['word_id'],)).fetchone()
                assert r['word_id'] in approved and r['front'] == original_word['headword']
                assert r['back'] in {system_back(original_word['phonetic'], original_word['translation']),
                                     (f"/{original_word['phonetic']}/\n" if original_word['phonetic'] else '') + original_word['translation']}
                assert updated['back'] == system_back(approved[r['word_id']]['primary'], original_word['translation'])
                skip = {'back'}
                report['changedCards'] += 1
            elif table == 'ielts_usages' and r != updated:
                assert r['word_id'] in approved
                assert updated['phonetic_legacy'] == (r['phonetic_legacy'] if r['phonetic_legacy'] is not None else r['phonetic'])
                skip = {'phonetic', 'phonetic_legacy', 'phonetic_profile'}
            assert all(r[k] == updated[k] for k in r if k not in skip), (table, r.get('id'), 'protected fields changed')
    report['tables'][table] = {'before': len(old), 'after': len(new), 'protectedColumnsUnchanged': True}
assert not after.execute('PRAGMA foreign_key_check').fetchall()
assert after.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
report['foreignKeysOk'] = report['integrityOk'] = True
atomic_json(a.report, report)
print(json.dumps({k: v for k, v in report.items() if k != 'tables'}))
