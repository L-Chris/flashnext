"""Selected reviewed mappings only; does not write application data."""
import json
from pathlib import Path
P=Path(__file__).parent;r=json.loads((P/'results.json').read_text())
# Rules restricted to the selected broad RP/UK samples, not arbitrary IPA/KK.
def display(raw,mono=False):
 s=raw.strip('/').replace('ɹ','r').replace('ɛ','e').replace('͡','').replace('̯','').replace('.','')
 return s.replace('ˈ','').replace('ˌ','') if mono else s
rows=[]
for w in ['go','day','bed','hair','happy','environment','record','read','teacher']:
 seen=set()
 for s in r['samples'][w]['kaikki']:
  raw=s['ipa'];tags=s.get('tags',[])
  if not any(t in tags for t in ['UK','Received-Pronunciation']) or not raw.startswith('/'):continue
  key=(s['pos'],raw)
  if key in seen:continue
  seen.add(key)
  status='candidate'
  if w=='teacher':status='review: unusual final əː; compare learner dictionary'
  if '-' in raw:status='review: abbreviated pronunciation, not full word'
  if w=='read':status='review: distinguish lemma and past-tense lexeme'
  rows.append({'word':w,'old':r['samples'][w]['current']['phonetic'],'pos':s['pos'],'etymology_number':s['etymology_number'],'raw':raw,'preview':display(raw,w in ['go','day','bed','hair','read']),'status':status})
assert display('/deɪ̯/',True)=='deɪ'
assert display('/ˈɹɛk.ɔːd/')=='ˈrekɔːd'
assert display('/ɪnˈvaɪ.ɹən.mənt/')=='ɪnˈvaɪrənmənt'
assert display('/ˈhæpi/')=='ˈhæpi'
(P/'preview.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
print(f'{len(rows)} pronunciation previews; 4 focused assertions passed; no database writes')
