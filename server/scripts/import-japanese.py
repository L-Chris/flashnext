"""Apply a prepared Japanese import atomically. Dry-run by default; optional verified cards."""
import argparse,hashlib,json,sqlite3,time
from pathlib import Path

ROOT=Path(__file__).resolve().parent

def compact(value):return json.dumps(value,ensure_ascii=False,separators=(',',':'))

def import_plan(db,plan,report,apply=False,cards=False):
    payload=json.loads(Path(plan).read_text())
    source=json.loads((ROOT/'resources/japanese-n5-source.json').read_text())
    membership=json.loads((ROOT/'resources/japanese-n5-membership.json').read_text())
    assert payload['sourceId']==source['sourceId'] and payload['sources']==source['dictionaries'], 'Unexpected source snapshot'
    assert [(r['sourceId'],r['headword'],r['reading']) for r in payload['rows']]==[tuple(r) for r in membership], 'Membership changed'
    c=sqlite3.connect(f'file:{Path(db).resolve()}?mode={"rw" if apply else "ro"}',uri=True,timeout=30);c.row_factory=sqlite3.Row;c.execute('pragma foreign_keys=on')
    changes=dict(newWords=0,newEntities=0,newTags=0,newSenses=0,newDecks=0,newCards=0)
    c.execute('begin immediate' if apply else 'begin')
    try:
        deck=c.execute("select id from decks where name='日语单词' and language='ja'").fetchone()
        deck_id=deck['id'] if deck else -1
        if not deck:
            changes['newDecks']+=1
            if apply:deck_id=c.execute("insert into decks(name,description,language,created_at) values ('日语单词','日语 N5 · 假名、释义与例句','ja',?)",(int(time.time()*1000),)).lastrowid
        for i,r in enumerate(payload['rows']):
            assert r['reading'] and r['translation'] and r['definitionStatus'] in {'ready','pending'}
            key=r['lexicalKey'];assert key==f"ja:openjlpt:{r['sourceId']}"
            metadata=compact(dict(sourceId=payload['sourceId'],sourceRevision=payload['sources']['openjlptRevision'],jmdictId=r['sourceRow']['jmdict_id'],reviewReason=r['reason'],original=r['sourceRow'],reviewed=r.get('reviewed'),jmdict=r['jmdict'],kaikki=r['kaikki'],sources=payload['sources']))
            values=(r['headword'],r['reading'],r['pos'],r['translation'],r['romaji'],r['definitionStatus'],compact(r['readings']),compact(r['spellings']),metadata)
            existing=c.execute('select * from words where lexical_key=?',(key,)).fetchone()
            if existing:
                assert existing['language']=='ja'
                assert tuple(existing[k] for k in ['headword','reading','pos','translation','romaji','definition_status','readings','spellings','source_metadata'])==values, f'Existing Japanese word changed: {key}'
                wid=existing['id']
            else:
                assert not c.execute('select 1 from knowledge_entities where canonical_key=?',(key,)).fetchone(), f'Entity identity conflict: {key}'
                changes['newWords']+=1;changes['newEntities']+=1
                if apply:
                    now=int(time.time()*1000)
                    eid=c.execute('insert into knowledge_entities(kind,canonical_key,title,summary,created_at,updated_at) values (?,?,?,?,?,?)',('word',key,r['headword'],r['translation'],now,now)).lastrowid
                    wid=c.execute("insert into words(knowledge_entity_id,language,lexical_key,headword,reading,pos,translation,romaji,definition_status,readings,spellings,source_metadata) values (?,'ja',?,?,?,?,?,?,?,?,?,?)",(eid,key,*values)).lastrowid
                else:wid=-(i+1)
            if not c.execute("select 1 from word_tags where word_id=? and scheme='jlpt' and level=5",(wid,)).fetchone():
                changes['newTags']+=1
                if apply:c.execute("insert into word_tags(word_id,scheme,level,label) values (?,'jlpt',5,'N5')",(wid,))
            if r['definitionStatus']=='ready':
                ex=r['sourceRow'].get('examples',[])[:2]
                skey=key+':summary-v1'
                if not c.execute('select 1 from word_senses where source_key=?',(skey,)).fetchone():
                    changes['newSenses']+=1
                    if apply:c.execute('insert into word_senses(word_id,source,source_key,source_revision,pos,tags,sense_idx,gloss,gloss_language,example_details,examples,zh) values (?,?,?,?,?,?,?,?,?,?,?,?)',
                        (wid,'japanese-n5-v1',skey,payload['sources']['rawSha256'],r['pos'],'[]',0,r['translation'],'zh',compact(ex),compact([x['ja'] for x in ex]),'[]'))
                if cards and not c.execute('select 1 from cards where word_id=?',(wid,)).fetchone():
                    changes['newCards']+=1
                    if apply:
                        back='\n'.join(filter(None,[r['reading'],r['pos'],r['translation']]))
                        now=int(time.time()*1000)
                        c.execute('insert into cards(deck_id,word_id,front,back,due,created_at) values (?,?,?,?,?,?)',(deck_id,wid,r['headword'],back,now,now))
        result=dict(applied=False,planSha256=hashlib.sha256(Path(plan).read_bytes()).hexdigest(),**changes)
        out=Path(report);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,ensure_ascii=False,indent=2))
        if apply:c.commit();result['applied']=True
        else:c.rollback()
        out.write_text(json.dumps(result,ensure_ascii=False,indent=2));return result
    except BaseException:c.rollback();raise
    finally:c.close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--plan',required=True);p.add_argument('--report',required=True);p.add_argument('--apply',action='store_true');p.add_argument('--cards',action='store_true');a=p.parse_args()
    print(json.dumps(import_plan(a.db,a.plan,a.report,a.apply,a.cards),ensure_ascii=False))
