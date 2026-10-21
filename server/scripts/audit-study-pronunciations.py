"""Freeze recent-first-learned + ALL unlearned English cards; audit BrE sources."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
from lib.study_pronunciations import atomic_json, scope, OxfordLookup

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--db', required=True)
p.add_argument('--since-ms', required=True, type=int)
p.add_argument('--output', required=True, type=Path)
p.add_argument('--fetch', action='store_true')
p.add_argument('--workers', type=int, default=3, choices=range(1, 5))
a = p.parse_args()
filename = a.output / 'scope.json'
if not filename.exists():
    atomic_json(filename, scope(a.db, a.since_ms))
plan = json.loads(filename.read_text())
print(json.dumps({'words': len(plan['words']), 'recentCards': plan['recentCards'], 'allUnlearnedCards': plan['unlearnedCards']}, ensure_ascii=False), flush=True)
if a.fetch:
    lookup = OxfordLookup(a.output / 'oxford-cache')
    remaining = [w for w in plan['words'] if not (a.output / 'lookups' / f"{w['id']}.json").exists()]
    complete = accepted = 0
    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        jobs = {pool.submit(lookup.word, w['headword']): w for w in remaining}
        for job in as_completed(jobs):
            w = jobs[job]
            result = job.result()
            atomic_json(a.output / 'lookups' / f"{w['id']}.json", result)
            complete += 1
            accepted += bool(result['entries'])
            if complete % 25 == 0 or complete == len(remaining):
                print(json.dumps({'completed': complete, 'total': len(remaining), 'withOfficialUK': accepted, 'latest': w['headword']}, ensure_ascii=False), flush=True)
