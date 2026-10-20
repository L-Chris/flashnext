"""Attach a checked TTS batch without changing cards or learning data. Dry-run by default."""
import argparse
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import time
import uuid

from lib.japanese_audio import (VERSION, atomic_json, digest, file_hash, validate_result)


def audio_only_authorizer(action, table, column, database, trigger):
    if action in {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE} and table not in {'media_assets', 'card_media', 'sqlite_sequence'}:
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def check_identity(c, row):
    word = c.execute('SELECT * FROM words WHERE id=?', (row['wordId'],)).fetchone()
    fields = dict(lexical_key='lexicalKey', headword='headword', reading='reading', pos='pos', translation='translation')
    if not word or word['language'] != 'ja' or word['definition_status'] != 'ready' or any(word[k] != row[v] for k, v in fields.items()):
        raise ValueError(f"Word identity/reading changed: {row['wordId']}")
    for target in row['cards']:
        card = c.execute('SELECT word_id,deck_id FROM cards WHERE id=?', (target['cardId'],)).fetchone()
        deck = c.execute('SELECT language FROM decks WHERE id=?', (target['deckId'],)).fetchone()
        if not card or card['word_id'] != row['wordId'] or card['deck_id'] != target['deckId'] or not deck or deck['language'] != 'ja':
            raise ValueError(f"Card identity changed: {target['cardId']}")


def mp3_info(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
        'format=format_name,duration:stream=codec_name,sample_rate,channels', '-of', 'json', str(path)],
        check=True, capture_output=True, text=True)
    info = json.loads(result.stdout)
    streams = info.get('streams', [])
    if len(streams) != 1 or streams[0].get('codec_name') != 'mp3' or streams[0].get('channels') != 1 or streams[0].get('sample_rate') != '24000' or not .15 <= float(info['format']['duration']) <= 8:
        raise ValueError('Invalid or unexpected MP3 word audio')
    return info


