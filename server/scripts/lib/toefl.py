"""Prepare a pinned TOEFL import with local dictionaries; never writes the database."""
import collections, hashlib, json, sqlite3, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'lib'))
from pronunciation import normalize, PROFILE


def load_source():
    manifest = json.loads((ROOT / 'resources/toefl-source.json').read_text())
    raw = (ROOT / 'resources/toefl-headwords.txt').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == manifest['headwordsSha256'], 'Headword snapshot changed'
    names = raw.decode().splitlines()
    assert len(names) == len(set(names)) == manifest['count']
    assert all(n == n.strip() and n and not any(ord(c) < 32 for c in n) for n in names)
    return manifest, names


def usable(s):
    return not (set(s.get('tags', [])) & {'obsolete', 'archaic', 'dated', 'rare', 'nonstandard'})


def project(entries):
    """Keep every gloss-bearing sense, including form references and senses without examples."""
    senses = []
    for eidx, entry in enumerate(entries):
        for idx, sense in enumerate(entry.get('senses', [])):
            glosses = sense.get('glosses', [])
            if not glosses: continue
            examples = []
            for ex in sense.get('examples', []):
                text = ex.get('text', '').strip()
                if ex.get('type') == 'example' and text and text not in examples:
                    examples.append(text)
            zh = list(dict.fromkeys(t['word'] for t in sense.get('translations', [])
                if t.get('code') in {'zh', 'zh-Hans', 'zh-Hant', 'cmn'} and t.get('word')))
            tags = list(dict.fromkeys(entry.get('tags', []) + sense.get('tags', [])))
            senses.append(dict(sourceKey=f'{eidx}:{idx}', pos=entry.get('pos', ''),
                gloss='\n'.join(glosses), examples=json.dumps(examples, ensure_ascii=False),
                zh=json.dumps(zh, ensure_ascii=False), tags=json.dumps(tags, ensure_ascii=False)))
    return sorted(senses, key=lambda s: bool(set(json.loads(s['tags'])) & {'obsolete', 'archaic', 'dated', 'rare', 'nonstandard'}))


