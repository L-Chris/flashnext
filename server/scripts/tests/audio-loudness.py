import hashlib
import importlib.util
import io
import math
from pathlib import Path
import sqlite3
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from lib.audio_loudness import AudioLoudnessError, PROFILE, check_wav, file_hash, measure, normalize, passed


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


imp = load('playback_import', ROOT / 'prepare-audio-playback.py')
verification = load('playback_verification', ROOT / 'verify-audio-playback.py')


def wav(amplitude=5000, duration=.5):
    out = io.BytesIO()
    with wave.open(out, 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(24000)
        f.writeframes(b''.join(struct.pack('<h', int(amplitude * math.sin(i * .15))) for i in range(int(duration * 24000))))
    return out.getvalue()


class LoudnessTests(unittest.TestCase):
    def test_silence_whispers_and_clipping_need_a_new_recording(self):
        for amplitude in [0, 2]:
            with self.assertRaises(AudioLoudnessError): check_wav(wav(amplitude))
        source = io.BytesIO()
        with wave.open(source, 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(24000)
            f.writeframes(struct.pack('<h', 32767) * 12000)
        with self.assertRaises(AudioLoudnessError): check_wav(source.getvalue())
        self.assertGreater(check_wav(wav())['rmsDbfs'], -42)

    def test_quiet_loud_and_very_short_clips_are_measured_after_mp3_encoding(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index, (amplitude, duration) in enumerate([(800, .5), (16000, 1), (5000, .2)]):
                source = root / f'{index}.wav'; source.write_bytes(wav(amplitude, duration)); original = file_hash(source)
                output = root / f'{index}.mp3'
                proof = normalize(source, output)
                self.assertEqual(proof['profile'], PROFILE); self.assertTrue(passed(measure(output)))
                self.assertEqual(file_hash(source), original)
                self.assertEqual(proof['outputSha256'], file_hash(output))
                decoded = subprocess.check_output(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(output),
                    '-f', 's16le', '-ar', '24000', '-ac', '1', '-'])
                self.assertAlmostEqual(len(decoded) / 48000, duration, delta=.01)
                with self.assertRaises(ValueError): normalize(source, source)
                with self.assertRaises(ValueError): normalize(source, output)

    def test_failed_calibration_is_bounded_and_never_publishes_an_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.wav'; source.write_bytes(wav())
            output = Path(directory) / 'out.mp3'
            readings = [dict(lufs=-20, truePeakDbtp=-5)] + [dict(lufs=-19, truePeakDbtp=1)] * 8
            with patch('lib.audio_loudness.measure', side_effect=readings), patch('lib.audio_loudness.subprocess.run') as run:
                with self.assertRaises(AudioLoudnessError): normalize(source, output)
                self.assertLessEqual(run.call_count, 8)
            self.assertFalse(output.exists()); self.assertTrue(source.exists())

    def test_playback_import_is_additive_idempotent_and_preserves_every_original_row(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); db = root / 'db.sqlite'; media = root / 'media'; media.mkdir()
            sql = subprocess.check_output(['node', str(ROOT.parent / 'node_modules/prisma/build/index.js'), 'migrate', 'diff',
                '--from-empty', '--to-schema-datamodel', str(ROOT.parent / 'prisma/schema.prisma'), '--script'], text=True)
            source = root / 'raw.wav'; source.write_bytes(wav(1200))
            identity = str(uuid.uuid4()); audio = media / (identity + '.mp3')
            subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-i', str(source), '-codec:a', 'libmp3lame', '-b:a', '64k', str(audio)], check=True)
            with sqlite3.connect(db) as c:
                c.executescript(sql)
                deck = c.execute("INSERT INTO decks(name,language) VALUES ('English','en')").lastrowid
                word = c.execute("INSERT INTO words(language,lexical_key,headword) VALUES ('en','en:test','test')").lastrowid
                card = c.execute("INSERT INTO cards(deck_id,word_id,front,back,state,reps,stability) VALUES (?,?,'test','answer',2,40,123)", (deck, word)).lastrowid
                c.execute('INSERT INTO media_assets(id,storage_key,sha256,mime_type,bytes,original_name) VALUES (?,?,?,?,?,?)',
                    (identity, audio.name, file_hash(audio), 'audio/mpeg', audio.stat().st_size, 'test.mp3'))
                c.execute("INSERT INTO card_media(card_id,media_id,side) VALUES (?,?,'back')", (card, identity))
            batch = root / 'batch'; prepared = imp.prepare(db, media, batch, 1)
            self.assertEqual(prepared['prepared'], 1)
            original = file_hash(audio)
            applied = imp.attach(db, media, batch, root / 'report.json', root / 'backup.db')
            self.assertEqual(len(applied['newPlaybackIds']), 1)
            report = verification.verify(root / 'backup.db', db, media, root / 'report.json')
            self.assertTrue(report['oldRowsUnchanged']); self.assertTrue(report['originalAudioUnchanged'])
            repeated = imp.attach(db, media, batch, root / 'repeat.json', root / 'backup2.db')
            self.assertEqual(repeated['newPlaybackIds'], []); self.assertEqual(len(repeated['existingPlaybackIds']), 1)
            self.assertEqual(original, file_hash(audio))
            with sqlite3.connect(db) as c:
                c.set_authorizer(imp.authorizer)
                with self.assertRaises(sqlite3.DatabaseError): c.execute("UPDATE cards SET front='overwritten'")


if __name__ == '__main__': unittest.main()
