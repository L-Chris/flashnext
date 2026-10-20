"""Integration checks for a disposable preview DB and server; never production."""
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import urllib.error
import urllib.request

base, filename = sys.argv[1:]
assert base.startswith('http://127.0.0.1:') and ':9000' not in base
assert Path(filename).name != 'flashnext.db'
c = sqlite3.connect(filename)

def call(path, body=None, status=200, method=None):
    request = urllib.request.Request(base+'/api'+path, None if body is None else json.dumps(body).encode(),
        {'Content-Type':'application/json'}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response: code, payload = response.status, json.load(response)
    except urllib.error.HTTPError as e: code, payload = e.code, json.load(e)
    assert code == status, (path,code,payload)
    return payload.get('data', payload)

def digest(table):
    return hashlib.sha256(repr(c.execute('SELECT * FROM '+table+' ORDER BY 1').fetchall()).encode()).hexdigest()

original = call('/settings')
protected = ['cards','words','review_logs','personal_knowledge_states','deck_fsrs_params']
before = {t:digest(t) for t in protected}
prior = call('/decks')
prior_settings = {d['id']:call(f"/decks/{d['id']}/settings") for d in prior}
created=[]
try:
    for bad in [{}, {'timezone':None}, {'timezone':'invalid/timezone'}, {'timezone':'UTC','newPerDay':9}, {'reviewPerDay':0}]:
        call('/settings',bad,status=400)
    assert call('/settings') == original
    chosen = 'America/New_York' if original['timezone'] != 'America/New_York' else 'Asia/Tokyo'
    changed = call('/settings',{'timezone':chosen})
    assert changed['timezone'] == chosen and changed['version'] == original['version']+1
    assert call('/settings',{'timezone':chosen}) == changed
    for deck_id,old in prior_settings.items():
        now=call(f'/decks/{deck_id}/settings')
        assert now['timezone']==chosen and now['version']==old['version']+1
        for key in ['newPerDay','reviewPerDay','rolloverHour','audioAutoplay','showNewCardAnswerImmediately','autoRevealAnswerSeconds']:
            assert now[key]==old[key],(deck_id,key)
        assert call(f'/decks/{deck_id}/fsrs/params')['timezone']==chosen
        assert {t:digest(t) for t in protected}==before
    for index in range(2): created.append(call('/decks',{'name':f'global clock fixture {index}'})['id'])
    a,b=created
    assert call(f'/decks/{a}/settings')['timezone']==chosen
    call(f'/decks/{a}/settings',{'timezone':original['timezone']},status=400)
    call(f'/decks/{a}/settings',{'timezone':chosen,'newPerDay':3,'rolloverHour':6})
    assert call(f'/decks/{a}/settings')['rolloverHour']==6
    assert call(f'/decks/{b}/settings')['rolloverHour']==4
    assert call('/settings')==changed
    call('/settings',{'timezone':'UTC'})
    assert all(call(f'/decks/{id}/settings')['timezone']=='UTC' for id in created)
    assert call(f'/decks/{a}/settings')['rolloverHour']==6
    print('PASS global timezone validation, all-deck inheritance, independent limits/rollovers, idempotent save and version invalidation')
finally:
    for id in created: call(f'/decks/{id}',method='DELETE')
    call('/settings',{'timezone':original['timezone']})
assert {t:digest(t) for t in protected}==before
for id,old in prior_settings.items():
    now=call(f'/decks/{id}/settings')
    for key in old:
        if key not in ['version','updatedAt']: assert now[key]==old[key],(id,key)
print('PASS timezone changes preserve cards, words, learning states, review logs and FSRS weights')
c.close()
