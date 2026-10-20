"""Check all pre-existing fields and all learning records across the multilingual migration."""
import argparse,json,sqlite3
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--before',required=True);p.add_argument('--after',required=True);p.add_argument('--plan',required=True);p.add_argument('--report',required=True);a=p.parse_args()
b=sqlite3.connect(f'file:{Path(a.before).resolve()}?mode=ro',uri=True);c=sqlite3.connect(f'file:{Path(a.after).resolve()}?mode=ro',uri=True)
payload=json.loads(Path(a.plan).read_text());total=len(payload['rows']);ready=sum(r['definitionStatus']=='ready' for r in payload['rows'])
additions={'words':total,'knowledge_entities':total,'word_tags':total,'word_senses':ready,'cards':ready,'decks':1}
checked={}
for (table,) in b.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'"):
    columns=[r[1] for r in b.execute(f'pragma table_info("{table}")')];select=','.join('"'+n+'"' for n in columns)
    before=b.execute(f'select {select} from "{table}" order by id').fetchall();after=c.execute(f'select {select} from "{table}" order by id').fetchall();current={r[0]:r for r in after}
    assert len(after)==len(before)+additions.get(table,0),(table,len(before),len(after))
    for row in before:assert row==current[row[0]],(table,row[0],'existing data changed')
    checked[table]={'before':len(before),'after':len(after)}
assert c.execute("select count(*) from words where language='ja'").fetchone()[0]==total
assert c.execute("select count(*) from words where language='en' and (lexical_key is null or lexical_key!='en:word:'||headword)").fetchone()[0]==0
assert not c.execute("select 1 from cards c join words w on w.id=c.word_id join decks d on d.id=c.deck_id where w.language!=d.language").fetchall()
assert not c.execute("select 1 from cards c join words w on w.id=c.word_id where w.language='ja' and (w.definition_status!='ready' or w.reading='' or w.translation='')").fetchall()
assert not c.execute('pragma foreign_key_check').fetchall()
assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
result=dict(ok=True,total=total,ready=ready,pending=total-ready,tables=checked)
Path(a.report).write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result))
