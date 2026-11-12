from pathlib import Path
import sys, json, re
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'gre800-cards/scripts/vendor'))
from pypdf import PdfReader
out=root/'gre-reading-studio/data/mixed-raw'
out.mkdir(exist_ok=True)
files={
 'mixed-gold':'GRE语文高频题目精练与精析-金皮书.pdf',
 'guide':'gre备考胜经.pdf',
 'mcgraw':"GRE/McGraw-Hill's GRE, 2010 Edition.pdf",
 'sentences300':'gre gmat lsat长难句300例精讲精练.pdf',
 'sentences-chen':'GRE/陈琦GRE长难句.pdf',
 'sentences-yang':'GRE/杨鹏GRE长难句.pdf',
}
report=[]
for sid,name in files.items():
 if (out/(sid+'.json')).exists():
  pages=json.loads((out/(sid+'.json')).read_text(encoding='utf-8'))
 else:
  r=PdfReader(root/name)
  pages=[p.extract_text() or '' for p in r.pages]
 (out/(sid+'.json')).write_text(json.dumps(pages,ensure_ascii=False),encoding='utf-8')
 (out/(sid+'.txt')).write_text('\n\n'.join('=== PDF PAGE '+str(i+1)+' ===\n'+s for i,s in enumerate(pages)),encoding='utf-8')
 info={'id':sid,'fileName':name,'pages':len(pages),'characters':sum(map(len,pages)),'readingHits':[]}
 for i,s in enumerate(pages):
  if re.search(r'reading comprehension|阅读|逻辑',s,re.I):
   info['readingHits'].append({'page':i+1,'text':' '.join(s.split())[:180]})
 report.append(info)
 print(sid,len(pages),info['characters'],json.dumps(info['readingHits'][:22],ensure_ascii=False))
(out/'inventory.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
