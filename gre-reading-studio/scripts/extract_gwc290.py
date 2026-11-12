"""Reproducible, loss-aware extraction of the user's GWC reading collection.

Run from any working directory. Original PDF and full extraction remain unchanged.
Answers are copied exclusively from the book's explicit answer tables.
"""
from pathlib import Path
import sys, re, json, shutil, collections

ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / 'gre-reading-studio'
sys.path.insert(0, str(ROOT / 'gre800-cards/scripts/vendor'))
from pypdf import PdfReader

SOURCE = ROOT / 'GWC阅读机经290篇 .pdf'
OUT = PROJECT / 'data'
reader = PdfReader(SOURCE)
raw_path = OUT / 'gwc290-raw-pages.json'
if raw_path.exists():
    pages = json.loads(raw_path.read_text(encoding='utf8'))
else:
    pages = [p.extract_text() or '' for p in reader.pages]
    raw_path.write_text(json.dumps(pages, ensure_ascii=False, indent=2), encoding='utf8')
    (OUT/'gwc290-raw.txt').write_text('\n'.join(f'\n=== PDF PAGE {i+1} ===\n{t}' for i,t in enumerate(pages)), encoding='utf8')

issues=[]
def squash(t): return re.sub(r'\s+', ' ', t).strip()
def compact(t): return re.sub(r'\s+', '', t)
def lines_for(start,end):
    return [(line.strip(),i+1) for i in range(start-1,end) for line in pages[i].splitlines() if line.strip() and not re.fullmatch(r'\d+',line.strip())]

# Metadata headings are excluded only from the structured text; rawText/raw pages retain them.
SKIP=re.compile(r'^(?:必读\s*30篇|Easy Section|Medium Section.*|Hard Section|Practice Tests: Set One|Set (?:One|Two|Three|Four)|Section [12]|短文章|中文章|长文章|逻辑|本文的第二种题目版本：)$')
INSTRUCTION=re.compile(r'^(?:Consider each of the choices separately and select all that apply\.?|For the following question.*|Select all that apply\.?)$',re.I)
QRE=re.compile(r'^([1-9]\d*|l)[.．]\s*(.*)')
ORE=re.compile(r'^([A-E])(?:[.．]\s*|\s+)(.*)')
MARKERS='❶❷❸❹❺❻❼❽❾❿'

def make_paragraphs(text):
    # The book restarts its sentence counter at ❶ for each paragraph.
    out=[squash(t) for t in re.split(r'(?=❶)',text) if squash(t)]
    return out or [text]

def sentence_options(paragraphs):
    results=[]
    for pi,para in enumerate(paragraphs,1):
        if re.search('['+MARKERS+']',para):
            parts=re.split('(['+MARKERS+'])',para)
            for x in range(1,len(parts)-1,2):
                results.append({'id':f'S{len(results)+1}','text':squash(parts[x+1]),'paragraph':pi,'sentence':MARKERS.index(parts[x])+1})
    return results

