"""Read-only end-to-end check of every registered speech playback version."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.audio_loudness import PROFILE, validate_processing
from lib.japanese_audio import atomic_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['base-url', 'db', 'report']:
        parser.add_argument('--' + key, required=True)
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    with sqlite3.connect(f'file:{Path(args.db).resolve()}?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        rows = [dict(r) for r in db.execute('''SELECT p.*,a.sha256 original_sha256,
            (SELECT MIN(card_id) FROM card_media WHERE media_id=a.id) card_id
            FROM media_playbacks p JOIN media_assets a ON a.id=p.media_id WHERE p.profile=?''', (PROFILE,))]
    if not rows:
        raise ValueError('No registered playback versions')
    def one(row):
        validate_processing(json.loads(row['metrics']), row['sha256'])
        url = f"/api/media/{row['media_id']}/content?playback={row['id']}"
        with urllib.request.urlopen(base + url, timeout=20) as response:
            assert response.status == 200
            assert response.headers.get_content_type() == 'audio/mpeg'
            assert response.headers['ETag'] == '"' + row['sha256'] + '"'
            audio = response.read()
            assert len(audio) == row['bytes']
            assert hashlib.sha256(audio).hexdigest() == row['sha256']
        return row['media_id']
    with ThreadPoolExecutor(max_workers=4) as pool:
        checked = list(pool.map(one, rows))
    for row in rows[::max(1, len(rows) // 10)]:
        with urllib.request.urlopen(base + f"/api/cards/{row['card_id']}", timeout=20) as response:
            card = json.load(response)['data']
        attached = next(m for m in card['media'] if m['mediaId'] == row['media_id'])
        assert urllib.parse.parse_qs(urllib.parse.urlsplit(attached['url']).query)['playback'] == [row['id']]
        assert attached['bytes'] == row['bytes']
        with urllib.request.urlopen(base + f"/api/media/{row['media_id']}/content", timeout=20) as response:
            assert hashlib.sha256(response.read()).hexdigest() == row['original_sha256']
    result = dict(status='passed', recordings=len(checked), profile=PROFILE, versionedHttpHashes=True,
                  originalHttpHashes=True, cardUrls=True, readOnly=True)
    atomic_json(args.report, result)
    print(json.dumps(result))


if __name__ == '__main__': main()
