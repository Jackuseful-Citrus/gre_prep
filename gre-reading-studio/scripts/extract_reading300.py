"""Extract all passages/questions from the locally supplied Reading 300 PDF.

This PDF refers readers elsewhere for answers; no answers are inferred here.
Original pages and formatting runs are retained separately for reproducibility.
"""
from pathlib import Path
import sys,re,json,shutil,collections
from library_paths import resolve_material, source_url, copy_source, normalize_material_links
ROOT=Path(__file__).resolve().parents[2]
PROJECT=ROOT/'gre-reading-studio';OUT=PROJECT/'data'
sys.path.insert(0,str(ROOT/'gre800-cards/scripts/vendor'))
from pypdf import PdfReader
SOURCE=resolve_material(source_id='reading300')
reader=PdfReader(SOURCE)
rawfile=OUT/'reading300-raw-pages.json'
if rawfile.exists():pages=json.loads(rawfile.read_text(encoding='utf8'))
else:
    pages=[p.extract_text() or '' for p in reader.pages]
    rawfile.write_text(json.dumps(pages,ensure_ascii=False,indent=2),encoding='utf8')
    (OUT/'reading300-raw.txt').write_text('\n'.join(f'\n=== PDF PAGE {i+1} ===\n{t}' for i,t in enumerate(pages)),encoding='utf8')

def squash(t):return re.sub(r'\s+',' ',t).strip()
def compact(t):return re.sub(r'\s+','',t)
QRE=re.compile(r'^([1-9]|1\d|20|l)[.．](?!\d)\s*(.*)')
ORE=re.compile(r'^([A-E])(?:[.．]\s*|\s+)(.*)')
INSTRUCTION=re.compile(r'^(?:Consider each of the choices separately and select all that apply\.?|Select all that apply\.?)$',re.I)
issues=[]

def sentence_list(paragraphs):
    out=[]
    for pi,para in enumerate(paragraphs,1):
        # Protect frequent initialisms and personal initials from sentence breaks.
        protected=re.sub(r'\b(?:[A-Z]\.){2,}|\b[A-Z]\.(?=\s+[A-Z])|\b(?:Dr|Mr|Mrs|Ms|Prof|St|vs|etc)\.',lambda m:m[0].replace('.','\uE001'),para)
        for si,s in enumerate(re.split(r'(?<=[.!?])\s+(?=[A-Z“"(])',protected),1):
            out.append({'id':f'S{len(out)+1}','text':s.replace('\uE001','.'),'paragraph':pi,'sentence':si})
    return out

def parse(n,ls):
    pid=f'reading300-p{n:03d}';raw='\n'.join(t for t,_ in ls)
    cleaned=[]
    for t,p in ls:
        if INSTRUCTION.match(t):continue
        for part in re.split(r'(?<=\.)\s+(?=E\.\s)',t):cleaned.append((part,p))
    ls=cleaned
    starts=[i for i,(line,_) in enumerate(ls) if QRE.match(line)]
    if not starts:
        starts=[i for i,(line,_) in enumerate(ls) if re.match(r'^(?:Which (?:of|one|is)|In the (?:argument|columnist.s argument|historian.s argument|passage)|In order to choose|The argument|The conclusion drawn|The passage suggests|The author of|The conservationists|According to the author|The reasoning)',line)]
        if len(starts)>1:starts=[starts[-1]]
        if len(starts)==1:
            i=starts[0];ls[i]=('1. '+ls[i][0],ls[i][1])
    if not starts or not all(QRE.match(ls[i][0]) for i in starts):
        issues.append({'id':pid,'issue':'unrecognized-question-start','candidates':starts})
        return {'id':pid,'sourceId':'reading300','number':n,'title':f'Passage {n}','text':squash(raw),'paragraphs':[squash(raw)],'pages':sorted({p for _,p in ls}),'questions':[],'rawText':raw,'notes':['题目边界需要对照原文核验。'],'section':'机经300篇'}
    para=[];buf=[]
    for t,_ in ls[:starts[0]]:
        if not t and buf:para.append(squash(' '.join(buf)));buf=[]
        elif t:buf.append(t)
    if buf:para.append(squash(' '.join(buf)))
    text='\n\n'.join(para)
    p={'id':pid,'sourceId':'reading300','number':n,'title':' '.join(squash(text).split()[:9]).rstrip('.,;:')+'…','text':text,'paragraphs':para,'pages':sorted({pg for _,pg in ls}),'questions':[],'rawText':raw,'notes':[],'section':'机经300篇','sourceLabel':f'Passage {n}'}
    for qi,start in enumerate(starts):
        chunk=ls[start:starts[qi+1] if qi+1<len(starts) else len(ls)]
        m=QRE.match(chunk[0][0]);qn=int(m[1]) if m[1]!='l' else 1
        stem=[m[2]];opts=[];current=None
        for line,pg in chunk[1:]:
            if not line:continue
            om=ORE.match(line);expected=chr(65+len(opts))
            if om and om[1]==expected:
                current={'id':om[1],'text':om[2]};opts.append(current)
            elif current:current['text']+=' '+line
            else:stem.append(line)
        stem=squash(' '.join(stem))
        for o in opts:o['text']=squash(o['text'])
        kind='multiple' if len(opts)==3 else 'single'
        if not opts:
            kind='sentence' if re.search(r'(?:select|choose|click|identify)\b.*\bsentence\b',stem,re.I) else 'open'
            if kind=='sentence':opts=sentence_list(para)
        q={'id':f'{pid}-q{qi+1}','number':qn,'stem':stem,'options':opts,'kind':kind,'answer':None,'answerStatus':'unverified','answerPages':[],'explanation':None,'pages':sorted({pg for _,pg in chunk}),'notes':['本 PDF 未附答案表；未推断答案。'],'rawText':'\n'.join(t for t,_ in chunk)}
        if kind=='open' or kind in ('single','multiple') and len(opts) not in (3,5):
            q['notes'].append('题目选项结构需要对照原 PDF 核验。');issues.append({'id':q['id'],'issue':'question-options','kind':kind,'optionCount':len(opts)})
        if q['id']=='reading300-p240-q3':
            q['notes'].append('原书 E 选项疑似被截断，仅保留所见文字，请核对来源。')
            issues.append({'id':q['id'],'issue':'source-option-truncation','option':'E'})
        if re.search('highlighted|boldface|bold face|indicated',stem,re.I):q['notes'].append('原文标示范围可打开来源 PDF 核对。')
        p['questions'].append(q)
    return p

