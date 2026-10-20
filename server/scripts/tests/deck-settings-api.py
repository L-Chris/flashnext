"""Run against a disposable, migrated DB and its running preview server only.
python server/scripts/tests/deck-settings-api.py http://127.0.0.1:19002 /dev/shm/flashnext-deck-settings/stage.db
"""
import hashlib
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

base, filename = sys.argv[1:]
assert Path(filename).name != 'flashnext.db', 'Use a disposable database copy'
db = sqlite3.connect(filename)

def call(path, body=None, status=200, method=None):
    request = urllib.request.Request(base + '/api' + path, data=None if body is None else json.dumps(body).encode(), headers={'Content-Type': 'application/json'}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            code, payload = response.status, json.load(response)
    except urllib.error.HTTPError as error:
        code, payload = error.code, json.load(error)
    assert code == status, (path, code, payload)
    return payload.get('data', payload)

def digest(sql, args=()):
    return hashlib.sha256(repr(db.execute(sql, args).fetchall()).encode()).hexdigest()

def wait(deck, kind):
    for _ in range(200):
        job = call(f'/decks/{deck}/fsrs/{kind}')
        if not job['running']:
            return job
        time.sleep(.05)
    raise AssertionError('Job did not finish')

english = db.execute("SELECT id FROM decks WHERE language='en' ORDER BY id LIMIT 1").fetchone()[0]
japanese = call('/decks',{'name':'isolated settings fixture'})['id']
with db: db.execute("UPDATE decks SET language='ja' WHERE id=?",(japanese,))
for index in range(3): call(f'/decks/{japanese}/cards',{'front':f'fixture {index}','back':'answer'})
en_settings = call(f'/decks/{english}/settings')
en_params = call(f'/decks/{english}/fsrs/params')
en_cards = digest('SELECT * FROM cards WHERE deck_id=? ORDER BY id',(english,))
en_logs = digest('SELECT r.* FROM review_logs r JOIN cards c ON r.card_id=c.id WHERE c.deck_id=? ORDER BY r.id',(english,))
assert call(f'/decks/{japanese}/fsrs/params')['reviewCount'] == 0
assert isinstance(call('/settings')['timezone'], str)
call('/settings', {'newPerDay': 3}, status=400)
for path in ['/fsrs/params','/fsrs/optimize','/fsrs/rebuild']:
    call(path,status=400)
    call(path,{},status=400)
call('/decks/9999999/settings',status=404)
call('/decks/0/settings',status=400)
for bad in [{'newPerDay':-1},{'reviewPerDay':1.5},{'rolloverHour':24},{'timezone':'invalid/timezone'},{'newPerDay':'2'},{'timezone':None}]:
    call(f'/decks/{japanese}/settings',bad,status=400)
call(f'/decks/{japanese}/settings',{'newPerDay':1,'reviewPerDay':2,'rolloverHour':6})
queue = call(f'/decks/{japanese}/cards/due')
assert len(queue['cards']) == 1 and queue['usage']['newLimit'] == 1
assert call(f'/decks/{english}/settings') == en_settings
call(f'/decks/{japanese}/fsrs/params',{})
assert call(f'/decks/{english}/fsrs/params') == en_params
call(f'/decks/{japanese}/fsrs/optimize',{})
job=wait(japanese,'optimize')
assert '0 < 1000' in job['error'],job
assert call(f'/decks/{english}/fsrs/optimize')['startedAt'] is None
print('PASS independent limits/queues/weights/jobs, input validation, rejected unscoped learning endpoints')

fixture = call('/decks',{'name':'isolated rebuild test'})['id']
assert call(f'/decks/{fixture}/fsrs/params')['source'] == 'default'
assert call(f'/decks/{fixture}/settings')['newPerDay'] == en_settings['newPerDay']
a=call(f'/decks/{fixture}/cards',{'front':'test one','back':'answer'})['id']
b=call(f'/decks/{fixture}/cards',{'front':'test two','back':'answer'})['id']
call(f'/cards/{a}/review',{'rating':3})
# One old log and one current log: replay covers cross-day and intraday state.
old=int(time.time()*1000)-86400000*3
with db:
    db.execute('UPDATE review_logs SET review_at=? WHERE card_id=?',(old,a))
call(f'/cards/{a}/review',{'rating':4})
log_identity = db.execute('SELECT id,card_id,rating,review_at,duration_ms FROM review_logs WHERE card_id=? ORDER BY id',(a,)).fetchall()
cards_before=digest('SELECT * FROM cards WHERE deck_id=? ORDER BY id',(fixture,))
logs_before=digest('SELECT * FROM review_logs WHERE card_id=? ORDER BY id',(a,))
call(f'/decks/{fixture}/fsrs/rebuild',{},status=409)
call(f'/decks/{fixture}/fsrs/rebuild',{'dryRun':True})
preview=wait(fixture,'rebuild')
assert preview['result']['cards']==2 and preview['result']['logs']==2,preview
assert digest('SELECT * FROM cards WHERE deck_id=? ORDER BY id',(fixture,))==cards_before
assert digest('SELECT * FROM review_logs WHERE card_id=? ORDER BY id',(a,))==logs_before
call(f'/decks/{fixture}/settings',{'newPerDay':2})
call(f'/decks/{fixture}/fsrs/rebuild',{})
stale=wait(fixture,'rebuild')
assert stale['error'] and '重新预览' in stale['error'],stale
assert digest('SELECT * FROM cards WHERE deck_id=? ORDER BY id',(fixture,))==cards_before
assert digest('SELECT * FROM review_logs WHERE card_id=? ORDER BY id',(a,))==logs_before
call(f'/decks/{fixture}/fsrs/rebuild',{'dryRun':True});assert not wait(fixture,'rebuild')['error']
# A concurrent review invalidates the preview without overwriting the new review.
call(f'/cards/{b}/review',{'rating':3})
after_review=digest('SELECT * FROM cards WHERE deck_id=? ORDER BY id',(fixture,))
call(f'/decks/{fixture}/fsrs/rebuild',{})
assert '重新预览' in wait(fixture,'rebuild')['error']
assert digest('SELECT * FROM cards WHERE deck_id=? ORDER BY id',(fixture,))==after_review
call(f'/decks/{fixture}/fsrs/rebuild',{'dryRun':True});assert not wait(fixture,'rebuild')['error']
call(f'/decks/{fixture}/fsrs/rebuild',{})
applied=wait(fixture,'rebuild')
assert not applied['error'] and not applied['result']['dryRun'],applied
assert db.execute('SELECT id,card_id,rating,review_at,duration_ms FROM review_logs WHERE card_id=? ORDER BY id',(a,)).fetchall()==log_identity
assert db.execute('SELECT id FROM cards WHERE deck_id=? ORDER BY id',(fixture,)).fetchall()==[(a,),(b,)]
assert digest('SELECT * FROM cards WHERE deck_id=? ORDER BY id',(english,))==en_cards
assert digest('SELECT r.* FROM review_logs r JOIN cards c ON r.card_id=c.id WHERE c.deck_id=? ORDER BY r.id',(english,))==en_logs
assert call(f'/decks/{english}/fsrs/params')==en_params
print('PASS preview makes no writes; stale settings/reviews reject apply; rebuild preserves IDs and other deck records')
call(f'/decks/{fixture}',method='DELETE')
assert db.execute('SELECT count(*) FROM deck_settings WHERE deck_id=?',(fixture,)).fetchone()[0]==0
assert db.execute('SELECT count(*) FROM deck_fsrs_params WHERE deck_id=?',(fixture,)).fetchone()[0]==0
call(f'/decks/{fixture}/fsrs/params',{},status=404)
print('PASS deleting deck cascades settings and cannot resurrect parameters')
# Same log time falls on different learning days under different deck cutoffs.
from datetime import datetime, timezone
hour=datetime.now(timezone.utc).hour
original_timezone=call('/settings')['timezone']
call('/settings',{'timezone':'UTC'})
window_decks=[]
for rollover in [hour,(hour+1)%24]:
    deck=call('/decks',{'name':'clock usage test'})['id'];window_decks.append(deck)
    call(f'/decks/{deck}/settings',{'timezone':'UTC','rolloverHour':rollover,'newPerDay':2})
    card=call(f'/decks/{deck}/cards',{'front':'clock card','back':'answer'})['id']
    with db:
        db.execute('INSERT INTO review_logs(card_id,rating,review_at,state) VALUES(?,?,?,?)',(card,3,int(time.time()*1000)-2*3600000,0))
first=call(f'/decks/{window_decks[0]}/cards/due')['usage']
second=call(f'/decks/{window_decks[1]}/cards/due')['usage']
assert first['newCount']==0 and second['newCount']==1,(first,second)
for deck in window_decks: call(f'/decks/{deck}',method='DELETE')
call('/settings',{'timezone':original_timezone})
print('PASS daily usage respects each deck cutoff at the same instant')

call(f'/decks/{japanese}',method='DELETE')
