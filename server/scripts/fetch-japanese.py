"""Download the pinned dictionaries without expanding the 1.9 GB multilingual dump to disk."""
import argparse,gzip,hashlib,json,urllib.request,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def sha(file):
    with open(file,'rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def fetch(path,url):
    if path.exists():return
    partial=path.with_suffix(path.suffix+'.part')
    with urllib.request.urlopen(url,timeout=120) as source,open(partial,'wb') as dest:
        while data:=source.read(1024*1024):dest.write(data)
    partial.rename(path)

def main(directory):
    p=Path(directory);p.mkdir(parents=True,exist_ok=True)
    source=json.loads((ROOT/'resources/japanese-n5-source.json').read_text());d=source['dictionaries']
    fetch(p/'openjlpt-n5.json',source['url']);assert sha(p/'openjlpt-n5.json')==d['openjlptSha256']
    fetch(p/'jmdict.zip',d['jmdictUrl'])
    with zipfile.ZipFile(p/'jmdict.zip') as archive:
        member=next(n for n in archive.namelist() if n.endswith('.json'));(p/'jmdict.json').write_bytes(archive.read(member))
    assert sha(p/'jmdict.json')==d['jmdictSha256']
    fetch(p/'zhwiktionary.jsonl.gz',d['kaikkiUrl']);assert sha(p/'zhwiktionary.jsonl.gz')==d['compressedSha256']
    digest=hashlib.sha256();partial=p/'kaikki-ja-zh.jsonl.part'
    with gzip.open(p/'zhwiktionary.jsonl.gz','rb') as stream,open(partial,'wb') as out:
        for line in stream:
            digest.update(line);entry=json.loads(line)
            if entry.get('lang_code')=='ja':out.write(line)
    assert digest.hexdigest()==d['rawSha256'] and sha(partial)==d['kaikkiJapaneseSha256']
    partial.rename(p/'kaikki-ja-zh.jsonl')
    (p/'dictionary-sources.json').write_text(json.dumps({k:v for k,v in d.items() if k not in {'openjlptRevision','openjlptSha256','reviewedSha256','kaikkiJapaneseSha256'}}))
    (p/'openjlpt-release.json').write_text(json.dumps({'sha':d['openjlptRevision']}))
    print('Pinned Japanese sources verified.')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--data',required=True);args=parser.parse_args();main(args.data)
