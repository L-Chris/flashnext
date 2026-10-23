"""Scoped, read-only pronunciation audit helpers. No synthesis or DB writes."""
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

from bs4 import BeautifulSoup

ROOT = 'https://www.oxfordlearnersdictionaries.com'
SOURCE = 'reviewed-study-20261021'
POS = {'noun': 'noun', 'verb': 'verb', 'adjective': 'adj', 'adverb': 'adv',
       'preposition': 'prep', 'pronoun': 'pron', 'exclamation': 'intj',
       'determiner': 'det', 'conjunction': 'conj', 'number': 'num', 'ordinal number': 'num'}


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temp.replace(path)


def word_key(word):
    return unicodedata.normalize('NFC', word).casefold().replace('’', "'").strip()


def display_ipa(raw):
    """Oxford broad BrE only: retain optional r and weak syllabic consonants."""
    if not raw.startswith('/') or not raw.endswith('/'):
        raise ValueError('Expected an explicitly broad transcription')
    value = unicodedata.normalize('NFC', raw[1:-1]).replace('ɡ', 'g').replace('g', 'ɡ')
    if not value or re.search(r'[^pbtdkɡfvθðszʃʒhmnŋlrwj iɪeɛæɑɒɔʊuʌɜəaːˈˌ().̩]', value):
        raise ValueError('Unreviewed IPA notation: ' + raw)
    return value


def parse_oxford(html, url):
    soup = BeautifulSoup(html, 'lxml')
    records = []
    for entry in soup.select('.entry'):
        top = entry.select_one('.webtop')
        if not top:
            continue
        head = top.select_one('.headword')
        pos = top.select_one('.pos')
        if not head:
            continue
        # Inflection tables also contain .phons_br; never treat them as lemmas.
        sounds = []
        for phonetics in top.find_all(class_='phonetics', recursive=False):
            for phon in phonetics.select('.phons_br .phon'):
                raw = phon.get_text('', strip=True)
                try:
                    ipa = display_ipa(raw)
                except ValueError:
                    continue
                if ipa not in [x['ipa'] for x in sounds]:
                    sounds.append({'ipa': ipa, 'raw': raw})
        for homograph in head.select('.hm'):
            homograph.decompose()
        name = head.get_text(' ', strip=True)
        aliases = [v.get_text(' ', strip=True) for v in top.select('.variants .v')]
        for part in re.split(r'\s*,\s*|\s+and\s+', pos.get_text(' ', strip=True) if pos else ''):
            records.append({'headword': name, 'aliases': aliases, 'pos': POS.get(part, part),
                            'sounds': sounds, 'url': url, 'entryId': entry.get('id')})
        for form in top.select('.verb_forms_table tr.verb_form'):
            for british in form.select('.phons_br'):
                spelling = british.get('wd')
                form_sounds = []
                for phon in british.select('.phon'):
                    raw = phon.get_text('', strip=True)
                    try:
                        form_sounds.append({'ipa': display_ipa(raw), 'raw': raw})
                    except ValueError:
                        pass
                if spelling and form_sounds:
                    records.append({'headword': spelling, 'aliases': [], 'pos': 'verb', 'sounds': form_sounds,
                                    'url': url, 'entryId': entry.get('id'), 'form': form.get('form'), 'lemma': name})
    related = [{'label': a.get_text(' ', strip=True), 'url': a.get('href')}
               for a in soup.select('#relatedentries a, .relatedentries a') if a.get('href', '').startswith(ROOT + '/definition/english/')]
    return {'entries': records, 'related': related,
            'htmlSha256': hashlib.sha256(html).hexdigest()}


