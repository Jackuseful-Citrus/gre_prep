from pathlib import Path
import sys,json,re
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parents[2];project=root/'gre-reading-studio';raw=project/'data/mixed-raw'
sys.path.insert(0,str(root/'gre800-cards/scripts/vendor'))
from pypdf import PdfReader
for sid in ['reading170-exercises','reading170-explained']:
 path=project/'data/archive-sources'/(sid+'.pdf');r=PdfReader(path)
 texts=[]
 for p in r.pages:texts.append(p.extract_text() or '')
 (raw/(sid+'.json')).write_text(json.dumps(texts,ensure_ascii=False),encoding='utf-8')
 (raw/(sid+'.txt')).write_text('\n\n'.join('=== PDF PAGE '+str(i+1)+' ===\n'+s for i,s in enumerate(texts)),encoding='utf-8')
 print(sid,'pages',len(texts),'chars',sum(map(len,texts)),'samples',[(i+1,x[:200]) for i,x in enumerate(texts[:10])])
