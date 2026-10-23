"""Resume one approved English batch, then stage, import and verify without learning writes."""
import argparse
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
    p.add_argument('--ready-only',action='store_true',help='Import checked items even while other words await review/quota')
    p.add_argument('--workers',type=int,choices=range(1,5),default=1)
    p.add_argument('--group-size',type=int,choices=[1,4],default=1)
    p.add_argument('--attempts',type=int,choices=range(1,5),default=4)
    p.add_argument('--wait-for-unit',help='Wait for an existing generation unit before reading/importing its artifacts')
    a=p.parse_args();node=shutil.which(a.node_bin)
    if not node:raise ValueError('Provide an existing Node executable with --node-bin')
    script=Path(__file__).resolve().parent;plan=json.loads((a.batch/'plan.json').read_text());state_file=a.batch/'continuation.json'
    def state(status,**data):
        value=dict(status=status,planHash=plan['planHash'],**data);atomic_json(state_file,value);print(json.dumps(value),flush=True)
    def verify(db,media,report,output,privileged=False):
        command=[sys.executable,str(script/'verify-english-audio.py'),'--db',str(db),'--batch',str(a.batch),
            '--media-dir',str(media),'--report',str(report),'--output',str(output)]
        subprocess.run((['sudo','-n'] if privileged else [])+command,check=True)
        coverage=json.loads(output.read_text())
        if coverage['status']!='complete' and not a.ready_only:raise RuntimeError('Frozen study batch still has missing audio')
        return coverage
    def playback(report):
        output=subprocess.run([node,str(script/'tests/english-audio-browser.cjs'),a.base_url,str(report)],
            check=True,capture_output=True,text=True)
        atomic_json(a.batch/'completion-browser-verification.json',json.loads(output.stdout))
        coverage=json.loads(a.verification.read_text())
        state(coverage['status'],verification=str(a.verification),cards=coverage.get('cardsWithBackAudio',plan['selectedCards']),
            remaining=coverage.get('remaining',0))
        return 0
    def has_ready():
        with sqlite3.connect(f'file:{a.db.resolve()}?mode=ro',uri=True) as c:
            for row in plan.get('rows',[]):
                evidence=a.batch/'results'/f"{row['wordId']}.json"
                if not evidence.exists() or json.loads(evidence.read_text()).get('status')!='accepted':continue
                if any(not c.execute("SELECT 1 FROM card_media WHERE card_id=? AND side='back'",(card['cardId'],)).fetchone() for card in row['cards']):
                    return True
        return False
    if a.wait_for_unit:
        while True:
            status=subprocess.run(['systemctl','show',a.wait_for_unit,'--property=SubState','--value'],
                check=True,capture_output=True,text=True).stdout.strip()
            if status not in {'running','start','start-pre','start-post','auto-restart'}:break
            state('waiting_for_generation',unit=a.wait_for_unit)
            time.sleep(30)
    # A verified completed import only needs playback recovery, never regeneration
    # or a whole-table comparison against a backup followed by later user reviews.
    for report in sorted(a.batch.glob('production-completion-*.json'),reverse=True):
        previous=json.loads(report.read_text())
        if previous.get('applied') and previous.get('planHash')==plan['planHash']:
            if not a.verification.exists():
                raise RuntimeError('Completed import exists without its protected-table verification; inspect before retrying')
            coverage=json.loads(a.verification.read_text())
            if (coverage.get('planHash')!=plan['planHash'] or
                not previous.get('journal') or coverage.get('journal')!=previous['journal']):
                raise RuntimeError('Latest import does not have its own protected-table verification; inspect before retrying')
            if coverage.get('status')=='complete':return playback(report)
            if not a.ready_only:
                raise RuntimeError('Completed import exists without its protected-table verification; inspect before retrying')
            # Recover playback for a verified partial import, then continue generation.
            playback(report)
            break
    def apply_ready():
        flags=['--ready-only'] if a.ready_only else []
        state('staging')
        with tempfile.TemporaryDirectory(prefix='flashnext-en-audio-completion-') as directory:
            stage=Path(directory)
            with sqlite3.connect(f'file:{a.db.resolve()}?mode=ro',uri=True) as source,sqlite3.connect(stage/'db') as dest:source.backup(dest)
            shutil.copytree(a.media_dir,stage/'media')
            staged=stage/'import.json'
            subprocess.run([sys.executable,str(script/'import-english-audio.py'),'--db',str(stage/'db'),'--batch',str(a.batch),
                '--media-dir',str(stage/'media'),'--report',str(staged),'--apply','--backup',str(stage/'before.db'),*flags],check=True)
            verify(stage/'db',stage/'media',staged,stage/'verified.json')
            atomic_json(a.batch/'completion-stage-verification.json',json.loads((stage/'verified.json').read_text()))
        suffix=time.strftime('%Y%m%d-%H%M%S',time.gmtime());report=a.batch/f'production-completion-{suffix}.json'
        backup=a.backup_dir/f'flashnext-pre-english-audio-completion-{suffix}.db'
        state('importing',report=str(report))
        try:
            subprocess.run(['docker','stop','--time','20',a.container],check=True)
            subprocess.run(['sudo','-n',sys.executable,str(script/'import-english-audio.py'),'--db',str(a.db),'--batch',str(a.batch),
                '--media-dir',str(a.media_dir),'--report',str(report),'--apply','--backup',str(backup),*flags],check=True)
            verify(a.db,a.media_dir,report,a.verification,True)
        finally:subprocess.run(['docker','start',a.container],check=True)
        # Readiness retry avoids treating normal server startup as a failed import.
        for ready in range(20):
            try:return playback(report)
            except subprocess.CalledProcessError:
                if ready==19:raise
                time.sleep(2)
    # The caller must not run another generator/importer for this frozen batch.
    # Import accepted cached work before a possibly long quota wait.
    if a.ready_only and has_ready():apply_ready()
    for attempt in range(1,5):
        quota_path=a.batch/'quota-wait.json';quota=json.loads(quota_path.read_text()) if quota_path.exists() else {}
        if quota and quota['planHash']!=plan['planHash']:raise ValueError('Quota checkpoint belongs to a different batch')
        if quota.get('retryAt',0)>time.time():
            state('waiting_for_daily_quota',retryAt=quota['retryAt'])
            while time.time()<quota['retryAt']:time.sleep(min(30,quota['retryAt']-time.time()))
        state('generating',attempt=attempt)
        command=[sys.executable,str(script/'prepare-english-audio.py'),'--db',str(a.db),'--deck-id',str(plan['deckId']),
            '--days',str(plan['days']),'--selection',plan.get('selection','today-and-upcoming-new-cards'),
            '--output',str(a.batch),'--generate','--workers',str(a.workers),'--group-size',str(a.group_size),'--attempts',str(a.attempts)]
        result=subprocess.run(command)
        if a.ready_only:
            if result.returncode not in {0,1,75}:raise RuntimeError('Generation failed; inspect before importing')
            if has_ready():apply_ready()
            if result.returncode==0:
                quota_path.unlink(missing_ok=True)
                with sqlite3.connect(f'file:{a.db.resolve()}?mode=ro',uri=True) as c:
                    covered=sum(bool(c.execute("SELECT 1 FROM card_media WHERE card_id=? AND side='back'",(card['cardId'],)).fetchone())
                        for card in plan.get('selections',[]))
                coverage=dict(status='complete' if covered==plan['selectedCards'] else 'partial',cardsWithBackAudio=covered,
                    remaining=plan['selectedCards']-covered)
                state('complete' if coverage['status']=='complete' else 'needs_review',
                    cards=coverage['cardsWithBackAudio'],remaining=coverage['remaining'],blocked=plan.get('blocked',[]))
                return 0
        else:
            if result.returncode==75:continue
            if result.returncode:
                if attempt<4:time.sleep(30);continue
                raise RuntimeError('Some pronunciation checks still fail; existing accepted audio retained')
            quota_path.unlink(missing_ok=True)
            return apply_ready()
        if result.returncode==75:continue
        if attempt<4:time.sleep(30)
        else:raise RuntimeError('Some pronunciation checks still fail; checked audio imported, remaining items need review')
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
