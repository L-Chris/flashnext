import importlib.util
import base64
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import wave

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


class QuietGateway(FixtureGateway):
    def __init__(self, word, always=False):
        super().__init__(word); self.always=always; self.transcriptions=0
    def speech_rows(self, rows, config, attempt=1):
        audio, info=super().speech_rows(rows,config,attempt)
        if self.always or self.calls==1:
            out=io.BytesIO()
            with wave.open(out,'wb') as f:
                f.setnchannels(1);f.setsampwidth(2);f.setframerate(24000);f.writeframes(b'\x01\x00'*12000)
            audio=out.getvalue()
        return audio,info
    def transcribe(self,audio,model):
        self.transcriptions+=1
        return super().transcribe(audio,model)


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

    def test_quiet_recording_retries_before_paid_recognition_and_final_mp3_passes_levels(self):
        from lib.audio_loudness import measure,passed,validate_processing
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p=self.fixture(Path(d));row=p['rows'][0];gateway=QuietGateway(row['headword'])
            value=generate_word(row,CONFIG,batch,gateway,attempts=2)
            self.assertEqual(value['status'],'accepted');self.assertEqual(gateway.calls,2)
            self.assertEqual(gateway.transcriptions,1)
            self.assertIn('too quiet',value['attempts'][0]['error'])
            validate_processing(value['audioProcessing'],value['sha256'])
            self.assertTrue(passed(measure(batch/value['audioFile'])))

    def test_permanently_quiet_recording_stops_at_retry_limit(self):
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p=self.fixture(Path(d));row=p['rows'][0];gateway=QuietGateway(row['headword'],always=True)
            value=generate_word(row,CONFIG,batch,gateway,attempts=2)
            self.assertEqual(value['status'],'needs_review');self.assertEqual(gateway.calls,2)
            self.assertEqual(gateway.transcriptions,0)

    def test_recent_learning_uses_first_review_and_freezes_30_learning_days(self):
        from datetime import datetime
        from zoneinfo import ZoneInfo
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p=self.fixture(Path(d));c=sqlite3.connect(db)
            start=int(datetime(2026,9,22,4,tzinfo=ZoneInfo('Asia/Shanghai')).timestamp()*1000)
            cards=[r[0] for r in c.execute('SELECT id FROM cards ORDER BY id')]
            def review(card,at,state=0):
                c.execute('INSERT INTO review_logs(card_id,rating,review_at,state,interval,stability,difficulty) VALUES (?,3,?,?,1,1,1)',(card,at,state))
            review(cards[1],start-1);review(cards[1],NOW-20,2)  # old word, recent review
            review(cards[2],start);review(cards[2],NOW-10,2)  # inclusive lower boundary
            review(cards[3],NOW+1)  # future record
            review(cards[4],start+1000)
            c.execute("UPDATE words SET phonetic='' WHERE id=(SELECT word_id FROM cards WHERE id=?)",(cards[4],))
            c.execute('UPDATE deck_settings SET new_per_day=0')  # history is independent of allowance
            c.commit();c.close()
            recent=prepare_plan(db,p['deckId'],30,NOW,selection='recently-learned')
            self.assertEqual([r['headword'] for r in recent['selections']],['elusive','read','plaque'])
            self.assertEqual([r['headword'] for r in recent['rows']],['elusive','plaque'])
            self.assertEqual(recent['firstStudyDate'],'2026-09-22')
            self.assertEqual(recent['lastStudyDate'],'2026-10-21')
            self.assertEqual(recent['blockedCards'],1);self.assertEqual(recent['existingAudioCards'],0)
            # Missing pronunciation remains visible; it is never counted as existing audio.
            self.assertEqual(recent['blocked'][0]['headword'],'read')

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

    def test_conditional_homophone_always_needs_independent_target_vowel(self):
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p=self.fixture(Path(d));r=dict(p['rows'][0],headword='wan',phonetic='wɒn')
            g=FixtureGateway('wan',transcript='one')
            g.phonetic_check=lambda audio,model:dict(model=model,transcript='/wʌn/')
            self.assertEqual(generate_word(r,CONFIG,batch,g,1)['status'],'needs_review')
            g.phonetic_check=lambda audio,model:dict(model=model,transcript='/wɒn/')
            accepted=generate_word(r,CONFIG,batch,g,1)
            self.assertEqual(accepted['status'],'accepted');validate_result(r,CONFIG,batch,accepted)
            forged=json.loads(json.dumps(accepted))
            forged['pronunciationCheck'].pop('requiresBlindPhoneticCheck')
            with self.assertRaises(ValueError):validate_result(r,CONFIG,batch,forged)

    def test_word_boundary_exception_still_requires_target_noun_stress(self):
        with tempfile.TemporaryDirectory() as d:
            db,batch,media,p=self.fixture(Path(d));r=dict(p['rows'][0],headword='turnout',phonetic='ˈtɜːnaʊt')
            g=FixtureGateway('turnout',transcript='turn out');value=generate_word(r,CONFIG,batch,g,1)
            self.assertEqual(value['status'],'accepted')
            self.assertEqual(value['checks'][0]['matchType'],'dictionary-word-boundary')
            value['pronunciationCheck']['stressMatches']=False
            with self.assertRaises(ValueError):validate_result(r,CONFIG,batch,value)


if __name__=='__main__':unittest.main()
