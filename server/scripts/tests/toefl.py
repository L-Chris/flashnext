import importlib.util,json,sqlite3,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from lib.toefl import load_source,project
spec=importlib.util.spec_from_file_location('import_toefl',ROOT/'import-toefl.py')
imp=importlib.util.module_from_spec(spec);spec.loader.exec_module(imp)

class ToeflTests(unittest.TestCase):
    def test_pinned_membership(self):
        manifest,names=load_source()
        self.assertEqual(len(names),4264)
        self.assertIn('polish',names)
        self.assertIn('X-ray',names)
        self.assertEqual(manifest['authorityType'],'community')

    def test_all_entries_no_example_required_and_quotes_not_examples(self):
        senses=project([{'pos':'noun','senses':[{'glosses':['old'], 'tags':['archaic']}, {'glosses':['modern'],'examples':[{'type':'quotation','text':'Quotation'},{'type':'example','text':'An example.'}]}]}, {'pos':'verb','senses':[{'glosses':['second entry, no examples'],'form_of':[{'word':'root'}]}]}])
        self.assertEqual(len(senses),3)
        self.assertEqual(senses[0]['gloss'],'modern')
        self.assertEqual(json.loads(senses[0]['examples']),['An example.'])
        self.assertEqual(senses[1]['pos'],'verb')
        self.assertEqual(senses[2]['sourceKey'],'0:0')

    def fixture(self,d):
        db=Path(d)/'test.db';c=sqlite3.connect(db)
        c.executescript('''
        create table words(id integer primary key,headword text unique,knowledge_entity_id integer,pos text,translation text,phonetic text,phonetic_legacy text,phonetic_profile text);
        create table knowledge_entities(id integer primary key,canonical_key text unique,kind text,title text,summary text,created_at text,updated_at text);
        create table word_tags(id integer primary key,word_id integer,scheme text,level integer,label text,unique(word_id,scheme,level));
        create table word_senses(id integer primary key,word_id integer,sense_idx integer,gloss text,examples text,zh text,source text,source_key text unique,source_revision text,pos text,tags text);
        create table word_pronunciations(id integer primary key,word_id integer,source_key text unique,source text,revision text,pos text,usage text,accent text,raw_ipa text,display_ipa text,status text,note text);
        create table cards(id integer primary key,word_id integer,reps integer,due text);
        create table review_logs(id integer primary key,card_id integer,rating integer);
        insert into knowledge_entities values(1,'en:word:polish','word','Polish','波兰的','old','old');
        insert into words values(1,'Polish',1,'a.','波兰的','','','legacy');
        insert into cards values(1,1,100,'2030-01-01');
        insert into review_logs values(1,1,3);
        ''');c.commit();c.close()
        word=lambda n:dict(headword=n,pos='v.',translation='擦亮',phonetic='pɒlɪʃ',phoneticLegacy='',phoneticProfile='learner-ipa-uk-v1')
        payload=dict(source={'sourceId':'test'},names=['polish','new'],existing={},newWords=[word('polish'),word('new')],entityRepairs=[dict(id=1,before='en:word:polish',after='en:word:Polish')],senses={'polish':[dict(sourceKey='0:0',pos='verb',gloss='To shine.',examples='[]',zh='[]',tags='[]')]},pronunciations=[],kaikkiRevision='fixture')
        plan=Path(d)/'plan.json';plan.write_text(json.dumps(payload));return db,plan,payload

    def test_dry_run_idempotence_and_memory_preservation(self):
        with tempfile.TemporaryDirectory() as d:
            db,plan,payload=self.fixture(d)
            with patch.object(imp,'load_source',return_value=(payload['source'],payload['names'])):
                before='\n'.join(sqlite3.connect(db).iterdump())
                result=imp.import_plan(db,plan,Path(d)/'dry.json')
                self.assertEqual(result['newWords'],2)
                self.assertEqual(before,'\n'.join(sqlite3.connect(db).iterdump()))
                imp.import_plan(db,plan,Path(d)/'apply.json',True)
                repeat=imp.import_plan(db,plan,Path(d)/'repeat.json',True)
                self.assertTrue(all(repeat[k]==0 for k in ['newWords','newTags','newSenses','entityKeyRepairs','newCards']))
            c=sqlite3.connect(db)
            self.assertEqual(c.execute('select * from cards').fetchall(),[(1,1,100,'2030-01-01')])
            self.assertEqual(c.execute('select canonical_key from knowledge_entities where id=1').fetchone()[0],'en:word:Polish')
            self.assertEqual(c.execute('select headword,translation from words where id=1').fetchone(),('Polish','波兰的'))

    def test_mid_transaction_conflict_rolls_back_every_write(self):
        with tempfile.TemporaryDirectory() as d:
            db,plan,payload=self.fixture(d)
            c=sqlite3.connect(db);c.execute("insert into knowledge_entities(id,canonical_key) values(2,'en:word:new')");c.commit()
            before='\n'.join(c.iterdump());c.close()
            with patch.object(imp,'load_source',return_value=(payload['source'],payload['names'])):
                with self.assertRaises(AssertionError):imp.import_plan(db,plan,Path(d)/'apply.json',True)
            self.assertEqual(before,'\n'.join(sqlite3.connect(db).iterdump()))

if __name__=='__main__':unittest.main()
