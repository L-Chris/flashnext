"""Verify a repair against its exact pre-migration backup and JSON plan."""
import json,sqlite3,sys
before,after,plan_file=sys.argv[1:]
plan=json.load(open(plan_file));a=sqlite3.connect(f'file:{before}?mode=ro',uri=True);b=sqlite3.connect(f'file:{after}?mode=ro',uri=True)
rules={'words':('translation',plan['words']), 'cards':('back',plan['cards']), 'knowledge_entities':('summary',plan['entities'])}
counts={}
for (table,) in a.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'"):
 cols=[r[1] for r in a.execute(f'pragma table_info("{table}")')]
 left=a.execute(f'select * from "{table}" order by id').fetchall();right=b.execute(f'select * from "{table}" order by id').fetchall()
 assert len(left)==len(right),f'row count changed: {table}'
 changes={r['id']:r for r in rules[table][1]} if table in rules else {}
 changed=0
 for old,new in zip(left,right):
  key=old[cols.index('id')]
  assert new[cols.index('id')]==key
  if key not in changes:assert old==new,f'unexpected change in {table}:{key}';continue
  field=rules[table][0];change=changes[key]
  assert old[cols.index(field)]==change['before'] and new[cols.index(field)]==change['after']
  for i,col in enumerate(cols):
   if col==field or table=='knowledge_entities' and col=='updated_at':continue
   if table=='knowledge_entities' and col=='canonical_key' and 'keyAfter' in change:
    assert old[i]==change['keyBefore'] and new[i]==change['keyAfter'];continue
   if table=='words' and col=='pos' and 'posAfter' in change:
    assert old[i]==change['posBefore'] and new[i]==change['posAfter'];continue
   assert old[i]==new[i],f'protected field changed {table}:{key}:{col}'
  changed+=1
 assert changed==len(changes)
 counts[table]={'rows':len(left),'expectedChanges':changed}
assert not b.execute('pragma foreign_key_check').fetchall()
assert b.execute('pragma integrity_check').fetchone()[0]=='ok'
print(json.dumps(counts,indent=2))
