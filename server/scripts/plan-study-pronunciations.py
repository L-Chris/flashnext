"""Build a scoped import plan from explicit BrE dictionary headwords, not guessed IPA."""
import argparse
import json
import re
from pathlib import Path
from lib.study_pronunciations import atomic_json, word_poses, comparable_ipa
from lib.pronunciation import normalize

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--batch', type=Path, required=True)
p.add_argument('--manual', type=Path)
p.add_argument('--kaikki', type=Path)
a = p.parse_args()
scope = json.loads((a.batch / 'scope.json').read_text())
manual = json.loads(a.manual.read_text()) if a.manual else {}
kaikki = json.loads(a.kaikki.read_text()) if a.kaikki else {'entries': {}, 'revision': ''}
words = []
pending = []
labels = {'noun': '名词', 'verb': '动词', 'adj': '形容词', 'adv': '副词', 'num': '数词',
          'prep': '介词', 'pron': '代词', 'intj': '感叹词', 'det': '限定词', 'conj': '连词'}
for w in scope['words']:
    expected = {k: w[k] for k in ['lexical_key', 'pos', 'translation', 'phonetic', 'phonetic_profile']}
    common = {'wordId': w['id'], 'headword': w['headword'], 'expected': expected}
    if w['headword'] in manual:
        item = manual[w['headword']]
        words.append(dict(common, primary=item['primary'], pronunciations=item['pronunciations']))
        continue
    file = a.batch / 'lookups' / f"{w['id']}.json"
    result = json.loads(file.read_text()) if file.exists() else {'entries': []}
    entries = result['entries']
    poses = word_poses(w['pos'])
    if file.exists() and (not entries or (poses and not any(e['pos'] in poses for e in entries))):
        candidates = []
        etymologies = set()
        for e in kaikki['entries'].get(w['headword'], []):
            senses = e.get('senses') or []
            if poses and e['pos'] not in poses:
                continue
            if senses and all(s.get('form_of') or s.get('alt_of') or set(s.get('tags', [])) & {'obsolete', 'archaic', 'dated', 'rare', 'nonstandard'} for s in senses):
                continue
            sounds = []
            for sound in e.get('sounds') or []:
                accent, ipa, reason = normalize(sound.get('ipa', ''), sound.get('tags', []), sound.get('note', ''))
                if accent == 'UK' and ipa and not re.search(r'a(?![ɪʊ])', ipa):
                    sounds.append({'ipa': ipa, 'raw': sound['ipa']})
            if sounds:
                etymologies.add(e.get('etymology_number'))
                candidates.append({'headword': w['headword'], 'pos': e['pos'], 'sounds': sounds,
                    'url': f"local-kaikki:{kaikki['revision']}:{w['headword']}:{e['pos']}:{e.get('etymology_number') or 1}"})
        if len(etymologies) == 1:
            entries = entries + candidates
    for entry in entries:
        if not entry['pos'] and poses:
            entry['pos'] = poses[0]
    matching = [e for e in entries if not poses or e['pos'] in poses]
    if entries and not matching:
        # A different POS can share the sound, but only after an exact full-IPA
        # cross-check against the local entry for the card's actual POS.
        for e in kaikki['entries'].get(w['headword'], []):
            if e['pos'] not in poses:
                continue
            keys = {comparable_ipa(s.get('ipa', '')) for s in e.get('sounds') or []}
            keys.discard(None)
            for official in list(entries):
                sounds = [s for s in official['sounds'] if comparable_ipa('/' + s['ipa'] + '/') in keys]
                if sounds:
                    shared = dict(official, pos=e['pos'], sounds=sounds,
                        evidence=f"local-kaikki:{kaikki['revision']}:{w['headword']}:{e['pos']}")
                    entries.append(shared)
                    matching.append(shared)
    if not matching:
        pending.append(dict(common, reason='no-matching-pos' if entries else 'no-exact-official-entry',
                            entries=entries, oldProfile=w['phonetic_profile']))
        continue
    primary_entry = min(matching, key=lambda e: poses.index(e['pos']) if e['pos'] in poses else len(poses))
    pronunciations = []
    for entry in entries:
        for sound in entry['sounds']:
            row = {'ipa': sound['ipa'], 'raw': sound['raw'], 'pos': entry['pos'],
                   'usage': labels.get(entry['pos'], entry['pos']) + '读法', 'reference': entry['url']}
            if entry.get('evidence'):
                row['evidence'] = entry['evidence']
            if not any((x['ipa'], x['pos']) == (row['ipa'], row['pos']) for x in pronunciations):
                pronunciations.append(row)
    words.append(dict(common, primary=primary_entry['sounds'][0]['ipa'], pronunciations=pronunciations))
plan = {'version': 'study-uk-20261021', 'sinceMs': scope['sinceMs'], 'frozenAt': scope['frozenAt'],
        'recentCards': scope['recentCards'], 'unlearnedCards': scope['unlearnedCards'],
        'scopeWordIds': [w['id'] for w in scope['words']], 'words': words}
atomic_json(a.batch / 'plan.json', plan)
atomic_json(a.batch / 'pending.json', pending)
print(json.dumps({'scopeWords': len(scope['words']), 'readyWords': len(words), 'pendingWords': len(pending),
                  'readyLegacy': sum(w['expected']['phonetic_profile'] == 'legacy' for w in words),
                  'pendingLegacy': sum(w['oldProfile'] == 'legacy' for w in pending)}))
