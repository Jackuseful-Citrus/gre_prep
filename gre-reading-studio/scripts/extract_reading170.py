from pathlib import Path
import sys,json,re,shutil
from library_paths import resolve_material, source_url, pdf_pages, normalize_material_links
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parents[2]; P=ROOT/'gre-reading-studio'; DATA=P/'data'; RAW=DATA/'mixed-raw'
sys.path.insert(0,str(ROOT/'gre800-cards/scripts/vendor'))
from pypdf import PdfReader
import openpyxl

def compact(s):return re.sub(r'\s+',' ',s).strip()
def original_bold(body,span):
 body=compact(body);positions=[i for i,c in enumerate(body) if not c.isspace()]
 plain=''.join(body[i] for i in positions);needle=''.join(span.split())
 a=plain.find(needle)
 return body[positions[a]:positions[a+len(needle)-1]+1] if a>=0 and len(needle)>=6 else None
def save(name,x):(DATA/name).write_text(json.dumps(normalize_material_links(x),ensure_ascii=False,indent=2),encoding='utf-8')
def joined(pages,start=1,footers=False):
 text='';off=[]
 for n,s in enumerate(pages,start):
  if footers:s=re.sub(r'(?m)^\s*\d+\s*$','',s)
  a=len(text);text+=s+'\n';off.append((n,a,len(text)))
 return text,off
def pp(a,b,off):return [n for n,x,y in off if y>a and x<b]

raw=pdf_pages(resolve_material(source_id='reading170'),RAW/'reading170-exercises.json')
expraw=pdf_pages(resolve_material(source_id='reading170-explained'),RAW/'reading170-explained.json')
text,off=joined(raw,footers=True);exptext,expoff=joined(expraw)
warnings=[]

# Explicit keys from the appendix. Keep both provenance and the unmodified source key.
keytext,keyoffs=joined(raw[232:238],233,True)
keytext=re.sub(r'(第❶)\s*\n句\s*\n',r'\1句 ',keytext)
keys={}; section='main';position=0
for line in keytext.splitlines():
 s=line.strip()
 if s in ['削弱题','假设题','加强题','评价题','解释题','结论题','Boldface 题']:section=s.replace(' 题','')
 m=re.match(r'Practice Tests-(\d)-(\d)-(\d)\s+(.+)$',s)
 if m:keys['test-'+ '-'.join(m.groups()[:3])]=(m.group(4).split(),pp(position,position+len(line),keyoffs))
 else:
  m=re.match(r'^(\d+)\s+((?:[A-E]+|第[^\s]+)(?:\s+(?:[A-E]+|第[^\s]+))*)\s*$',s)
  if m:keys[(f'main-{int(m.group(1))}' if section=='main' else f'logic-{section}-{int(m.group(1))}')]=(m.group(2).split(),pp(position,position+len(line),keyoffs))
 position+=len(line)+1

# Difficulty table has explicit source section and number columns; no inferred difficulty values.
w=openpyxl.load_workbook(resolve_material('sources/difficulty.xlsx'),read_only=True,data_only=True)
difficulties={};section='main'
for rownum,row in enumerate(w.worksheets[0].values,1):
 val=row[1]
 if isinstance(val,str) and val.startswith('Practice Tests'):
  match=re.search(r'第([一二三四])套 Section ([12])',val)
  section=f'test-{ "一二三四".index(match.group(1))+1}-{match.group(2)}' if match else 'unknown'
 if isinstance(val,(int,float)):
  key=f'{section}-{int(val)}'; difficulties[key]={'title':row[2],'difficulty':row[3],'row':rownum,'questions':[{'type':row[4+2*i],'difficulty':row[5+2*i]} for i in range(4)]}

