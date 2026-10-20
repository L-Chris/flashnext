"""Verify additive import against a consistent before snapshot, including every learning field."""
import argparse,json,sqlite3
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--before',required=True);p.add_argument('--after',required=True);p.add_argument('--plan',required=True);p.add_argument('--report',required=True);a=p.parse_args()
before=sqlite3.connect(f'file:{Path(a.before).resolve()}?mode=ro',uri=True)
after=sqlite3.connect(f'file:{Path(a.after).resolve()}?mode=ro',uri=True)
payload=json.loads(Path(a.plan).read_text());repairs={r['id']:r for r in payload.get('entityRepairs',[])}
additions={'words':len(payload['newWords']),'knowledge_entities':len(payload['newWords']),'word_tags':payload['report']['newTags'],'word_senses':payload['report']['senses'],'word_pronunciations':len(payload['pronunciations'])}
checked={}
for (table,) in before.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'"):
    columns=[r[1] for r in before.execute(f'pragma table_info("{table}")')]
    names=','.join(f'"{n}"' for n in columns)
    original=before.execute(f'select {names} from "{table}" order by id').fetchall()
    current=after.execute(f'select {names} from "{table}" order by id').fetchall()
    assert len(current)==len(original)+additions.get(table,0),(table,len(original),len(current))
    by_id={r[0]:r for r in current}
    for row in original:
        expected=list(row)
        if table=='knowledge_entities' and row[0] in repairs:
            r=repairs[row[0]];idx=columns.index('canonical_key');assert expected[idx]==r['before'];expected[idx]=r['after']
        assert tuple(expected)==by_id[row[0]],(table,row[0],'Existing row changed')
    checked[table]=dict(before=len(original),after=len(current))
assert after.execute('pragma integrity_check').fetchone()[0]=='ok'
assert not after.execute('pragma foreign_key_check').fetchall()
assert after.execute("select count(*) from word_tags where scheme='toefl' and level=1").fetchone()[0]==4264
result=dict(ok=True,tables=checked,entityKeyRepairs=len(repairs))
Path(a.report).write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result))
