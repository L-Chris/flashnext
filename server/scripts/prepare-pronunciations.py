"""Read-only preparation. Writes a versioned JSON candidate file, never the DB."""
import argparse,collections,hashlib,json,sqlite3,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'lib'))
from pronunciation import normalize,PROFILE
p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--output',required=True);p.add_argument('--data',default=str(Path(__file__).parent/'data/kaikki.org-dictionary-English.jsonl'));a=p.parse_args()
c=sqlite3.connect(f'file:{Path(a.db).resolve()}?mode=ro',uri=True)
english_filter=" where language='en'" if any(r[1]=='language' for r in c.execute('pragma table_info(words)')) else ''
words={w:i for i,w in c.execute('select id,headword from words'+english_filter)}
overrides=json.loads((Path(__file__).parent/'resources/pronunciation-overrides.json').read_text())
overridden={x['word'] for x in overrides}
rows={};digest=hashlib.sha256();counts=collections.Counter()
with open(a.data,'rb') as f:
 for n,line in enumerate(f,1):
  digest.update(line);e=json.loads(line);w=e.get('word')
  if e.get('lang_code')!='en' or w not in words:continue
  senses=e.get('senses',[])
  form=bool(senses) and all(s.get('form_of') or s.get('alt_of') for s in senses)
  # Preserve homograph identity; gloss is a hint, not an automatic sense mapping.
  hint=next((s.get('glosses',[''])[-1] for s in senses if s.get('glosses')),'')
  usage=f"词源 {e.get('etymology_number','1')} · {hint}"[:220]
  for s in e.get('sounds',[]):
   raw=s.get('ipa')
   if not raw:continue
   accent,display,reason=normalize(raw,s.get('tags',[]),s.get('note',''),form)
   if w in overridden:display='';reason='使用已核验的词性／词形校订项'
   if senses and all(set(x.get('tags',[])) & {'obsolete','archaic','dated','rare','nonstandard'} for x in senses):display='';reason='全部义项均有限定标签'
   identity=json.dumps([w,e.get('pos',''),usage,raw,s.get('tags',[]),s.get('note','')],ensure_ascii=False)
   key='kaikki:'+hashlib.sha256(identity.encode()).hexdigest()
   rows[key]={'sourceKey':key,'wordId':words[w],'headword':w,'source':'kaikki','pos':e.get('pos',''),'usage':usage,'accent':accent,'rawIpa':raw,'displayIpa':display,'status':'accepted' if display else 'review','note':json.dumps({'tags':s.get('tags',[]),'note':s.get('note',''),'reason':reason},ensure_ascii=False)}
  if n%100000==0:print('scanned',n,flush=True)
revision=digest.hexdigest()
for r in rows.values():r['revision']=revision
# Explicit reviewed lexical overrides. Never generalize these into global vowel conversion rules.
for x in overrides:
 w=x['word']
 if w in words:
  key='reviewed-20260922:'+hashlib.sha256(json.dumps(x,sort_keys=True).encode()).hexdigest()
  rows[key]={'sourceKey':key,'wordId':words[w],'headword':w,'source':'reviewed-20260922','revision':'2026-09-22','pos':x['pos'],'usage':x['usage'],'accent':'UK','rawIpa':x['ipa'],'displayIpa':x['ipa'],'status':'accepted','note':x['reference'],'priority':x['priority']}
for r in rows.values():counts[r['status']]+=1
out={'profile':PROFILE,'sha256':revision,'rows':list(rows.values()),'counts':counts}
Path(a.output).parent.mkdir(parents=True,exist_ok=True);Path(a.output).write_text(json.dumps(out,ensure_ascii=False))
print(json.dumps({'profile':PROFILE,'sha256':revision,'rows':len(rows),'counts':counts},ensure_ascii=False))
