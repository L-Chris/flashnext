"""Read-only audit: distinguish incomplete references from normal usage notes."""
import argparse,collections,datetime,json,re,sqlite3
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--output');a=p.parse_args()
c=sqlite3.connect(f'file:{Path(a.db).resolve()}?mode=ro',uri=True);c.row_factory=sqlite3.Row
rows=[dict(r) for r in c.execute('select id,headword,translation from words')];by_name={r['headword']:r for r in rows}
cards=collections.defaultdict(list)
for r in c.execute('select id,word_id,back from cards'):cards[r['word_id']].append(dict(r))
first={r[0]:r[1] for r in c.execute('select c.word_id,min(l.review_at) from cards c join review_logs l on l.card_id=c.id group by c.word_id')}
now=datetime.datetime.now(datetime.timezone.utc);cut=int((now-datetime.timedelta(days=7)).timestamp()*1000)
results=collections.defaultdict(list)
form=r'(?:过去式|过去分词|现在分词|复数|第三人称单数)'
for r in rows:
 text=re.sub(r'^(?:[a-z&]+\.[,\s]*)+','',r['translation'].strip())
 text=re.sub(r'^(?:<(?!<)[^<>]+>\s*)+','',text)
 alias=re.fullmatch(r'(?:=|＝|同|见|参见|same as|variant of|alternative spelling of)\s*([A-Za-z][A-Za-z\s\-’\x27]*)',text,re.I)
 inflection=re.fullmatch(r'([A-Za-z][A-Za-z\-’\x27]*)\s*的\s*'+form+r'(?:\s*(?:和|与|及|、)\s*'+form+r')*(?:形式)?[。.]?',text)
 category=''
 if alias:category='reference_only'
 elif inflection:category='form_only'
 elif text in {'translation','definition','undefined','null'} or not text:category='placeholder'
 elif not re.search(r'[\u3400-\u9fff]',r['translation']):category='no_chinese_review'
 if not category:continue
 target=alias[1].strip() if alias else (inflection[1] if inflection else None)
 target_row=by_name.get(target) if target else None
 results[category].append({**r,'target':target,'exactTargetPresent':bool(target_row),'targetTranslation':target_row['translation'] if target_row else None,'cardIds':[x['id'] for x in cards[r['id']]],'backs':[x['back'] for x in cards[r['id']]],'firstStudy':datetime.datetime.fromtimestamp(first[r['id']]/1000,datetime.timezone(datetime.timedelta(hours=8))).isoformat() if first.get(r['id']) else None,'newLast7Days':bool(first.get(r['id']) and first[r['id']]>=cut)})
summary={'scannedWords':len(rows),'windowStart':datetime.datetime.fromtimestamp(cut/1000,datetime.timezone.utc).isoformat(),'windowEnd':now.isoformat(),'categories':{k:{'words':len(v),'cardedWords':sum(bool(r['cardIds']) for r in v),'newLast7Days':sum(r['newLast7Days'] for r in v)} for k,v in results.items()}}
out={'summary':summary,'findings':results}
if a.output:
 dest=Path(a.output);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(json.dumps(out,ensure_ascii=False,indent=2))
print(json.dumps(summary,ensure_ascii=False,indent=2))
for category,found in results.items():
 print(category)
 for r in found:print(json.dumps({k:v for k,v in r.items() if k not in {'backs','targetTranslation'}},ensure_ascii=False))
