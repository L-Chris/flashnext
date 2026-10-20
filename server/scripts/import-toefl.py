"""Transactional TOEFL import. Default dry-run; never creates cards or updates existing words."""
import argparse, hashlib, json, sqlite3, time
from pathlib import Path
from lib.toefl import load_source


def import_plan(db, plan, report, apply=False):
    payload=json.loads(Path(plan).read_text())
    manifest,names=load_source()
    assert payload['source']==manifest and payload['names']==names, 'Unexpected source snapshot'
    assert {w['headword'] for w in payload['newWords']} | set(payload['existing']) == set(names)
    c=sqlite3.connect(f'file:{Path(db).resolve()}?mode={"rw" if apply else "ro"}',uri=True,timeout=30)
    c.row_factory=sqlite3.Row;c.execute('pragma foreign_keys=on')
    counts=dict(entityKeyRepairs=0,newWords=0,newTags=0,enrichedWords=0,newSenses=0,newPronunciations=0,newCards=0)
    # All writes roll back together on any stale data, conflict or malformed record.
    c.execute('begin immediate' if apply else 'begin')
    try:
        english_filter=" where language='en'" if any(r[1]=='language' for r in c.execute('pragma table_info(words)')) else ''
        words={r['headword']:dict(r) for r in c.execute('select * from words'+english_filter)}
        for n,original in payload['existing'].items():
            assert words.get(n)==original, f'Existing word changed; prepare again: {n}'
        for repair in payload.get('entityRepairs', []):
            linked=c.execute('select headword from words where knowledge_entity_id=?',(repair['id'],)).fetchone()
            assert linked and f'en:word:{linked[0]}' == repair['after'], 'Entity owner changed since preparation'
            row=c.execute('select canonical_key from knowledge_entities where id=?',(repair['id'],)).fetchone()
            assert row and row[0] in {repair['before'],repair['after']}, 'Entity changed since preparation'
            if row[0]==repair['after']: continue
            assert not c.execute('select 1 from knowledge_entities where canonical_key=?',(repair['after'],)).fetchone()
            counts['entityKeyRepairs']+=1
            if apply:c.execute('update knowledge_entities set canonical_key=? where id=?',(repair['after'],repair['id']))
        for w in payload['newWords']:
            n=w['headword'];key=f'en:word:{n}'
            if n in words:
                current=words[n]
                assert all(current[k]==w[v] for k,v in [('translation','translation'),('phonetic','phonetic'),('pos','pos'),('phonetic_legacy','phoneticLegacy'),('phonetic_profile','phoneticProfile')]), f'New word conflicts: {n}'
                entity=c.execute('select canonical_key from knowledge_entities where id=?',(current['knowledge_entity_id'],)).fetchone()
                assert entity and entity[0]==key, f'Entity identity conflict: {n}'
                continue
            assert (not c.execute('select 1 from knowledge_entities where canonical_key=?',(key,)).fetchone() or (not apply and any(r['before']==key for r in payload.get('entityRepairs', [])))), f'Existing entity requires explicit reconciliation: {n}'
            assert w['translation'].strip() and '\\n' not in w['translation'], f'Invalid meaning: {n}'
            counts['newWords']+=1
            if apply:
                eid=c.execute('insert into knowledge_entities(kind,canonical_key,title,summary,created_at,updated_at) values (?,?,?,?,?,?)',('word',key,n,w['translation'],int(time.time()*1000),int(time.time()*1000))).lastrowid
                migrated = 'lexical_key' in {r[1] for r in c.execute('pragma table_info(words)')}
                if migrated:
                    wid=c.execute('insert into words(headword,knowledge_entity_id,pos,translation,phonetic,phonetic_legacy,phonetic_profile,language,lexical_key) values (?,?,?,?,?,?,?,?,?)',(n,eid,w['pos'],w['translation'],w['phonetic'],w['phoneticLegacy'],w['phoneticProfile'],'en',key)).lastrowid
                else:wid=c.execute('insert into words(headword,knowledge_entity_id,pos,translation,phonetic,phonetic_legacy,phonetic_profile) values (?,?,?,?,?,?,?)',(n,eid,w['pos'],w['translation'],w['phonetic'],w['phoneticLegacy'],w['phoneticProfile'])).lastrowid
            else: wid=-counts['newWords']
            words[n]=dict(id=wid)
        for n in names:
            wid=words[n]['id']
            if not c.execute("select 1 from word_tags where word_id=? and scheme='toefl' and level=1",(wid,)).fetchone():
                counts['newTags']+=1
                if apply:c.execute("insert into word_tags(word_id,scheme,level,label) values (?,'toefl',1,'托福词汇')",(wid,))
        for n,senses in payload['senses'].items():
            wid=words[n]['id']
            current=c.execute('select * from word_senses where word_id=?',(wid,)).fetchall()
            # Preserve legacy/manual sense rows; only add missing source records.
            if any(r['source']!='kaikki-toefl-v1' for r in current):continue
            keys={r['source_key'] for r in current}
            added=0
            for idx,s in enumerate(senses):
                key='kaikki-toefl:'+hashlib.sha256(json.dumps([payload['kaikkiRevision'],n,s['sourceKey']],ensure_ascii=False).encode()).hexdigest()
                if key in keys:continue
                added+=1
                if apply:c.execute('insert into word_senses(word_id,sense_idx,gloss,examples,zh,source,source_key,source_revision,pos,tags) values (?,?,?,?,?,?,?,?,?,?)',
                    (wid,idx,s['gloss'],s['examples'],s['zh'],'kaikki-toefl-v1',key,payload['kaikkiRevision'],s['pos'],s['tags']))
            counts['newSenses']+=added;counts['enrichedWords']+=bool(added)
        for s in payload['pronunciations']:
            key='toefl-kaikki:'+hashlib.sha256(json.dumps([payload['kaikkiRevision'],s],sort_keys=True,ensure_ascii=False).encode()).hexdigest()
            if c.execute('select 1 from word_pronunciations where source_key=?',(key,)).fetchone():continue
            counts['newPronunciations']+=1
            if apply:c.execute('insert into word_pronunciations(word_id,source_key,source,revision,pos,usage,accent,raw_ipa,display_ipa,status,note) values (?,?,?,?,?,?,?,?,?,?,?)',
                (words[s['headword']]['id'],key,'kaikki-toefl-v1',payload['kaikkiRevision'],s['pos'],'',s['accent'],s['rawIpa'],s['displayIpa'],s['status'],s['note']))
        result=dict(applied=False,sourceId=manifest['sourceId'],planSha256=hashlib.sha256(Path(plan).read_bytes()).hexdigest(),**counts)
        # Persist the manifest before committing the transaction.
        dest=Path(report);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(json.dumps(result,ensure_ascii=False,indent=2))
        if apply:c.commit();result['applied']=True
        else:c.rollback()
        dest.write_text(json.dumps(result,ensure_ascii=False,indent=2))
        return result
    except BaseException:
        c.rollback();raise
    finally:c.close()


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--plan',required=True);p.add_argument('--report',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
    print(json.dumps(import_plan(a.db,a.plan,a.report,a.apply),ensure_ascii=False))
