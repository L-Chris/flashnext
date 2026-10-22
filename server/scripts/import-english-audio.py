"""Import checked English MP3s using the existing media-only transaction/rollback."""
import argparse
import importlib.util
import json
from pathlib import Path

from lib.english_audio import VERSION,check_identity,validate_result

spec=importlib.util.spec_from_file_location('shared_audio_import',Path(__file__).with_name('import-japanese-audio.py'))
shared=importlib.util.module_from_spec(spec);spec.loader.exec_module(shared)


def import_batch(db,batch,media_dir,report,apply=False,backup=None,limit=None,ready_only=False):
    return shared.import_batch(db,batch,media_dir,report,apply,backup,limit,ready_only,
        version=VERSION,language='en',check_word=check_identity,validate_audio=validate_result)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['db','batch','media-dir','report']:p.add_argument('--'+name,required=True)
    p.add_argument('--apply',action='store_true');p.add_argument('--backup');p.add_argument('--limit',type=int)
    p.add_argument('--ready-only',action='store_true');p.add_argument('--rollback')
    a=p.parse_args()
    value=shared.rollback_batch(a.db,a.media_dir,a.rollback,a.apply) if a.rollback else import_batch(a.db,a.batch,a.media_dir,a.report,a.apply,a.backup,a.limit,a.ready_only)
    if a.rollback:shared.atomic_json(a.report,value)
    print(json.dumps({k:v for k,v in value.items() if k not in ['records','evidence','plan','newAssetIds','config']},ensure_ascii=False))
