"""Prepare/resume a frozen English study batch; paid generation requires --generate."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import sqlite3
import sys

from lib.english_audio import (VERSION, DailyQuotaExceeded, EnglishGateway, atomic_json,
    check_identity, compact, digest, generate_group, prepare_plan)
from lib.japanese_audio import load_token


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--db',required=True)
    p.add_argument('--deck-id',type=int,required=True)
    p.add_argument('--days',type=int,default=7)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--env-file',type=Path,default=Path(__file__).resolve().parents[2]/'.env')
    p.add_argument('--generate',action='store_true')
    p.add_argument('--limit',type=int)
    p.add_argument('--workers',type=int,choices=range(1,5),default=2)
    p.add_argument('--group-size',type=int,choices=[1,4],default=1)
    p.add_argument('--attempts',type=int,choices=range(1,5),default=3)
    a=p.parse_args()
    if a.limit is not None and a.limit<1: p.error('limit must be positive')
    path=a.output/'plan.json'
    if path.exists():
        plan=json.loads(path.read_text());expected=plan.pop('planHash')
        if plan['version']!=VERSION or digest(plan)!=expected or plan['deckId']!=a.deck_id or plan['days']!=a.days:
            raise ValueError('Frozen plan differs; use a new batch directory')
        plan['planHash']=expected
        with sqlite3.connect(f'file:{Path(a.db).resolve()}?mode=ro',uri=True) as c:
            c.row_factory=sqlite3.Row
            for row in plan['rows']: check_identity(c,row)
    else:
        plan=prepare_plan(a.db,a.deck_id,a.days);atomic_json(path,plan)
    print(compact(dict(plan=str(path),selectedCards=plan['selectedCards'],words=plan['wordCount'],
        firstStudyDate=plan['firstStudyDate'],lastStudyDate=plan['lastStudyDate'],generate=a.generate)),flush=True)
    if not a.generate:return 0
    config=plan['config'];gateway=EnglishGateway(config['gateway'],load_token(a.env_file))
    models={x['id'] for x in gateway.json('/v1/models')['data']}
    required=[config['model'],config['asrModel'],config['verifierModel'],config['qaModel'],*['gemini/'+x for x in config['fallbackModels']]]
    if any(x not in models for x in required):raise ValueError('Required gateway models are unavailable')
    selected=plan['rows'][:a.limit] if a.limit else plan['rows']
    status=0
    try:
        with ThreadPoolExecutor(max_workers=a.workers) as pool:
            jobs=[pool.submit(generate_group,selected[i:i+a.group_size],config,a.output,gateway,a.attempts) for i in range(0,len(selected),a.group_size)]
            complete=0
            for job in as_completed(jobs):
                for value in job.result():
                    complete+=1
                    print(compact(dict(completed=complete,total=len(selected),word=value['headword'],status=value['status'],
                        model=value.get('model'),cached=bool(value.get('cached')))),flush=True)
    except DailyQuotaExceeded as error:
        atomic_json(a.output/'quota-wait.json',dict(planHash=plan['planHash'],retryAt=error.retry_at))
        status=75
    states=[]
    for row in selected:
        file=a.output/'results'/f"{row['wordId']}.json"
        states.append(json.loads(file.read_text()).get('status') if file.exists() else 'pending')
    result=dict(planHash=plan['planHash'],selected=len(selected),accepted=states.count('accepted'),
        needsReview=states.count('needs_review'),pending=states.count('pending'),waitingForQuota=status==75)
    atomic_json(a.output/'generation-summary.json',result);print(compact(result),flush=True)
    return status or (0 if result['accepted']==len(selected) else 1)


if __name__=='__main__':sys.exit(main())
