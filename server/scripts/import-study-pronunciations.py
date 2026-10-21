"""Import a reviewed, scoped IPA plan. Dry-run by default; learning fields are protected."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
from lib.study_pronunciations import SOURCE, atomic_json, display_ipa, system_back, word_poses
from lib.pronunciation import PROFILE


def authorize(action, table, column, database, trigger):
    if action == sqlite3.SQLITE_UPDATE:
        allowed = {'words': {'phonetic', 'phonetic_legacy', 'phonetic_profile'}, 'cards': {'back'},
                   'ielts_usages': {'phonetic', 'phonetic_legacy', 'phonetic_profile'}}
        if table != 'word_pronunciations' and column not in allowed.get(table, set()):
            return sqlite3.SQLITE_DENY
    if action in {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_DELETE} and table not in {'word_pronunciations', 'sqlite_sequence'}:
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def apply_plan(db, plan, apply=False, backup=None):
    scope_ids = set(plan['scopeWordIds'])
    rows = plan['words']
    assert len({w['wordId'] for w in rows}) == len(rows), 'Duplicate words'
    assert all(w['wordId'] in scope_ids for w in rows), 'Word outside frozen scope'
    report = {'applied': apply, 'scopeWords': len(scope_ids), 'reviewedWords': len(rows), 'changedWords': [],
              'changedCards': [], 'changedIeltsUsages': [], 'preservedCustomCards': [], 'pronunciationChanges': 0}
    c = sqlite3.connect(f'file:{Path(db).resolve()}?mode={"rw" if apply else "ro"}', uri=True, timeout=30)
    c.row_factory = sqlite3.Row
    try:
        c.execute('PRAGMA foreign_keys=ON')
        if apply:
            if not backup or Path(backup).resolve() == Path(db).resolve():
                raise ValueError('A separate, new backup path is required')
            Path(backup).parent.mkdir(parents=True, exist_ok=True)
            with Path(backup).open('xb'):
                pass
            with sqlite3.connect(backup) as dest:
                c.backup(dest)
        c.execute('BEGIN IMMEDIATE' if apply else 'BEGIN')
        c.set_authorizer(authorize)
        for item in rows:
            w = c.execute("SELECT * FROM words WHERE id=? AND language='en'", (item['wordId'],)).fetchone()
            if not w or w['headword'] != item['headword']:
                raise ValueError('Word identity changed')
            expected = item['expected']
            for key in ['lexical_key', 'pos', 'translation']:
                if w[key] != expected[key]:
                    raise ValueError('Word content changed; regenerate plan: ' + w['headword'])
            primary = item['primary']
            display_ipa('/' + primary + '/')
            unchanged = w['phonetic'] == primary and w['phonetic_profile'] == PROFILE
            if not unchanged and any(w[k] != expected[k] for k in ['phonetic', 'phonetic_profile']):
                raise ValueError('Pronunciation changed since audit: ' + w['headword'])
            pronunciations = item['pronunciations']
            assert pronunciations and primary in {p['ipa'] for p in pronunciations}
            accepted_keys = set()
            for p in pronunciations:
                display_ipa('/' + p['ipa'] + '/')
                assert p['reference'].startswith(('https://www.oxfordlearnersdictionaries.com/', 'https://dictionary.cambridge.org/', 'https://www.collinsdictionary.com/', 'local-kaikki:'))
                identity = dict(word=w['headword'], pos=p['pos'], ipa=p['ipa'], usage=p['usage'], reference=p['reference'])
                key = SOURCE + ':' + hashlib.sha256(json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                accepted_keys.add(key)
                values = (w['id'], key, SOURCE, '2026-10-21', p['pos'], p['usage'], 'UK', p.get('raw', p['ipa']), p['ipa'], 'accepted', p['reference'])
                old = c.execute('SELECT * FROM word_pronunciations WHERE source_key=?', (key,)).fetchone()
                if not old or old['display_ipa'] != p['ipa'] or old['status'] != 'accepted':
                    report['pronunciationChanges'] += 1
                    if apply:
                        c.execute('''INSERT INTO word_pronunciations(word_id,source_key,source,revision,pos,usage,accent,raw_ipa,display_ipa,status,note)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET display_ipa=excluded.display_ipa,status=excluded.status,note=excluded.note''', values)
            # Keep original evidence, but don't display superseded automatic or stale readings.
            for old in c.execute("SELECT * FROM word_pronunciations WHERE word_id=? AND status='accepted'", (w['id'],)).fetchall():
                if old['source_key'] not in accepted_keys:
                    report['pronunciationChanges'] += 1
                    if apply:
                        c.execute("UPDATE word_pronunciations SET status='review' WHERE id=?", (old['id'],))
            if not unchanged:
                report['changedWords'].append({'wordId': w['id'], 'word': w['headword'], 'old': w['phonetic'], 'new': primary, 'oldProfile': w['phonetic_profile']})
                old_backs = {system_back(w['phonetic'], w['translation']), (f"/{w['phonetic']}/\n" if w['phonetic'] else '') + w['translation']}
                new_back = system_back(primary, w['translation'])
                for card in c.execute('SELECT id,front,back FROM cards WHERE word_id=?', (w['id'],)):
                    if card['front'] == w['headword'] and card['back'] in old_backs:
                        if card['back'] != new_back:
                            report['changedCards'].append(card['id'])
                            if apply:
                                c.execute('UPDATE cards SET back=? WHERE id=?', (new_back, card['id']))
                    else:
                        report['preservedCustomCards'].append(card['id'])
                if apply:
                    c.execute('UPDATE words SET phonetic_legacy=COALESCE(phonetic_legacy,phonetic),phonetic=?,phonetic_profile=? WHERE id=?', (primary, PROFILE, w['id']))
            for u in c.execute('SELECT * FROM ielts_usages WHERE word_id=?', (w['id'],)).fetchall():
                poses = word_poses(u['pos'])
                candidates = {p['ipa'] for p in pronunciations if p['pos'] in poses}
                if len(candidates) == 1:
                    value = next(iter(candidates))
                    if u['phonetic'] != value or u['phonetic_profile'] != PROFILE:
                        report['changedIeltsUsages'].append({'id': u['id'], 'old': u['phonetic'], 'new': value})
                        if apply:
                            c.execute('UPDATE ielts_usages SET phonetic_legacy=COALESCE(phonetic_legacy,phonetic),phonetic=?,phonetic_profile=? WHERE id=?', (value, PROFILE, u['id']))
        c.commit() if apply else c.rollback()
        return report
    finally:
        c.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backup')
    a = parser.parse_args()
    report = apply_plan(a.db, json.loads(a.input.read_text()), a.apply, a.backup)
    atomic_json(a.report, report)
    print(json.dumps({k: len(v) if isinstance(v, list) else v for k, v in report.items()}))