# Read original bold spans for function / boldface questions.
pdf=PdfReader(resolve_material(source_id='reading170'));bold={}
for n,page in enumerate(pdf.pages[:232],1):
 spans=[];run=['']
 def visitor(s,cm,tm,f,sz):
  if not s.strip():return
  if f and 'Bold' in str(f.get('/BaseFont','')):run[0]+=s
  elif run[0]:spans.append(run[0]);run[0]=''
 page.extract_text(visitor_text=visitor)
 if run[0]:spans.append(run[0])
 bold[n]=spans

def parse_exp_block(block,a,key):
 translation=re.search(r'【原文翻译】\s*([\s\S]+?)(?=【)',block)
 title=compact(re.split(r'【|扫描',block,maxsplit=1)[0])
 start=block.find('【题目讲解】')
 entries=[]
 if start>=0:
  body=block[start+len('【题目讲解】'):]
  ms=list(re.finditer(r'(?m)^\s*(\d+)\s*[.．]\s*(?=[\u3400-\u9fff“「])',body))
  # Logical problems are individually numbered; some test logic lacks a visible number.
  if not ms and re.search(r'[A-E]\s*[.．]\s*（正确）',body):
   chunks=[(1,0,len(body))]
  else:chunks=[(int(m.group(1)),m.start(),ms[i+1].start() if i+1<len(ms) else len(body)) for i,m in enumerate(ms)]
  for num,qa,qb in chunks:
   q=body[qa:qb]
   opts=re.findall(r'(?m)^\s*([A-E])\s*[.．]\s*（正确）',q)
   entries.append({'number':num,'answer':opts or None,'explanation':compact(q),'pages':pp(a+start+len('【题目讲解】')+qa,a+start+len('【题目讲解】')+qb,expoff)})
 return {'title':title,'translation':compact(translation.group(1)) if translation else None,'questions':entries,'pages':pp(a,a+len(block),expoff),'rawText':block}

# Match complete explanation blocks in source order, rejecting the stray heading at PDF628.
em=list(re.finditer(r'(?m)^Passage\s+(\d+)\s*',exptext))
expblocks=[]
for i,m in enumerate(em):
 end=em[i+1].start() if i+1<len(em) else exptext.find('逻辑篇',m.end())
 block=exptext[m.end():end]
 if m.start()<expoff[48][1] or '【原文翻译】' not in block or '【题目讲解】' not in block:continue
 expblocks.append((int(m.group(1)),block,m.end()))
explanations={}
for j,(nr,block,a) in enumerate(expblocks[:178]):
 if j<139:key=f'main-{nr}'
 else:
  k=j-139;setnum=1 if k<9 else 2 if k<19 else 3 if k<29 else 4
  local=k-[0,9,19,29][setnum-1];sectionnum=1 if local<(4 if setnum==1 else 5) else 2
  key=f'test-{setnum}-{sectionnum}-{nr}'
 explanations[key]=parse_exp_block(block,a,key)

logictypes=['削弱题','假设题','加强题','评价题','解释题','结论题','Boldface']
for kind in logictypes:
 label=(kind+' 题' if kind=='Boldface' else kind)+'例题解析'
 logic_exp_start=expoff[773][1]
 found=re.search(re.escape(kind)+r'\s*(?:题\s*)?例题解析',exptext[logic_exp_start:])
 start=logic_exp_start+found.start() if found else -1
 if start<0:raise RuntimeError(('missing explanation group',label))
 um=re.search(r'(?m)^Unit\s+\d+',exptext[start:]);end=start+um.start() if um else len(exptext)
 block=exptext[start:end]
 lm=list(re.finditer(r'(?m)^(\d\d)\s*\n【原文翻译】',block))
 for i,m in enumerate(lm):
  a=start+m.end()-len('【原文翻译】');b=start+(lm[i+1].start() if i+1<len(lm) else len(block));key=f'logic-{kind}-{int(m.group(1))}'
  explanations[key]=parse_exp_block(exptext[a:b],a,key)

