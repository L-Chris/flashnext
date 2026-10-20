import json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lib.japanese import kana,ruby_reading,candidates,valid_jmdict,prepare_rows

class JapaneseTests(unittest.TestCase):
    def test_readings_do_not_merge_distinct_vowels_or_morae(self):
        self.assertEqual(kana('ガクセイ'),'がくせい')
        self.assertNotEqual(kana('がくせい'),kana('がくせー'))
        self.assertEqual(ruby_reading({'form':'食べる','ruby':[['食','た']]}),'たべる')
        self.assertEqual(ruby_reading({'form':'学生','ruby':[['学','がく'],['生','せい']]}),'がくせい')
        self.assertEqual(ruby_reading({'form':'未確認'}),'')

    def test_jmdict_writing_reading_restrictions(self):
        e={'kanji':[{'text':'一日'}],'kana':[{'text':'いちにち','appliesToKanji':['一日']},{'text':'ついたち','appliesToKanji':['一日']}]}
        self.assertTrue(valid_jmdict({'word':'一日','reading':'いちにち'},e))
        self.assertFalse(valid_jmdict({'word':'一日','reading':'いちじつ'},e))
        self.assertFalse(valid_jmdict({'word':'別','reading':'いちにち'},e))

    def test_no_first_entry_wins_or_romaji_join(self):
        row={'word':'私','reading':'わたくし','pos':['pn']}
        def e(reading,meaning,pos='pron'):
            return {'word':'私','pos':pos,'forms':[{'form':'私','tags':['canonical'],'ruby':[['私',reading]]}],'senses':[{'glosses':[meaning]}]}
        matches=candidates(row,{'私':[e('わたし','我'),e('わたくし','私有物','noun'),e('わたくし','我')]})
        self.assertEqual(len(matches),1)
        self.assertEqual(matches[0]['senses'][0]['glosses'],['我'])

    def test_automatic_match_requires_review_and_wrong_english_sense_is_rejected(self):
        row={'id':'id','word':'あっち','reading':'あっち','romaji':'acchi','pos':['pn'],'jmdict_id':1,'meanings':['there']}
        entry={'id':'1','kanji':[],'kana':[{'text':'あっち','appliesToKanji':['*']}],'sense':[{'appliesToKanji':['*'],'appliesToKana':['*'],'gloss':[{'text':'over there'}]}]}
        index={'あっち':[{'word':'あっち','pos':'pron','senses':[{'glosses':['我']}]}]}
        self.assertEqual(prepare_rows([row],{'1':entry},index)[0]['definitionStatus'],'pending')
        reviewed={'id':{'headword':'あっち','reading':'あっち','jmdictId':1,'translation':'那边','expectedEnglishPattern':'there'}}
        result=prepare_rows([row],{'1':entry},index,reviewed)[0]
        self.assertEqual((result['definitionStatus'],result['translation']),('ready','那边'))
        reviewed['id']['expectedEnglishPattern']='soap'
        with self.assertRaises(AssertionError):prepare_rows([row],{'1':entry},index,reviewed)

if __name__=='__main__':unittest.main()
