import sqlite3,json,collections,re
from pathlib import Path
R=Path(__file__).resolve().parents[2]; D=R/'server/scripts/data'; O=Path(__file__).parent
c=sqlite3.connect(f'file:{R}/server/data/flashnext.db?mode=ro',uri=True); c.row_factory=sqlite3.Row
words={r['headword']:dict(r) for r in c.execute('select id,headword,phonetic from words')}
cardwords={r[0] for r in c.execute('select distinct w.headword from words w join cards c on c.word_id=w.id')}
ielts={r[0] for r in c.execute("select w.headword from words w join word_tags t on t.word_id=w.id where t.scheme='ielts'")}
samples=set('go home day name bed bird teacher water hot bath record permit bow resume read minute happy near hair poor apple address environment mantle'.split())
flags=collections.defaultdict(set); details=collections.defaultdict(list); tagcounts=collections.Counter()
for line in (D/'kaikki.org-dictionary-English.jsonl').open():
 e=json.loads(line); w=e.get('word');
 if e.get('lang_code')!='en' or w not in words: continue
 for s in e.get('sounds',[]):
  ipa=s.get('ipa')
  if not ipa: continue
  flags['any_ipa'].add(w); tags=s.get('tags',[]); tagcounts.update(tags)
  uk=any(t in tags for t in ('UK','Received-Pronunciation','Standard-Southern-British'))
  if uk: flags['uk_tagged'].add(w)
  if 'US' in tags or 'General-American' in tags: flags['us_tagged'].add(w)
  if not tags: flags['untagged'].add(w)
  if uk and ipa.startswith('/') and ipa.endswith('/'): flags['uk_slash'].add(w)
  if w in samples: details[w].append({'pos':e.get('pos'),'etymology_number':e.get('etymology_number'),**s})
summary={}
for name,group in [('all',set(words)),('cards',cardwords),('ielts',ielts)]:
 summary[name]={'total':len(group),'empty':sum(not words[w]['phonetic'] for w in group),**{k:len(v&group) for k,v in flags.items()}}
 summary[name]['symbol_counts']={ch:sum(ch in words[w]['phonetic'] for w in group) for ch in ['ɝ','ɚ','ɛ','ː',':',"'",'ˈ','əʊ','oʊ','[','/','ɪ','ɡ']}
rows=[dict(r) for r in c.execute('select d.name,count(*) as cards from cards c join decks d on c.deck_id=d.id group by d.id')]
out={'coverage':summary,'decks':rows,'tag_counts':tagcounts,'samples':{w:{'current':words.get(w),'kaikki':details[w]} for w in sorted(samples)}}
(O/'results.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
print(json.dumps({'coverage':summary,'decks':rows,'tag_counts':tagcounts.most_common(25)},ensure_ascii=False,indent=2))
