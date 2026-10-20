"""Finish one frozen, approved audio batch after its AI Studio daily quota resets."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

from lib.japanese_audio import atomic_json


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['db', 'batch', 'kaikki', 'media-dir', 'backup-dir', 'verification']:
        p.add_argument('--'+name, type=Path, required=True)
    p.add_argument('--base-url', default='http://127.0.0.1:9000')
    p.add_argument('--node-bin', default='node')
    a = p.parse_args()
    node = shutil.which(a.node_bin)
    if not node:
        raise ValueError('Node executable not found; provide its absolute path with --node-bin before starting the batch')
    a.node_bin = node
    script = Path(__file__).resolve().parent
    state_file = a.batch/'continuation.json'
    plan = json.loads((a.batch/'plan.json').read_text())
    def finish(report):
        subprocess.run([sys.executable, str(script/'verify-japanese-audio.py'), '--db', str(a.db),
            '--batch', str(a.batch), '--media-dir', str(a.media_dir), '--report', str(report),
            '--base-url', a.base_url, '--output', str(a.verification), '--node-bin', a.node_bin], check=True)
        checked = json.loads(a.verification.read_text())
        if checked['status'] != 'complete':
            raise RuntimeError('Expected all planned Japanese cards to have back audio')
        atomic_json(state_file, dict(status='complete', planHash=plan['planHash'], verification=str(a.verification)))
        return 0
    # A post-import verification failure must never regenerate or reimport audio.
    for report in sorted(a.batch.glob('production-completion-*.json'), reverse=True):
        previous = json.loads(report.read_text())
        if previous.get('applied') and previous.get('planHash') == plan['planHash']:
            return finish(report)
    for attempt in range(1, 7):
        quota_path = a.batch/'quota-wait.json'
        quota = json.loads(quota_path.read_text()) if quota_path.exists() else {}
        if quota and quota['planHash'] != plan['planHash']:
            raise ValueError('Quota checkpoint belongs to a different plan')
        if quota.get('retryAt', 0) > time.time():
            state = dict(status='waiting_for_daily_quota', retryAt=quota['retryAt'], planHash=plan['planHash'])
            atomic_json(state_file, state); print(json.dumps(state), flush=True)
            while time.time() < quota['retryAt']:
                time.sleep(min(30, quota['retryAt']-time.time()))
        atomic_json(state_file, dict(status='generating', attempt=attempt, planHash=plan['planHash']))
        command = [sys.executable, str(script/'prepare-japanese-audio.py'), '--db', str(a.db),
            '--deck-id', str(plan['deckId']), '--output', str(a.batch), '--kaikki', str(a.kaikki), '--generate']
        if plan.get('selection') == 'missing-back-audio':
            command.append('--only-missing-audio')
        if plan.get('config', {}).get('model') != 'gemini/tts-lite' and plan.get('config'):
            command.extend(['--speech-model', plan['config']['resolvedModel']])
        for model in plan.get('config', {}).get('fallbackModels', []):
            command.extend(['--fallback-speech-model', model])
        generated = subprocess.run(command)
        if generated.returncode == 75:
            continue
        if generated.returncode != 0:
            if attempt < 6:
                time.sleep(30)
                continue
            raise RuntimeError('Generation still needs review; accepted artifacts retained')
        suffix = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
        report = a.batch/f'production-completion-{suffix}.json'
        backup = a.backup_dir/f'flashnext-pre-japanese-audio-completion-{suffix}.db'
        # This stage reads only local checked artifacts; credentials never enter sudo.
        subprocess.run(['sudo', '-n', sys.executable, str(script/'import-japanese-audio.py'), '--db', str(a.db),
            '--batch', str(a.batch), '--media-dir', str(a.media_dir), '--report', str(report),
            '--apply', '--backup', str(backup)], check=True)
        return finish(report)
    raise RuntimeError('Continuation retry limit reached; checkpoint retained')


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        if '--batch' in sys.argv:
            state_path = Path(sys.argv[sys.argv.index('--batch')+1])/'continuation.json'
            state = json.loads(state_path.read_text()) if state_path.exists() else {}
            state.update(status='needs_review', error=str(e)[:500])
            atomic_json(state_path, state)
        print(str(e), file=sys.stderr)
        sys.exit(1)
