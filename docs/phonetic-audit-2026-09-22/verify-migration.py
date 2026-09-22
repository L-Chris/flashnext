"""Run against a schema-migrated copy; verifies all protected columns and rerun identity."""
import sqlite3,json,hashlib,subprocess,sys
from pathlib import Path
R=Path(__file__).resolve().parents[2];db=sys.argv[1]
def snapshot():
 c=sqlite3.connect(db);out={}
 for (t,) in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'"):
  if t=='word_pronunciations':continue
  skip={'words':{'phonetic','phonetic_legacy','phonetic_profile'},'cards':{'back'},'ielts_usages':{'phonetic','phonetic_legacy','phonetic_profile'}}.get(t,set())
  cols=[x[1] for x in c.execute(f'pragma table_info("{t}")') if x[1] not in skip]
  data=c.execute(f'select '+','.join('"'+x+'"' for x in cols)+f' from "{t}" order by 1').fetchall()
  out[t]=hashlib.sha256(json.dumps(data,ensure_ascii=False).encode()).hexdigest()
 c.close();return out
c=sqlite3.connect(db)
# Ensure manual changes survive, on a word known to be normalized.
id=c.execute("select c.id from cards c join words w on w.id=c.word_id where w.headword='go'").fetchone()[0]
c.execute('update cards set back=? where id=?',('我的自定义笔记，不覆盖',id));c.commit();c.close()
before=snapshot()
for n in (1,2):
 subprocess.run([sys.executable,str(R/'server/scripts/import-pronunciations.py'),'--db',db,'--input',str(R/'server/scripts/data/pronunciations-v1.json'),'--report',str(R/f'docs/phonetic-audit-2026-09-22/copy-pass-{n}.json'),'--apply'],check=True)
 assert snapshot()==before,'protected table/column changed'
 c=sqlite3.connect(db)
 assert c.execute('select back from cards where id=?',(id,)).fetchone()[0]=='我的自定义笔记，不覆盖'
 records=c.execute('select * from word_pronunciations order by id').fetchall()
 if n==1: first=records
 else:assert records==first,'non-idempotent pronunciation identity'
 for w,want in [('go','ɡəʊ'),('day','deɪ'),('bed','bed'),('read','riːd'),('permit','ˈpɜːmɪt'),('resume','rɪˈzjuːm')]:
  assert c.execute('select phonetic from words where headword=?',(w,)).fetchone()[0]==want,w
 accepted=lambda w:set(c.execute("select p.pos,p.display_ipa from word_pronunciations p join words w on w.id=p.word_id where w.headword=? and p.status='accepted'",(w,)).fetchall())
 assert ('verb','red') in accepted('read') and ('verb','riːd') in accepted('read')
 assert ('noun','pəˈmɪt') not in accepted('permit')
 assert ('verb','baʊ') in accepted('bow') and ('noun','bəʊ') in accepted('bow')
 c.close()
r=json.loads((R/'docs/phonetic-audit-2026-09-22/copy-pass-2.json').read_text())
assert r['changedWords']==r['changedCards']==r['changedIeltsUsages']==0
print('PASS: protected tables/columns unchanged; custom card retained; sample lexemes correct; rerun stable.')
