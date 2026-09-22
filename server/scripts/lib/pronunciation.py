"""Conservative, source-scoped display rules for broad English IPA."""
import re, unicodedata
PROFILE='learner-ipa-uk-v1'
BAD={'obsolete','archaic','dated','dialectal','nonstandard','Scotland','Northern-England','Wales','Ireland','Northern-Ireland'}
UK={'UK','Received-Pronunciation'}
VOWELS='iɪeɛæɑɒɔʊuʌɜəa'

def normalize(raw, tags, note='', form=False):
    tags=set(tags)
    accent='UK' if tags & UK else ('US' if tags & {'US','General-American'} else 'unspecified')
    reason=''
    if form: reason='词形或拼写变体需关联原词'
    elif accent!='UK': reason='未确认教材风格英音'
    elif tags & BAD or note: reason='存在地区、用法或其他限定，待核验'
    elif not (raw.startswith('/') and raw.endswith('/')): reason='非宽式音标'
    s=unicodedata.normalize('NFC',raw.strip('/'))
    if not reason and (re.search(r'[-~\[\],;]',s) or ' ' in s): reason='缩略或组合发音'
    # Length after schwa and modern narrow vowel conventions need human review.
    if not reason and ('əː' in s or 'ɛː' in s or 'ɪː' in s): reason='与目标学习词典转写存在差异'
    if reason: return accent,'',reason
    s=s.replace('ɹ','r').replace('ɛ','e').replace('ɡ','g').replace('͡','').replace('͜','').replace('̯','').replace('.','')
    # Do not strip arbitrary diacritics, infer schwas, or convert American vowels.
    if re.search(r'[^pbtdkgfvθðszʃʒhmnŋlrwj' + VOWELS + r'ːˈˌ()]',s):
        return accent,'','含目标规范外符号'
    if '(' in s or ')' in s: return accent,'','可选音需核验'
    nuclei=re.findall(r'eɪ|aɪ|ɔɪ|əʊ|aʊ|ɪə|eə|ʊə|['+VOWELS+r']ː?',s)
    if len(nuclei)==1: s=s.replace('ˈ','').replace('ˌ','')
    return accent,s.replace('g','ɡ'),''

def back(ipa, translation):
    return (f'/{ipa}/\n' if ipa else '')+translation
