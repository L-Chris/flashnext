"""Frozen English study batches, British TTS and separate audio quality checks."""
import base64
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import unicodedata
import uuid
from zoneinfo import ZoneInfo
from .audio_loudness import STYLE as LOUDNESS_STYLE, check_wav as check_levels, normalize as normalize_audio, validate_processing

from .japanese_audio import (Gateway, DailyQuotaExceeded, SPEECH_MODELS, atomic_json,
    compact, decode_speech_audio, digest, file_hash, split_word_group, validate_wav)

VERSION = 'en-gemini-audio-v1'
CONFIG = dict(version=VERSION, gateway='https://chat.rethinkos.com',
    model='gemini/gemini-3.8-flash-tts', resolvedModel='gemini-3.8-flash-tts',
    fallbackModels=['gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-lite-tts'],
    voice='Kore', accent='British English', asrModel='gemini/lite',
    verifierModel='gemini/gemini-3.8-flash', qaModel='gemini/gemini-3.8-flash')


def fingerprint(row, config):
    return digest(dict(version=VERSION, config=config, word={k: row[k] for k in
        ['wordId', 'lexicalKey', 'headword', 'phonetic', 'phoneticProfile', 'pos', 'translation', 'pronunciation']}))


def prepare_plan(db, deck_id, days=7, now_ms=None, selection='today-and-upcoming-new-cards'):
    if not 1 <= days <= 30:
        raise ValueError('Select 1–30 study days')
    if selection not in {'today-and-upcoming-new-cards', 'recently-learned'}:
        raise ValueError('Unknown English study selection')
    c = sqlite3.connect(f'file:{Path(db).resolve()}?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    try:
        c.execute('BEGIN')
        deck = c.execute('SELECT * FROM decks WHERE id=?', (deck_id,)).fetchone()
        settings = c.execute('SELECT * FROM deck_settings WHERE deck_id=?', (deck_id,)).fetchone()
        if not deck or deck['language'] != 'en' or not settings:
            raise ValueError('An English deck with saved settings is required')
        now_ms = int(time.time()*1000) if now_ms is None else now_ms
        now = datetime.fromtimestamp(now_ms/1000, ZoneInfo(settings['timezone']))
        cutoff = now.replace(hour=settings['rollover_hour'], minute=0, second=0, microsecond=0)
        if now < cutoff:
            cutoff -= timedelta(days=1)
        start, end = int(cutoff.timestamp()*1000), int((cutoff+timedelta(days=1)).timestamp()*1000)
        spent = c.execute('''SELECT COUNT(*) FROM review_logs r JOIN cards c ON c.id=r.card_id
            WHERE c.deck_id=? AND r.state=0 AND r.review_at>=? AND r.review_at<?''', (deck_id,start,end)).fetchone()[0]
        # Include new words already learned today; deduct used slots when selecting
        # the remaining queue. The backend's fresh-card order is ascending card ID.
        learned = c.execute('''SELECT c.*,w.headword FROM cards c JOIN words w ON w.id=c.word_id
            WHERE c.deck_id=? AND w.language='en' AND
            (SELECT MIN(r.review_at) FROM review_logs r WHERE r.card_id=c.id AND r.state=0)>=?
            AND (SELECT MIN(r.review_at) FROM review_logs r WHERE r.card_id=c.id AND r.state=0)<?
            ORDER BY c.id''', (deck_id,start,end)).fetchall()
        today_remaining = max(0, settings['new_per_day']-spent)
        capacity = today_remaining+(days-1)*settings['new_per_day']
        if settings['new_per_day'] < 1 and selection != 'recently-learned':
            raise ValueError('Deck has no daily new-card allowance')
        fresh = c.execute('''SELECT c.*,w.headword FROM cards c JOIN words w ON w.id=c.word_id
            WHERE c.deck_id=? AND c.state=0 AND c.reps=0 AND w.language='en' ORDER BY c.id LIMIT ?''',
            (deck_id,capacity)).fetchall()
        records = [*learned, *fresh]
        first_day = cutoff
        if selection == 'recently-learned':
            first_day = cutoff-timedelta(days=days-1)
            # Filter only after finding the earliest review in the full history.
            # Recent reviews of older words must not make them newly learned.
            records = c.execute('''WITH first_reviews AS (
                SELECT card_id,MIN(review_at) first_learned_at FROM review_logs GROUP BY card_id
            ) SELECT c.*,w.headword,f.first_learned_at FROM cards c
                JOIN words w ON w.id=c.word_id JOIN first_reviews f ON f.card_id=c.id
                WHERE c.deck_id=? AND w.language='en' AND f.first_learned_at>=? AND f.first_learned_at<=?
                ORDER BY f.first_learned_at DESC,c.id''',
                (deck_id,int(first_day.timestamp()*1000),now_ms)).fetchall()
        rows, selections, blocked = {}, [], []
        for index, card in enumerate(records):
            if selection == 'recently-learned':
                first = datetime.fromtimestamp(card['first_learned_at']/1000, ZoneInfo(settings['timezone']))
                day = first.replace(hour=settings['rollover_hour'],minute=0,second=0,microsecond=0)
                date = (day-timedelta(days=1) if first < day else day).date().isoformat()
            else:
                fresh_index = index-len(learned)
                offset = 0 if fresh_index < today_remaining else 1+(fresh_index-today_remaining)//settings['new_per_day']
                if index < len(learned): offset = 0
                date = (cutoff+timedelta(days=offset)).date().isoformat()
            selections.append(dict(cardId=card['id'], wordId=card['word_id'], headword=card['headword'], studyDate=date))
            if c.execute("SELECT 1 FROM card_media WHERE card_id=? AND side='back'", (card['id'],)).fetchone():
                continue
            w = c.execute('SELECT * FROM words WHERE id=?', (card['word_id'],)).fetchone()
            p = c.execute("""SELECT pos,usage,display_ipa,note,source FROM word_pronunciations
                WHERE word_id=? AND status='accepted' AND accent='UK' AND display_ipa=? ORDER BY id LIMIT 1""",
                (w['id'],w['phonetic'])).fetchone()
            if w['phonetic_profile'] != 'learner-ipa-uk-v1' or not w['phonetic'] or not p:
                if selection == 'recently-learned':
                    blocked.append(dict(cardId=card['id'],wordId=w['id'],headword=w['headword'],
                        reason='Verify British pronunciation before generation',studyDate=date))
                    continue
                raise ValueError(f"Verify British pronunciation before generation: {w['headword']}")
            row = rows.setdefault(w['id'], dict(wordId=w['id'], lexicalKey=w['lexical_key'], headword=w['headword'],
                reading=w['headword'], pos=w['pos'], translation=w['translation'], phonetic=w['phonetic'],
                phoneticProfile=w['phonetic_profile'], pronunciation=dict(p), studyDate=date, cards=[]))
            row['cards'].append(dict(cardId=card['id'],deckId=deck_id,front=card['front'],back=card['back']))
        plan = dict(version=VERSION,deckId=deck_id,config=dict(CONFIG),createdAt=datetime.fromtimestamp(now_ms/1000,timezone.utc).isoformat(),
            selection=selection,days=days,timezone=settings['timezone'],rolloverHour=settings['rollover_hour'],
            newPerDay=settings['new_per_day'],newSlotsUsedToday=spent,todayRemaining=today_remaining,
            firstStudyDate=first_day.date().isoformat(),lastStudyDate=(cutoff if selection=='recently-learned' else cutoff+timedelta(days=days-1)).date().isoformat(),
            selectedCards=len(selections),existingAudioCards=len(selections)-sum(len(r['cards']) for r in rows.values())-len(blocked),
            cardCount=sum(len(r['cards']) for r in rows.values()),wordCount=len(rows),selections=selections,rows=list(rows.values()))
        if selection == 'recently-learned':
            plan.update(blocked=blocked,blockedCards=len(blocked),windowStart=int(first_day.timestamp()*1000),windowEnd=now_ms)
        plan['planHash'] = digest(plan)
        return plan
    finally:
        c.close()


def check_identity(c, row):
    w = c.execute('SELECT * FROM words WHERE id=?', (row['wordId'],)).fetchone()
    fields = dict(lexical_key='lexicalKey',headword='headword',pos='pos',translation='translation',
        phonetic='phonetic',phonetic_profile='phoneticProfile')
    if not w or w['language'] != 'en' or any(w[k] != row[v] for k,v in fields.items()):
        raise ValueError('English word identity or pronunciation changed')
    if not c.execute("SELECT 1 FROM word_pronunciations WHERE word_id=? AND status='accepted' AND accent='UK' AND display_ipa=? AND pos=? AND usage=?",
        (row['wordId'],row['phonetic'],row['pronunciation']['pos'],row['pronunciation']['usage'])).fetchone():
        raise ValueError('The selected pronunciation is no longer accepted')
    for target in row['cards']:
        card = c.execute('SELECT c.*,d.language FROM cards c JOIN decks d ON c.deck_id=d.id WHERE c.id=?', (target['cardId'],)).fetchone()
        if not card or card['language'] != 'en' or card['word_id'] != row['wordId'] or card['deck_id'] != target['deckId'] or any(card[k] != target[k] for k in ['front','back']):
            raise ValueError('Target English card identity or content changed')


def normalized_transcript(text):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC',text).casefold().strip(' \t\r\n.!,?;:。，“”\"‘’')).replace('’', "'")


def annotate_transcript(row, check):
    check={k:v for k,v in check.items() if k not in {'matchType','homophoneEvidence'}}
    if normalized_transcript(check['transcript'])==normalized_transcript(row['headword']):
        return dict(check,matchType='exact')
    proofs=json.loads((Path(__file__).resolve().parents[1]/'resources/english-audio-recognition-aliases.json').read_text())
    for proof in proofs:
        if proof['word']==row['headword'] and proof['targetIpa']==row['phonetic'] and normalized_transcript(proof['transcript'])==normalized_transcript(check['transcript']):
            return dict(check,matchType=proof.get('kind','dictionary-homophone'),homophoneEvidence=proof)
    return check


def transcript_matches(row, check):
    expected=annotate_transcript(row,check)
    return expected.get('matchType')=='exact' or (expected.get('matchType') in {'dictionary-homophone','dictionary-word-boundary'} and
        check.get('homophoneEvidence')==expected['homophoneEvidence'])


def style_for(row, attempt=1):
    style=(f"Standard British English dictionary pronunciation, non-rhotic modern RP. "
        f"Pronounce ONLY {row['headword']} once, without an article, spelling, examples or explanation. "
        f"Target British IPA: /{row['phonetic']}/; part of speech: {row['pronunciation']['pos']}; "
        f"usage: {row['pronunciation']['usage']}. Use the exact vowel quality and primary stress of this IPA. "
        "Speak at a clear natural pace; no music, sound effects or exaggerated syllable breaks. " + LOUDNESS_STYLE
        + ("Take particular care with word endings, British vowels and the indicated stress." if attempt>1 else ''))
    guidance=json.loads((Path(__file__).resolve().parents[1]/'resources/english-audio-pronunciation-guidance.json').read_text())
    for item in guidance:
        if item['word']==row['headword'] and item['targetIpa']==row['phonetic']:style+=' '+item['style']
    return style


def speech_body(rows, config, model, attempt=1):
    if model == 'gemini-3.1-flash-tts-preview':
        text = ('Read only the following English words, each exactly once, in standard British English. '
            'Do not read the instructions or IPA aloud. Leave one second of silence between words.\n'
            + '\n'.join(style_for(r,attempt) for r in rows)+'\nText to pronounce:\n'+'\n'.join(r['headword'] for r in rows))
        parts, voice = [dict(text=text)],dict(prebuiltVoiceConfig=dict(voiceName=config['voice']))
    else:
        parts = [dict(text=r['headword']+(' <long pause>' if i<len(rows)-1 else ''),
            speech_metadata=dict(style=style_for(r,attempt))) for i,r in enumerate(rows)]
        voice = dict(voice=config['voice'])
    return dict(contents=[dict(role='user',parts=parts)],generationConfig=dict(responseModalities=['AUDIO'],speechConfig=dict(voiceConfig=voice)))


class EnglishGateway(Gateway):
    def speech_rows(self, rows, config, attempt=1):
        exhausted,failures=[],[]
        for model in [config['resolvedModel'],*config['fallbackModels']]:
            if model not in SPEECH_MODELS: raise ValueError('Unapproved TTS model')
            body=speech_body(rows,config,model,attempt)
            try:
                result=self.json('/genai_passthrough/v1beta/models/'+model+':generateContent',body,True)
                parts=[p['inlineData'] for candidate in result.get('candidates',[]) for p in candidate.get('content',{}).get('parts',[]) if p.get('inlineData')]
                if len(parts)!=1: raise ValueError('Expected one native audio result')
                audio,encoding=decode_speech_audio(parts[0],model)
            except DailyQuotaExceeded as error:
                exhausted.append(error);failures.append(dict(model=model,reason='daily_quota'));continue
            except (RuntimeError,ValueError) as error:
                failures.append(dict(model=model,reason=str(error)[:900]));continue
            return audio,dict(model=model,voice=config['voice'],encoding=encoding,request=body,
                usage=result.get('usageMetadata'),fallbackHistory=failures)
        if len(exhausted)==1+len(config['fallbackModels']):
            raise DailyQuotaExceeded(min(e.retry_at for e in exhausted))
        raise RuntimeError('All approved speech models failed: '+compact(failures))

    def audio_question(self, audio, prompt, model, json_output=False):
        body=dict(model=model,temperature=0,messages=[dict(role='user',content=[dict(type='text',text=prompt),
            dict(type='input_audio',input_audio=dict(data=base64.b64encode(audio).decode(),format='wav'))])])
        if json_output: body['response_format']=dict(type='json_object')
        result=self.json('/openai/v1/chat/completions',body)
        text=result['choices'][0]['message']['content']
        if not isinstance(text,str) or not text.strip(): raise ValueError('Audio check returned no answer')
        return dict(model=model,transcript=text.strip(),usage=result.get('usage'))

    def transcribe(self, audio, model):
        return self.audio_question(audio,'Transcribe exactly the audible English speech. Return only the word or words heard, without punctuation, explanations, or alternatives. Do not add missing words.',model)

    def review(self, audio, row, model):
        prompt=(f"Evaluate this audio as a British English vocabulary recording. Target word: {row['headword']}; "
            f"target British IPA: /{row['phonetic']}/; POS: {row['pronunciation']['pos']}. "
            'Judge what is actually audible, not what the spelling suggests. Return a JSON object with '
            'wordMatches, britishCompatible, stressMatches, singleWord (booleans), confidence (high/medium/low), '
            'heardIpa (your independent phonetic transcription), and reason. '
            'wordMatches requires all consonants, vowels and inflectional endings, without extra speech. '
            'britishCompatible rejects clearly American rhoticity or US vowels, but accepts sounds shared by both accents. '
            'stressMatches checks primary stress against the IPA; singleWord requires one complete utterance of the target, no repetition or instructions. '
            'Confidence concerns compatibility of the audible pronunciation with the target IPA, not the speaker geographic origin. '
            'Use high when the word is clear and all target features match, including words pronounced alike in several accents. '
            'Use false or lower confidence if uncertain. Do not assume generated audio is correct.')
        answer=self.audio_question(audio,prompt,model,True)
        text=re.sub(r'^```(?:json)?\s*|\s*```$','',answer.pop('transcript'))
        answer.update(json.loads(text),targetIpa=row['phonetic'])
        return answer

    def phonetic_check(self,audio,model):
        return self.audio_question(audio,'Listen to the English audio and transcribe its actual sounds in broad British IPA only. '
            'Do not infer a spelling or a target word. Include primary stress for words with multiple syllables; '
            'omit stress for a monosyllable. Use phonemic slashes and no explanations.',model)


def qa_passed(qa, row, config):
    compatible=(qa.get('model')==config['qaModel'] and qa.get('targetIpa')==row['phonetic'] and bool(qa.get('heardIpa'))
        and all(qa.get(k) is True for k in ['wordMatches','britishCompatible','stressMatches','singleWord']))
    if not compatible:return False
    if qa.get('confidence')=='high' and not qa.get('requiresBlindPhoneticCheck'):return True
    confirmation=qa.get('blindPhoneticCheck',{})
    def key(value):
        value=value.strip().strip('/[]').replace('(r)','').replace('ɹ','r').replace('ɛ','e').replace('g','ɡ').replace(':','ː')
        value=re.sub(r'[\s.ˌ]','',value)
        return value.replace('ˈ','') if 'ˈ' not in row['phonetic'] else value
    return (qa.get('confidence') in {'medium','high'} and confirmation.get('model')==config['verifierModel']
        and key(confirmation.get('transcript',''))==key(row['phonetic'])==key(qa['heardIpa']))


def validate_result(row, config, root, value):
    if value.get('version')!=VERSION or value.get('status')!='accepted' or value.get('fingerprint')!=fingerprint(row,config):
        raise ValueError('Audio identity/configuration or acceptance differs')
    if value.get('model') not in [config['resolvedModel'],*config['fallbackModels']]: raise ValueError('Unapproved audio model')
    path=(Path(root)/value['audioFile']).resolve()
    if not path.is_relative_to(Path(root).resolve()) or not path.is_file() or file_hash(path)!=value['sha256']:
        raise ValueError('Audio file is missing or changed')
    if 'audioProcessing' in value:
        validate_processing(value['audioProcessing'], value['sha256'])
    if not any(p.get('model') in [config['asrModel'],config['verifierModel']] and
        transcript_matches(row,p) for p in value.get('checks',[])):
        raise ValueError('No matching blind English transcription')
    if not qa_passed(value.get('pronunciationCheck',{}),row,config): raise ValueError('Pronunciation QA did not pass')
    if any(p.get('homophoneEvidence',{}).get('requiresBlindPhoneticCheck') for p in value.get('checks',[])) and not value['pronunciationCheck'].get('requiresBlindPhoneticCheck'):
        raise ValueError('Conditional homophone needs a blind phonetic check')
    return path


def audit_clip(data, row, config, gateway):
    checks=[gateway.transcribe(data,config['asrModel'])]
    if normalized_transcript(checks[0]['transcript'])!=normalized_transcript(row['headword']):
        checks.append(gateway.transcribe(data,config['verifierModel']))
    checks=[annotate_transcript(row,c) for c in checks]
    qa={}
    if any(transcript_matches(row,c) for c in checks):
        qa=gateway.review(data,row,config['qaModel'])
        if any(c.get('homophoneEvidence',{}).get('requiresBlindPhoneticCheck') for c in checks):qa['requiresBlindPhoneticCheck']=True
        if (qa.get('confidence')=='medium' or qa.get('requiresBlindPhoneticCheck')) and all(qa.get(k) is True for k in ['wordMatches','britishCompatible','stressMatches','singleWord']):
            qa['blindPhoneticCheck']=gateway.phonetic_check(data,config['verifierModel'])
    return checks,qa


def persist(row, config, root, data, source, checks, qa, history):
    stem=f"{row['wordId']}-{uuid.uuid4().hex[:10]}"
    wav=Path(root)/'audio'/(stem+'.wav');wav.parent.mkdir(parents=True,exist_ok=True);wav.write_bytes(data)
    mp3=wav.with_suffix('.mp3')
    processing=normalize_audio(wav,mp3)
    value=dict(version=VERSION,status='accepted',fingerprint=fingerprint(row,config),wordId=row['wordId'],
        lexicalKey=row['lexicalKey'],headword=row['headword'],reading=row['headword'],phonetic=row['phonetic'],
        generatedAt=datetime.now(timezone.utc).isoformat(),model=source['model'],voice=config['voice'],
        audioFile=str(mp3.relative_to(root)),sha256=file_hash(mp3),bytes=mp3.stat().st_size,audio=validate_wav(data),
        checks=checks,pronunciationCheck=qa,generation=source,attempts=history,phoneticCertified=False,
        audioProcessing=processing)
    atomic_json(Path(root)/'results'/f"{row['wordId']}.json",value)
    return value


def recheck_saved_attempt(row,config,root,gateway,old):
    if old.get('fingerprint')!=fingerprint(row,config):return None
    for attempt in reversed(old.get('attempts',[])):
        if not attempt.get('rawAudioFile') or not attempt.get('source'):continue
        checks=[annotate_transcript(row,c) for c in attempt.get('checks',[])]
        if not any(transcript_matches(row,c) for c in checks):continue
        raw=(Path(root)/attempt['rawAudioFile']).resolve()
        if not raw.is_relative_to(Path(root).resolve()) or not raw.is_file() or file_hash(raw)!=attempt.get('rawSha256'):continue
        data=raw.read_bytes();validate_wav(data);check_levels(data)
        qa=gateway.review(data,row,config['qaModel'])
        if any(c.get('homophoneEvidence',{}).get('requiresBlindPhoneticCheck') for c in checks):qa['requiresBlindPhoneticCheck']=True
        if (qa.get('confidence')=='medium' or qa.get('requiresBlindPhoneticCheck')) and all(qa.get(k) is True for k in ['wordMatches','britishCompatible','stressMatches','singleWord']):
            qa['blindPhoneticCheck']=gateway.phonetic_check(data,config['verifierModel'])
        if qa_passed(qa,row,config):
            return persist(row,config,root,data,dict(mode='single-word-rechecked',**attempt['source']),checks,qa,
                [*old['attempts'],dict(recheck=True,rawAudioFile=attempt['rawAudioFile'],checks=checks,pronunciationCheck=qa)])
        break
    return None


def generate_word(row, config, root, gateway, attempts=3):
    path=Path(root)/'results'/f"{row['wordId']}.json"
    old={}
    try:
        old=json.loads(path.read_text());validate_result(row,config,root,old);return dict(old,cached=True)
    except (OSError,ValueError,KeyError): pass
    history=old.get('attempts',[]) if old.get('fingerprint')==fingerprint(row,config) else []
    if old.get('status')=='needs_review':
        try:
            rechecked=recheck_saved_attempt(row,config,root,gateway,old)
            if rechecked:return rechecked
        except DailyQuotaExceeded:raise
        except (OSError,ValueError,KeyError,RuntimeError):pass
    for attempt in range(1,attempts+1):
        item=dict(attempt=attempt)
        try:
            data,source=gateway.speech_rows([row],config,attempt);validate_wav(data)
            raw=Path(root)/'attempts'/f"{row['wordId']}-{uuid.uuid4().hex[:10]}.wav"
            raw.parent.mkdir(parents=True,exist_ok=True);raw.write_bytes(data)
            item.update(rawAudioFile=str(raw.relative_to(root)),rawSha256=file_hash(raw))
            item['audioLevels']=check_levels(data)
            checks,qa=audit_clip(data,row,config,gateway);item.update(checks=checks,pronunciationCheck=qa,source=source)
            if qa_passed(qa,row,config): return persist(row,config,root,data,dict(mode='single-word',**source),checks,qa,[*history,item])
            item['error']='Transcript or British pronunciation check did not pass'
        except DailyQuotaExceeded: raise
        except Exception as error: item['error']=str(error)[:900]
        history.append(item)
    value=dict(version=VERSION,status='needs_review',fingerprint=fingerprint(row,config),wordId=row['wordId'],headword=row['headword'],attempts=history)
    atomic_json(path,value);return value


def generate_group(rows, config, root, gateway, attempts=3):
    accepted,pending=[],[]
    for row in rows:
        try:
            value=json.loads((Path(root)/'results'/f"{row['wordId']}.json").read_text())
            validate_result(row,config,root,value);accepted.append(dict(value,cached=True))
        except (OSError,ValueError,KeyError): pending.append(row)
    if not pending: return accepted
    if len(pending)==1: return accepted+[generate_word(pending[0],config,root,gateway,attempts)]
    try:
        data,source=gateway.speech_rows(pending,config);clips=split_word_group(data,len(pending))
        path=Path(root)/'groups'/(uuid.uuid4().hex+'.wav');path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        atomic_json(path.with_suffix('.json'),dict(wordIds=[r['wordId'] for r in pending],source=source,sha256=file_hash(path)))
    except DailyQuotaExceeded: raise
    except Exception: return accepted+[generate_word(r,config,root,gateway,attempts) for r in pending]
    for row,(clip,boundary) in zip(pending,clips):
        try:
            check_levels(clip)
            checks,qa=audit_clip(clip,row,config,gateway)
            if not qa_passed(qa,row,config): raise ValueError('Group clip failed pronunciation check')
            provenance=dict(mode='pause-separated-group',groupFile=str(path.relative_to(root)),groupSha256=file_hash(path),boundary=boundary,**source)
            accepted.append(persist(row,config,root,clip,provenance,checks,qa,[]))
        except DailyQuotaExceeded: raise
        except Exception: accepted.append(generate_word(row,config,root,gateway,attempts))
    return accepted
