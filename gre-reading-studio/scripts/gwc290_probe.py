from pathlib import Path
import sys, json
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'gre800-cards' / 'scripts' / 'vendor'))
from pypdf import PdfReader
reader = PdfReader(ROOT / 'GWC阅读机经290篇 .pdf')
pages = [p.extract_text() or '' for p in reader.pages]
out=ROOT/'gre-reading-studio'/'data'
(out/'gwc290-raw-pages.json').write_text(json.dumps(pages,ensure_ascii=False,indent=2),encoding='utf-8')
(out/'gwc290-raw.txt').write_text('\n'.join('\n=== PDF PAGE %d ===\n%s' % (i+1,t) for i,t in enumerate(pages)),encoding='utf-8')
print('PAGES',len(pages),'CHARS',sum(map(len,pages)))
for i in list(range(min(8,len(pages)))) + list(range(max(8,len(pages)-8),len(pages))):
    print('\n=== PDF PAGE %d ===\n%s' % (i+1,pages[i][:11000]))
