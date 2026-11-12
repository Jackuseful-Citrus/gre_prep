from pathlib import Path
import sys,json,re
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'gre800-cards/scripts/vendor'))
from pypdf import PdfReader
p=json.loads((ROOT/'gre-reading-studio/data/gwc290-raw-pages.json').read_text(encoding='utf8'))
for i,t in enumerate(p):
    hits=[l for l in t.splitlines() if re.match(r'^(?:Passage \d+|GWC-R\d+|(?:\d+)\. |[A-E]\. |Set |Section [12]|[一-鿿]{2,5}题|Boldface题|Easy|Medium|Hard)',l)]
    if 160 <= i <=233: print(i+1,' | '.join(h[:110] for h in hits))
r=PdfReader(ROOT/'GWC阅读机经290篇 .pdf')
layout=[r.pages[i].extract_text(extraction_mode='layout') for i in range(205,233)]
(ROOT/'gre-reading-studio/data/gwc290-logic-layout.json').write_text(json.dumps(layout,ensure_ascii=False,indent=2),encoding='utf8')
print('\nLAYOUT 206\n'+layout[0])
print('\nLAYOUT 219\n'+layout[13])
