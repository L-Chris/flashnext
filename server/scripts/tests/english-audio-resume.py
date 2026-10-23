import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
spec=importlib.util.spec_from_file_location('english_resume',ROOT/'resume-english-audio.py')
resume=importlib.util.module_from_spec(spec);spec.loader.exec_module(resume)


class ResumeTests(unittest.TestCase):
    def fixture(self,root):
        batch=root/'batch';batch.mkdir();media=root/'media';media.mkdir()
        db=root/'db';sqlite3.connect(db).close()
        (batch/'plan.json').write_text(json.dumps(dict(planHash='fixture',deckId=9,days=7,selectedCards=175)))
        output=batch/'verified.json'
        args=['resume','--db',str(db),'--batch',str(batch),'--media-dir',str(media),
            '--backup-dir',str(root/'backups'),'--verification',str(output)]
        return args,batch,output

    def runner(self,calls,fail_generation=False,fail_production_verify=False):
        def run(command,**kwargs):
            calls.append(command);text=' '.join(command)
            if 'prepare-english-audio.py' in text:return subprocess.CompletedProcess(command,1 if fail_generation else 0)
            if 'import-english-audio.py' in text:
                Path(command[command.index('--report')+1]).write_text(json.dumps(dict(applied=True,planHash='fixture',journal='fixture-journal')))
            if 'verify-english-audio.py' in text:
                if fail_production_verify and command[0]=='sudo':raise subprocess.CalledProcessError(1,command)
                Path(command[command.index('--output')+1]).write_text(json.dumps(dict(status='complete',planHash='fixture',journal='fixture-journal')))
            return subprocess.CompletedProcess(command,0,stdout=json.dumps(dict(status='passed')))
        return run

    def test_quota_wait_stages_before_production_and_finishes_with_playback(self):
        with tempfile.TemporaryDirectory() as d:
            args,batch,output=self.fixture(Path(d));calls=[];clock=[100]
            (batch/'quota-wait.json').write_text(json.dumps(dict(planHash='fixture',retryAt=105)))
            def sleep(seconds):clock[0]+=seconds
            with patch.object(sys,'argv',args),patch.object(resume.shutil,'which',return_value='/usr/bin/node'), \
                patch.object(resume.time,'time',side_effect=lambda:clock[0]),patch.object(resume.time,'sleep',side_effect=sleep), \
                patch.object(resume.subprocess,'run',side_effect=self.runner(calls)):
                self.assertEqual(resume.main(),0)
            self.assertEqual(clock[0],105)
            self.assertEqual(json.loads((batch/'continuation.json').read_text())['status'],'complete')
            stop=next(i for i,c in enumerate(calls) if c[:2]==['docker','stop'])
            self.assertTrue(any('verify-english-audio.py' in ' '.join(c) for c in calls[:stop]))
            self.assertTrue(any(c[:2]==['docker','start'] for c in calls))

    def test_generation_failures_never_import_or_stop_service(self):
        with tempfile.TemporaryDirectory() as d:
            args,batch,output=self.fixture(Path(d));calls=[]
            with patch.object(sys,'argv',args),patch.object(resume.shutil,'which',return_value='/usr/bin/node'), \
                patch.object(resume.time,'sleep'),patch.object(resume.subprocess,'run',side_effect=self.runner(calls,fail_generation=True)):
                with self.assertRaises(RuntimeError):resume.main()
            self.assertEqual(len(calls),4);self.assertTrue(all('prepare-english-audio.py' in ' '.join(c) for c in calls))

    def test_production_failure_always_restarts_the_service(self):
        with tempfile.TemporaryDirectory() as d:
            args,batch,output=self.fixture(Path(d));calls=[]
            with patch.object(sys,'argv',args),patch.object(resume.shutil,'which',return_value='/usr/bin/node'), \
                patch.object(resume.subprocess,'run',side_effect=self.runner(calls,fail_production_verify=True)):
                with self.assertRaises(subprocess.CalledProcessError):resume.main()
            self.assertEqual(calls[-1],['docker','start','flashnext'])

    def test_verified_import_recovery_only_checks_playback(self):
        with tempfile.TemporaryDirectory() as d:
            args,batch,output=self.fixture(Path(d));calls=[]
            (batch/'production-completion-fixture.json').write_text(json.dumps(dict(applied=True,planHash='fixture',journal='fixture-journal')))
            output.write_text(json.dumps(dict(status='complete',planHash='fixture',journal='fixture-journal')))
            with patch.object(sys,'argv',args),patch.object(resume.shutil,'which',return_value='/usr/bin/node'), \
                patch.object(resume.subprocess,'run',side_effect=self.runner(calls)):
                self.assertEqual(resume.main(),0)
            self.assertEqual(len(calls),1);self.assertIn('english-audio-browser.cjs',calls[0][1])

    def partial_fixture(self,root):
        args,batch,output=self.fixture(root)
        db=root/'db';c=sqlite3.connect(db)
        c.execute('CREATE TABLE card_media(card_id INTEGER,side TEXT)');c.commit();c.close()
        plan=json.loads((batch/'plan.json').read_text())
        plan.update(selectedCards=2,days=30,selection='recently-learned',
            rows=[dict(wordId=1,cards=[dict(cardId=1)])],selections=[dict(cardId=1),dict(cardId=2)],
            blocked=[dict(cardId=2,headword='unverified')])
        (batch/'plan.json').write_text(json.dumps(plan))
        (batch/'results').mkdir();(batch/'results/1.json').write_text(json.dumps(dict(status='accepted')))
        return [*args,'--ready-only'],batch,output

    def partial_runner(self,root,calls):
        base=self.runner(calls)
        def run(command,**kwargs):
            result=base(command,**kwargs)
            if 'verify-english-audio.py' in ' '.join(command):
                Path(command[command.index('--output')+1]).write_text(json.dumps(dict(status='partial',cardsWithBackAudio=1,remaining=1,planHash='fixture',journal='fixture-journal')))
            if command[:2]==['sudo','-n'] and 'import-english-audio.py' in ' '.join(command):
                c=sqlite3.connect(root/'db');c.execute("INSERT INTO card_media VALUES (1,'back')");c.commit();c.close()
            return result
        return run

    def test_ready_only_imports_checked_cache_before_waiting_and_keeps_blocked_pending(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);args,batch,output=self.partial_fixture(root);calls=[];clock=[100]
            (batch/'quota-wait.json').write_text(json.dumps(dict(planHash='fixture',retryAt=105)))
            def sleep(seconds):
                self.assertTrue(any(c[:2]==['docker','start'] for c in calls))
                clock[0]+=seconds
            with patch.object(sys,'argv',args),patch.object(resume.shutil,'which',return_value='/usr/bin/node'), \
                patch.object(resume.time,'time',side_effect=lambda:clock[0]),patch.object(resume.time,'sleep',side_effect=sleep), \
                patch.object(resume.subprocess,'run',side_effect=self.partial_runner(root,calls)):
                self.assertEqual(resume.main(),0)
            value=json.loads((batch/'continuation.json').read_text())
            self.assertEqual(value['status'],'needs_review');self.assertEqual(value['remaining'],1)
            commands=[c for c in calls if 'import-english-audio.py' in ' '.join(c)]
            self.assertEqual(len(commands),2);self.assertTrue(all('--ready-only' in c for c in commands))
            generation=next(c for c in calls if 'prepare-english-audio.py' in ' '.join(c))
            self.assertEqual(generation[generation.index('--selection')+1],'recently-learned')

    def test_ready_only_unexpected_generation_failure_never_stops_service(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);args,batch,output=self.partial_fixture(root);calls=[]
            (batch/'results/1.json').unlink()
            def run(command,**kwargs):
                calls.append(command);return subprocess.CompletedProcess(command,2)
            with patch.object(sys,'argv',args),patch.object(resume.shutil,'which',return_value='/usr/bin/node'), \
                patch.object(resume.subprocess,'run',side_effect=run):
                with self.assertRaises(RuntimeError):resume.main()
            self.assertEqual(len(calls),1);self.assertIn('prepare-english-audio.py',calls[0][1])

    def test_waits_until_existing_generator_has_exited(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);args,batch,output=self.partial_fixture(root);calls=[];statuses=iter(['running','exited'])
            base=self.partial_runner(root,calls)
            def run(command,**kwargs):
                if command[:2]==['systemctl','show']:
                    calls.append(command);return subprocess.CompletedProcess(command,0,stdout=next(statuses))
                return base(command,**kwargs)
            with patch.object(sys,'argv',[*args,'--wait-for-unit','generator.service']), \
                patch.object(resume.shutil,'which',return_value='/usr/bin/node'),patch.object(resume.time,'sleep'), \
                patch.object(resume.subprocess,'run',side_effect=run):
                self.assertEqual(resume.main(),0)
            self.assertEqual(calls[0][:2],['systemctl','show']);self.assertEqual(calls[1][:2],['systemctl','show'])

    def test_previous_verification_cannot_cover_a_newer_partial_import(self):
        with tempfile.TemporaryDirectory() as d:
            args,batch,output=self.partial_fixture(Path(d));calls=[]
            (batch/'production-completion-latest.json').write_text(json.dumps(dict(applied=True,planHash='fixture',journal='new-journal')))
            output.write_text(json.dumps(dict(status='partial',planHash='fixture',journal='old-journal')))
            with patch.object(sys,'argv',args),patch.object(resume.shutil,'which',return_value='/usr/bin/node'), \
                patch.object(resume.subprocess,'run',side_effect=self.runner(calls)):
                with self.assertRaisesRegex(RuntimeError,'own protected-table verification'):resume.main()
            self.assertEqual(calls,[])


if __name__=='__main__':unittest.main()
