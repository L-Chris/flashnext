import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

S = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(S))
from lib.study_pronunciations import parse_oxford, display_ipa, matches_word, system_back, word_poses, scope, comparable_ipa, verified_alias_entries
spec = importlib.util.spec_from_file_location('scoped_import', S / 'import-study-pronunciations.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Parsing(unittest.TestCase):
    def test_headword_british_only_and_explicit_variant(self):
        html = b'''<div class="entry" id="reuse_1"><div class="webtop"><h1 class="headword">reuse</h1><span class="pos">verb</span>
          <span class="phonetics"><div class="phons_br"><span class="phon">/ri:z/</span></div>
          <div class="phons_n_am"><span class="phon">/US/</span></div></span>
          <span class="phonetics"><div class="phons_br"><span class="phon">/ju:z/</span></div></span>
          <div><span class="phonetics"><div class="phons_br"><span class="phon">/ju:zd/</span></div></span></div>
          <div class="variants"><span class="v">re-use</span></div></div></div>'''.replace(b':', '\u02d0'.encode())
        e = parse_oxford(html, 'https://example.com')['entries'][0]
        self.assertEqual([s['ipa'] for s in e['sounds']], ['riːz', 'juːz'])
        self.assertTrue(matches_word(e, 're-use'))
        self.assertFalse(matches_word(e, 'reused'))

    def test_ipa_scope_and_weak_sounds(self):
        self.assertEqual(display_ipa('/ˈrɪpl/'), 'ˈrɪpl')
        self.assertEqual(display_ipa('/ˈkəʊ wɜːkə(r)/'), 'ˈkəʊ wɜːkə(r)')
        for v in ['[rɪpl]', '/bad;ipa/', '/ɝd/']:
            with self.assertRaises(ValueError): display_ipa(v)
        self.assertEqual(word_poses('vt.vi.'), ['verb'])
        self.assertEqual(word_poses('n. / adj.'), ['noun', 'adj'])
        self.assertEqual(system_back('sliːk', r'one\ntwo'), '/sliːk/\none\ntwo')

    def test_homograph_numbers_combined_pos_and_exact_verb_forms(self):
        html = '''<div class="entry" id="converse1"><div class="webtop"><h1 class="headword">converse<span class="hm">1</span></h1>
          <span class="pos">adjective , adverb</span><span class="phonetics"><div class="phons_br"><span class="phon">/kənˈvɜːs/</span></div></span>
          <table class="verb_forms_table"><tr class="verb_form" form="past"><td><div class="phons_br" wd="conversed"><span class="phon">/kənˈvɜːst/</span></div></td></tr></table>
          </div></div>'''.encode()
        entries = parse_oxford(html, 'https://example.com')['entries']
        self.assertEqual([(e['headword'], e['pos']) for e in entries], [('converse','adj'),('converse','adv'),('conversed','verb')])
        self.assertTrue(all([s['ipa'] for s in e['sounds']] == ['kənˈvɜːs'] for e in entries[:2]))

    def test_cross_pos_comparison_keeps_accent_and_primary_stress(self):
        self.assertEqual(comparable_ipa('/ˈrɪpl/'), comparable_ipa('/ˈɹɪpəl/'))
        self.assertNotEqual(comparable_ipa('/ˈkɒnvɜːs/'), comparable_ipa('/kənˈvɜːs/'))
        self.assertNotEqual(comparable_ipa('/kənˈvɜːs/'), comparable_ipa('/kənˈvɝs/'))
        self.assertIsNone(comparable_ipa('/rɪ-/'))
        self.assertIsNone(comparable_ipa('[rɪpl]'))

    def test_alias_cannot_inherit_synonym_or_shorter_word_pronunciation(self):
        for target,head,wrong,correct,pos in [
            ('bookstore','bookshop','ˈbʊkʃɒp','ˈbʊkstɔː','noun'),
            ('amongst','among','əˈmʌŋ','əˈmʌŋst','prep')]:
            entry=dict(headword=head,aliases=[target],pos=pos,sounds=[dict(ipa=wrong)])
            local=dict(revision='test',entries={target:[dict(pos=pos,sounds=[dict(ipa='/'+correct+'/',tags=['Received-Pronunciation'])])]})
            self.assertEqual(verified_alias_entries([entry],target,local),[])
            # The exact headword's own IPA is unaffected.
            self.assertEqual(verified_alias_entries([entry],head,local),[entry])
        entry=dict(headword='colour',aliases=['color'],pos='noun',sounds=[dict(ipa='ˈkʌlə(r)')])
        local=dict(revision='test',entries={'color':[dict(pos='noun',sounds=[dict(ipa='/ˈkʌlə/',tags=['Received-Pronunciation'])])]})
        result=verified_alias_entries([entry],'color',local)
        self.assertEqual(result[0]['sounds'],entry['sounds']);self.assertIn('evidence',result[0])
        self.assertEqual(verified_alias_entries([entry],'color',dict(entries={})),[])


class ScopedImport(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / 'stage.db'
        c = sqlite3.connect(self.db)
        c.executescript('''CREATE TABLE words(id INTEGER PRIMARY KEY,language TEXT,headword TEXT,lexical_key TEXT,pos TEXT,translation TEXT,phonetic TEXT,phonetic_legacy TEXT,phonetic_profile TEXT);
          CREATE TABLE cards(id INTEGER PRIMARY KEY,word_id INTEGER,deck_id INTEGER,front TEXT,back TEXT,state INTEGER,reps INTEGER,due INTEGER);
          CREATE TABLE ielts_usages(id INTEGER PRIMARY KEY,word_id INTEGER,pos TEXT,phonetic TEXT,phonetic_legacy TEXT,phonetic_profile TEXT);
          CREATE TABLE review_logs(id INTEGER PRIMARY KEY,card_id INTEGER,review_at INTEGER,state INTEGER);
          CREATE TABLE decks(id INTEGER PRIMARY KEY,language TEXT);
          CREATE TABLE word_pronunciations(id INTEGER PRIMARY KEY,word_id INTEGER,source_key TEXT UNIQUE,source TEXT,revision TEXT,pos TEXT,usage TEXT,accent TEXT,raw_ipa TEXT,display_ipa TEXT,status TEXT,note TEXT);
          INSERT INTO decks VALUES(9,'en');
          INSERT INTO words VALUES(1,'en','sleek','en:sleek','a.','one\\ntwo','ˈslik',NULL,'legacy');
          INSERT INTO words VALUES(2,'en','other','en:other','n.','note','other',NULL,'legacy');
          INSERT INTO cards VALUES(10,1,9,'sleek','/ˈslik/\none\ntwo',0,0,123);
          INSERT INTO cards VALUES(11,1,9,'sleek','my custom math \\(x\\)',2,4,456);
          INSERT INTO cards VALUES(12,2,9,'other','other',2,3,789);
          INSERT INTO ielts_usages VALUES(20,1,'adj.','old',NULL,'legacy');
          INSERT INTO review_logs VALUES(30,12,100,0);''')
        c.commit(); c.close()
        self.plan = {'scopeWordIds': [1], 'words': [{'wordId': 1, 'headword': 'sleek', 'primary': 'sliːk',
          'expected': {'lexical_key': 'en:sleek', 'pos': 'a.', 'translation': r'one\ntwo', 'phonetic': 'ˈslik', 'phonetic_profile': 'legacy'},
          'pronunciations': [{'ipa': 'sliːk', 'pos': 'adj', 'usage': 'smooth', 'reference': 'https://www.oxfordlearnersdictionaries.com/definition/english/sleek'}]}]}

    def tearDown(self): self.temp.cleanup()

    def dump(self):
        with sqlite3.connect(self.db) as c: return '\n'.join(c.iterdump())

    def run_apply(self, name='backup.db'):
        return module.apply_plan(self.db, self.plan, True, Path(self.temp.name) / name)

    def test_dry_run_then_apply_and_idempotence(self):
        before = self.dump()
        report = module.apply_plan(self.db, self.plan)
        self.assertEqual(self.dump(), before)
        self.assertEqual(report['changedCards'], [10])
        report = self.run_apply()
        self.assertEqual(report['preservedCustomCards'], [11])
        c = sqlite3.connect(self.db)
        self.assertEqual(c.execute('SELECT phonetic,phonetic_legacy FROM words WHERE id=1').fetchone(), ('sliːk', 'ˈslik'))
        self.assertEqual(c.execute('SELECT back,state,reps,due FROM cards WHERE id=10').fetchone(), ('/sliːk/\none\ntwo',0,0,123))
        self.assertEqual(c.execute('SELECT state,reps,due FROM cards WHERE id=11').fetchone(), (2,4,456))
        self.assertEqual(c.execute('SELECT phonetic FROM words WHERE id=2').fetchone(), ('other',))
        self.assertEqual(c.execute('SELECT count(*) FROM review_logs').fetchone(), (1,))
        c.close()
        before = self.dump(); report = self.run_apply('second.db')
        self.assertEqual(report['changedWords'], [])
        self.assertEqual(report['pronunciationChanges'], 0)
        self.assertEqual(self.dump(), before)

    def test_stale_input_rejects_every_write(self):
        self.plan['words'][0]['expected']['translation'] = 'stale'
        before = self.dump()
        with self.assertRaisesRegex(ValueError, 'content changed'): self.run_apply()
        self.assertEqual(self.dump(), before)

    def test_scope_excludes_old_reviews_and_includes_every_unlearned(self):
        with sqlite3.connect(self.db) as c:
            c.execute('INSERT INTO review_logs VALUES(31,11,200,0)')
            c.execute('INSERT INTO review_logs VALUES(32,12,300,2)')
        result = scope(self.db, 150)
        self.assertEqual(result['recentCards'], 1)
        self.assertEqual(result['unlearnedCards'], 1)
        self.assertEqual([w['id'] for w in result['words']], [1])

    def test_authorizer_blocks_learning_and_text_changes(self):
        c = sqlite3.connect(self.db); c.set_authorizer(module.authorize)
        for sql in ['UPDATE cards SET reps=99', "UPDATE words SET translation='x'", 'DELETE FROM review_logs']:
            with self.assertRaises(sqlite3.DatabaseError): c.execute(sql)
        c.close()


if __name__ == '__main__': unittest.main()
