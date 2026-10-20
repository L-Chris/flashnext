"""Exercise a preview server backed by a disposable database, never production.
Usage: python server/scripts/tests/rich-cards-api.py http://127.0.0.1:19003 /dev/shm/flashnext-rich-cards/stage.db [upload-limit]
Optional ffmpeg exercises all four audio formats. The preview server's file limit must match the third argument.
"""
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
import shutil
import sqlite3
import socket
from urllib.parse import urlparse
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import wave

base, filename = sys.argv[1:3]
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 20*1024*1024
assert Path(filename).name != 'flashnext.db', 'Use a disposable database copy'
db=sqlite3.connect(filename)

def request(path, body=None, *, method=None, status=200, headers=None, binary=False):
    if isinstance(body,dict) or isinstance(body,list):
        body=json.dumps(body).encode();headers={'Content-Type':'application/json',**(headers or {})}
    req=urllib.request.Request(base+'/api'+path,data=body,method=method,headers=headers or {})
    try:
        with urllib.request.urlopen(req,timeout=45) as r:code,data,h=r.status,r.read(),dict(r.headers)
    except urllib.error.HTTPError as r:code,data,h=r.code,r.read(),dict(r.headers)
    assert code==status,(path,code,data[:1000])
    if binary:return data,h
    obj=json.loads(data)
    return obj.get('data',obj)

def upload(data,name='test.wav',status=200,extra=None,field='file'):
    boundary='test-'+uuid.uuid4().hex
    body=f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{name}"\r\nContent-Type: text/plain\r\n\r\n'.encode()+data+b'\r\n'
    if extra:
        body+=f'--{boundary}\r\nContent-Disposition: form-data; name="bad"\r\n\r\n{extra}\r\n'.encode()
    body+=f'--{boundary}--\r\n'.encode()
    return request('/media',body,status=status,headers={'Content-Type':f'multipart/form-data; boundary={boundary}'})

def digest(sql,args=()):return hashlib.sha256(repr(db.execute(sql,args).fetchall()).encode()).hexdigest()

def memory(card):return {k:card[k] for k in ['stability','difficulty','state','reps','lapses','learningSteps','interval','due','lastReview']}

old_decks=request('/decks')
old_cards=digest('SELECT * FROM cards ORDER BY id')
old_logs=digest('SELECT * FROM review_logs ORDER BY id')
old_params=digest('SELECT * FROM deck_fsrs_params ORDER BY deck_id')
fixture=request('/decks',{'name':'rich cards fixture'})['id']
other=request('/decks',{'name':'isolated fixture'})['id']
settings=request(f'/decks/{fixture}/settings')
assert settings['autoRevealAnswerSeconds']==10
assert not settings['audioAutoplay'] and not settings['showNewCardAnswerImmediately']
other_settings=request(f'/decks/{other}/settings')
for bad in [{'autoRevealAnswerSeconds':0},{'autoRevealAnswerSeconds':-1},{'autoRevealAnswerSeconds':1.5},{'autoRevealAnswerSeconds':'10'},{'autoRevealAnswerSeconds':True},{'autoRevealAnswerSeconds':3601},{'audioAutoplay':1},{'audioAutoplay':None},{'showNewCardAnswerImmediately':'true'}]:
    request(f'/decks/{fixture}/settings',bad,status=400)
print('PASS defaults are 10 seconds, settings validation is strict')

