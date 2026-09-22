"""Idempotent transactional import. Default dry-run. Requires the Prisma schema update."""
import argparse,json,sqlite3,sys,collections,re
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'lib'))
from pronunciation import back,PROFILE
p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--input',required=True);p.add_argument('--report',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
payload=json.loads(Path(a.input).read_text());assert payload['profile']==PROFILE
rows=payload['rows'];c=sqlite3.connect(f'file:{Path(a.db).resolve()}?mode={"rw" if a.apply else "ro"}',uri=True,timeout=30);c.row_factory=sqlite3.Row
c.execute('pragma foreign_keys=on')
words={r['id']:dict(r) for r in c.execute('select * from words')};groups=collections.defaultdict(list)
for r in rows:
 assert r['wordId'] in words and words[r['wordId']]['headword']==r['headword'], 'word identity changed; regenerate candidates'
 assert r['status'] in ['accepted','review']
 if r['status']=='accepted':
  assert r['accent']=='UK' and r['displayIpa'] and '\n' not in r['displayIpa']
 groups[r['wordId']].append(r)
cards_by_word=collections.defaultdict(list)
for card in c.execute('select id,word_id,front,back from cards'):cards_by_word[card['word_id']].append(dict(card))
changes=[];protected=0;card_changes=[]
for wid,w in words.items():
 accepted=sorted((r for r in groups[wid] if r['status']=='accepted'),key=lambda r:(r.get('priority',10),r['source']!='reviewed-20260922',r['pos']!='noun',r['usage'],r['displayIpa']))
 if not accepted and w.get('phonetic_profile')!=PROFILE:continue
 new=accepted[0]['displayIpa'] if accepted else (w.get('phonetic_legacy') or '')
 profile=PROFILE if accepted else 'legacy';old=w['phonetic']
 if new==old and w.get('phonetic_profile')==profile:continue
 changes.append({'wordId':wid,'word':w['headword'],'old':old,'new':new,'profile':profile,'sourceKey':accepted[0]['sourceKey'] if accepted else 'legacy'})
 for card in cards_by_word[wid]:
  # Only exact system-generated cards are updated. A manually changed front/back is preserved.
  if card['front']==w['headword'] and card['back']==back(old,w['translation']):
   if card['back']!=back(new,w['translation']):card_changes.append((back(new,w['translation']),card['id']))
  else:protected+=1
usage_changes=[]
for u in c.execute('select * from ielts_usages'):
 u=dict(u);w=words[u['word_id']]['headword']
 poses={p for short,p in [('n.','noun'),('v.','verb'),('adj.','adj'),('adv.','adv')] if re.search(r'(^|/|\s)'+re.escape(short),u['pos'])}
 candidates=[r for r in groups[u['word_id']] if r['status']=='accepted' and r['pos'] in poses]
 if w=='bow': candidates=[r for r in candidates if r['displayIpa']==('baʊ' if '鞠躬' in u['meaning'] else 'bəʊ')]
 values={r['displayIpa'] for r in candidates}
 if len(values)==1 or u.get('phonetic_profile')==PROFILE:
  new=next(iter(values)) if len(values)==1 else (u.get('phonetic_legacy') or '')
  profile=PROFILE if len(values)==1 else 'legacy'
  if new!=u['phonetic'] or u.get('phonetic_profile')!=profile:usage_changes.append({'id':u['id'],'old':u['phonetic'],'new':new,'profile':profile})
report={'profile':PROFILE,'mode':'apply' if a.apply else 'dry-run','candidateRows':len(rows),'acceptedWords':sum(any(r['status']=='accepted' for r in g) for g in groups.values()),'changedWords':len(changes),'changedCards':len(card_changes),'protectedCustomCards':protected,'changedIeltsUsages':len(usage_changes),'usageChanges':usage_changes,'changes':changes}
if a.apply:
 with c:
  c.execute('create temp table incoming_keys (key text primary key)')
  c.executemany('insert into incoming_keys values (?)',[(r['sourceKey'],) for r in rows])
  c.execute("delete from word_pronunciations where source in ('kaikki','reviewed-20260922') and source_key not in (select key from incoming_keys)")
  c.executemany('''insert into word_pronunciations(word_id,source_key,source,revision,pos,usage,accent,raw_ipa,display_ipa,status,note) values (?,?,?,?,?,?,?,?,?,?,?)
   on conflict(source_key) do update set revision=excluded.revision,display_ipa=excluded.display_ipa,status=excluded.status,note=excluded.note''',[(r['wordId'],r['sourceKey'],r['source'],r['revision'],r['pos'],r['usage'],r['accent'],r['rawIpa'],r['displayIpa'],r['status'],r['note']) for r in rows])
  c.execute('update words set phonetic_legacy=phonetic where phonetic_legacy is null')
  for u in usage_changes:c.execute('update ielts_usages set phonetic_legacy=coalesce(phonetic_legacy,phonetic),phonetic=?,phonetic_profile=? where id=?',(u['new'],u['profile'],u['id']))
  for x in changes:c.execute('update words set phonetic=?,phonetic_profile=? where id=?',(x['new'],x['profile'],x['wordId']))
  c.executemany('update cards set back=? where id=?',card_changes)
Path(a.report).parent.mkdir(parents=True,exist_ok=True);Path(a.report).write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ('changes','usageChanges')},ensure_ascii=False))