def parse_block(identifier,number,ls,section,source_label):
    raw='\n'.join(x[0] for x in ls)
    cleaned=[]
    for line,pn in ls:
        if SKIP.match(line) or INSTRUCTION.match(line):continue
        # A line-wrapped source contains D and E on a single extracted line.
        for part in re.split(r'(?<=\.)\s+(?=E\.\s)',line) if line.startswith('D.') else [line]:
            cleaned.append((part,pn))
    starts=[i for i,(line,_) in enumerate(cleaned) if QRE.match(line)]
    if not starts and re.fullmatch(r'gwc290-r(?:2[5-9]|3[0-4])',identifier):
        # These ten source questions have no printed number.
        starts=[i for i,(line,_) in enumerate(cleaned) if re.match(r'^(?:Which of the following|In the (?:argument given|columnist.s argument))',line)]
        if len(starts)==1:
            i=starts[0];cleaned[i]=('1. '+cleaned[i][0],cleaned[i][1])
    if not starts: raise ValueError(f'No question {identifier}: {raw[:200]}')
    text=squash(' '.join(x[0] for x in cleaned[:starts[0]]))
    paragraphs=make_paragraphs(text)
    if identifier in ('gwc290-r38','gwc290-r39'):
        # Verbatim paragraph opening strings, confirmed against the source pages.
        boundaries={'gwc290-r38':['One type of external evidence','Quotations from a Roman text','Much as scholars'], 'gwc290-r39':['Younger Koreanists,','In short, in the case of Korea']}[identifier]
        paragraphs=[text]
        for boundary in boundaries:
            tail=paragraphs.pop();a,b=tail.split(boundary,1);paragraphs.extend([a.strip(),boundary+b])
    obj={'id':identifier,'sourceId':'gwc290','number':number,'title':' '.join(re.sub('['+MARKERS+']','',text).split()[:9]).rstrip('.,;:')+'…','text':text,'paragraphs':paragraphs,'pages':sorted(set(x[1] for x in ls)), 'questions':[], 'notes':[], 'section':section,'sourceLabel':source_label,'rawText':raw}
    for qi,start in enumerate(starts):
        chunk=cleaned[start:starts[qi+1] if qi+1<len(starts) else len(cleaned)]
        m=QRE.match(chunk[0][0]); qn=int(m[1]) if m[1]!='l' else 1
        stem_lines=[m[2]]; opts=[]; current=None
        for line,p in chunk[1:]:
            om=ORE.match(line)
            expected=chr(65+len(opts))
            if om and om[1]==expected:
                current={'id':om[1],'text':om[2]};opts.append(current)
            elif current: current['text']+=' '+line
            else: stem_lines.append(line)
        stem=squash(' '.join(stem_lines))
        for o in opts: o['text']=squash(o['text'])
        kind='multiple' if len(opts)==3 else 'single'
        if not opts:
            kind='sentence' if re.search(r'(?:select|choose|click|identify)\b.*\bsentence\b',stem,re.I) else 'open'
            if kind=='sentence':
                opts=sentence_options(paragraphs)
                if not opts and identifier in ('gwc290-r38','gwc290-r39'):
                    for pi,para in enumerate(paragraphs,1):
                        for si,sentence in enumerate(re.split(r'(?<=[.!?])\s+(?=[A-Z])',para),1):
                            opts.append({'id':f'S{len(opts)+1}','text':sentence,'paragraph':pi,'sentence':si})
        q={'id':f'{identifier}-q{qi+1}','number':qn,'stem':stem,'options':opts,'kind':kind,'answer':None,'explanation':None,'pages':sorted(set(x[1] for x in chunk)),'answerPages':[],'answerStatus':'unverified','notes':[],'rawText':'\n'.join(x[0] for x in chunk)}
        if kind in ('single','multiple') and len(opts) not in (3,5):
            q['notes'].append(f'原文提取到 {len(opts)} 个选项，请核对 PDF。'); issues.append({'id':q['id'],'issue':'option-count','count':len(opts)})
        if re.search(r'highlighted|boldface|bold face|indicated',stem,re.I):q['notes'].append('本题涉及原文标示部分，可打开来源 PDF 核对加粗或高亮范围。')
        obj['questions'].append(q)
    return obj

passages=[]
main_keys={}; practice_keys={}; logic_keys={}; appended_keys={}
logic_names=['削弱题','假设题','加强题','解释题','评价题','结论题','Boldface题']

# The answer table wraps one sentence answer onto two lines; join that literal wrap.
for pn in range(234,240):
    s=pages[pn-1].replace('第二段第❶\n句\nE C','第二段第❶句 E C')
    for line in s.splitlines():
        line=line.strip()
        if line=='逻辑分册': current_logic=''
        if line in logic_names: current_logic=line
        pm=re.match(r'Practice Tests-(\d)-(\d)-(\d)\s+(.+)',line)
        if pm:
            practice_keys[tuple(map(int,pm.group(1,2,3)))]=(pm[4].split(),pn);continue
        m=re.match(r'^(\d+)\s+((?:[A-E]+|第.+).*)$',line)
        if m:
            if pn<=237: main_keys[int(m[1])]=(m[2].split(),pn)
            elif 'current_logic' in locals() and current_logic: logic_keys[(current_logic,int(m[1]))]=(m[2].split(),pn)
        # First four lines on p238 continue the practice table, before logical keys.

for line in pages[290].splitlines():
    m=re.match(r'^(\d+)\.\s+(.+)',line.strip())
    if m:
        v=m[2].strip(); vals=v.split('/') if '/' in v else list(v)
        appended_keys[int(m[1])]=(vals,291)