wav=io.BytesIO()
with wave.open(wav,'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(8000);f.writeframes(b'\x00\x00'*800)
sound=wav.getvalue()
asset=upload(sound,'../测试.wav')
assert asset['mimeType']=='audio/wav' and asset['bytes']==len(sound)
assert '/' not in asset['originalName']
assert 'storageKey' not in asset and 'sha256' not in asset
assert upload(sound,'renamed.mp3')['id']==asset['id'],'MIME must come from bytes, not filename'
# Native clients may submit a binary file part without a filename.
boundary='no-filename-upload'
bare_sound=sound[:-2]+b'\x77\x01'
bare_body=f'--{boundary}\r\nContent-Disposition: form-data; name="file"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()+bare_sound+f'\r\n--{boundary}--\r\n'.encode()
bare=request('/media',bare_body,headers={'Content-Type':f'multipart/form-data; boundary={boundary}'})
assert bare['originalName']=='audio.wav'
request(f"/media/{bare['id']}",method='DELETE')
# A malformed duplicate upload must never delete an already stored asset.
upload(sound,extra='unexpected',status=400)
received,_=request(f"/media/{asset['id']}/content",binary=True)
assert received==sound
upload(b'<script>not audio</script>','fake.mp3',status=415)
upload(b'',status=400)
upload(sound,field='wrong',status=400)
upload(b'X'*(limit+1),status=413)
request('/media',{},status=415)
request('/media',b'bad',headers={'Content-Type':'multipart/form-data'},status=400)
# Concurrent identical uploads create one asset and one permanent file.
unique_sound=sound[:-2]+b'\x01\x00'
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:duplicates=list(pool.map(lambda _:upload(unique_sound),range(4)))
assert len({a['id'] for a in duplicates})==1
request(f"/media/{duplicates[0]['id']}",method='DELETE')
# The exact limit is accepted; a byte over the limit was rejected above.
if limit <= 100000 and (limit-44)%2==0:
    exact=io.BytesIO()
    with wave.open(exact,'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(8000);f.writeframes(b'\x00\x00'*((limit-44)//2))
    result=upload(exact.getvalue())
    assert result['bytes']==limit
    request(f"/media/{result['id']}",method='DELETE')
# A malformed upload must not leave a new asset behind.
before_assets=db.execute('SELECT COUNT(*) FROM media_assets').fetchone()[0]
upload(sound[:-2]+b'\x02\x00',extra='bad extra part',status=400)
assert db.execute('SELECT COUNT(*) FROM media_assets').fetchone()[0]==before_assets
# Close a socket halfway through an upload; partial temporary files must be removed.
parsed=urlparse(base)
if parsed.scheme=='http':
    boundary='aborted-upload-test'
    partial=f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()+sound[:800]
    with socket.create_connection((parsed.hostname,parsed.port or 80)) as connection:
        headers=f'POST /api/media HTTP/1.1\r\nHost: {parsed.hostname}\r\nContent-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: {len(partial)+1000}\r\n\r\n'.encode()
        connection.sendall(headers+partial)
        time.sleep(.05)
    time.sleep(.2)
    assert db.execute('SELECT COUNT(*) FROM media_assets').fetchone()[0]==before_assets
    temporary=Path(filename).parent/'media'/'.tmp'
    if temporary.is_dir():assert not list(temporary.iterdir())
    request('/decks')
print('PASS streamed upload, detected MIME, deduplication, concurrent uploads, exact size boundary and interrupted upload cleanup')

raw,headers=request(f"/media/{asset['id']}/content",binary=True)
assert raw==sound and headers['Content-Type'].startswith('audio/wav')
assert headers['Accept-Ranges']=='bytes'
head,hh=request(f"/media/{asset['id']}/content",method='HEAD',binary=True)
assert not head and int(hh['Content-Length'])==len(sound)
for value,expected in [('bytes=0-15',sound[:16]),('bytes=10-',sound[10:]),('bytes=-12',sound[-12:]),('bytes=0-999999',sound)]:
    data,h=request(f"/media/{asset['id']}/content",headers={'Range':value},status=206,binary=True)
    assert data==expected and 'Content-Range' in h
for value in ['bytes=999999-','bytes=5-1','bytes=-0','bytes=','bytes=0-1,3-4']:
    request(f"/media/{asset['id']}/content",headers={'Range':value},status=416)
full,_=request(f"/media/{asset['id']}/content",headers={'Range':'bytes=0-1','If-Range':'"old-etag"'},binary=True)
assert full==sound
cached,_=request(f"/media/{asset['id']}/content",headers={'If-None-Match':headers['Etag'] if 'Etag' in headers else headers['ETag']},status=304,binary=True)
assert not cached
print('PASS GET/HEAD, exact/open/suffix ranges, 416 handling, If-Range and conditional caching')

front='**求解** \\(x^2=4\\)'
back='$$x=\\pm 2$$'
preview=request('/content/preview',{'front':front,'back':back,'contentFormat':'markdown_math'})
assert preview['valid'] and '<math' in preview['front']['html']
css,ch=request('/content/assets/katex.min.css',binary=True)
assert b'.katex' in css and ch['Content-Type'].startswith('text/css')
font,fh=request('/content/assets/fonts/KaTeX_Main-Regular.woff2',binary=True)
assert font.startswith(b'wOF2')
invalid=request('/content/preview',{'front':'line\n\n\\(\\noSuchMath\\)'})
assert not invalid['valid'] and invalid['front']['errors'][0]['line']==3
request('/content/preview',{'contentFormat':'html'},status=400)
request('/content/assets/fonts/not-a-font.txt',status=404)
links=[{'mediaId':asset['id'],'side':'front','position':0},{'mediaId':asset['id'],'side':'back','position':0}]
card=request(f'/decks/{fixture}/cards',{'front':front,'back':back,'contentFormat':'markdown_math','media':links})
card_id=card['id'];before=memory(card)
assert card['contentFormat']=='markdown_math' and len(card['media'])==2
assert card['presentation']['answerRevealAfterMs']==10000
assert all('storageKey' not in m and 'asset' not in m for m in card['media'])
request(f"/media/{asset['id']}",method='DELETE',status=409)
# Content errors/invalid relationships must not partially replace content or attachments.
for patch,status in [({'front':'\\(\\noSuchMath\\)','media':[]},422),({'front':'would change','media':[{'mediaId':str(uuid.uuid4()),'side':'front','position':0}]},404),({'media':links+links},400),({'contentFormat':None},400),({'due':'2030-01-01'},400)]:
    request(f'/cards/{card_id}',patch,method='PATCH',status=status)
    assert request(f'/cards/{card_id}')==card
edited=request(f'/cards/{card_id}',{'back':'**答案** \\(x=2\\)'},method='PATCH')
assert memory(edited)==before and edited['front']==front and len(edited['media'])==2
assert db.execute('SELECT COUNT(*) FROM review_logs WHERE card_id=?',(card_id,)).fetchone()[0]==0
# List/detail/queue/review/undo all use the same content+media+presentation shape.
listed=request(f'/decks/{fixture}/cards')['cards'][0]
assert listed['media']==edited['media'] and listed['presentation']==edited['presentation']
queue=request(f'/decks/{fixture}/cards/due')
assert queue['reviewOptions']['autoRevealAnswerSeconds']==10 and queue['cards'][0]['presentation']['answerRevealAfterMs']==10000
request(f'/decks/{fixture}/settings',{'audioAutoplay':True,'showNewCardAnswerImmediately':True})
assert request(f'/cards/{card_id}')['presentation']['answerRevealAfterMs']==0
assert request(f'/cards/{card_id}')['presentation']['audioAutoplay'] is True
assert request(f'/decks/{other}/settings')==other_settings
reviewed=request(f'/cards/{card_id}/review',{'rating':3})
assert reviewed['reps']==1 and reviewed['presentation']['answerRevealAfterMs']==10000
assert reviewed['media']==edited['media']
request(f'/decks/{fixture}/settings',{'autoRevealAnswerSeconds':None})
assert request(f'/cards/{card_id}')['presentation']['answerRevealAfterMs'] is None
undone=request(f'/cards/{card_id}/undo',{})
assert undone['reps']==0 and undone['presentation']['answerRevealAfterMs']==0
request(f'/decks/{fixture}/settings',{'showNewCardAnswerImmediately':False})
assert request(f'/cards/{card_id}')['presentation']['answerRevealAfterMs'] is None
# A learning card that has never been graded is not a pristine new card.
with db:db.execute('UPDATE cards SET state=1 WHERE id=?',(card_id,))
request(f'/decks/{fixture}/settings',{'showNewCardAnswerImmediately':True})
assert request(f'/cards/{card_id}')['presentation']['answerRevealAfterMs'] is None
with db:db.execute('UPDATE cards SET state=0 WHERE id=?',(card_id,))
print('PASS math preview/assets, atomic content editing, unchanged memory, uniform DTOs and immediate/delay/off/undo semantics')

shared=request(f'/decks/{other}/cards',{'front':'question','back':'answer','media':[links[0]]})
request(f'/decks/{fixture}',method='DELETE')
request(f"/media/{asset['id']}",method='DELETE',status=409)
assert request(f"/cards/{shared['id']}")['media'][0]['mediaId']==asset['id']
request(f"/cards/{shared['id']}",{'media':[]},method='PATCH')
request(f"/media/{asset['id']}",method='DELETE')
request(f"/media/{asset['id']}/content",status=404)
request(f'/cards/{card_id}',status=404)
request(f'/decks/{other}',method='DELETE')
assert digest('SELECT * FROM cards ORDER BY id')==old_cards
assert digest('SELECT * FROM review_logs ORDER BY id')==old_logs
assert digest('SELECT * FROM deck_fsrs_params ORDER BY deck_id')==old_params
print('PASS shared asset lifetime, attachment cascade, deletion protection, and original cards/logs/FSRS parameters unchanged')

if shutil.which('ffmpeg'):
    with tempfile.TemporaryDirectory() as temp:
        source=Path(temp)/'source.wav';source.write_bytes(sound)
        for ext,codec,expected in [('mp3','libmp3lame','audio/mpeg'),('m4a','aac','audio/mp4'),('ogg','libvorbis','audio/ogg')]:
            target=Path(temp)/('audio.'+ext)
            subprocess.run(['ffmpeg','-v','error','-i',str(source),'-c:a',codec,str(target)],check=True)
            result=upload(target.read_bytes(),target.name)
            assert result['mimeType']==expected,(ext,result)
            request(f"/media/{result['id']}",method='DELETE')
    print('PASS actual MP3, M4A and OGG generated by ffmpeg (WAV tested above)')
