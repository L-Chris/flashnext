"""Prepare measured playback versions. Dry-run by default; original assets and study data are immutable."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import shutil
import sqlite3
import time
import uuid

from lib.audio_loudness import PROFILE, file_hash, normalize, validate_processing
from lib.japanese_audio import atomic_json


def inventory(db):
    with sqlite3.connect(f'file:{Path(db).resolve()}?mode=ro', uri=True) as c:
        c.row_factory = sqlite3.Row
        return [dict(r) for r in c.execute('''SELECT a.* FROM media_assets a WHERE a.mime_type='audio/mpeg'
            AND EXISTS (SELECT 1 FROM card_media m JOIN cards c ON c.id=m.card_id
                JOIN words w ON w.id=c.word_id WHERE m.media_id=a.id AND w.language IN ('en','ja'))
            ORDER BY a.id''')]


def prepare(db, media, output, workers=4):
    media, output = Path(media).resolve(), Path(output).resolve()
    rows = inventory(db)
    if not rows:
        raise ValueError('No attached English/Japanese word audio to process')
    output.mkdir(parents=True, exist_ok=True)
    def one(row):
        source = media / row['storage_key']
        if not source.is_file() or file_hash(source) != row['sha256'] or source.stat().st_size != row['bytes']:
            raise ValueError('Original audio is missing or changed: ' + row['id'])
        evidence = output / 'results' / (row['id'] + '.json')
        try:
            old = json.loads(evidence.read_text())
            path = output / old['audioFile']
            validate_processing(old['processing'], old['sha256'])
            if (old['sourceSha256'] == row['sha256'] and path.resolve().is_relative_to(output) and
                    path.is_file() and file_hash(path) == old['sha256'] and path.stat().st_size == old['bytes']):
                return old
        except (OSError, ValueError, KeyError):
            pass
        playback_id = str(uuid.uuid4())
        relative = 'files/' + playback_id + '.mp3'
        path = output / relative
        processing = normalize(source, path)
        value = dict(mediaId=row['id'], sourceSha256=row['sha256'], sourceStorageKey=row['storage_key'],
                     id=playback_id, profile=PROFILE, storageKey='.playback/' + playback_id + '.mp3',
                     audioFile=relative, sha256=file_hash(path), bytes=path.stat().st_size, mimeType='audio/mpeg',
                     processing=processing)
        atomic_json(evidence, value)
        return value
    records, failures = [], []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = {pool.submit(one, row): row for row in rows}
        for job in as_completed(jobs):
            try:
                records.append(job.result())
            except Exception as error:
                failures.append(dict(mediaId=jobs[job]['id'], error=str(error)[:600]))
            if (len(records) + len(failures)) % 100 == 0:
                print(json.dumps(dict(measured=len(records), failed=len(failures), total=len(rows))), flush=True)
    result = dict(profile=PROFILE, total=len(rows), prepared=len(records), failures=failures,
                  records=sorted(records, key=lambda x: x['mediaId']))
    atomic_json(output / 'preparation.json', result)
    if failures:
        raise ValueError(f'{len(failures)} recordings failed level checks; no database changes made')
    return result


def authorizer(action, table, column, database, trigger):
    if action in {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE}:
        if table != 'media_playbacks' or action == sqlite3.SQLITE_UPDATE:
            return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def attach(db, media, batch, report, backup):
    db, media, batch = Path(db).resolve(), Path(media).resolve(), Path(batch).resolve()
    manifest = json.loads((batch / 'preparation.json').read_text())
    if manifest['profile'] != PROFILE or manifest['failures'] or manifest['prepared'] != manifest['total']:
        raise ValueError('Only a fully checked playback batch may be applied')
    ids = [r['mediaId'] for r in manifest['records']]
    playback_ids = [r['id'] for r in manifest['records']]
    if len(ids) != len(set(ids)) or len(ids) != manifest['total'] or len(playback_ids) != len(set(playback_ids)):
        raise ValueError('Invalid or duplicate playback records')
    if {row['id'] for row in inventory(db)} != set(ids):
        raise ValueError('Word audio selection changed; prepare the batch again before applying')
    backup = Path(backup).resolve()
    if backup == db:
        raise ValueError('Backup must be separate from the live database')
    c = sqlite3.connect(f'file:{db}?mode=rw', uri=True, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    owned, added, existing, committed = [], [], [], False
    try:
        if not c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_playbacks'").fetchone():
            raise ValueError('Migrate the database schema before attaching playback versions')
        backup.parent.mkdir(parents=True, exist_ok=True)
        with backup.open('xb'):
            pass
        with sqlite3.connect(backup) as dest:
            c.backup(dest)
        c.set_authorizer(authorizer)
        c.execute('BEGIN IMMEDIATE')
        for row in manifest['records']:
            validate_processing(row['processing'], row['sha256'])
            if str(uuid.UUID(row['id'])) != row['id'] or row['processing']['sourceSha256'] != row['sourceSha256']:
                raise ValueError('Invalid playback identity or provenance')
            asset = c.execute('SELECT * FROM media_assets WHERE id=?', (row['mediaId'],)).fetchone()
            if not asset or asset['sha256'] != row['sourceSha256'] or asset['storage_key'] != row['sourceStorageKey']:
                raise ValueError('Original asset identity changed before attachment')
            original = media / asset['storage_key']
            if not original.is_file() or file_hash(original) != asset['sha256']:
                raise ValueError('Original audio bytes changed before attachment')
            found = c.execute('SELECT * FROM media_playbacks WHERE media_id=? AND profile=?', (row['mediaId'], PROFILE)).fetchone()
            if found:
                path = media / found['storage_key']
                if (found['source_sha256'] != asset['sha256'] or not path.is_file() or
                        path.stat().st_size != found['bytes'] or file_hash(path) != found['sha256']):
                    raise ValueError('Existing playback is corrupt; refusing automatic replacement')
                validate_processing(json.loads(found['metrics']), found['sha256'])
                existing.append(found['id'])
                continue
            source = (batch / row['audioFile']).resolve()
            if not source.is_relative_to(batch) or file_hash(source) != row['sha256'] or source.stat().st_size != row['bytes']:
                raise ValueError('Prepared playback is missing or changed')
            if row['storageKey'] != '.playback/' + row['id'] + '.mp3':
                raise ValueError('Invalid playback storage key')
            destination = media / row['storageKey']
            destination.parent.mkdir(parents=True, exist_ok=True)
            with source.open('rb') as src, destination.open('xb') as dst:
                owned.append(destination)
                shutil.copyfileobj(src, dst)
                dst.flush(); os.fsync(dst.fileno())
            if file_hash(destination) != row['sha256']:
                raise ValueError('Playback copy failed verification')
            c.execute('''INSERT INTO media_playbacks(id,media_id,profile,source_sha256,storage_key,sha256,mime_type,bytes,metrics,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)''', (row['id'], row['mediaId'], PROFILE, row['sourceSha256'], row['storageKey'],
                    row['sha256'], row['mimeType'], row['bytes'], json.dumps(row['processing']), int(time.time() * 1000)))
            added.append(row['id'])
        result = dict(applied=True, profile=PROFILE, batch=str(batch), backup=str(backup), total=manifest['total'],
                      newPlaybackIds=added, existingPlaybackIds=existing, records=manifest['records'])
        # Recovery journal is durable before commit; source files are never overwritten.
        journal = media / 'playback-imports' / (str(uuid.uuid4()) + '.json')
        atomic_json(journal, dict(result, applied=False))
        c.commit(); committed = True
        atomic_json(journal, result)
        atomic_json(report, result)
        return result
    except BaseException:
        c.rollback()
        raise
    finally:
        c.close()
        if not committed:
            for path in owned:
                path.unlink(missing_ok=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db', required=True, type=Path)
    p.add_argument('--media-dir', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--workers', type=int, choices=range(1, 5), default=4)
    p.add_argument('--apply', action='store_true')
    p.add_argument('--backup', type=Path)
    p.add_argument('--report', type=Path)
    a = p.parse_args()
    if a.apply:
        if not a.backup or not a.report:
            p.error('--apply requires a new --backup path and --report')
        result = attach(a.db, a.media_dir, a.output, a.report, a.backup)
    else:
        result = prepare(a.db, a.media_dir, a.output, a.workers)
    print(json.dumps({k: v for k, v in result.items() if k not in {'records', 'newPlaybackIds', 'existingPlaybackIds'}}))