def set_answers(p,entry):
    if entry is None:
        p['notes'].append('未找到明确的原书答案键。');issues.append({'id':p['id'],'issue':'no-answer-key'});return
    answers,pg=entry
    if len(answers)!=len(p['questions']):
        issues.append({'id':p['id'],'issue':'answer-count','key':answers,'questions':len(p['questions'])})
        p['notes'].append('原书答案数量与提取题目数不一致，需要核对。')
        return
    for q,a in zip(p['questions'],answers):
        q['answerText']=a;q['answerPages']=[pg]
        if re.fullmatch('[A-E]+',a) and q['kind'] in ('single','multiple'):
            if set(a).issubset({x['id'] for x in q['options']}):
                q['answer']=list(a);q['answerStatus']='source-key'
                if len(a)>1:q['kind']='multiple'
            else:q['notes'].append('答案键含提取选项之外的字母，请核对来源。')
        elif q['kind']=='sentence':
            # Map literal numbered sentence only; no answer inference.
            m=re.search('第(['+MARKERS+'])句',a)
            para=2 if a.startswith('第二段') else 3 if a.startswith('第三段') else 1
            sn=MARKERS.index(m[1])+1 if m else 3 if a=='第三段第三句' else None
            if a=='第一段最后一句':sn=max((x['sentence'] for x in q['options'] if x['paragraph']==1),default=None)
            candidates=[x for x in q['options'] if sn and x['paragraph']==para and x['sentence']==sn]
            if len(candidates)==1:
                q['answer']=[candidates[0]['id']];q['answerStatus']='source-key'
            else:q['notes'].append('原书选句答案已保留，句子定位需要对照 PDF。')
        else:q['notes'].append('原书答案保留为文字，未强制自动判分。')

# Main 139 passages and 39 practice passages.
bucket=[];active=None;set_no=0;section_no=0
for line,pn in lines_for(10,205):
    sm=re.search(r'Set (One|Two|Three|Four)',line)
    if sm:set_no={'One':1,'Two':2,'Three':3,'Four':4}[sm[1]]
    sec=re.fullmatch(r'Section ([12])',line)
    if sec:section_no=int(sec[1])
    head=re.fullmatch(r'Passage\s+(\d+)',line)
    if head:
        if active:
            p=parse_block(*active,bucket,active_section,active_label);set_answers(p,active_key);passages.append(p)
        n=int(head[1]);bucket=[]
        if pn<165:
            active=(f'gwc290-p{n:03d}',n);active_key=main_keys.get(n)
            active_section='必读30篇' if n<=30 else 'Easy' if n<=53 else 'Medium' if n<=120 else 'Hard'
            active_label=f'Passage {n}'
        else:
            active=(f'gwc290-test{set_no}-s{section_no}-p{n}',n);active_key=practice_keys.get((set_no,section_no,n));active_section=f'模考 {set_no} · Section {section_no}';active_label=f'Practice Tests-{set_no}-{section_no}-{n}'
    elif active:bucket.append((line,pn))
if active:
    p=parse_block(*active,bucket,active_section,active_label);set_answers(p,active_key);passages.append(p)

# Logic: layout preserves paragraph gaps; use those boundaries against untouched
# plain extraction so layout-mode spacing never replaces the original wording.
layout_path=OUT/'gwc290-logic-layout.json'
if layout_path.exists(): layout=json.loads(layout_path.read_text(encoding='utf8'))
else:
    layout=[reader.pages[i].extract_text(extraction_mode='layout') for i in range(205,233)]
    layout_path.write_text(json.dumps(layout,ensure_ascii=False,indent=2),encoding='utf8')
logic_ls=[]
for idx,txt in enumerate(layout):
    for line in txt.splitlines():
        if re.fullmatch(r'\d+',line.strip()):continue
        logic_ls.append((line.strip(),idx+206))
normal_ls=lines_for(206,233)
normal_text='\n'.join(x[0] for x in normal_ls)
normal_chars=[];normal_map=[]
for i,ch in enumerate(normal_text):
    if not ch.isspace():normal_chars.append(ch);normal_map.append(i)
normal_compact=''.join(normal_chars)
logic_starts=[];cat='削弱题'
for i,(line,pn) in enumerate(logic_ls):
    if line in logic_names or line=='Boldface':cat='Boldface题' if line=='Boldface' else line
    m=QRE.match(line)
    if not m:continue
    # Previous non-empty block is the passage; it may be on previous PDF page.
    end=i
    while end>0 and not logic_ls[end-1][0]:end-=1
    begin=end-1
    while begin>0 and logic_ls[begin-1][0]:begin-=1
    block=[x for x in logic_ls[begin:end] if x[0] not in logic_names and x[0]!='Boldface']
    needle=compact(' '.join(x[0] for x in block))[:100]
    loc=normal_compact.find(needle)
    if loc<0:raise ValueError(f'Cannot map logic paragraph {cat} {m[1]}: {needle}')
    logic_starts.append((normal_map[loc],cat,int(m[1]),pn))

