"""Conservative Japanese word identity and reading matching. No database writes."""
import json,re,unicodedata
from pathlib import Path
from collections import defaultdict

POS = {'num':'数词','adj-pn':'连体词','adj-f':'连体词','adj-ix':'い形容词（特殊活用）','aux-v':'辅助动词','n-pref':'名词性前缀','n-suf':'名词性后缀','n':'名词','n-adv':'副词性名词','n-t':'时间名词','pn':'代词','adj-i':'い形容词','adj-na':'な形容词','adj-no':'の形容词','adv':'副词','adv-to':'副词','int':'感叹词','exp':'表达','prt':'助词','pref':'前缀','suf':'后缀','ctr':'量词','vt':'他动词','vi':'自动词','v1':'一段动词','v5u':'五段动词','v5k':'五段动词','v5k-s':'五段动词','v5g':'五段动词','v5s':'五段动词','v5t':'五段动词','v5n':'五段动词','v5b':'五段动词','v5m':'五段动词','v5r':'五段动词','v5r-i':'五段动词','vs':'する动词','vs-i':'する动词','vs-s':'する动词','vk':'カ变动词'}
BAD={'archaic','obsolete','rare','dated','nonstandard','historical','dialectal','classical','no-gloss'}

def kana(text):
    # Match hiragana/katakana only; keep long-vowel marks and small kana distinct.
    s=unicodedata.normalize('NFC',text)
    return ''.join(chr(ord(c)-0x60) if '\u30a1'<=c<='\u30f6' else c for c in s)


def ruby_reading(form):
    text=form.get('form','')
    for written,reading in form.get('ruby',[]):
        if written not in text:return ''
        text=text.replace(written,reading,1)
    return kana(text) if re.fullmatch(r'[\u3041-\u3096\u30a1-\u30faー]+',text) else ''


def pos_matches(pos,codes):
    allowed=set()
    for code in codes:
        if code.startswith('v') and code not in {'vi','vt'}:allowed.add('verb')
        elif code.startswith('n'):allowed.add('noun')
        elif code.startswith('adj'):allowed.update({'adj','adj_noun'})
        elif code.startswith('adv'):allowed.add('adv')
        else:allowed.update({'pn':{'pron'},'exp':{'phrase','intj'},'int':{'intj'},'prt':{'particle'},'pref':{'prefix'},'suf':{'suffix'},'ctr':{'counter','classifier'}}.get(code,set()))
    return pos in allowed


def valid_jmdict(row,entry):
    if not entry:return False
    writing=row['word'];reading=row['reading']
    if writing not in [x['text'] for x in entry.get('kanji',[])+entry.get('kana',[])]:return False
    return any(k['text']==reading and ('*' in k['appliesToKanji'] or writing in k['appliesToKanji']) for k in entry.get('kana',[]))


def candidates(row,index):
    """Only exact writing + attested reading + compatible POS. No romaji joins."""
    writing=row['word'];reading=kana(row['reading']);matches=[]
    queue=[writing];seen=set()
    while queue:
        key=queue.pop(0)
        if key in seen:continue
        seen.add(key)
        for e in index.get(key,[]):
            if e.get('pos')=='soft-redirect':
                # Follow explicit redirects only to this exact kana reading.
                queue.extend(t for t in e.get('redirects',[]) if kana(t)==reading)
                continue
            if not pos_matches(e.get('pos'),row.get('pos',[])):continue
            forms=[f for f in e.get('forms',[]) if 'canonical' in f.get('tags',[])]
            if not (any(ruby_reading(f)==reading for f in forms) or (not forms and kana(e['word'])==reading)):continue
            # Kana pages combining several kanji spellings need sense-level review.
            kanji_forms={f['form'] for f in forms if re.search(r'[\u3400-\u9fff]',f.get('form',''))}
            if kanji_forms and writing not in kanji_forms and writing!=row['reading']:continue
            senses=[s for s in e.get('senses',[]) if s.get('glosses') and not(set(s.get('tags',[]))&BAD) and not s.get('form_of') and not s.get('alt_of')]
            if not senses:continue
            matches.append(dict(entry=e,senses=senses))
    return matches


def prepare_rows(rows,jmdict,index,reviewed=None):
    reviewed = reviewed or {}
    result=[]
    for row in rows:
        entry=jmdict.get(str(row.get('jmdict_id')))
        valid=valid_jmdict(row,entry)
        matches=candidates(row,index) if valid else []
        signatures={tuple(g for s in m['senses'] for g in s['glosses']) for m in matches}
        reason=''
        if not valid:reason='词典编号、写法或读音未通过 JMdict 校验'
        elif not matches:reason='缺少可确认读音及词性的中文义项'
        elif len(signatures)>1:reason='存在多组中文义项，需核对义项对应关系'
        chosen=matches[0] if matches and not reason else None
        glosses=list(dict.fromkeys(g for s in chosen['senses'] for g in s['glosses'])) if chosen else []
        if any(g.strip() in {'同上。','同上','同前','略。'} for g in glosses):reason='中文释义包含未解析转指';chosen=None;glosses=[]
        override=reviewed.get(row['id'])
        if override and valid:
            assert (override['headword'],override['reading'],override['jmdictId'])==(row['word'],row['reading'],row['jmdict_id']), 'Reviewed identity changed'
            english=[g['text'] for sense in entry['sense'] if ('*' in sense['appliesToKanji'] or row['word'] in sense['appliesToKanji']) and ('*' in sense['appliesToKana'] or row['reading'] in sense['appliesToKana']) for g in sense['gloss']]
            assert any(re.search(override['expectedEnglishPattern'],g,re.I) for g in english), 'Reviewed meaning no longer matches dictionary'
            reason='';glosses=[override['translation']]
        else:
            reason=reason or '中文候选尚未人工核对'
            glosses=[]
        result.append(dict(sourceId=row['id'],lexicalKey=f"ja:openjlpt:{row['id']}",headword=row['word'],reading=row['reading'],romaji=row['romaji'],
            translation='；'.join(glosses) if glosses else '英文参考：'+'；'.join(row['meanings']),definitionStatus='pending' if reason else 'ready',reason=reason,
            pos='／'.join(dict.fromkeys(POS.get(p,p) for p in row.get('pos',[]))),
            readings=entry.get('kana',[]) if entry else [],spellings=entry.get('kanji',[]) if entry else [],
            sourceRow=row,jmdict=entry,kaikki=chosen['entry'] if chosen else None,
            chineseCandidates=[m['entry'] for m in matches] if reason else [], reviewed=override if override and valid else None))
    return result
