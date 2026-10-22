"""Resume one approved English batch, then stage, import and verify without learning writes."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time

from lib.japanese_audio import atomic_json


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['db','batch','media-dir','backup-dir','verification']:p.add_argument('--'+key,type=Path,required=True)
    p.add_argument('--base-url',default='http://127.0.0.1:9000')
    p.add_argument('--node-bin',default='node')
    p.add_argument('--container',default='flashnext')
    a=p.parse_args();node=shutil.which(a.node_bin)
    if not node:raise ValueError('Provide an existing Node executable with --node-bin')
    script=Path(__file__).resolve().parent;plan=json.loads((a.batch/'plan.json').read_text());state_file=a.batch/'continuation.json'
    def state(status,**data):
        value=dict(status=status,planHash=plan['planHash'],**data);atomic_json(state_file,value);print(json.dumps(value),flush=True)
    def verify(db,media,report,output,privileged=False):
        command=[sys.executable,str(script/'verify-english-audio.py'),'--db',str(db),'--batch',str(a.batch),
            '--media-dir',str(media),'--report',str(report),'--output',str(output)]
        subprocess.run((['sudo','-n'] if privileged else [])+command,check=True)
        if json.loads(output.read_text())['status']!='complete':raise RuntimeError('Frozen study batch still has missing audio')
    def playback(report):
        output=subprocess.run([node,str(script/'tests/english-audio-browser.cjs'),a.base_url,str(report)],
            check=True,capture_output=True,text=True)
        atomic_json(a.batch/'completion-browser-verification.json',json.loads(output.stdout))
        state('complete',verification=str(a.verification),cards=plan['selectedCards'])
        return 0
    # A verified completed import only needs playback recovery, never regeneration
    # or a whole-table comparison against a backup followed by later user reviews.
    for report in sorted(a.batch.glob('production-completion-*.json'),reverse=True):
        previous=json.loads(report.read_text())
        if previous.get('applied') and previous.get('planHash')==plan['planHash']:
            if not a.verification.exists() or json.loads(a.verification.read_text()).get('status')!='complete':
                raise RuntimeError('Completed import exists without its protected-table verification; inspect before retrying')
            return playback(report)
    for attempt in range(1,5):
        quota_path=a.batch/'quota-wait.json';quota=json.loads(quota_path.read_text()) if quota_path.exists() else {}
        if quota and quota['planHash']!=plan['planHash']:raise ValueError('Quota checkpoint belongs to a different batch')
        if quota.get('retryAt',0)>time.time():
            state('waiting_for_daily_quota',retryAt=quota['retryAt'])
            while time.time()<quota['retryAt']:time.sleep(min(30,quota['retryAt']-time.time()))
        state('generating',attempt=attempt)
        command=[sys.executable,str(script/'prepare-english-audio.py'),'--db',str(a.db),'--deck-id',str(plan['deckId']),
            '--days',str(plan['days']),'--output',str(a.batch),'--generate','--workers','1','--group-size','1','--attempts','4']
        result=subprocess.run(command)
        if result.returncode==75:continue
        if result.returncode:
            if attempt<4:time.sleep(30);continue
            raise RuntimeError('Some pronunciation checks still fail; existing accepted audio retained')
        quota_path.unlink(missing_ok=True)
        state('staging')
        with tempfile.TemporaryDirectory(prefix='flashnext-en-audio-completion-') as directory:
            stage=Path(directory)
            with sqlite3.connect(f'file:{a.db.resolve()}?mode=ro',uri=True) as source,sqlite3.connect(stage/'db') as dest:source.backup(dest)
            shutil.copytree(a.media_dir,stage/'media')
            staged=stage/'import.json'
            subprocess.run([sys.executable,str(script/'import-english-audio.py'),'--db',str(stage/'db'),'--batch',str(a.batch),
                '--media-dir',str(stage/'media'),'--report',str(staged),'--apply','--backup',str(stage/'before.db')],check=True)
            verify(stage/'db',stage/'media',staged,stage/'verified.json')
            atomic_json(a.batch/'completion-stage-verification.json',json.loads((stage/'verified.json').read_text()))
        suffix=time.strftime('%Y%m%d-%H%M%S',time.gmtime());report=a.batch/f'production-completion-{suffix}.json'
        backup=a.backup_dir/f'flashnext-pre-english-audio-completion-{suffix}.db'
        state('importing',report=str(report))
        try:
            subprocess.run(['docker','stop','--time','20',a.container],check=True)
            subprocess.run(['sudo','-n',sys.executable,str(script/'import-english-audio.py'),'--db',str(a.db),'--batch',str(a.batch),
                '--media-dir',str(a.media_dir),'--report',str(report),'--apply','--backup',str(backup)],check=True)
            verify(a.db,a.media_dir,report,a.verification,True)
        finally:subprocess.run(['docker','start',a.container],check=True)
        # Readiness retry avoids treating normal server startup as a failed import.
        for ready in range(20):
            try:return playback(report)
            except subprocess.CalledProcessError:
                if ready==19:raise
                time.sleep(2)
    raise RuntimeError('Quota retry limit reached; frozen batch retained')


if __name__=='__main__':
    def interrupted(signum,frame):raise KeyboardInterrupt('Continuation stopped')
    signal.signal(signal.SIGTERM,interrupted)
    try:sys.exit(main())
    except (Exception,KeyboardInterrupt) as error:
        if '--batch' in sys.argv:
            path=Path(sys.argv[sys.argv.index('--batch')+1])/'continuation.json'
            value=json.loads(path.read_text()) if path.exists() else {};value.update(status='needs_review',error=str(error)[:600]);atomic_json(path,value)
        print(str(error),file=sys.stderr);sys.exit(1)
