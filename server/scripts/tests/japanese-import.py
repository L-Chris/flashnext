import importlib.util,json,sqlite3,subprocess,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('japanese_import',ROOT/'import-japanese.py');imp=importlib.util.module_from_spec(spec);spec.loader.exec_module(imp)
PLAN=ROOT/'data/japanese-n5-2026-10-19/plan.json'

class JapaneseImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema_sql=subprocess.check_output(['node',str(ROOT.parent/'node_modules/prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel',str(ROOT.parent/'prisma/schema.prisma'),'--script'],cwd=ROOT.parent,text=True)

    def fixture(self,path):
        c=sqlite3.connect(path);c.executescript(self.schema_sql);c.commit();return c

    def test_dry_run_idempotence_and_pending_never_gets_cards(self):
        with tempfile.TemporaryDirectory() as directory:
            db=Path(directory)/'test.db';c=self.fixture(db);before=list(c.iterdump());c.close()
            dry=imp.import_plan(db,PLAN,Path(directory)/'dry.json',cards=True)
            self.assertEqual(dry['newWords'],674);self.assertEqual(list(sqlite3.connect(db).iterdump()),before)
            applied=imp.import_plan(db,PLAN,Path(directory)/'apply.json',apply=True,cards=True)
            self.assertEqual(applied['newCards'],343)
            again=imp.import_plan(db,PLAN,Path(directory)/'repeat.json',apply=True,cards=True)
            self.assertTrue(all(again[k]==0 for k in ['newWords','newTags','newCards','newSenses','newDecks']))
            c=sqlite3.connect(db)
            self.assertEqual(c.execute("select count(*) from cards c join words w on w.id=c.word_id where w.definition_status='pending'").fetchone()[0],0)
            # Same spelling in another language has a distinct identity.
            c.execute("insert into words(language,lexical_key,headword) values ('en','en:word:学生','学生')");c.commit()
            self.assertEqual(c.execute("select count(*) from words where headword='学生'").fetchone()[0],2)

    def test_mid_import_conflict_rolls_back_deck_words_cards_and_tags(self):
        with tempfile.TemporaryDirectory() as directory:
            db=Path(directory)/'test.db';c=self.fixture(db)
            payload=json.loads(PLAN.read_text());key=payload['rows'][2]['lexicalKey']
            c.execute("insert into knowledge_entities(kind,canonical_key,title,summary,created_at,updated_at) values ('word',?,'conflict','',0,0)",(key,));c.commit()
            before=list(c.iterdump());c.close()
            with self.assertRaises(AssertionError):imp.import_plan(db,PLAN,Path(directory)/'apply.json',apply=True,cards=True)
            self.assertEqual(list(sqlite3.connect(db).iterdump()),before)

if __name__=='__main__':unittest.main()
