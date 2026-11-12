from pathlib import Path
import sys,json
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'gre800-cards/scripts/vendor'))
from pypdf import PdfReader
out=ROOT/'gre-reading-studio/data'
reader=PdfReader(out/'archive-sources/reading300.pdf')
pages=[p.extract_text() or '' for p in reader.pages]
(out/'reading300-raw-pages.json').write_text(json.dumps(pages,ensure_ascii=False,indent=2),encoding='utf8')
(out/'reading300-raw.txt').write_text('\n'.join(f'\n=== PDF PAGE {i+1} ===\n{t}' for i,t in enumerate(pages)),encoding='utf8')
print('PAGES',len(pages),'CHARS',sum(map(len,pages)))
for i in [10,11,12,13,30,100,200,283]:print(f'\n===PDF PAGE {i+1}===\n{pages[i]}')
