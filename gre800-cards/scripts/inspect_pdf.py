from pathlib import Path
import sys, re, json
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'/'vendor'))
from pypdf import PdfReader
PDF=ROOT.parent/'《GRE800词 》.pdf'
r=PdfReader(PDF)
pages=[p.extract_text() or '' for p in r.pages]
(ROOT/'scripts'/'pdf-extracted.txt').write_text('\n'.join(f'\n=== PDF PAGE {i+1} ===\n{x}' for i,x in enumerate(pages)),encoding='utf-8')
entries=[]
current=None
group=None
for page_index, text in enumerate(pages):
    for line in text.splitlines():
        line=line.strip()
        if not line: continue
        lm=re.fullmatch(r'List\s*(\d+)',line,re.I)
        if lm:
            group=int(lm.group(1)); continue
        em=re.match(r'^(\d{3})\.\s*(.+)$',line)
        if em:
            current={'id':int(em.group(1)), 'word':em.group(2).strip(), 'page':page_index+1, 'group':group,'lines':[]}
            entries.append(current)
        elif current and page_index<88:
            current['lines'].append(line)
(ROOT/'scripts'/'raw-entries.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2),encoding='utf-8')
print('Count:',len(entries))
print('IDs missing:',sorted(set(range(1,801))-set(e['id'] for e in entries)))
print('Head anomalies:',[{'id':e['id'],'word':e['word']} for e in entries if not re.fullmatch(r'[a-z][a-z -]*',e['word'])])
print('Definition marker anomalies:',[e for e in entries if not any('考法' in x for x in e['lines'])])
print('Groups:',sorted(set(e['group'] for e in entries),key=lambda n:n or 0))
print('Unusual chars:',[(e['id'],line) for e in entries for line in e['lines'] if re.search(r'[^\x20-\x7e\u3000-\u303f\u4e00-\u9fff\uff00-\uffef\u2010-\u2026]',line)])
