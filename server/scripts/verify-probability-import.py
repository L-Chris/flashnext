"""Compare every old row/column and constrain all additions to one probability import."""
import argparse
import json
from pathlib import Path
import sqlite3


def verify(before_path, after_path, manifest):
    before = sqlite3.connect(f'file:{Path(before_path).resolve()}?mode=ro', uri=True)
    after = sqlite3.connect(f'file:{Path(after_path).resolve()}?mode=ro', uri=True)
    before.row_factory = after.row_factory = sqlite3.Row
    try:
        assert manifest['applied'] and manifest['datasetId'] == 'probability-high-school'
        deck_id, cards = manifest['deckId'], set(manifest['cardIds'])
        entities = {r[0] for r in after.execute('SELECT id FROM knowledge_entities WHERE canonical_key IN ('+
                    ','.join('?' for _ in manifest['entityKeys'])+')', manifest['entityKeys'])}
        assert len(entities) == len(cards) == 24
        additions = {
            'decks': lambda row: row['id'] == deck_id and row['subject'] == 'probability' and row['language'] == 'zh',
            'cards': lambda row: row['id'] in cards and row['deck_id'] == deck_id and row['word_id'] is None
                and row['knowledge_entity_id'] in entities and row['content_format'] == 'markdown_math',
            'knowledge_entities': lambda row: row['id'] in entities and row['kind'] == 'math_concept',
            'knowledge_tags': lambda row: row['entity_id'] in entities and row['scheme'] in {'education-stage', 'probability-topic'},
            'deck_settings': lambda row: row['deck_id'] == deck_id,
            'deck_fsrs_params': lambda row: row['deck_id'] == deck_id,
        }
        defaults = {'cards': {'learning_order': None, 'knowledge_entity_id': None},
                    'decks': {'subject': ''}, 'knowledge_entities': {'metadata': '{}'}}
        old_tables = {r[0] for r in before.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        new_tables = {r[0] for r in after.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        assert not old_tables-new_tables
        assert new_tables-old_tables <= {'knowledge_tags'}
        results = {}
        for table in sorted(new_tables):
            info = before.execute(f'PRAGMA table_info("{table}")').fetchall() if table in old_tables else []
            columns = [r['name'] for r in info]
            primary = [r['name'] for r in sorted(info, key=lambda r: r['pk']) if r['pk']]
            current = [dict(row) for row in after.execute(f'SELECT * FROM "{table}"')]
            original = [dict(row) for row in before.execute(f'SELECT * FROM "{table}"')] if info else []
            identity = lambda row: tuple(row[k] for k in primary)
            old_by_key = {identity(row): row for row in original}
            seen, new = set(), []
            for row in current:
                key = identity(row)
                if key in old_by_key:
                    assert {k: row[k] for k in columns} == old_by_key[key], (table, key, 'old column changed')
                    for column, value in defaults.get(table, {}).items():
                        if column not in columns:assert row[column] == value, (table, key, column)
                    seen.add(key)
                else:
                    assert table in additions and additions[table](row), (table, 'unexpected addition')
                    new.append(row)
            assert seen == set(old_by_key), (table, 'old row missing')
            results[table] = dict(preservedRows=len(original), addedRows=len(new))
        assert after.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not after.execute('PRAGMA foreign_key_check').fetchall()
        assert after.execute('SELECT COUNT(*) FROM cards WHERE deck_id=?', (deck_id,)).fetchone()[0] == 24
        return dict(status='passed', deckId=deck_id, cards=24, tables=results,
                    oldRowsAndColumnsUnchanged=True, integrityOk=True, foreignKeysOk=True)
    finally:
        before.close(); after.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['before', 'after', 'manifest', 'output']:parser.add_argument('--'+key, required=True)
    args = parser.parse_args()
    result = verify(args.before, args.after, json.loads(Path(args.manifest).read_text()))
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'tables'}))
