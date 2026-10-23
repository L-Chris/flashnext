"""Japanese TTS preparation. No learning-data writes; credentials never enter artifacts."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shlex
import sqlite3
import subprocess
import tempfile
import threading
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
import wave

from .japanese import kana, candidates
from .audio_loudness import STYLE as LOUDNESS_STYLE, check_wav as check_levels, normalize as normalize_audio, validate_processing

VERSION = 'ja-gemini-audio-v1'
DEFAULT_CONFIG = dict(gateway='https://chat.rethinkos.com', model='gemini/tts-lite',
                      resolvedModel='gemini-3.8-flash-lite-tts', voice='Kore',
                      asrModel='gemini/lite', verifierModel='gemini/gemini-3.8-flash', version=VERSION)
SPEECH_MODELS = ('gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview')
PRIORITY = ['私', '魚', '今日', '明日', '行く', '学校', '病院', 'こんにちは', '飴', '雨',
            '切る', '着る', '一日', '一', '絵', '木', '四', '二', '九', '七']


def compact(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(compact(value).encode()).hexdigest()


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x') as f:
            f.write(json.dumps(value, ensure_ascii=False, indent=2))
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def load_token(env_file):
    for line in Path(env_file).read_text().splitlines():
        match = re.match(r'^\s*(?:export\s+)?LLM_API_KEY\s*=\s*(.*)$', line)
        if match:
            parts = shlex.split(match[1], comments=True)
            if len(parts) == 1 and parts[0]:
                return parts[0]
    raise ValueError('LLM_API_KEY is missing from the configured env file')


def normalized_transcript(text):
    # Orthographic normalization only: do not remove repeated morae, small kana,
    # long vowels or voiced consonants just to make an ASR response pass.
    text = kana(unicodedata.normalize('NFKC', text).strip())
    return re.sub(r'[\s。、，,！!？?「」『』"\'・.]+', '', text)


def morae(reading):
    groups = []
    for c in reading:
        if c in 'ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ' and groups:
            groups[-1] += c
        else:
            groups.append(c)
    return groups


def fingerprint(row, config):
    return digest(dict(version=VERSION, config=config, word={k: row[k] for k in
                  ['wordId', 'lexicalKey', 'headword', 'reading', 'pos', 'translation', 'pitchHints']}))


def prepare_plan(db, deck_id, kaikki_file=None, config=None, only_missing_audio=False):
    c = sqlite3.connect(f'file:{Path(db).resolve()}?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    try:
        c.execute('begin')
        deck = c.execute('SELECT id,language FROM decks WHERE id=?', (deck_id,)).fetchone()
        if not deck or deck['language'] != 'ja':
            raise ValueError('Select an existing Japanese deck')
        missing_filter = " AND NOT EXISTS (SELECT 1 FROM card_media cm WHERE cm.card_id=c.id AND cm.side='back')" if only_missing_audio else ''
        records = c.execute("""SELECT w.id wordId,w.lexical_key lexicalKey,w.headword,w.reading,
            w.pos,w.translation,w.source_metadata,w.definition_status,c.id cardId,c.deck_id deckId
            FROM cards c JOIN words w ON w.id=c.word_id
            WHERE c.deck_id=? AND w.language='ja'""" + missing_filter + ' ORDER BY w.id,c.id', (deck_id,)).fetchall()
        rows = {}
        for raw in records:
            if raw['definition_status'] != 'ready' or not raw['reading']:
                raise ValueError(f"Card {raw['cardId']} has an unreviewed or missing reading")
            row = rows.setdefault(raw['wordId'], {k: raw[k] for k in
                                  ['wordId', 'lexicalKey', 'headword', 'reading', 'pos', 'translation']})
            row.setdefault('cards', []).append(dict(cardId=raw['cardId'], deckId=raw['deckId']))
            row['pitchHints'] = []
        by_word = {}
        for raw in records:
            by_word.setdefault(raw['headword'], []).append(raw)
        index = {}
        if kaikki_file:
            with Path(kaikki_file).open() as f:
                for line in f:
                    entry = json.loads(line)
                    if entry.get('word') in by_word:
                        index.setdefault(entry['word'], []).append(entry)
        for word_id, row in rows.items():
            source = json.loads(next(raw['source_metadata'] for raw in records if raw['wordId'] == word_id))
            original = source.get('original', {})
            if original:
                for match in candidates(original, index):
                    for sound in match['entry'].get('sounds', []):
                        if '東京' not in sound.get('raw_tags', []):
                            continue
                        for tag in sound.get('tags', []):
                            if tag in {'Heiban', 'Atamadaka', 'Odaka', 'Nakadaka'} and tag not in row['pitchHints']:
                                row['pitchHints'].append(tag)
            row['fingerprint'] = fingerprint(row, config or DEFAULT_CONFIG)
        ordered = sorted(rows.values(), key=lambda r: (PRIORITY.index(r['headword']) if r['headword'] in PRIORITY else len(PRIORITY), r['wordId']))
        plan = dict(version=VERSION, deckId=deck_id, config=dict(config or DEFAULT_CONFIG),
                    wordCount=len(ordered), cardCount=len(records), rows=ordered)
        if only_missing_audio:
            plan.update(selection='missing-back-audio', deckCardCount=c.execute("SELECT COUNT(*) FROM cards c JOIN words w ON w.id=c.word_id WHERE c.deck_id=? AND w.language='ja'", (deck_id,)).fetchone()[0])
        return plan
    finally:
        c.close()


def style_for(row, attempt=1):
    parts = morae(row['reading'])
    text = (f"Standard Japanese dictionary pronunciation in a neutral Tokyo accent. "
            f"The lexeme is {row['headword']} ({row['pos']}; meaning: {row['translation']}). "
            f"The required reading is {row['reading']}, exactly {len(parts)} mora: {'・'.join(parts)}. "
            "Pronounce ONLY the transcript exactly once at a clear, natural pace. "
            "Do not read these directions, the gloss, or an alternative reading aloud. "
            "Preserve small tsu, long vowels and all morae; do not add explanatory words. " + LOUDNESS_STYLE)
    hints = row.get('pitchHints', [])
    if len(hints) == 1 and hints[0] != 'Nakadaka':
        text += ' Dictionary pitch hint: ' + {
            'Heiban': 'heiban (unaccented, no downstep inside the word).',
            'Atamadaka': 'atamadaka (high first mora, downstep immediately after the first mora).',
            'Odaka': 'odaka (accent on the final mora).',
        }[hints[0]]
    if attempt > 1:
        text += ' Articulate each mora clearly without merging or omitting it, but keep the word connected.'
    return text


def validate_wav(data, maximum_duration=8):
    if not data.startswith(b'RIFF') or data[8:12] != b'WAVE':
        raise ValueError('TTS did not return a WAV file')
    with wave.open(io.BytesIO(data)) as f:
        pcm = f.readframes(f.getnframes())
        if pcm[:4] == b'RIFF':
            raise ValueError('WAV contains a redundant nested file header')
        duration = f.getnframes() / f.getframerate()
        if (f.getnchannels(), f.getsampwidth(), f.getframerate()) != (1, 2, 24000):
            raise ValueError('Unexpected TTS audio encoding')
        if not .15 <= duration <= maximum_duration or not any(pcm):
            raise ValueError('Silent, empty, truncated or unexpectedly long word audio')
        return dict(duration=round(duration, 6), sampleRate=24000, channels=1, sampleWidth=2)


class Gateway:
    def __init__(self, base, token, timeout=90):
        if base.rstrip('/') != 'https://chat.rethinkos.com':
            raise ValueError('Use the configured HTTPS Bifrost domain')
        self.base, self._token, self.timeout = base.rstrip('/'), token, timeout
        self._lock, self._next, self._blocked = threading.Lock(), {}, {}
        self._quotas = {}

    def rate_slot(self, model, native):
        # This AI Studio project's TTS quota is 10 RPM. Leave headroom for other clients.
        interval = 6.4 if native else .3
        while True:
            with self._lock:
                if model in self._quotas:
                    raise self._quotas[model]
                now = time.monotonic()
                when = max(self._next.get(model, 0), self._blocked.get(model, 0))
                if now >= when:
                    self._next[model] = now + interval
                    return
            time.sleep(min(1, when - now))

    def json(self, path, body=None, native=False):
        headers = {'Content-Type': 'application/json', 'User-Agent': 'FlashnextJapaneseAudio/1.0'}
        headers['x-goog-api-key' if native else 'Authorization'] = self._token if native else 'Bearer ' + self._token
        request = urllib.request.Request(self.base + path, None if body is None else compact(body).encode(), headers)
        model = path if native else (body or {}).get('model', path)
        for attempt in range(4):
            if body is not None:
                self.rate_slot(model, native)
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                detail = e.read().decode(errors='replace').replace(self._token, '[REDACTED]')
                detail = re.sub(r'(AIza[\w-]+|sk-[\w-]+)', '[REDACTED]', detail)
                if e.code == 429 and 'per_model_per_day' in detail:
                    retry = re.search(r'"retryDelay"\s*:\s*"([\d.]+)s', detail)
                    self._quotas[model] = DailyQuotaExceeded(time.time() + (float(retry[1]) if retry else 3600) + 60)
                    raise self._quotas[model]
                if e.code in {429, 500, 502, 503, 504} and attempt < 3:
                    delay = e.headers.get('Retry-After', '')
                    recommended = re.search(r'(?:retry in |"retryDelay"\s*:\s*")([\d.]+)s', detail)
                    delay = max(2 ** (attempt + 1), float(delay) if delay.isdigit() else 0,
                                float(recommended[1]) + 1 if recommended else 0)
                    with self._lock:
                        self._blocked[model] = max(self._blocked.get(model, 0), time.monotonic() + min(90, delay))
                    continue
                raise RuntimeError(f'Gateway HTTP {e.code}: {detail[:700]}') from None
            except (TimeoutError, urllib.error.URLError):
                if attempt == 3:
                    raise RuntimeError('Gateway connection failed after retries') from None
                time.sleep(2 ** (attempt + 1))

    def speech(self, row, config, attempt):
        return self._speech([row], config, attempt)

    def transcribe(self, audio, model):
        prompt = ('音声を書き起こしてください。聞こえた発音をひらがなだけで答えてください。'
                  '意味から推測して別の単語に言い換えないでください。長音、促音、拗音、濁音を正確に保ってください。'
                  '説明や漢字、句読点は不要です。')
        result = self.json('/openai/v1/chat/completions', {'model': model, 'temperature': 0,
            'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': prompt},
            {'type': 'input_audio', 'input_audio': {'data': base64.b64encode(audio).decode(), 'format': 'wav'}}]}]})
        text = result['choices'][0]['message'].get('content')
        if not isinstance(text, str) or not text.strip():
            raise ValueError('ASR returned no transcript')
        return dict(model=model, transcript=text.strip(), usage=result.get('usage'))

    def speech_group(self, rows, config):
        return self._speech(rows, config)

    def _speech(self, rows, config, attempt=1):
        exhausted = []
        for model in [config['resolvedModel'], *config.get('fallbackModels', [])]:
            if model not in SPEECH_MODELS:
                raise ValueError('Unsupported speech model')
            body = speech_body(rows, config, model, attempt)
            try:
                result = self.json('/genai_passthrough/v1beta/models/' + model + ':generateContent', body, True)
            except DailyQuotaExceeded as e:
                exhausted.append(e)
                continue
            parts = [p['inlineData'] for c in result.get('candidates', []) for p in c.get('content', {}).get('parts', []) if p.get('inlineData')]
            if len(parts) != 1:
                raise ValueError('Expected one native audio result')
            data, encoding = decode_speech_audio(parts[0], model)
            usage = dict(result.get('usageMetadata') or {})
            usage['flashnextSource'] = dict(model=model, encoding=encoding, request=body)
            return data, usage
        # All approved models exhausted; wait for the first available daily reset.
        raise DailyQuotaExceeded(min(e.retry_at for e in exhausted))


def speech_body(rows, config, model, attempt=1):
    legacy = model == 'gemini-3.1-flash-tts-preview'
    if legacy:
        if len(rows) == 1:
            row = rows[0]
            prompt = ('標準的な日本語で、次の単語だけを一度発音してください。説明は読まないでください。'
                      f"促音・長音を省略せず、{len(morae(row['reading']))}拍ではっきり読んでください。\n"
                      'Text to pronounce:\n' + row['reading'])
        else:
            prompt = ('標準的な日本語で、次の単語だけを順番に一度ずつ発音してください。'
                      '単語と単語の間には一秒の無音を入れてください。説明は読まないでください。\n'
                      + '\n'.join(row['reading'] for row in rows))
        parts = [{'text': prompt}]
        voice = {'prebuiltVoiceConfig': {'voiceName': config['voice']}}
    else:
        parts = [{'text': row['reading'] + (' <long pause>' if i < len(rows)-1 else ''),
                  'speech_metadata': {'style': style_for(row, attempt) + (' Respect the long pause tag after this word.' if len(rows)>1 else '')}}
                 for i, row in enumerate(rows)]
        voice = {'voice': config['voice']}
    return {'contents': [{'role': 'user', 'parts': parts}],
            'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': {'voiceConfig': voice}}}


def decode_speech_audio(part, model):
    data = base64.b64decode(part['data'], validate=True)
    mime = part.get('mimeType', '').lower()
    if mime == 'audio/wav':
        return data, dict(sourceMime=mime, pcmWrapped=False)
    if model != 'gemini-3.1-flash-tts-preview' or not mime.startswith('audio/l16') or 'rate=24000' not in mime or not data or len(data) % 2 or data.startswith(b'RIFF'):
        raise ValueError('Unexpected native TTS encoding')
    out = io.BytesIO()
    with wave.open(out, 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(24000); f.writeframes(data)
    return out.getvalue(), dict(sourceMime=mime, pcmWrapped=True)


def split_word_group(data, count):
    """Require exactly count-1 long internal silences; never guess word boundaries."""
    info = validate_wav(data, count * 8)
    with tempfile.TemporaryDirectory() as d:
        source = Path(d) / 'group.wav'
        source.write_bytes(data)
        output = subprocess.run(['ffmpeg', '-nostdin', '-i', str(source), '-af',
            'silencedetect=noise=-45dB:d=0.5', '-f', 'null', '-'], capture_output=True, text=True, check=True)
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', output.stderr)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', output.stderr)]
    if len(starts) != len(ends):
        raise ValueError('Incomplete group silence boundaries')
    gaps = [(s, e) for s, e in zip(starts, ends) if s > .1 and e < info['duration'] - .1]
    if len(gaps) != count - 1:
        raise ValueError('Unexpected number of long pauses; regenerate words separately')
    with wave.open(io.BytesIO(data)) as f:
        pcm = f.readframes(f.getnframes())
    clips = []
    for i in range(count):
        start = max(0, gaps[i-1][1] - .12) if i else 0
        end = min(info['duration'], gaps[i][0] + .12) if i < count-1 else info['duration']
        out = io.BytesIO()
        with wave.open(out, 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(24000)
            f.writeframes(pcm[int(start * 24000)*2:int(end * 24000)*2])
        clip = out.getvalue()
        validate_wav(clip)
        clips.append((clip, dict(start=start, end=end)))
    return clips


def persist_accepted(row, config, root, wav, info, checks, history, generation=None):
    output = wav.with_suffix('.mp3')
    processing = normalize_audio(wav, output)
    result = dict(version=VERSION, status='accepted', fingerprint=fingerprint(row, config),
                  wordId=row['wordId'], lexicalKey=row['lexicalKey'], headword=row['headword'], reading=row['reading'],
                  generatedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), model=(generation or {}).get('model', config['resolvedModel']),
                  voice=config['voice'], style=style_for(row), audioFile=str(output.relative_to(root)),
                  sha256=file_hash(output), bytes=output.stat().st_size, audio=info,
                  checks=checks, attempts=history, generation=generation or {'mode': 'single-word'}, pitchAccentCertified=False,
                  audioProcessing=processing)
    atomic_json(root / 'results' / f"{row['wordId']}.json", result)
    return result


def validate_result(row, config, root, result):
    if result.get('status') != 'accepted' or result.get('fingerprint') != fingerprint(row, config):
        raise ValueError('Audio has not passed reading checks for this word/configuration')
    if result.get('model') not in [config['resolvedModel'], *config.get('fallbackModels', [])]:
        raise ValueError('Audio model is outside the approved model policy')
    path = (Path(root) / result['audioFile']).resolve()
    if not path.is_relative_to(Path(root).resolve()) or not path.is_file() or file_hash(path) != result['sha256']:
        raise ValueError('Missing, changed or invalid audio artifact')
    if 'audioProcessing' in result:
        validate_processing(result['audioProcessing'], result['sha256'])
    checks = result.get('checks', [])
    if not checks or not any(normalized_transcript(c['transcript']) == normalized_transcript(row['reading']) for c in checks):
        raise ValueError('No matching blind ASR evidence')
    return path


class DailyQuotaExceeded(Exception):
    def __init__(self, retry_at):
        self.retry_at = retry_at
        super().__init__('Daily TTS request quota exhausted; retain accepted results and retry after reset')


def generate_word(row, config, root, gateway, attempts=3):
    root = Path(root)
    result_file = root / 'results' / f"{row['wordId']}.json"
    old = json.loads(result_file.read_text()) if result_file.exists() else {}
    try:
        validate_result(row, config, root, old)
        return dict(old, cached=True)
    except (ValueError, KeyError, OSError):
        pass
    history = []
    for attempt in range(1, attempts + 1):
        started = time.monotonic()
        entry = dict(attempt=attempt, checks=[])
        try:
            data, usage = gateway.speech(row, config, attempt)
            info = validate_wav(data)
            stem = f"{row['wordId']}-{uuid.uuid4().hex[:10]}"
            wav = root / 'audio' / f'{stem}.wav'
            wav.parent.mkdir(parents=True, exist_ok=True)
            wav.write_bytes(data)
            entry.update(wavFile=str(wav.relative_to(root)), audio=info, usage=usage)
            entry['audioLevels'] = check_levels(data)
            first = gateway.transcribe(data, config['asrModel'])
            entry['checks'].append(first)
            if normalized_transcript(first['transcript']) != normalized_transcript(row['reading']):
                second = gateway.transcribe(data, config['verifierModel'])
                entry['checks'].append(second)
            passed = any(normalized_transcript(c['transcript']) == normalized_transcript(row['reading']) for c in entry['checks'])
            if not passed:
                entry['error'] = 'Blind ASR readings do not match the planned kana'
                history.append(entry)
                continue
            entry['seconds'] = round(time.monotonic() - started, 3)
            history.append(entry)
            result = persist_accepted(row, config, root, wav, info, entry['checks'], history,
                                      dict(mode='single-word', **usage.get('flashnextSource', {})))
            result['style'] = style_for(row, attempt)
            atomic_json(result_file, result)
            return result
        except DailyQuotaExceeded:
            raise
        except Exception as e:
            entry['error'] = str(e)[:900]
            entry['seconds'] = round(time.monotonic() - started, 3)
            history.append(entry)
    result = dict(version=VERSION, status='needs_review', fingerprint=fingerprint(row, config),
                  wordId=row['wordId'], headword=row['headword'], reading=row['reading'], attempts=history)
    atomic_json(result_file, result)
    return result


def generate_group(rows, config, root, gateway, attempts=3):
    root = Path(root)
    accepted, pending = [], []
    for row in rows:
        path = root / 'results' / f"{row['wordId']}.json"
        try:
            result = json.loads(path.read_text())
            validate_result(row, config, root, result)
            accepted.append(dict(result, cached=True))
        except (OSError, ValueError, KeyError):
            pending.append(row)
    if not pending:
        return accepted
    if len(pending) == 1:
        return accepted + [generate_word(pending[0], config, root, gateway, attempts)]
    try:
        data, usage = gateway.speech_group(pending, config)
        clips = split_word_group(data, len(pending))
        group_id = uuid.uuid4().hex
        group_path = root / 'groups' / (group_id + '.wav')
        group_path.parent.mkdir(parents=True, exist_ok=True)
        group_path.write_bytes(data)
        atomic_json(group_path.with_suffix('.json'), dict(words=pending, usage=usage, sha256=file_hash(group_path)))
    except DailyQuotaExceeded:
        raise
    except Exception:
        # No guessed cuts are accepted. The fallback still requires a matching ASR.
        return accepted + [generate_word(row, config, root, gateway, attempts) for row in pending]
    for row, (data, boundary) in zip(pending, clips):
        try:
            check_levels(data)
            checks = [gateway.transcribe(data, config['asrModel'])]
            if normalized_transcript(checks[0]['transcript']) != normalized_transcript(row['reading']):
                checks.append(gateway.transcribe(data, config['verifierModel']))
            if not any(normalized_transcript(c['transcript']) == normalized_transcript(row['reading']) for c in checks):
                raise ValueError('Group clip reading mismatch')
            wav = root / 'audio' / f"{row['wordId']}-{group_id[:10]}.wav"
            wav.parent.mkdir(parents=True, exist_ok=True)
            wav.write_bytes(data)
            provenance = dict(mode='pause-separated-group', groupFile=str(group_path.relative_to(root)),
                              groupSha256=file_hash(group_path), boundary=boundary, groupUsage=usage,
                              **usage.get('flashnextSource', {}))
            accepted.append(persist_accepted(row, config, root, wav, validate_wav(data), checks,
                                            [dict(attempt=1, checks=checks, group=provenance)], provenance))
        except DailyQuotaExceeded:
            raise
        except Exception:
            accepted.append(generate_word(row, config, root, gateway, attempts))
    return accepted
