"""Read-only checks of imported Japanese media and the pre-import database."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess

from lib.japanese_audio import atomic_json, file_hash


def snapshot(db):
    c = sqlite3.connect(f'file:{Path(db).resolve()}?mode=ro', uri=True)
    c.execute('begin')
    result = {}
    try:
        for (name,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall():
            if name in {'media_assets', 'card_media'}:
                continue
            h, count = hashlib.sha256(), 0
            for row in c.execute('SELECT * FROM "' + name.replace('"', '""') + '" ORDER BY rowid'):
                h.update(repr(row).encode()); h.update(b'\n'); count += 1
            result[name] = dict(count=count, sha256=h.hexdigest())
        return result
    finally:
        c.close()


def preserved_media(db, backup):
    before = sqlite3.connect(f'file:{Path(backup).resolve()}?mode=ro', uri=True)
    after = sqlite3.connect(f'file:{Path(db).resolve()}?mode=ro', uri=True)
    try:
        counts = {}
        for table in ['media_assets', 'card_media']:
            rows = before.execute(f'SELECT * FROM {table}').fetchall()
            for row in rows:
                if after.execute(f'SELECT * FROM {table} WHERE id=?', (row[0],)).fetchone() != row:
                    raise ValueError('Pre-existing media or attachment changed during import')
            counts[table] = len(rows)
        return counts
    finally:
        before.close(); after.close()


def verify(db, batch, media_dir, report, base_url, output, node_bin='node'):
    batch, media_dir = Path(batch).resolve(), Path(media_dir).resolve()
    plan = json.loads((batch/'plan.json').read_text())
    manifest = json.loads(Path(report).read_text())
    if manifest['planHash'] != plan['planHash'] or not manifest['applied']:
        raise ValueError('Applied import and plan must match')
    c = sqlite3.connect(f'file:{Path(db).resolve()}?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    try:
        linked, total_bytes = 0, 0
        for record in manifest['records']:
            for target in record['cards']:
                if target['status'] != 'attached':
                    continue
                asset = c.execute("""SELECT m.* FROM card_media cm JOIN media_assets m ON m.id=cm.media_id
                    WHERE cm.id=? AND cm.card_id=? AND cm.media_id=? AND cm.side='back'""",
                    (target['linkId'], target['cardId'], target['mediaId'])).fetchone()
                if not asset or asset['sha256'] != record['sha256'] or asset['mime_type'] != 'audio/mpeg':
                    raise ValueError('Imported media link does not match its evidence')
                path = media_dir/asset['storage_key']
                if file_hash(path) != asset['sha256'] or path.stat().st_size != asset['bytes']:
                    raise ValueError('Production media bytes do not match')
                total_bytes += asset['bytes']; linked += 1
        if linked != manifest['newLinks']:
            raise ValueError('Import link count mismatch')
        targets = [target['cardId'] for row in plan['rows'] for target in row['cards']]
        expected_cards = plan.get('deckCardCount', plan['cardCount'])
        if 'deckCardCount' in plan:
            targets = [r[0] for r in c.execute("SELECT c.id FROM cards c JOIN words w ON w.id=c.word_id WHERE c.deck_id=? AND w.language='ja'", (plan['deckId'],))]
            if len(targets) != expected_cards:
                raise ValueError('Japanese deck card count changed during generation')
        slots = ','.join('?' for _ in targets)
        covered = c.execute(f"SELECT COUNT(DISTINCT card_id) FROM card_media WHERE card_id IN ({slots}) AND side='back'", targets).fetchone()[0]
        media_totals = c.execute(f"""SELECT COUNT(*), COALESCE(SUM(bytes),0) FROM media_assets WHERE id IN
            (SELECT media_id FROM card_media WHERE card_id IN ({slots}) AND side='back')""", targets).fetchone()
        for asset in c.execute(f"""SELECT * FROM media_assets WHERE id IN
            (SELECT media_id FROM card_media WHERE card_id IN ({slots}) AND side='back')""", targets):
            path = media_dir/asset['storage_key']
            if not path.is_file() or file_hash(path) != asset['sha256'] or path.stat().st_size != asset['bytes']:
                raise ValueError('A Japanese back audio file is missing or corrupt')
        autoplay = c.execute('SELECT audio_autoplay FROM deck_settings WHERE deck_id=?', (plan['deckId'],)).fetchone()[0]
    finally:
        c.close()
    before, after = snapshot(manifest['backup']), snapshot(db)
    changed = [name for name in set(before)|set(after) if before.get(name) != after.get(name)]
    if changed:
        raise ValueError('Non-media tables differ from backup: ' + ', '.join(sorted(changed)))
    previous_media = preserved_media(db, manifest['backup'])
    model_counts = Counter(manifest['evidence'][str(record['wordId'])]['model'] for record in manifest['records']
                           for target in record['cards'] if target['status'] == 'attached')
    browser = subprocess.run([node_bin, str(Path(__file__).parent/'tests/japanese-audio-browser.cjs'), base_url, str(report)],
                             check=True, capture_output=True, text=True)
    result = dict(status='complete' if covered == expected_cards else 'partial_waiting_for_quota',
        planHash=plan['planHash'], expectedCards=expected_cards, scopeCards=plan['cardCount'], cardsWithBackAudio=covered,
        remaining=expected_cards-covered, importedThisBatch=linked, importedBytesThisBatch=total_bytes,
        totalBackAudioAssets=media_totals[0], totalBackAudioBytes=media_totals[1],
        unchangedPreviousMedia=previous_media, modelsUsedThisBatch=dict(model_counts),
        audioAutoplay=bool(autoplay), unchangedNonMediaTables=after, browser=browser.stdout.strip(),
        backup=manifest['backup'], journal=manifest['journal'], config=plan['config'], pitchAccentCertified=False)
    atomic_json(output, result)
    print(json.dumps({k:v for k,v in result.items() if k not in {'unchangedNonMediaTables','config'}}, ensure_ascii=False))
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for arg in ['db', 'batch', 'media-dir', 'report', 'base-url', 'output']:
        p.add_argument('--'+arg, required=True)
    p.add_argument('--node-bin', default='node', help='Explicit Node executable for services without a shell PATH')
    a = p.parse_args()
    verify(a.db, a.batch, a.media_dir, a.report, a.base_url, a.output, a.node_bin)
