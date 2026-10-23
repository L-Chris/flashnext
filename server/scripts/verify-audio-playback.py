"""Compare all original database rows and audio bytes; verify only measured playback versions were added."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3

from lib.audio_loudness import PROFILE, file_hash, validate_processing
from lib.japanese_audio import atomic_json


def table_digest(connection, table, columns=None):
    quote = lambda name: '"' + name.replace('"', '""') + '"'
    fields = ','.join(quote(x) for x in columns) if columns else '*'
    digest, count = hashlib.sha256(), 0
    for row in connection.execute(f'SELECT {fields} FROM {quote(table)} ORDER BY rowid'):
        digest.update(repr(row).encode()); digest.update(b'\n'); count += 1
    return dict(rows=count, sha256=digest.hexdigest())


def verify(before, db, media, manifest):
    result = json.loads(Path(manifest).read_text())
    if not result['applied'] or result['profile'] != PROFILE:
        raise ValueError('Use an applied playback import report')
    media = Path(media).resolve()
    a = sqlite3.connect(f'file:{Path(before).resolve()}?mode=ro', uri=True)
    b = sqlite3.connect(f'file:{Path(db).resolve()}?mode=ro', uri=True)
    tables = {}
    try:
        a.execute('BEGIN'); b.execute('BEGIN')
        names = lambda c: {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        old_names, new_names = names(a), names(b)
        if old_names - new_names or new_names - old_names - {'media_playbacks'}:
            raise ValueError('An unrelated database table changed')
        for table in sorted(old_names - {'media_playbacks'}):
            columns = [r[1] for r in a.execute('PRAGMA table_info("' + table + '")')]
            if table_digest(a, table, columns) != table_digest(b, table, columns):
                raise ValueError('Existing table changed: ' + table)
            tables[table] = table_digest(a, table, columns)['rows']
        old = {r[0]: r for r in a.execute('SELECT * FROM media_playbacks')} if 'media_playbacks' in old_names else {}
        for identity, row in old.items():
            if b.execute('SELECT * FROM media_playbacks WHERE id=?', (identity,)).fetchone() != row:
                raise ValueError('An existing playback was modified')
        new_ids = {r[0] for r in b.execute('SELECT id FROM media_playbacks')} - set(old)
        if new_ids != set(result['newPlaybackIds']):
            raise ValueError('Unrelated playback rows were added or removed')
        b.row_factory = sqlite3.Row
        levels, peaks = [], []
        for row in result['records']:
            source = b.execute('SELECT * FROM media_assets WHERE id=?', (row['mediaId'],)).fetchone()
            playback = b.execute('SELECT * FROM media_playbacks WHERE media_id=? AND profile=?', (row['mediaId'], PROFILE)).fetchone()
            if not source or not playback or source['sha256'] != playback['source_sha256']:
                raise ValueError('Playback does not match its original recording')
            for record in [source, playback]:
                path = media / record['storage_key']
                if not path.is_file() or path.stat().st_size != record['bytes'] or file_hash(path) != record['sha256']:
                    raise ValueError('Original or playback audio file is missing or corrupt')
            processing = json.loads(playback['metrics'])
            validate_processing(processing, playback['sha256'])
            levels.append(processing['output']['lufs']); peaks.append(processing['output']['truePeakDbtp'])
        if b.execute('PRAGMA quick_check').fetchall()[0][0] != 'ok' or b.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Database integrity check failed')
        return dict(status='passed', profile=PROFILE, recordings=len(levels), preservedTables=tables,
                    oldRowsUnchanged=True, originalAudioUnchanged=True, loudnessRange=[min(levels), max(levels)],
                    maximumTruePeak=max(peaks), newPlaybacks=len(new_ids))
    finally:
        a.close(); b.close()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for key in ['before', 'db', 'media-dir', 'manifest', 'report']:
        p.add_argument('--' + key, required=True, type=Path)
    args = p.parse_args()
    result = verify(args.before, args.db, args.media_dir, args.manifest)
    atomic_json(args.report, result)
    print(json.dumps(result))
