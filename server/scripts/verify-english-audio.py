"""Read-only verification of English audio provenance and all protected DB tables."""
import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path
import sqlite3

from lib.english_audio import check_identity,validate_result
from lib.japanese_audio import atomic_json,file_hash

spec=importlib.util.spec_from_file_location('shared_verification',Path(__file__).with_name('verify-japanese-audio.py'))
shared=importlib.util.module_from_spec(spec);spec.loader.exec_module(shared)


def verify(db,batch,media_dir,report,output):
    batch,media_dir=Path(batch).resolve(),Path(media_dir).resolve()
    plan=json.loads((batch/'plan.json').read_text());manifest=json.loads(Path(report).read_text())
    if not manifest['applied'] or manifest['planHash']!=plan['planHash']:raise ValueError('Applied import must match plan')
    before,after=shared.snapshot(manifest['backup']),shared.snapshot(db)
    if before!=after:raise ValueError('A non-media table changed after the backup')
    old=shared.preserved_media(db,manifest['backup'])
    c=sqlite3.connect(f'file:{Path(db).resolve()}?mode=ro',uri=True);c.row_factory=sqlite3.Row
    try:
        for row in plan['rows']:check_identity(c,row)
        if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or c.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('SQLite integrity check failed')
        linked=total_bytes=0;models=Counter()
        row_by_id={r['wordId']:r for r in plan['rows']}
        for record in manifest['records']:
            evidence=manifest['evidence'][str(record['wordId'])]
            validate_result(row_by_id[record['wordId']],plan['config'],batch,evidence)
            for target in record['cards']:
                if target['status']!='attached':continue
                asset=c.execute("SELECT m.* FROM card_media cm JOIN media_assets m ON m.id=cm.media_id WHERE cm.id=? AND cm.card_id=? AND cm.media_id=? AND cm.side='back'",(target['linkId'],target['cardId'],target['mediaId'])).fetchone()
                if not asset or asset['sha256']!=record['sha256'] or asset['mime_type']!='audio/mpeg':raise ValueError('Media association changed')
                path=media_dir/asset['storage_key']
                if not path.is_file() or file_hash(path)!=asset['sha256'] or path.stat().st_size!=asset['bytes']:raise ValueError('Production MP3 bytes differ')
                linked+=1;total_bytes+=asset['bytes'];models[evidence['model']]+=1
        if linked!=manifest['newLinks']:raise ValueError('Import link count mismatch')
        targets=[r['cardId'] for r in plan['selections']]
        slots=','.join('?' for _ in targets)
        covered=c.execute(f"SELECT COUNT(DISTINCT card_id) FROM card_media WHERE card_id IN ({slots}) AND side='back'",targets).fetchone()[0]
        result=dict(status='complete' if covered==plan['selectedCards'] else 'partial',expectedCards=plan['selectedCards'],
            cardsWithBackAudio=covered,remaining=plan['selectedCards']-covered,importedThisBatch=linked,importedBytes=total_bytes,
            modelsUsed=dict(models),unchangedPreviousMedia=old,unchangedNonMediaTables=after,backup=manifest['backup'],
            journal=manifest['journal'],planHash=plan['planHash'],phoneticCertified=False)
        atomic_json(output,result);return result
    finally:c.close()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['db','batch','media-dir','report','output']:p.add_argument('--'+key,required=True)
    a=p.parse_args();r=verify(a.db,a.batch,a.media_dir,a.report,a.output)
    print(json.dumps({k:v for k,v in r.items() if k!='unchangedNonMediaTables'},ensure_ascii=False))