passages=[];active=None;bucket=[]
for i,page in enumerate(pages[10:],11):
    lines=page.splitlines()
    # Source headers are exactly these first five lines; do not strip words from body.
    if lines[:5]==['真经','GRE','阅读机经','300','篇']:lines=lines[5:]
    for line in lines:
        line=line.strip()
        if line.startswith(('微信公众号','答案获取')):break
        m=re.fullmatch(r'Passage\s+(\d+)',line,re.I)
        if m:
            if active is not None:passages.append(parse(active,bucket))
            active=int(m[1]);bucket=[]
        elif active is not None:bucket.append((line,i))
if active is not None:passages.append(parse(active,bucket))

# The source uses bold fonts to mark indicated words/phrases. Restore only exact
# source matches, never infer which sentence a question is referring to.
stylefile=OUT/'reading300-style-runs.json'
needed=sorted({pg for p in passages if any(re.search('highlighted|boldface|bold face|indicated',q['stem'],re.I) for q in p['questions']) for pg in p['pages']})
if stylefile.exists():style=json.loads(stylefile.read_text(encoding='utf8'))
else:
    style={}
    for pg in needed:
        runs=[];current=[]
        def visit(t,cm,tm,font,size):
            if not t.strip():return
            if font and 'bold' in str(font.get('/BaseFont','')).lower():current.append(t)
            elif current:runs.append(''.join(current));current.clear()
        reader.pages[pg-1].extract_text(visitor_text=visit)
        if current:runs.append(''.join(current))
        style[str(pg)]=runs
    stylefile.write_text(json.dumps(style,ensure_ascii=False,indent=2),encoding='utf8')
for p in passages:
    c=compact(p['text']);mapping=[i for i,ch in enumerate(p['text']) if not ch.isspace()];hs=[]
    for pg in p['pages']:
        for run in style.get(str(pg),[]):
            needle=re.sub(r'^Passage\d+','',compact(run),flags=re.I)
            if len(needle)<4:continue
            off=c.find(needle)
            if off>=0:
                h=p['text'][mapping[off]:mapping[off+len(needle)-1]+1]
                if h not in hs:hs.append(h)
    # Some source passages use literal asterisks as their indication instead of a font.
    for m in re.finditer(r'\*\s*[^*]{3,160}\s*\*',p['text']):
        if m[0] not in hs:hs.append(m[0])
    if hs:p['highlights']=hs
    elif any(re.search('highlighted|boldface|bold face|indicated',q['stem'],re.I) for q in p['questions']):
        p['notes'].append('原书标示未能从字体可靠恢复，请打开来源 PDF 查看。')
        issues.append({'id':p['id'],'issue':'highlight-unrecovered'})
qs=[q for p in passages for q in p['questions']]
coverage={'pdfPages':len(pages),'passages':len(passages),'questions':len(qs),'answerVerified':0,'answerUnverified':len(qs),'questionKinds':dict(collections.Counter(q['kind'] for q in qs)),'sourceTextCharacters':sum(map(len,pages)),'issues':issues}
result={'source':{'id':'reading300','title':'真经 GRE 阅读机经 300 篇','fileName':'GRE阅读机经300篇【微信公众号：张巍老师GRE】.pdf','pages':len(pages),'pdfUrl':source_url(source_id='reading300'),'archive':'GRE/GRE备考资料.rar','archiveMember':'GRE备考资料/阅读+逻辑/GRE阅读机经300篇【微信公众号：张巍老师GRE】.pdf','notes':['来自用户本地 GRE/GRE备考资料.rar。','封面与末页说明答案和解析需另行获取；本 PDF 无答案表。','完整原始文本保存在 data/reading300-raw-pages.json；展示数据只整理换行和题号。']},'passages':passages,'coverage':coverage}
(OUT/'reading300.json').write_text(json.dumps(normalize_material_links(result),ensure_ascii=False,indent=2),encoding='utf8')
(OUT/'reading300-validation.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2),encoding='utf8')
copy_source(SOURCE, 'reading300.pdf')
print(json.dumps(coverage,ensure_ascii=False,indent=2))
