import importlib.util
import io
import json
import math
from pathlib import Path
import sqlite3
import struct
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from unittest.mock import patch
import uuid
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from lib.japanese_audio import (DEFAULT_CONFIG, DailyQuotaExceeded, Gateway, atomic_json, digest, fingerprint, generate_word,
                               morae, normalized_transcript, prepare_plan, split_word_group, validate_wav, speech_body, decode_speech_audio, validate_result)
spec = importlib.util.spec_from_file_location('audio_import', ROOT / 'import-japanese-audio.py')
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)


def audio_bytes():
    out = io.BytesIO()
    with wave.open(out, 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(24000)
        f.writeframes(b''.join(struct.pack('<h', int(math.sin(i * .12) * 5000)) for i in range(12000)))
    return out.getvalue()


class GatewayFixture:
    def __init__(self, reading):
        self.reading, self.calls = reading, 0
    def speech(self, row, config, attempt):
        self.calls += 1
        return audio_bytes(), {}
    def transcribe(self, audio, model):
        return dict(transcript=self.reading, model=model)


class AudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = subprocess.check_output(['node', str(ROOT.parent / 'node_modules/prisma/build/index.js'),
            'migrate', 'diff', '--from-empty', '--to-schema-datamodel', str(ROOT.parent / 'prisma/schema.prisma'), '--script'], text=True)

    def fixture(self, directory):
        db = directory / 'stage.db'
        c = sqlite3.connect(db)
        c.executescript(self.sql)
        ja = c.execute("INSERT INTO decks(name,language) VALUES ('日本語','ja')").lastrowid
        en = c.execute("INSERT INTO decks(name,language) VALUES ('English','en')").lastrowid
        word = c.execute("INSERT INTO words(language,lexical_key,headword,reading,pos,translation) VALUES ('ja','ja:test:1','私','わたくし','代词','我')").lastrowid
        card = c.execute("INSERT INTO cards(deck_id,word_id,front,back,state,reps,stability) VALUES (?,?,'私','わたくし',2,40,123)", (ja, word)).lastrowid
        c.execute("INSERT INTO words(language,lexical_key,headword,reading,definition_status) VALUES ('ja','ja:test:2','未審査','みしんさ','pending')")
        ew = c.execute("INSERT INTO words(language,lexical_key,headword) VALUES ('en','en:test:1','私')").lastrowid
        c.execute("INSERT INTO cards(deck_id,word_id,front,back) VALUES (?,?,'私','English')", (en, ew))
        c.commit(); c.close()
        batch = directory / 'batch'
        plan = prepare_plan(db, ja)
        plan['planHash'] = digest(plan)
        atomic_json(batch / 'plan.json', plan)
        gateway = GatewayFixture('わたくし')
        generate_word(plan['rows'][0], DEFAULT_CONFIG, batch, gateway)
        return db, batch, directory / 'media', plan, word, card, en

    def snapshot(self, db):
        c = sqlite3.connect(db)
        return {t: c.execute(f'SELECT * FROM {t} ORDER BY 1').fetchall() for t in ['cards', 'words', 'review_logs', 'personal_knowledge_states', 'deck_fsrs_params', 'deck_settings']}

    def test_conservative_mora_normalization_and_invalid_headers(self):
        self.assertEqual(normalized_transcript('「ワタクシ」。'), 'わたくし')
        for wrong in ['わたし', 'がくこう', 'きよう', 'きょー']:
            self.assertNotEqual(normalized_transcript(wrong), normalized_transcript({'わたし':'わたくし', 'がくこう':'がっこう', 'きよう':'きょう', 'きょー':'きょう'}[wrong]))
        self.assertEqual(morae('びょういん'), ['びょ', 'う', 'い', 'ん'])
        self.assertEqual(morae('がっこう'), ['が', 'っ', 'こ', 'う'])
        with self.assertRaises(ValueError): validate_wav(b'not audio')
        nested = io.BytesIO()
        with wave.open(nested, 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(24000); f.writeframes(audio_bytes())
        with self.assertRaises(ValueError): validate_wav(nested.getvalue())

    def test_quiet_japanese_generation_retries_before_recognition(self):
        from lib.audio_loudness import measure, passed
        class QuietFirst(GatewayFixture):
            def speech(self, row, config, attempt):
                data, usage = super().speech(row, config, attempt)
                if self.calls == 1:
                    out = io.BytesIO()
                    with wave.open(out, 'wb') as f:
                        f.setnchannels(1); f.setsampwidth(2); f.setframerate(24000); f.writeframes(b'\x01\x00' * 12000)
                    data = out.getvalue()
                return data, usage
        with tempfile.TemporaryDirectory() as directory:
            row = dict(wordId=1, lexicalKey='ja:fixture', headword='駅', reading='えき', pos='名词', translation='车站', pitchHints=[])
            gateway = QuietFirst('えき')
            result = generate_word(row, DEFAULT_CONFIG, Path(directory), gateway, attempts=2)
            self.assertEqual(result['status'], 'accepted'); self.assertEqual(gateway.calls, 2)
            self.assertIn('too quiet', result['attempts'][0]['error'])
            self.assertTrue(passed(measure(Path(directory) / result['audioFile'])))

    def test_mismatch_never_accepted_cache_is_reusable_and_reading_change_invalidates_it(self):
        with tempfile.TemporaryDirectory() as d:
            db, batch, media, plan, word, card, en = self.fixture(Path(d))
            row = plan['rows'][0]
            good = GatewayFixture('わたくし')
            self.assertTrue(generate_word(row, DEFAULT_CONFIG, batch, good)['cached'])
            self.assertEqual(good.calls, 0)
            changed = dict(row, reading='わたし')
            bad = GatewayFixture('わたくし')
            result = generate_word(changed, DEFAULT_CONFIG, batch, bad, attempts=2)
            self.assertEqual(result['status'], 'needs_review'); self.assertEqual(bad.calls, 2)
            self.assertNotEqual(fingerprint(changed, DEFAULT_CONFIG), fingerprint(row, DEFAULT_CONFIG))
            with self.assertRaises(ValueError): imp.import_batch(db, batch, media, Path(d)/'dry.json')
            with self.assertRaises(ValueError): prepare_plan(db, en)

    def test_group_splitting_requires_exact_long_pause_count(self):
        with wave.open(io.BytesIO(audio_bytes())) as f:
            tone = f.readframes(f.getnframes())
        out = io.BytesIO()
        with wave.open(out, 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(24000)
            f.writeframes(tone + b'\x00\x00'*19200 + tone + b'\x00\x00'*19200 + tone)
        clips = split_word_group(out.getvalue(), 3)
        self.assertEqual(len(clips), 3)
        for clip, boundary in clips:
            self.assertLess(validate_wav(clip)['duration'], 1)
        with self.assertRaises(ValueError): split_word_group(out.getvalue(), 4)
        with self.assertRaises(ValueError): split_word_group(audio_bytes(), 2)

    def test_dry_run_apply_repeated_apply_and_rollback_preserve_learning_data(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            db, batch, media, plan, word, card, en = self.fixture(root)
            before = self.snapshot(db)
            dry = imp.import_batch(db, batch, media, root/'dry.json')
            self.assertEqual(dry['newLinks'], 1); self.assertFalse(media.exists())
            self.assertEqual(self.snapshot(db), before)
            result = imp.import_batch(db, batch, media, root/'apply.json', True, root/'backup.db')
            self.assertEqual((result['newLinks'], result['newAssets']), (1, 1))
            self.assertEqual(self.snapshot(db), before)
            again = imp.import_batch(db, batch, media, root/'again.json', True, root/'backup2.db')
            self.assertEqual((again['newLinks'], again['newAssets'], again['skippedExistingBackAudio']), (0, 0, 1))
            self.assertEqual(len(list(media.glob('*.mp3'))), 1)
            rolled = imp.rollback_batch(db, media, result['journal'], True)
            self.assertEqual(rolled['removedLinks'], 1); self.assertFalse(list(media.glob('*.mp3')))
            self.assertEqual(self.snapshot(db), before)

    def test_changed_identity_or_bytes_rejected_before_any_files_are_copied(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            db, batch, media, plan, word, card, en = self.fixture(root)
            c = sqlite3.connect(db); c.execute("UPDATE words SET reading='わたし' WHERE id=?", (word,)); c.commit(); c.close()
            with self.assertRaises(ValueError): imp.import_batch(db, batch, media, root/'apply.json', True, root/'backup.db')
            self.assertFalse(media.exists())
            c = sqlite3.connect(db); c.execute("UPDATE words SET reading='わたくし' WHERE id=?", (word,)); c.commit(); c.close()
            result = json.loads((batch/'results'/f'{word}.json').read_text())
            (batch/result['audioFile']).write_bytes(b'changed')
            with self.assertRaises(ValueError): imp.import_batch(db, batch, media, root/'apply.json', True, root/'backup.db')
            self.assertFalse(media.exists())

    def test_mid_transaction_failure_cleans_staging_and_shared_audio_survives_rollback(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            db, batch, media, plan, word, card, en = self.fixture(root)
            c = sqlite3.connect(db)
            c.execute("CREATE TRIGGER reject_audio BEFORE INSERT ON card_media BEGIN SELECT RAISE(FAIL,'fixture'); END")
            c.commit(); c.close()
            with self.assertRaises(sqlite3.IntegrityError): imp.import_batch(db, batch, media, root/'bad.json', True, root/'backup.db')
            self.assertFalse(list(media.glob('*.mp3')))
            c = sqlite3.connect(db); self.assertEqual(c.execute('SELECT COUNT(*) FROM media_assets').fetchone()[0], 0)
            c.execute('DROP TRIGGER reject_audio'); c.commit(); c.close()
            result = imp.import_batch(db, batch, media, root/'ok.json', True, root/'backup2.db')
            c = sqlite3.connect(db); mid = c.execute('SELECT id FROM media_assets').fetchone()[0]
            other = c.execute("INSERT INTO cards(deck_id,front,back) VALUES (?,'audio','shared')", (en,)).lastrowid
            c.execute("INSERT INTO card_media(card_id,media_id,side) VALUES (?,?,'back')", (other,mid)); c.commit(); c.close()
            imp.rollback_batch(db, media, result['journal'], True)
            self.assertEqual(len(list(media.glob('*.mp3'))), 1)
            self.assertEqual(sqlite3.connect(db).execute('SELECT COUNT(*) FROM media_assets').fetchone()[0], 1)

    def test_exclusive_staging_collision_never_deletes_an_existing_file(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            db, batch, media, plan, word, card, en = self.fixture(root)
            media.mkdir()
            fixed = uuid.UUID('00000000-0000-0000-0000-000000000001')
            existing = media / (str(fixed) + '.mp3')
            existing.write_bytes(b'user media')
            with patch.object(imp.uuid, 'uuid4', return_value=fixed):
                with self.assertRaises(FileExistsError): imp.import_batch(db, batch, media, root/'bad.json', True, root/'backup.db')
            self.assertEqual(existing.read_bytes(), b'user media')

    def test_database_authorizer_prevents_learning_writes_even_through_a_trigger(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            db, batch, media, plan, word, card, en = self.fixture(root)
            c = sqlite3.connect(db)
            c.execute('CREATE TRIGGER unexpected_learning_write BEFORE INSERT ON card_media BEGIN UPDATE cards SET reps=999; END')
            c.commit(); c.close()
            before = self.snapshot(db)
            with self.assertRaises(sqlite3.DatabaseError): imp.import_batch(db, batch, media, root/'bad.json', True, root/'backup.db')
            self.assertEqual(self.snapshot(db), before)
            self.assertFalse(list(media.glob('*.mp3')))

    def test_explicit_ready_only_skips_unfinished_and_quota_does_not_mark_audio_as_bad(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            db, batch, media, plan, word, card, en = self.fixture(root)
            c = sqlite3.connect(db)
            second = c.execute("INSERT INTO words(language,lexical_key,headword,reading,pos,translation) VALUES ('ja','ja:test:3','猫','ねこ','名词','猫')").lastrowid
            c.execute("INSERT INTO cards(deck_id,word_id,front,back) VALUES (?,?,'猫','ねこ')", (plan['deckId'], second))
            c.commit(); c.close()
            plan = prepare_plan(db, plan['deckId']); plan['planHash'] = digest(plan)
            atomic_json(batch/'plan.json', plan)
            with self.assertRaises(FileNotFoundError): imp.import_batch(db, batch, media, root/'all.json')
            partial = imp.import_batch(db, batch, media, root/'ready.json', ready_only=True)
            self.assertEqual(partial['selectedCards'], 1); self.assertTrue(partial['readyOnly'])
            gateway = GatewayFixture('ねこ')
            def exhausted(*args): raise DailyQuotaExceeded(123)
            gateway.speech = exhausted
            with self.assertRaises(DailyQuotaExceeded): generate_word(plan['rows'][1], DEFAULT_CONFIG, batch, gateway)
            self.assertFalse((batch/'results'/f'{second}.json').exists())
            shared = Gateway('https://chat.rethinkos.com', 'fixture-no-key')
            shared._quotas['anything'] = DailyQuotaExceeded(123)
            with self.assertRaises(DailyQuotaExceeded): shared.rate_slot('anything', True)

    def test_daily_quota_response_stops_immediately_and_keeps_reset_time(self):
        body = json.dumps({'error': {'message': 'generate_requests_per_model_per_day',
                           'details': [{'retryDelay': '10000s'}]}}).encode()
        error = urllib.error.HTTPError('https://chat.rethinkos.com/fixture', 429, 'quota', {}, io.BytesIO(body))
        gateway = Gateway('https://chat.rethinkos.com', 'fixture-no-key')
        with patch.object(gateway, 'rate_slot'), patch('urllib.request.urlopen', side_effect=error) as request, \
             patch('lib.japanese_audio.time.time', return_value=100):
            with self.assertRaises(DailyQuotaExceeded) as raised:
                gateway.json('/fixture', {}, native=True)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(raised.exception.retry_at, 10160)
        with self.assertRaises(DailyQuotaExceeded): gateway.rate_slot('/fixture', True)
        gateway.rate_slot('gemini/lite', False)

    def test_model_schemas_pcm_conversion_and_quota_fallback_stay_separate(self):
        with tempfile.TemporaryDirectory() as d:
            db, batch, media, plan, word, card, en = self.fixture(Path(d))
            row = plan['rows'][0]
            config = dict(DEFAULT_CONFIG, model='gemini/gemini-3.8-flash-tts', resolvedModel='gemini-3.8-flash-tts',
                          fallbackModels=['gemini-3.1-flash-tts-preview'])
            modern = speech_body([row], config, config['resolvedModel'])
            self.assertEqual(modern['contents'][0]['parts'][0]['text'], 'わたくし')
            self.assertIn('speech_metadata', modern['contents'][0]['parts'][0])
            legacy = speech_body([row], config, config['fallbackModels'][0])
            self.assertNotIn('speech_metadata', legacy['contents'][0]['parts'][0])
            self.assertIn('Text to pronounce:', legacy['contents'][0]['parts'][0]['text'])
            self.assertEqual(legacy['generationConfig']['speechConfig']['voiceConfig']['prebuiltVoiceConfig']['voiceName'], 'Kore')
            import base64
            with wave.open(io.BytesIO(audio_bytes())) as f: pcm = f.readframes(f.getnframes())
            part = dict(mimeType='audio/L16;codec=pcm;rate=24000', data=base64.b64encode(pcm).decode())
            decoded, encoding = decode_speech_audio(part, config['fallbackModels'][0])
            self.assertEqual(validate_wav(decoded)['duration'], .5); self.assertTrue(encoding['pcmWrapped'])
            with self.assertRaises(ValueError): decode_speech_audio(part, config['resolvedModel'])
            part_wav = dict(mimeType='audio/wav', data=base64.b64encode(audio_bytes()).decode())
            self.assertEqual(decode_speech_audio(part_wav, config['resolvedModel'])[0], audio_bytes())
            gateway = Gateway('https://chat.rethinkos.com', 'fixture-no-key')
            def native(path, body, native):
                if config['resolvedModel'] in path: raise DailyQuotaExceeded(200)
                return {'candidates':[{'content':{'parts':[{'inlineData':part}]}}]}
            with patch.object(gateway, 'json', side_effect=native):
                data, usage = gateway.speech(row, config, 1)
            self.assertEqual(usage['flashnextSource']['model'], config['fallbackModels'][0])
            self.assertEqual(validate_wav(data)['duration'], .5)
            def both_exhausted(path, body, native):
                raise DailyQuotaExceeded(200 if config['resolvedModel'] in path else 300)
            with patch.object(gateway, 'json', side_effect=both_exhausted):
                with self.assertRaises(DailyQuotaExceeded) as raised: gateway.speech(row, config, 1)
            self.assertEqual(raised.exception.retry_at, 200)
            good = GatewayFixture('わたくし')
            good.speech = lambda *args: (data, usage)
            result = generate_word(row, config, batch, good)
            self.assertEqual(result['model'], config['fallbackModels'][0])
            validate_result(row, config, batch, result)
            result['model'] = 'unapproved-model'
            with self.assertRaises(ValueError): validate_result(row, config, batch, result)
            gateway.rate_slot('gemini/lite', False)

    def test_missing_audio_plan_preserves_all_existing_back_attachments(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            db, batch, media, plan, word, card, en = self.fixture(root)
            imp.import_batch(db, batch, media, root/'applied.json', True, root/'backup.db')
            missing = prepare_plan(db, plan['deckId'], only_missing_audio=True)
            self.assertEqual(missing['cardCount'], 0)
            self.assertEqual(missing['deckCardCount'], 1)
            self.assertEqual(missing['selection'], 'missing-back-audio')


if __name__ == '__main__': unittest.main()
