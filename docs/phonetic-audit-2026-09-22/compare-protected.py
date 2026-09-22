"""Compare pre/post migration databases without exposing study contents."""
import sqlite3,hashlib,json,sys
before=sqlite3.connect(f'file:{sys.argv[1]}?mode=ro',uri=True);after=sqlite3.connect(f'file:{sys.argv[2]}?mode=ro',uri=True)
result={}
for (table,) in before.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'"):
 skip={'words':{'phonetic','phonetic_legacy','phonetic_profile'},'cards':{'back'},'ielts_usages':{'phonetic','phonetic_legacy','phonetic_profile'}}.get(table,set())
 cols=[r[1] for r in before.execute(f'pragma table_info("{table}")') if r[1] not in skip]
 sql='select '+','.join('"'+col+'"' for col in cols)+f' from "{table}" order by 1'
 a=before.execute(sql).fetchall();b=after.execute(sql).fetchall();assert a==b,f'protected data changed in {table}'
 result[table]={'rows':len(a),'unchanged':True}
assert not after.execute('pragma foreign_key_check').fetchall()
assert after.execute('pragma integrity_check').fetchone()[0]=='ok'
print(json.dumps(result,ensure_ascii=False,indent=2))