def sentences_from(body):
 ms=list(re.finditer(r'[❶❷❸❹❺❻❼❽❾❿]',body));sent=[];para=0
 for i,m in enumerate(ms):
  n='❶❷❸❹❺❻❼❽❾❿'.index(m.group())+1
  if n==1:para+=1
  s=compact(body[m.end():ms[i+1].start() if i+1<len(ms) else len(body)])
  if s:sent.append({'id':f'S{len(sent)+1}','text':s,'paragraph':para,'sentence':n})
 return sent

def make_question(pid,num,chunk,a,b,key,body):
 notes=[]
 chunk=re.split(r'(?m)^\s*(?:本文的第?二?另?一种题目版本|本文的第二种题目版本|Set (?:One|Two|Three|Four)|Section [12]|Practice Tests|Easy (?:Section|模式)|Medium (?:Section|模式)|Hard (?:Section|模式)|本资料配套)',chunk)[0]
 chunk=chunk.replace(' E. have increased','\nE. have increased')
 opts=list(re.finditer(r'(?m)^\s*([A-E])(?:\s*[.．]\s*|\s+(?=[A-Za-z]))',chunk))
 options=[{'id':m.group(1),'text':compact(chunk[m.end():opts[i+1].start() if i+1<len(opts) else len(chunk)])} for i,m in enumerate(opts)]
 stem=compact(chunk[:opts[0].start()] if opts else chunk)
 original=keys.get(key,([],[]));answerText=original[0][num-1] if num<=len(original[0]) else None
 answer=list(answerText) if answerText and re.fullmatch('[A-E]+',answerText) else None
 kind='multiple' if len(options)==3 or answer and len(answer)>1 else 'single'
 if not options:
  kind='sentence' if re.search(r'select.*sentence|identify.*sentence',stem,re.I) else 'open'
  if kind=='sentence':
   sents=sentences_from(body);options=[{'id':s['id'],'text':s['text']} for s in sents]
   sm=re.search(r'(?:第([一二三四])段)?第([❶❷❸❹❺❻❼❽❾❿])句',answerText or '')
   if sm:
    para='一二三四'.index(sm.group(1))+1 if sm.group(1) else 1;n='❶❷❸❹❺❻❼❽❾❿'.index(sm.group(2))+1
    matched=[s['id'] for s in sents if s['paragraph']==para and s['sentence']==n]
    if len(matched)==1:answer=matched
  if not answer:notes.append('无法可靠自动映射选句答案，保留原文答案与原页供核验。')
 if options and kind!='sentence' and [o['id'] for o in options] not in [list('ABC'),list('ABCDE')]:
  warnings.append({'key':key,'q':num,'issue':'option-count-or-order','options':[o['id'] for o in options]})
  notes.append('选项格式需参照原页核对。');answer=None
 ex=explanations.get(key);eq=next((q for q in ex['questions'] if q['number']==num),None) if ex else None
 explanation=eq['explanation'] if eq else None
 status='source-key' if answer else 'unverified'
 if eq and eq['answer'] and answer and kind!='sentence' and sorted(eq['answer'])!=sorted(answer):
  notes.append('来源答案冲突：练习册总表='+str(answerText)+'；精讲解析标记='+''.join(eq['answer'])+'。保留两份原文，不自动判分。')
  warnings.append({'key':key,'q':num,'issue':'source-key-conflict','table':answerText,'explanation':eq['answer']})
  answer=None;status='source-conflict'
 if not original[0]:notes.append('未匹配到练习册总答案表。')
 return {'id':f'{pid}-q{num:02d}','number':num,'stem':stem,'options':options,'kind':kind,'answer':answer,'answerText':answerText,'explanation':explanation,'pages':pp(a,b,off),'answerPages':original[1],'explanationPages':eq['pages'] if eq else [],'explanationSourceId':'reading170-explained' if eq else None,'answerStatus':status,'notes':notes}

