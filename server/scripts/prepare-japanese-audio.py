"""Create/resume an auditable Japanese TTS batch. Generation requires --generate."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import sys

from lib.japanese_audio import (DEFAULT_CONFIG, SPEECH_MODELS, DailyQuotaExceeded, Gateway, atomic_json, compact, digest,
                                generate_group, load_token, prepare_plan)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', required=True)
    parser.add_argument('--deck-id', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--env-file', type=Path, default=Path(__file__).resolve().parents[2] / '.env')
    parser.add_argument('--kaikki', type=Path)
    parser.add_argument('--generate', action='store_true')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--workers', type=int, default=2, choices=range(1, 5))
    parser.add_argument('--attempts', type=int, default=3, choices=range(1, 5))
    parser.add_argument('--speech-model', choices=SPEECH_MODELS)
    parser.add_argument('--fallback-speech-model', choices=SPEECH_MODELS, action='append', default=[])
    parser.add_argument('--only-missing-audio', action='store_true')
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error('--limit must be positive')
    config = dict(DEFAULT_CONFIG)
    if args.speech_model:
        config.update(model='gemini/'+args.speech_model, resolvedModel=args.speech_model)
    if args.fallback_speech_model:
        if len(set([config['resolvedModel'], *args.fallback_speech_model])) != 1+len(args.fallback_speech_model):
            parser.error('Speech models must not repeat')
        config['fallbackModels'] = args.fallback_speech_model
    plan = prepare_plan(args.db, args.deck_id, args.kaikki, config, args.only_missing_audio)
    plan['planHash'] = digest(plan)
    filename = args.output / 'plan.json'
    if filename.exists() and json.loads(filename.read_text()) != plan:
        raise ValueError('Existing batch plan differs from the current word identities/configuration; use a new output directory')
    atomic_json(filename, plan)
    print(compact(dict(plan=str(filename), words=plan['wordCount'], cards=plan['cardCount'], generate=args.generate)), flush=True)
    if not args.generate:
        return 0
    gateway = Gateway(config['gateway'], load_token(args.env_file))
    available = {row['id'] for row in gateway.json('/v1/models')['data']}
    for model in [config['model'], 'gemini/' + config['resolvedModel'], config['asrModel'], config['verifierModel'],
                  *['gemini/'+m for m in config.get('fallbackModels', [])]]:
        if model not in available:
            raise ValueError('Required gateway model is not available: ' + model)
    selected = plan['rows'][:args.limit] if args.limit else plan['rows']
    accepted = cached = 0
    try:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            groups = [selected[i:i+4] for i in range(0, len(selected), 4)]
            jobs = [pool.submit(generate_group, group, config, args.output, gateway, args.attempts) for group in groups]
            completed = 0
            for task in as_completed(jobs):
                for result in task.result():
                    completed += 1
                    accepted += result['status'] == 'accepted'
                    cached += bool(result.get('cached'))
                    print(compact(dict(completed=completed, total=len(selected), word=result['headword'], reading=result['reading'],
                                       status=result['status'], cached=bool(result.get('cached')))), flush=True)
    except DailyQuotaExceeded as e:
        state = dict(planHash=plan['planHash'], status='waiting_for_daily_quota', retryAt=e.retry_at)
        atomic_json(args.output / 'quota-wait.json', state)
        states = []
        for row in selected:
            path = args.output / 'results' / f"{row['wordId']}.json"
            states.append(json.loads(path.read_text()).get('status') if path.exists() else None)
        atomic_json(args.output / 'generation-summary.json', dict(state, selected=len(selected),
            accepted=states.count('accepted'), needsReview=states.count('needs_review'), pending=states.count(None)))
        print(compact(state), flush=True)
        return 75
    summary = dict(planHash=plan['planHash'], selected=len(selected), accepted=accepted,
                   needsReview=len(selected)-accepted, cached=cached)
    atomic_json(args.output / 'generation-summary.json', summary)
    print(compact(summary), flush=True)
    return 0 if accepted == len(selected) else 1


if __name__ == '__main__':
    sys.exit(main())
