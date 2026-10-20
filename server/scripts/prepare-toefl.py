"""Read-only preparation for the pinned TOEFL word list."""
import argparse
from pathlib import Path
from lib.toefl import prepare

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('--db',required=True);p.add_argument('--output',required=True)
    p.add_argument('--data',default=str(Path(__file__).parent/'data/kaikki.org-dictionary-English.jsonl'));a=p.parse_args()
    prepare(a.db,a.data,a.output)