passages=[]
readingStart=off[8][1];readingEnd=off[204][1]
reading=text[readingStart:readingEnd]
markers=list(re.finditer(r'(?m)^\s*Passage\s+(\d+)\s*\n',reading))
for i,m in enumerate(markers):
 nr=int(m.group(1));end=markers[i+1].start() if i+1<len(markers) else len(reading)
 a=readingStart+m.end();b=readingStart+end;chunk=text[a:b]
 if i<139:key=f'main-{nr}';section='必做30篇' if nr<=30 else 'Easy' if nr<=53 else 'Medium' if nr<=120 else 'Hard'
 else:
  k=i-139;setnum=1 if k<9 else 2 if k<19 else 3 if k<29 else 4;local=k-[0,9,19,29][setnum-1];sec=1 if local<(4 if setnum==1 else 5) else 2
  key=f'test-{setnum}-{sec}-{nr}';section=f'模考 {setnum} · Section {sec}'
 qms=list(re.finditer(r'(?m)^\s*(\d+|l)[.．]\s*(?=[A-Z“\"])',chunk))
 if not qms:raise RuntimeError(('no questions',key,chunk[:100]))
 body=chunk[:qms[0].start()].strip();pid='reading170-'+key
 questions=[]
 for j,qm in enumerate(qms):
  num=1 if qm.group(1)=='l' else int(qm.group(1));qb=qms[j+1].start() if j+1<len(qms) else len(chunk)
  q=make_question(pid,num,chunk[qm.end():qb],a+qm.start(),a+qb,key,body)
  questions.append(q)
 ex=explanations.get(key);di=difficulties.get(key,{})
 nums=pp(a,b,off);highlights=[]
 for pg in nums:
  highlights.extend(h for s in bold.get(pg,[]) if (h:=original_bold(body,s)))
 notes=[]
 if len(questions)!=len(keys.get(key,([],[]))[0]):warnings.append({'key':key,'issue':'question-key-count','questions':len(questions),'keys':keys.get(key)})
 passages.append({'id':pid,'sourceId':'reading170','number':nr,'sourceKey':key,'title':di.get('title') or (ex['title'] if ex else f'{section} Passage {nr}'),'section':section,'text':compact(body),'paragraphs':[compact(x) for x in re.split(r'\n\s*\n',body) if x.strip()],'pages':nums,'questions':questions,'highlights':highlights,'translation':ex['translation'] if ex else None,'explanationPages':ex['pages'] if ex else [],'difficulty':di.get('difficulty'),'difficultySource':{'fileName':'difficulty.xlsx','sheet':'Sheet1','row':di['row']} if di else None,'notes':notes,'rawText':chunk})