def prepare(db, data, output):
    manifest, names = load_source()
    c = sqlite3.connect(f'file:{Path(db).resolve()}?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    english_filter=" where language='en'" if any(r[1]=='language' for r in c.execute('pragma table_info(words)')) else ''
    words = {r['headword']: dict(r) for r in c.execute('select * from words'+english_filter)}
    have_senses = {r[0] for r in c.execute('select distinct word_id from word_senses')}
    missing = [n for n in names if n not in words]
    reviewed = json.loads((ROOT / 'resources/toefl-reviewed-definitions.json').read_text())
    entity_repairs = []
    for n in missing:
        row = c.execute('select e.id,e.canonical_key,w.headword from knowledge_entities e left join words w on w.knowledge_entity_id=e.id where e.canonical_key=?', (f'en:word:{n}',)).fetchone()
        if row:
            assert row['headword'] and row['headword'] != n and row['headword'].lower() == n.lower(), f'Unresolved entity collision: {n}'
            target=f"en:word:{row['headword']}"
            assert not c.execute('select 1 from knowledge_entities where canonical_key=?',(target,)).fetchone()
            entity_repairs.append(dict(id=row['id'],before=row['canonical_key'],after=target))
    # Reuse the guarded, exact-case CSV decoder and reviewed Chinese overrides.
    code = "const {lookupEcdict}=require('./scripts/lib/ecdict'); lookupEcdict(process.argv[1],JSON.parse(process.argv[2])).then(m=>process.stdout.write(JSON.stringify(Object.fromEntries(m))))"
    ec = json.loads(subprocess.check_output(['node', '-e', code, str(ROOT/'data/ecdict.csv'), json.dumps(missing)], cwd=ROOT.parent))
    targets = set(missing) | {n for n in names if n in words and words[n]['id'] not in have_senses}
    collected = collections.defaultdict(list)
    digest = hashlib.sha256()
    with open(data, 'rb') as stream:
        for line in stream:
            digest.update(line)
            entry = json.loads(line)
            if entry.get('lang_code') == 'en' and entry.get('word') in targets:
                collected[entry['word']].append(entry)
    revision = digest.hexdigest()
    new_words, phonetics, empty_meanings = [], [], []
    for n in missing:
        entries = collected[n]
        info = ec.get(n, {})
        translation = info.get('translation', '').strip()
        origin = 'ecdict+reviewed-overrides'
        if not translation:
            glosses = [s['glosses'][-1] for e in entries for s in e.get('senses', []) if s.get('glosses') and usable(s)]
            translation = '\n'.join(dict.fromkeys(glosses[:4]))
            origin = 'kaikki-en'
        if n in reviewed:
            translation=reviewed[n]['translation'];origin=reviewed[n]['source']
        if not translation: empty_meanings.append(n)
        sounds = []
        for e in entries:
            senses = e.get('senses', [])
            form = bool(senses) and all(s.get('form_of') or s.get('alt_of') for s in senses)
            for sound in e.get('sounds', []):
                if not sound.get('ipa'): continue
                accent, display, reason = normalize(sound['ipa'], sound.get('tags', []), sound.get('note', ''), form)
                if senses and all(not usable(s) for s in senses): display, reason = '', '全部义项均有限定标签'
                sounds.append(dict(pos=e.get('pos',''), accent=accent, rawIpa=sound['ipa'], displayIpa=display,
                    status='accepted' if display else 'review', note=json.dumps(dict(tags=sound.get('tags', []), reason=reason), ensure_ascii=False)))
        sounds = list({json.dumps(s, sort_keys=True): s for s in sounds}.values())
        accepted = [s for s in sounds if s['status'] == 'accepted']
        ipa = accepted[0]['displayIpa'] if accepted else ''
        pos = reviewed[n]['pos'] if n in reviewed else info.get('pos','') or '/'.join(dict.fromkeys(e.get('pos','') for e in entries))
        new_words.append(dict(headword=n, translation=translation, pos=pos,
            phonetic=ipa, phoneticLegacy=info.get('phonetic', ''), phoneticProfile=PROFILE if ipa else 'legacy', definitionSource=origin))
        phonetics.extend(dict(headword=n, **s) for s in sounds)
    if empty_meanings: raise ValueError(f'No definition; review before importing: {empty_meanings}')
    projected = {n: project(collected[n]) for n in names if n in targets and collected[n]}
    projected = {n: senses for n,senses in projected.items() if senses}
    report = dict(total=len(names), existing=len(names)-len(missing), newWords=len(new_words),
        newTags=sum(not c.execute("select 1 from word_tags where word_id=? and scheme='toefl' and level=1", (words[n]['id'],)).fetchone() for n in names if n in words)+len(missing),
        enrichedWords=len(projected), senses=sum(map(len, projected.values())),
        noKaikki=[n for n in missing if not collected[n]], noAcceptedUkIpa=[w['headword'] for w in new_words if not w['phonetic']],
        entityKeyRepairs=entity_repairs, reviewedChinese=[n for n in missing if n in reviewed], englishFallback=[w['headword'] for w in new_words if w['definitionSource']=='kaikki-en'])
    payload = dict(dictionaryProvenance=dict(kaikkiSha256=revision, ecdictSha256=hashlib.file_digest(open(ROOT/'data/ecdict.csv','rb'),'sha256').hexdigest(), reviewedDefinitionsSha256=hashlib.sha256((ROOT/'resources/toefl-reviewed-definitions.json').read_bytes()).hexdigest()), source=manifest, names=names, kaikkiRevision=revision, existing={n:words[n] for n in names if n in words},
        entityRepairs=entity_repairs, newWords=new_words, pronunciations=phonetics, senses=projected, report=report)
    out=Path(output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(payload,ensure_ascii=False))
    out.with_suffix('.raw-kaikki.json').write_text(json.dumps(dict(revision=revision, entries=collected),ensure_ascii=False))
    print(json.dumps(report,ensure_ascii=False),flush=True)
