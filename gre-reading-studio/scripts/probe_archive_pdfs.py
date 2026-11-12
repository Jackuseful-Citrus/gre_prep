from pathlib import Path
import sys, json
PROJECT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(PROJECT.parent/'gre800-cards'/'scripts'/'vendor'))
from pypdf import PdfReader
files=[PROJECT/'data'/'archive-reading.pdf',*sorted((PROJECT/'data'/'archive-sources').glob('*.pdf'))]
summary=[]
for path in files:
    reader=PdfReader(path)
    entries=[]
    for i in list(range(min(8,len(reader.pages)))) + list(range(max(8,len(reader.pages)-6),len(reader.pages))):
        text=reader.pages[i].extract_text() or ''
        entries.append({'page':i+1,'text':text})
    dest=PROJECT/'data'/('probe-'+path.stem+'.json')
    dest.write_text(json.dumps(entries,ensure_ascii=False,indent=2),encoding='utf-8')
    summary.append({'file':str(path.relative_to(PROJECT)),'pages':len(reader.pages),'samples':str(dest.relative_to(PROJECT)),'first':entries[0]['text'][:400]})
print(json.dumps(summary,ensure_ascii=True))
