import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('audio_resume', ROOT/'resume-japanese-audio.py')
resume = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resume)


class ResumeTests(unittest.TestCase):
    def fixture(self, root):
        batch = root/'batch'; batch.mkdir()
        (batch/'plan.json').write_text(json.dumps(dict(planHash='fixture', deckId=10)))
        output = root/'verification.json'
        args = ['resume', '--db', str(root/'db'), '--batch', str(batch), '--kaikki', str(root/'kaikki'),
                '--media-dir', str(root/'media'), '--backup-dir', str(root/'backup'), '--verification', str(output)]
        return args, batch, output

    def test_quota_resume_waits_and_only_imports_after_full_success(self):
        with tempfile.TemporaryDirectory() as d:
            args, batch, output = self.fixture(Path(d))
            (batch/'plan.json').write_text(json.dumps(dict(planHash='fixture', deckId=10, selection='missing-back-audio',
                config=dict(model='gemini/gemini-3.8-flash-tts', resolvedModel='gemini-3.8-flash-tts', fallbackModels=['gemini-3.1-flash-tts-preview']))))
            (batch/'quota-wait.json').write_text(json.dumps(dict(planHash='fixture', retryAt=105)))
            calls = []
            now = [100]
            def sleep(seconds): now[0] += seconds
            def run(command, **kwargs):
                calls.append(command)
                if 'verify-japanese-audio.py' in ' '.join(command):
                    output.write_text(json.dumps(dict(status='complete')))
                return subprocess.CompletedProcess(command, 0)
            with patch.object(sys, 'argv', args), patch.object(resume.time, 'time', side_effect=lambda:now[0]), \
                 patch.object(resume.time, 'sleep', side_effect=sleep), patch.object(resume.subprocess, 'run', side_effect=run):
                self.assertEqual(resume.main(), 0)
            self.assertEqual(now[0], 105)
            self.assertEqual(len(calls), 3)
            self.assertIn('--generate', calls[0]); self.assertEqual(calls[1][:2], ['sudo','-n'])
            self.assertIn('--only-missing-audio', calls[0])
            self.assertIn('gemini-3.8-flash-tts', calls[0]); self.assertIn('gemini-3.1-flash-tts-preview', calls[0])
            self.assertIn('--apply', calls[1]); self.assertNotIn('--ready-only', calls[1])
            self.assertEqual(json.loads((batch/'continuation.json').read_text())['status'], 'complete')

    def test_generation_failures_never_import(self):
        with tempfile.TemporaryDirectory() as d:
            args, batch, output = self.fixture(Path(d))
            calls = []
            def run(command, **kwargs):
                calls.append(command)
                return subprocess.CompletedProcess(command, 1)
            with patch.object(sys, 'argv', args), patch.object(resume.time, 'sleep'), patch.object(resume.subprocess, 'run', side_effect=run):
                with self.assertRaises(RuntimeError): resume.main()
            self.assertEqual(len(calls), 6)
            self.assertTrue(all('--generate' in c for c in calls))
            self.assertFalse(output.exists())

    def test_post_import_verification_recovery_never_generates_or_reimports(self):
        with tempfile.TemporaryDirectory() as d:
            args, batch, output = self.fixture(Path(d))
            (batch/'production-completion-fixture.json').write_text(json.dumps(dict(applied=True,planHash='fixture')))
            calls = []
            def run(command, **kwargs):
                calls.append(command)
                output.write_text(json.dumps(dict(status='complete')))
                return subprocess.CompletedProcess(command, 0)
            with patch.object(sys, 'argv', args), patch.object(resume.subprocess, 'run', side_effect=run):
                self.assertEqual(resume.main(), 0)
            self.assertEqual(len(calls), 1)
            self.assertIn('verify-japanese-audio.py', Path(calls[0][1]).name)
            self.assertIn('--node-bin', calls[0]); self.assertNotIn('--generate', calls[0]); self.assertNotIn('--apply', calls[0])
            self.assertEqual(json.loads((batch/'continuation.json').read_text())['status'], 'complete')


if __name__ == '__main__': unittest.main()