# Logical booklet: the original blank line after the E choice separates the next stimulus.
logictext=text[off[204][1]:off[232][1]];logicoffset=off[204][1]
groups=list(re.finditer(r'(?m)^\s*(削弱题|假设题|加强题|评价题|解释题|结论题|Boldface)\s*\n',logictext))
for gi,gm in enumerate(groups):
 kind=gm.group(1);end=groups[gi+1].start() if gi+1<len(groups) else len(logictext)
 block=logictext[gm.end():end];ba=logicoffset+gm.end();qms=list(re.finditer(r'(?m)^\s*(\d+)\.\s*(?=[A-Z])',block));prevEnd=0
 for j,qm in enumerate(qms):
  num=int(qm.group(1));key=f'logic-{kind}-{num}';pid='reading170-'+key
  boundary=qms[j+1].start() if j+1<len(qms) else len(block)
  after=block[qm.end():boundary];em=re.search(r'(?m)^\s*E[.．]\s*',after)
  if not em:raise RuntimeError(('no E',key))
  gap=re.search(r'\n\s*\n',after[em.end():])
  qend=qm.end()+em.end()+gap.start() if gap else boundary
  if kind=='解释题' and num==3:
   missing_gap=after.find('\nObservations of the Arctic')
   assert missing_gap>0
   qend=qm.end()+missing_gap
  body=block[prevEnd:qm.start()].strip();body=re.sub(r'^\s*本资料[\s\S]+?》\s*','',body)
  q=make_question(pid,num,block[qm.end():qend],ba+qm.start(),ba+qend,key,body)
  # Each numbered problem corresponds to its own single question, while the table is indexed by problem number.
  original=keys.get(key,([],[]))
  if num!=1:
   q2key=key+'-one';keys[q2key]=original
   if key in explanations:
    ex=explanations[key];eq=next((z for z in ex['questions'] if z['number']==num),None)
    explanations[q2key]={**ex,'questions':[{**eq,'number':1}] if eq else []}
   q=make_question(pid,1,block[qm.end():qend],ba+qm.start(),ba+qend,q2key,body)
   q['number']=num;q['id']=f'{pid}-q{num:02d}'
  nums=pp(ba+prevEnd,ba+qend,off);ex=explanations.get(key)
  highlights=[]
  for pg in nums:
   highlights.extend(h for s in bold.get(pg,[]) if (h:=original_bold(body,s)))
  passages.append({'id':pid,'sourceId':'reading170','number':num,'sourceKey':key,'title':f'{kind} · {num:02d}','section':'逻辑 · '+kind,'text':compact(body),'paragraphs':[compact(body)],'pages':nums,'questions':[q],'highlights':highlights,'translation':ex['translation'] if ex else None,'explanationPages':ex['pages'] if ex else [],'notes':[],'rawText':block[prevEnd:qend]})
  prevEnd=qend

source={'id':'reading170','title':'GRE 阅读170篇 · 练习与逻辑分册','fileName':'Archive.zip / 阅读170篇/《GRE阅读170篇》配套练习题目（2019年6月）.pdf','pages':246,'notes':['原书名为170篇；当前题目本含170篇阅读及79道逻辑单题，共249篇/组。总答案表另有解释题第10题答案，但当前题目本无该题，不虚构补入。','原PDF提取断词、拼写和格式疑点未静默更正，答案冲突不自动判分。','难度仅取同目录难度表对应章节和编号，原值保留。'],'reader':{'url':source_url(source_id='reading170'),'originalPages':list(range(1,247)),'pageMap':{str(x):x for x in range(1,247)}}}
provenance={name:resolve_material('sources/'+name).relative_to(ROOT).as_posix() for name in ['reading170-exercises.pdf','reading170-explained.pdf']}
source['fileName']=provenance['reading170-exercises.pdf']
qall=[q for p in passages for q in p['questions']]
coverage={'passages':len(passages),'mainPassages':len(markers),'readingPassages':170,'logicalStimuli':len(passages)-170,'questions':len(qall),'sourceKeys':sum(q['answerStatus']=='source-key' for q in qall),'conflicts':sum('conflict' in q['answerStatus'] for q in qall),'unverified':sum(q['answerStatus']=='unverified' for q in qall),'explanations':sum(bool(q['explanation']) for q in qall),'translations':sum(bool(p.get('translation')) for p in passages),'originalExplanationBlocks':len(expblocks),'rawText':'data/mixed-raw/reading170-exercises.json','rawExplanations':'data/mixed-raw/reading170-explained.json','warnings':warnings}
save('reading170.json',{'source':source,'additionalSources':[{'id':'reading170-explained','title':'GRE阅读170篇精讲精析 · 原书解析','fileName':provenance['reading170-explained.pdf'],'pages':952,'notes':['仅用于对应题目的中文翻译、原书答案标记与解释；与练习总表不同的答案作为冲突保留。'],'reader':{'url':source_url(source_id='reading170-explained'),'originalPages':list(range(1,953)),'pageMap':{str(x):x for x in range(1,953)}}}],'passages':passages,'coverage':coverage})
save('reading170-extraction-report.json',coverage)
print(json.dumps(coverage,ensure_ascii=False,indent=2))
