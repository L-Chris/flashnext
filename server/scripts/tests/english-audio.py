import importlib.util
import base64
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from lib.english_audio import (CONFIG, EnglishGateway, fingerprint, generate_word, normalized_transcript,
    prepare_plan, speech_body, validate_result)


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


imp=load('english_import',ROOT/'import-english-audio.py')
ja=load('audio_test_helpers',ROOT/'tests/japanese-audio.py')
verify=load('media_verification',ROOT/'verify-japanese-audio.py')
NOW=1792555200000  # 2026-10-21 12:00 Asia/Shanghai


class FixtureGateway:
    def __init__(self,word,correct=True,transcript=None):self.word,self.correct,self.calls,self.transcript=word,correct,0,transcript
    def speech_rows(self,rows,config,attempt=1):
        self.calls+=1;return ja.audio_bytes(),dict(model=config['resolvedModel'])
    def transcribe(self,audio,model):return dict(model=model,transcript=self.transcript if self.transcript is not None else self.word)
    def review(self,audio,row,model):
        return dict(model=model,targetIpa=row['phonetic'],confidence='high',heardIpa=row['phonetic'],
            wordMatches=True,britishCompatible=self.correct,stressMatches=True,singleWord=True)


class EnglishAudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ja.AudioTests.setUpClass();cls.sql=ja.AudioTests.sql

    def fixture(self,root):
        db=root/'db.sqlite';c=sqlite3.connect(db);c.executescript(self.sql)
        deck=c.execute("INSERT INTO decks(name,language) VALUES ('English','en')").lastrowid
        c.execute("INSERT INTO deck_settings(deck_id,new_per_day,review_per_day,timezone,rollover_hour,updated_at) VALUES (?,2,500,'Asia/Shanghai',4,?)",(deck,NOW))
        for i,word in enumerate(['elusive','hue','plaque','polar','read','record']):
            wid=c.execute("INSERT INTO words(language,lexical_key,headword,pos,translation,phonetic,phonetic_profile) VALUES ('en',?,?,'n.','n. 测试','test','learner-ipa-uk-v1')",('en:word:'+word,word)).lastrowid
            c.execute("INSERT INTO word_pronunciations(word_id,source_key,source,revision,pos,usage,accent,raw_ipa,display_ipa,status) VALUES (?,?,'reviewed','test','noun','测试','UK','/test/','test','accepted')",(wid,word))
            card=c.execute("INSERT INTO cards(deck_id,word_id,front,back,state,reps) VALUES (?,?,?,'/test/\nn. 测试',?,?)",(deck,wid,word,2 if i==0 else 0,1 if i==0 else 0)).lastrowid
            if i==0:c.execute("INSERT INTO review_logs(card_id,rating,review_at,state,interval,stability,difficulty) VALUES (?,3,?,0,1,1,1)",(card,NOW-1000))
        c.commit();c.close()
        plan=prepare_plan(db,deck,2,NOW);batch=root/'batch'
        imp.shared.atomic_json(batch/'plan.json',plan)
        return db,batch,root/'media',plan

    def ready(self,root):
        db,batch,media,plan=self.fixture(root);row=plan['rows'][0]
        value=generate_word(row,CONFIG,batch,FixtureGateway(row['headword']))
        self.assertEqual(value['status'],'accepted')
        return db,batch,media,plan,value

    def test_scope_includes_today_learned_and_deducts_used_slots(self):
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p=self.fixture(Path(d))
            self.assertEqual([r['headword'] for r in p['rows']],['elusive','hue','plaque','polar'])
            self.assertEqual(p['newSlotsUsedToday'],1);self.assertEqual(p['todayRemaining'],1)
            self.assertEqual([r['studyDate'] for r in p['rows']],['2026-10-21']*2+['2026-10-22']*2)
            c=sqlite3.connect(db);c.execute('UPDATE cards SET state=2,reps=3');c.commit();c.row_factory=sqlite3.Row
            for r in p['rows']:imp.check_identity(c,r)
            c.close()

    def test_wrong_transcript_or_pronunciation_never_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p=self.fixture(Path(d));r=p['rows'][0]
            for g in [FixtureGateway(r['headword'],transcript='different'),FixtureGateway(r['headword'],correct=False)]:
                value=generate_word(r,CONFIG,batch,g,attempts=1)
                self.assertEqual(value['status'],'needs_review')
                with self.assertRaises(ValueError):validate_result(r,CONFIG,batch,value)

    def test_cache_reused_but_pronunciation_change_invalidates_it(self):
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p,v=self.ready(Path(d));r=p['rows'][0];g=FixtureGateway(r['headword'])
            self.assertTrue(generate_word(r,CONFIG,batch,g)['cached']);self.assertEqual(g.calls,0)
            r=dict(r,phonetic='different')
            with self.assertRaises(ValueError):validate_result(r,CONFIG,batch,v)

    def test_import_and_repeat_keep_nonmedia_tables_unchanged_and_support_rollback(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);db,batch,media,p,v=self.ready(root);before=verify.snapshot(db)
            dry=imp.import_batch(db,batch,media,root/'dry.json',limit=1)
            self.assertEqual(dry['newLinks'],1);self.assertFalse(media.exists())
            applied=imp.import_batch(db,batch,media,root/'apply.json',True,root/'backup.db',limit=1)
            self.assertEqual(applied['newLinks'],1);self.assertEqual(verify.snapshot(db),before)
            again=imp.import_batch(db,batch,media,root/'again.json',limit=1)
            self.assertEqual(again['newLinks'],0)
            self.assertIn('en-',Path(applied['journal']).name)
            imp.shared.rollback_batch(db,media,applied['journal'],True)
            self.assertEqual(verify.snapshot(db),before);self.assertEqual(list(media.glob('*.mp3')),[])

    def test_changed_ipa_or_card_content_blocks_import(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);db,batch,media,p,v=self.ready(root)
            c=sqlite3.connect(db);c.execute("UPDATE words SET phonetic='wrong' WHERE id=?",(p['rows'][0]['wordId'],));c.commit();c.close()
            with self.assertRaises(ValueError):imp.import_batch(db,batch,media,root/'dry.json',limit=1)
            self.assertFalse(media.exists())

    def test_qa_evidence_is_required_and_models_are_restricted(self):
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p,v=self.ready(Path(d));r=p['rows'][0]
            for bad in [dict(v,pronunciationCheck={}),dict(v,model='other-tts')]:
                with self.assertRaises(ValueError):validate_result(r,CONFIG,batch,bad)

    def test_model_formats_and_strict_transcript_normalization(self):
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p=self.fixture(Path(d));r=p['rows'][0]
            for model in [CONFIG['resolvedModel'],*CONFIG['fallbackModels']]:
                body=speech_body([r],CONFIG,model)
                text=body['contents'][0]['parts'][0]['text']
                if '3.1' in model:self.assertIn('British English',text)
                else:self.assertEqual(text,r['headword']);self.assertIn(r['phonetic'],body['contents'][0]['parts'][0]['speech_metadata']['style'])
            self.assertEqual(normalized_transcript('Elusive.'),'elusive')
            self.assertNotEqual(normalized_transcript('alumnus'),normalized_transcript('alumni'))
            self.assertNotEqual(normalized_transcript('over view'),normalized_transcript('overview'))

    def test_model_failure_falls_back_only_to_the_three_approved_models(self):
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p=self.fixture(Path(d));gateway=EnglishGateway(CONFIG['gateway'],'test-token');calls=[]
            def request(path,body,native):
                calls.append(path)
                if len(calls)<3:raise RuntimeError('Gateway HTTP 400: unavailable model')
                return {'candidates':[{'content':{'parts':[{'inlineData':{'mimeType':'audio/wav','data':base64.b64encode(ja.audio_bytes()).decode()}}]}}]}
            gateway.json=request
            audio,source=gateway.speech_rows([p['rows'][0]],CONFIG)
            self.assertEqual(source['model'],'gemini-3.8-flash-lite-tts')
            self.assertEqual(len(calls),3);self.assertEqual(len(source['fallbackHistory']),2)

    def test_dictionary_homophone_requires_explicit_evidence_and_correct_target_ipa(self):
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p=self.fixture(Path(d));r=dict(p['rows'][0],headword='stellar',phonetic='ˈstelə(r)')
            value=generate_word(r,CONFIG,batch,FixtureGateway('stellar',transcript='Stella'),1)
            self.assertEqual(value['status'],'accepted')
            self.assertEqual(value['checks'][0]['transcript'],'Stella')
            self.assertEqual(value['checks'][0]['matchType'],'dictionary-homophone')
            validate_result(r,CONFIG,batch,value)
            no_evidence=dict(value,checks=[dict(model=CONFIG['asrModel'],transcript='Stella')])
            with self.assertRaises(ValueError):validate_result(r,CONFIG,batch,no_evidence)
            forged=dict(value,checks=[dict(model=CONFIG['asrModel'],transcript='different',matchType='exact')])
            with self.assertRaises(ValueError):validate_result(r,CONFIG,batch,forged)
            other=dict(r,phonetic='ˈstelɚ')
            bad=generate_word(other,CONFIG,batch,FixtureGateway('stellar',transcript='Stella'),1)
            self.assertEqual(bad['status'],'needs_review')

    def test_medium_qa_requires_matching_target_free_phonetic_confirmation(self):
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p=self.fixture(Path(d));r=dict(p['rows'][0],headword='plank',phonetic='plæŋk')
            g=FixtureGateway('plank');original=g.review
            g.review=lambda *args:dict(original(*args),confidence='medium')
            g.phonetic_check=lambda audio,model:dict(model=model,transcript='/blæŋk/')
            self.assertEqual(generate_word(r,CONFIG,batch,g,1)['status'],'needs_review')
            g.phonetic_check=lambda audio,model:dict(model=model,transcript='/plæŋk/')
            value=generate_word(r,CONFIG,batch,g,1)
            self.assertEqual(value['status'],'accepted');validate_result(r,CONFIG,batch,value)
            self.assertEqual(g.calls,1,'Retry should reuse the unchanged saved WAV rather than call TTS again')
            value['pronunciationCheck'].pop('blindPhoneticCheck')
            with self.assertRaises(ValueError):validate_result(r,CONFIG,batch,value)

    def test_word_boundary_exception_still_requires_target_noun_stress(self):
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p=self.fixture(Path(d));r=dict(p['rows'][0],headword='turnout',phonetic='ˈtɜːnaʊt')
            g=FixtureGateway('turnout',transcript='turn out');value=generate_word(r,CONFIG,batch,g,1)
            self.assertEqual(value['status'],'accepted')
            self.assertEqual(value['checks'][0]['matchType'],'dictionary-word-boundary')
            value['pronunciationCheck']['stressMatches']=False
            with self.assertRaises(ValueError):validate_result(r,CONFIG,batch,value)


if __name__=='__main__':unittest.main()