def scope(db, since_ms):
    with sqlite3.connect(f'file:{Path(db).resolve()}?mode=ro', uri=True) as c:
        c.row_factory = sqlite3.Row
        c.execute('BEGIN')
        decks = [r[0] for r in c.execute("SELECT id FROM decks WHERE language='en'")]
        if not decks:
            raise ValueError('No English decks')
        q = ','.join('?' for _ in decks)
        recent = c.execute(f'''SELECT c.id cardId,c.word_id wordId,MIN(r.review_at) firstNew
          FROM cards c JOIN review_logs r ON r.card_id=c.id AND r.state=0
          WHERE c.deck_id IN ({q}) GROUP BY c.id HAVING firstNew>=?''', [*decks, since_ms]).fetchall()
        fresh = c.execute(f'''SELECT c.id cardId,c.word_id wordId FROM cards c
          WHERE c.deck_id IN ({q}) AND c.state=0 AND c.reps=0 ORDER BY c.id''', decks).fetchall()
        targets = {}
        for kind, rows in [('unlearned', fresh), ('recent', recent)]:
            for card in rows:
                if card['wordId'] is None:
                    continue
                w = targets.setdefault(card['wordId'], dict(c.execute("SELECT * FROM words WHERE id=? AND language='en'", (card['wordId'],)).fetchone() or {}))
                if not w:
                    raise ValueError('Invalid English word identity')
                w.setdefault('cards', [])
                if card['cardId'] not in w['cards']:
                    w['cards'].append(card['cardId'])
                w.setdefault('selection', [])
                if kind not in w['selection']:
                    w['selection'].append(kind)
        return {'sinceMs': since_ms, 'frozenAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'recentCards': len(recent), 'unlearnedCards': len(fresh), 'words': list(targets.values())}


class OxfordLookup:
    def __init__(self, directory, interval=.4):
        self.directory = Path(directory)
        self.lock = threading.Lock()
        self.next = 0
        self.interval = interval

    def get(self, url):
        if not url.startswith(ROOT + '/'):
            raise ValueError('Unexpected dictionary host')
        file = self.directory / (hashlib.sha256(url.encode()).hexdigest() + '.json')
        if file.exists():
            return json.loads(file.read_text())
        with self.lock:
            delay = max(0, self.next - time.monotonic())
            self.next = time.monotonic() + delay + self.interval
        if delay:
            time.sleep(delay)
        result = {'requestedUrl': url}
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(request, timeout=20) as response:
                result.update(parse_oxford(response.read(), response.url), status=200, url=response.url)
        except urllib.error.HTTPError as error:
            result.update(status=error.code, error='HTTP ' + str(error.code))
        except (OSError, ValueError) as error:
            result.update(status=0, error=str(error)[:200])
        result['checkedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        atomic_json(file, result)
        return result

    def word(self, word):
        slug = urllib.parse.quote(word.replace(' ', '-').lower(), safe="-'")
        root = self.get(ROOT + '/definition/english/' + slug)
        found = [root]
        if root['status'] != 200 or not any(matches_word(e, word) and e['sounds'] for e in root.get('entries', [])):
            result = self.get(ROOT + '/search/english/?q=' + urllib.parse.quote(word))
            found.append(result)
        # Other parts of speech are separate pages (e.g. reuse noun / verb).
        links = {r['url'] for page in found for r in page.get('related', [])
                 if any(word_key(r['label']) == word_key(word) + ' ' + p for p in POS)}
        for url in sorted(links):
            found.append(self.get(url))
        entries = []
        for page in found:
            for entry in page.get('entries', []):
                if matches_word(entry, word) and entry['sounds'] and entry not in entries:
                    entries.append(entry)
        return {'headword': word, 'entries': entries,
                'attempts': [{'url': p['requestedUrl'], 'status': p['status']} for p in found]}


def matches_word(entry, word):
    return word_key(word) in {word_key(x) for x in [entry['headword'], *entry.get('aliases', [])]}


def verified_alias_entries(entries, word, kaikki):
    """A variant/synonym label must not inherit another spelling's pronunciation."""
    from .pronunciation import normalize
    verified = []
    for entry in entries:
        if not matches_word(entry, word):
            continue
        if word_key(entry['headword']) == word_key(word):
            verified.append(entry)
            continue
        keys = set()
        for local in kaikki.get('entries', {}).get(word, []):
            if local['pos'] != entry['pos']:
                continue
            for sound in local.get('sounds') or []:
                accent, ipa, reason = normalize(sound.get('ipa',''),sound.get('tags',[]),sound.get('note',''))
                if accent == 'UK' and ipa:
                    key = comparable_ipa('/'+ipa+'/')
                    if key:keys.add(key)
        sounds = [s for s in entry['sounds'] if comparable_ipa('/'+s['ipa']+'/') in keys]
        if sounds:
            verified.append(dict(entry,sounds=sounds,evidence=f"local-kaikki:{kaikki['revision']}:{word}:{entry['pos']}"))
    return verified


def word_poses(value):
    aliases = {'n': 'noun', 'pl': 'noun', 'a': 'adj', 'adj': 'adj', 'v': 'verb', 'vt': 'verb', 'vi': 'verb',
               'adv': 'adv', 'prep': 'prep', 'pron': 'pron', 'num': 'num', 'conj': 'conj', 'interj': 'intj', 'det': 'det'}
    short = [aliases[x] for x in re.findall(r'(?<![a-z])(interj|adj|adv|prep|pron|conj|det|num|pl|vt|vi|n|a|v)\.', value)]
    long = [POS[x] for x in re.findall(r'\b(noun|verb|adjective|adverb|ordinal number|number)\b', value)]
    return list(dict.fromkeys(short + long))


def system_back(ipa, translation):
    decoded = re.sub(r'\\+r\\+n|\\+[nr]|\r\n?', '\n', translation)
    return (f'/{ipa}/\n' if ipa else '') + decoded


def comparable_ipa(raw):
    """Compare explicit full transcriptions; keep primary stress and accent vowels."""
    if not (raw.startswith('/') and raw.endswith('/')):
        return None
    value = unicodedata.normalize('NFC', raw[1:-1]).replace('(r)', '').replace('(ɹ)', '')
    if '(' in value or ')' in value or '-' in value:
        return None
    value = value.replace('ɹ', 'r').replace('ɛ', 'e').replace('g', 'ɡ')
    value = re.sub(r'[. ̯͜͡ˌ]', '', value)
    return re.sub(r'ə(?=[lnm](?:$|[^iɪeɛæɑɒɔʊuʌɜəa]))', '', value)