def import_batch(db, batch, media_dir, report_path, apply=False, backup=None, limit=None, ready_only=False):
    if limit is not None and (not isinstance(limit, int) or isinstance(limit, bool) or limit < 1):
        raise ValueError('limit must be a positive integer')
    db, batch, media_dir = Path(db).resolve(), Path(batch).resolve(), Path(media_dir).resolve()
    plan = json.loads((batch / 'plan.json').read_text())
    expected_hash = plan.pop('planHash')
    if plan['version'] != VERSION or digest(plan) != expected_hash:
        raise ValueError('Invalid or changed batch plan')
    rows = plan['rows'][:limit] if limit else plan['rows']
    if ready_only:
        selected = []
        for row in rows:
            path = batch / 'results' / f"{row['wordId']}.json"
            if path.is_file() and json.loads(path.read_text()).get('status') == 'accepted':
                selected.append(row)
        rows = selected
    if not rows or len({r['wordId'] for r in rows}) != len(rows):
        raise ValueError('Empty plan or duplicate words')
    card_ids = [t['cardId'] for r in rows for t in r['cards']]
    if len(card_ids) != len(set(card_ids)):
        raise ValueError('Duplicate target cards')
    c = sqlite3.connect(f'file:{db}?mode={"rw" if apply else "ro"}', uri=True, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    artifacts = {}
    staged = {}
    committed = False
    owned_paths = set()
    journal = None
    result = dict(version=VERSION, applied=False, planHash=expected_hash, selectedCards=len(card_ids), readyOnly=ready_only,
                  newAssets=0, newLinks=0, skippedExistingBackAudio=0, reusedAssets=0, records=[])
    try:
        # Validate every artifact and identity before creating any files or rows.
        c.execute('begin')
        for row in rows:
            check_identity(c, row)
            value = json.loads((batch / 'results' / f"{row['wordId']}.json").read_text())
            audio = validate_result(row, plan['config'], batch, value)
            if value['wordId'] != row['wordId'] or value['reading'] != row['reading'] or value['bytes'] != audio.stat().st_size:
                raise ValueError('Audio identity or length does not match its evidence')
            mp3_info(audio)
            artifacts[row['wordId']] = (value, audio)
        c.rollback()
        if apply:
            if not backup:
                raise ValueError('--backup is required when applying an audio import')
            backup = Path(backup).resolve()
            backup.parent.mkdir(parents=True, exist_ok=True)
            with backup.open('xb'):
                pass
            with sqlite3.connect(backup) as target:
                c.backup(target)
            media_dir.mkdir(parents=True, exist_ok=True)
            for value, audio in artifacts.values():
                if value['sha256'] in staged:
                    continue
                media_id = str(uuid.uuid4())
                storage_key = media_id + '.mp3'
                destination = media_dir / storage_key
                # Random exclusive file names, verified bytes and fsync before DB commit.
                with audio.open('rb') as src, destination.open('xb') as dst:
                    staged[value['sha256']] = dict(id=media_id, storageKey=storage_key, path=destination)
                    shutil.copyfileobj(src, dst)
                    dst.flush()
                    os.fsync(dst.fileno())
                if file_hash(destination) != value['sha256']:
                    raise ValueError('Audio changed during staging')
        c.set_authorizer(audio_only_authorizer)
        c.execute('begin immediate' if apply else 'begin')
        predicted_assets = set()
        for row in rows:
            check_identity(c, row)
            value, audio = artifacts[row['wordId']]
            record = dict(wordId=row['wordId'], lexicalKey=row['lexicalKey'], headword=row['headword'],
                          reading=row['reading'], sha256=value['sha256'], evidenceFile=str((batch / 'results' / f"{row['wordId']}.json").relative_to(batch)), cards=[])
            for target in row['cards']:
                existing = c.execute('SELECT * FROM card_media WHERE card_id=?', (target['cardId'],)).fetchall()
                backs = [r for r in existing if r['side'] == 'back']
                if backs:
                    result['skippedExistingBackAudio'] += 1
                    record['cards'].append(dict(cardId=target['cardId'], status='existing_back_audio'))
                    continue
                if len(existing) >= 20:
                    raise ValueError('Card already has the maximum number of media attachments')
                asset = c.execute('SELECT * FROM media_assets WHERE sha256=?', (value['sha256'],)).fetchone()
                if asset:
                    asset_path = media_dir / asset['storage_key']
                    if asset['bytes'] != audio.stat().st_size or not asset_path.is_file() or file_hash(asset_path) != asset['sha256']:
                        raise ValueError('An existing shared audio asset is missing or corrupt')
                    media_id = asset['id']
                    result['reusedAssets'] += 1
                else:
                    if value['sha256'] in predicted_assets:
                        result['reusedAssets'] += 1
                    else:
                        result['newAssets'] += 1
                        predicted_assets.add(value['sha256'])
                    media_id = staged[value['sha256']]['id'] if apply else 'dry-run-' + value['sha256']
                    if apply:
                        asset_info = staged[value['sha256']]
                        c.execute('INSERT INTO media_assets(id,storage_key,sha256,mime_type,bytes,original_name,created_at) VALUES (?,?,?,?,?,?,?)',
                                  (media_id, asset_info['storageKey'], value['sha256'], 'audio/mpeg', value['bytes'],
                                   f"{row['headword']}（{row['reading']}）.mp3", int(time.time() * 1000)))
                        owned_paths.add(asset_info['path'])
                positions = {r['position'] for r in backs}
                position = next(n for n in range(1001) if n not in positions)
                result['newLinks'] += 1
                link_id = None
                if apply:
                    link_id = c.execute("INSERT INTO card_media(card_id,media_id,side,position) VALUES (?,?,'back',?)", (target['cardId'], media_id, position)).lastrowid
                record['cards'].append(dict(cardId=target['cardId'], mediaId=media_id, linkId=link_id, side='back', position=position, status='attached'))
            result['records'].append(record)
        if apply:
            journal_dir = db.parent / 'audio-imports'
            journal_dir.mkdir(parents=True, exist_ok=True)
            journal = journal_dir / f"ja-{plan['deckId']}-{expected_hash[:12]}-{uuid.uuid4().hex[:10]}.json"
            result.update(backup=str(backup), journal=str(journal), config=plan['config'],
                          plan=plan, evidence={str(row['wordId']): artifacts[row['wordId']][0] for row in rows},
                          newAssetIds=[x['id'] for x in staged.values() if x['path'] in owned_paths])
            # Persist the complete provenance/recovery journal before DB commit.
            atomic_json(journal, result)
            c.commit()
            committed = True
            result['applied'] = True
            atomic_json(journal, result)
        else:
            c.rollback()
        atomic_json(report_path, result)
        return result
    except BaseException:
        c.rollback()
        raise
    finally:
        c.close()
        for info in staged.values():
            if not committed or info['path'] not in owned_paths:
                info['path'].unlink(missing_ok=True)


def rollback_batch(db, media_dir, journal_path, apply=False):
    """Remove only this batch's unchanged links; retain shared or edited assets."""
    manifest = json.loads(Path(journal_path).read_text())
    c = sqlite3.connect(f'file:{Path(db).resolve()}?mode={"rw" if apply else "ro"}', uri=True, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    removed = []
    files = []
    expected_hashes = {item['mediaId']: record['sha256'] for record in manifest['records']
                       for item in record['cards'] if item['status'] == 'attached'}
    try:
        c.set_authorizer(audio_only_authorizer)
        c.execute('begin immediate' if apply else 'begin')
        for record in manifest['records']:
            for item in record['cards']:
                if item['status'] != 'attached':
                    continue
                link = c.execute('SELECT * FROM card_media WHERE id=?', (item['linkId'],)).fetchone()
                if not link:
                    continue
                if (link['card_id'], link['media_id'], link['side'], link['position']) != (item['cardId'], item['mediaId'], item['side'], item['position']):
                    raise ValueError('Audio association changed after import; refusing rollback')
                if apply:
                    c.execute('DELETE FROM card_media WHERE id=?', (item['linkId'],))
                removed.append(item['linkId'])
        for media_id in manifest.get('newAssetIds', []):
            if c.execute('SELECT 1 FROM card_media WHERE media_id=?', (media_id,)).fetchone():
                continue
            asset = c.execute('SELECT * FROM media_assets WHERE id=?', (media_id,)).fetchone()
            if asset:
                if asset['sha256'] != expected_hashes.get(media_id):
                    raise ValueError('Audio asset changed after import; refusing rollback')
                path = Path(media_dir) / asset['storage_key']
                if path.is_file() and file_hash(path) != asset['sha256']:
                    raise ValueError('Audio bytes changed after import; refusing rollback')
                if apply:
                    c.execute('DELETE FROM media_assets WHERE id=?', (media_id,))
                    files.append(path)
        if apply:
            c.commit()
            for path in files:
                path.unlink(missing_ok=True)
        else:
            c.rollback()
        return dict(applied=apply, removedLinks=len(removed))
    except BaseException:
        c.rollback()
        raise
    finally:
        c.close()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db', required=True)
    p.add_argument('--batch')
    p.add_argument('--media-dir', required=True)
    p.add_argument('--report', required=True)
    p.add_argument('--apply', action='store_true')
    p.add_argument('--backup')
    p.add_argument('--limit', type=int)
    p.add_argument('--ready-only', action='store_true', help='Explicitly import only completed, accepted results; all selected artifacts are still validated')
    p.add_argument('--rollback', help='Path to this batch import journal')
    a = p.parse_args()
    if a.rollback:
        output = rollback_batch(a.db, a.media_dir, a.rollback, a.apply)
        atomic_json(a.report, output)
    else:
        if not a.batch:
            p.error('--batch is required')
        output = import_batch(a.db, a.batch, a.media_dir, a.report, a.apply, a.backup, a.limit, a.ready_only)
    print(json.dumps({k: v for k, v in output.items() if k not in {'records', 'evidence', 'plan', 'newAssetIds', 'config'}}, ensure_ascii=False))
