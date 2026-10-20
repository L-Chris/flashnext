"""Create a reviewable N5 import plan from pinned OpenJLPT, JMdict and Kaikki files."""
import argparse,collections,hashlib,json
from pathlib import Path
from lib.japanese import prepare_rows
ROOT=Path(__file__).resolve().parent

def sha(p):
    with open(p,'rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def prepare(data,output):
    data=Path(data)
    rows=json.loads((data/'openjlpt-n5.json').read_text())
    assert len(rows)==674 and len({r['id'] for r in rows})==674
    needed={str(r.get('jmdict_id')) for r in rows}
    jmdict={r['id']:r for r in json.loads((data/'jmdict.json').read_text())['words'] if r['id'] in needed}
    index=collections.defaultdict(list)
    for line in open(data/'kaikki-ja-zh.jsonl'):
        e=json.loads(line)
        if e.get('lang_code')=='ja':index[e['word']].append(e)
    reviewed=json.loads((ROOT/'resources/japanese-n5-reviewed.json').read_text())
    prepared=prepare_rows(rows,jmdict,index,reviewed)
    sources=json.loads((data/'dictionary-sources.json').read_text())
    sources.update(openjlptRevision=json.loads((data/'openjlpt-release.json').read_text())['sha'],openjlptSha256=sha(data/'openjlpt-n5.json'),jmdictSha256=sha(data/'jmdict.json'),kaikkiJapaneseSha256=sha(data/'kaikki-ja-zh.jsonl'),reviewedSha256=sha(ROOT/'resources/japanese-n5-reviewed.json'))
    payload=dict(version=1,sourceId='openjlpt-n5-v1',level=5,sources=sources,rows=prepared)
    out=Path(output);out.write_text(json.dumps(payload,ensure_ascii=False))
    pending=[dict(word=r['headword'],reading=r['reading'],reason=r['reason']) for r in prepared if r['definitionStatus']!='ready']
    out.with_suffix('.review.json').write_text(json.dumps(pending,ensure_ascii=False,indent=2))
    print(json.dumps(dict(total=len(prepared),ready=len(prepared)-len(pending),pending=len(pending),reasons=dict(collections.Counter(r['reason'] for r in pending))),ensure_ascii=False),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data',required=True);p.add_argument('--output',required=True);a=p.parse_args();prepare(a.data,a.output)