offsets=[];pos=0
for line,pn in normal_ls:offsets.append((pos,line,pn));pos+=len(line)+1
for i,(pos,cat,n,pn) in enumerate(logic_starts):
    end=logic_starts[i+1][0] if i+1<len(logic_starts) else len(normal_text)
    ls=[(line,pg) for off,line,pg in offsets if pos<=off<end and line not in logic_names and line!='Boldface']
    ci=logic_names.index(cat)+1;identifier=f'gwc290-logic{ci}-q{n:02d}'
    p=parse_block(identifier,n,ls,'逻辑 · '+cat,f'{cat} {n}');set_answers(p,logic_keys.get((cat,n)));passages.append(p)

# The appended gold-book collection has an independent 40-entry answer table.
bucket=[];active=None
for line,pn in lines_for(250,290):
    m=re.fullmatch(r'GWC-R(\d+)',line)
    if m:
        if active:
            p=parse_block(*active,bucket,'金皮书40篇',label);set_answers(p,appended_keys.get(active[1]));passages.append(p)
        n=int(m[1]);active=(f'gwc290-r{n:02d}',n);label=f'GWC-R{n}';bucket=[]
    elif active:bucket.append((line,pn))
if active:
    p=parse_block(*active,bucket,'金皮书40篇',label);set_answers(p,appended_keys.get(active[1]));passages.append(p)

# Recover printed bold runs for highlighted-text and boldface questions. Match
# whitespace-insensitively, then return exact slices of the structured text.
style_path=OUT/'gwc290-style-runs.json'
needed_pages=sorted({pn for p in passages if any(re.search('highlighted|boldface|bold face|indicated',q['stem'],re.I) for q in p['questions']) for pn in p['pages']})
if style_path.exists():style_runs=json.loads(style_path.read_text(encoding='utf8'))
else:
    style_runs={}
    for pn in needed_pages:
        runs=[];current=[]
        def visitor(t,cm,tm,font,size):
            if not t.strip():return
            bold=font and 'bold' in str(font.get('/BaseFont','')).lower()
            if bold:current.append(t)
            elif current:runs.append(''.join(current));current.clear()
        reader.pages[pn-1].extract_text(visitor_text=visitor)
        if current:runs.append(''.join(current))
        style_runs[str(pn)]=runs
    style_path.write_text(json.dumps(style_runs,ensure_ascii=False,indent=2),encoding='utf8')
for p in passages:
    if p['section'] in ('Easy','Medium','Hard'):p['difficulty']=p['section']
    text=p['text'];mapped=[i for i,ch in enumerate(text) if not ch.isspace()];c=compact(text);highlights=[]
    for pn in p['pages']:
        for run in style_runs.get(str(pn),[]):
            needle=compact(run)
            if len(needle)<4:continue
            off=c.find(needle)
            if off>=0:
                exact=text[mapped[off]:mapped[off+len(needle)-1]+1]
                if exact not in highlights:highlights.append(exact)
    if highlights:p['highlights']=highlights

questions=[q for p in passages for q in p['questions']]
issues.append({'issue':'source-count-discrepancy','detail':'原书标题为290篇，但实际正文为139篇分级阅读、39篇模考、71篇逻辑和40篇金皮书，共289篇。原书逻辑解释题答案表列出第10题，正文PDF222–224只包含第1–9题；没有补造缺失题。','pages':[222,223,224,239]})
coverage={'pdfPages':len(pages),'passages':len(passages),'questions':len(questions),'answerVerified':sum(q['answerStatus']=='source-key' for q in questions),'answerUnverified':sum(q['answerStatus']!='source-key' for q in questions),'sections':dict(collections.Counter(p['section'] for p in passages)),'questionKinds':dict(collections.Counter(q['kind'] for q in questions)),'sourceTextCharacters':sum(map(len,pages)),'issues':issues}
result={'source':{'id':'gwc290','title':'GWC 阅读机经 290 篇','fileName':SOURCE.name,'pages':len(pages),'notes':['全部原文与答案来自本地 PDF；原始文本保留于 data/gwc290-raw-pages.json。','原书未提供逐题解析；未生成或推测解析。','编号、空白与排版标题仅在展示层整理，原文未被覆盖。'],'pdfUrl':'sources/gwc290.pdf'},'passages':passages,'coverage':coverage}
(OUT/'gwc290.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
(OUT/'gwc290-validation.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2),encoding='utf8')
(PROJECT/'dist/sources').mkdir(exist_ok=True,parents=True)
shutil.copy2(SOURCE,PROJECT/'dist/sources/gwc290.pdf')
print(json.dumps(coverage,ensure_ascii=False,indent=2))
