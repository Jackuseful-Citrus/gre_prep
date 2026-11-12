"""Lossless page archive plus conservative reading-question extraction from mixed books."""
from pathlib import Path
import sys,json,re,unicodedata
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parents[2]
PROJECT=ROOT/'gre-reading-studio'; DATA=PROJECT/'data'; RAW=DATA/'mixed-raw'
sys.path.insert(0,str(ROOT/'gre800-cards/scripts/vendor'))
from pypdf import PdfReader,PdfWriter

def save(name,obj):
 (DATA/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
def compact(s):
 return re.sub(r'\s+',' ',s).strip()
def pages_for(a,b,offsets):
 return [p for p,start,end in offsets if end>a and start<b]
def combined(pages,clean=False,start=1):
 text=''; offsets=[]
 for i,s in enumerate(pages,start):
  if clean:
   lines=s.splitlines()
   if lines and re.search(r'^(?:\d+ Part [IV]+:|Chapter \d+:)',lines[0]):lines=lines[1:]
   lines=[l for l in lines if not re.fullmatch(r'\s*(?:\(\d+\)|Line)\s*',l)]
   s='\n'.join(lines)
  a=len(text); text+=s+'\n';offsets.append((i,a,len(text)))
 return text,offsets
def subset(sid,fn,nums):
 r=PdfReader(ROOT/fn);w=PdfWriter(); nums=sorted(set(nums))
 for n in nums:w.add_page(r.pages[n-1])
 dest=PROJECT/'dist/sources';dest.mkdir(parents=True,exist_ok=True)
 with (dest/(sid+'-reading.pdf')).open('wb') as f:w.write(f)
 return {'url':'sources/'+sid+'-reading.pdf','originalPages':nums,'pageMap':{str(n):i+1 for i,n in enumerate(nums)}}

def extract_mcgraw():
 fn="GRE/McGraw-Hill's GRE, 2010 Edition.pdf"
 raw=json.loads((RAW/'mcgraw.json').read_text(encoding='utf-8'))
 alltext,offs=combined(raw,True)
 specs=[]
 section_specs=[('诊断练习',[57,59,61],(76,78)),('模拟测验 1',[309,310,312],(329,331)),('模拟测验 2',[353,354,356],(373,375)),('模拟测验 3',[399,400,402],(418,420))]
 for label,starts,answer_range in section_specs:
  for page,qs in zip(starts,[(17,18),(21,24),(25,26)]):
   offset=offs[page-1][1]
   marker=re.search(r'Questions [^\n]+are based on the following passage\.',alltext[offset:])
   start=offset+marker.end()
   qfirst=re.search(r'(?m)^'+str(qs[0])+r'\. ',alltext[start:]); qstart=start+qfirst.start()
   lastq=re.search(r'(?m)^'+str(qs[1])+r'\. ',alltext[qstart:]); lend=qstart+lastq.end()
   boundary=re.search(r'(?m)^(?:'+str(qs[1]+1)+r'\. |Questions \d|END OF SECTION)',alltext[lend:])
   if boundary:end=lend+boundary.start()
   else:raise RuntimeError((page,'no question end'))
   specs.append((label,start,qstart,end,answer_range))
 # Chapter exercises: exact visible boundaries; the sample is kept once (also appears on PDF 30–31).
 start=alltext.index('According to many scholars, Johannes Gutenberg')
 qstart=alltext.index('\n1. The author is primarily concerned with',start)+1
 end=alltext.index('Answers and Explanations',qstart)
 specs.append(('阅读专项 · 印刷术',start,qstart,end,(204,205)))
 start=alltext.index('Defined biologically, hair is primarily composed')
 qstart=alltext.index('\n1. It can be inferred from the passage',start)+1
 end=alltext.index('Answers and Explanations',qstart)
 specs.append(('阅读专项 · 毛发',start,qstart,end,(206,206)))
 start=alltext.index('Scientists know very little about the eating habits of our ancestors')
 qstart=alltext.index('The main purpose of the passage is to',start)
 end=alltext.index('Text Completion',qstart)
 specs.append(('题型示例 · 黑猩猩',start,qstart,end,None))
 result=[]; sourcepages=set([193]); audit=[]
 topics=['人与犬的文化关系','熊的觅食行为','载人航天与机器人','林肯纪念堂','对计算机技术的依赖','国家的自我认识','中国城市与自行车','睡眠的生理作用','淡水豚的声学追踪','极光与磁暴','安提基特拉机械','太空中的爆炸','印刷术与文艺复兴','人类毛囊的差异','黑猩猩与人类祖先']
 for ix,(label,a,qstart,b,arange) in enumerate(specs,1):
  pid=f'mcgraw-p{ix:03d}'
  ptext=alltext[a:qstart].strip(); qtext=alltext[qstart:b].strip()
  if label.startswith('题型示例'):qtext='1. '+qtext
  matches=list(re.finditer(r'(?m)^\s*(\d+)\.\s+(?!The best answer)',qtext))
  answers={}
  if arange:
   aa=offs[arange[0]-1][1];bb=offs[arange[1]-1][2];ans=alltext[aa:bb]
   am=list(re.finditer(r'(?m)^(\d+)\. The best answer is ([A-E])\.',ans))
   for j,x in enumerate(am):
    nxt=re.search(r'(?m)^\d+\. The best answer is ',ans[x.end():]);ae=x.end()+nxt.start() if nxt else len(ans)
    answers[int(x.group(1))]={'answer':[x.group(2)],'explanation':compact(ans[x.end():ae]),'answerPages':pages_for(aa+x.start(),aa+ae,offs)}
  questions=[]
  for j,match in enumerate(matches):
   qend=matches[j+1].start() if j+1<len(matches) else len(qtext)
   chunk=qtext[match.end():qend].strip()
   opts=list(re.finditer(r'(?m)^\s*\(([A-E])\)\s*',chunk))
   if len(opts)!=5:raise RuntimeError((label,match.group(1),'option count',len(opts),chunk))
   options=[{'id':x.group(1),'text':compact(chunk[x.end():(opts[k+1].start() if k+1<len(opts) else len(chunk))])} for k,x in enumerate(opts)]
   number=int(match.group(1)); key=answers.get(number)
   q={'id':f'{pid}-q{number:02d}','number':number,'stem':compact(chunk[:opts[0].start()]),'options':options,'kind':'single','answer':key['answer'] if key else None,'explanation':key['explanation'] if key else None,'pages':pages_for(qstart+match.start(),qstart+qend,offs),'answerPages':key['answerPages'] if key else [],'answerStatus':'source-key' if key else 'unverified','notes':[]}
   if not key:q['notes'].append('原书该题型示例未提供答案，不自动判分。')
   questions.append(q)
  nums=pages_for(a,b,offs);sourcepages.update(nums)
  for q in questions:sourcepages.update(q['answerPages'])
  result.append({'id':pid,'sourceId':'mcgraw','number':ix,'title':topics[ix-1],'section':label,'text':compact(ptext),'paragraphs':[compact(ptext)],'pages':nums,'questions':questions,'notes':['原书为2010年版旧制GRE，保留阅读练习原文；题型与内容未按现行考试改写。','题干中的line为原PDF行号，可通过来源原页核对。']+(['原书PDF30–31与193页为同一题型示例，已合并。'] if label.startswith('题型示例') else []),'rawText':alltext[a:b]})
 source={'id':'mcgraw','title':"McGraw-Hill's GRE · 阅读精选（2010）",'fileName':fn,'pages':477,'notes':['仅提取阅读理解，未收入填空、类比、反义、数学或写作题。','删除页眉与行号；仅合并PDF自动换行，未改写题干、选项或答案。'],'reader':subset('mcgraw',fn,sourcepages)}
 save('mcgraw.json',{'source':source,'passages':result,'coverage':{'passages':len(result),'questions':sum(len(p['questions']) for p in result),'unverified':sum(q['answer'] is None for p in result for q in p['questions']),'rawPages':'data/mixed-raw/mcgraw.json','sampleDuplicatePages':[30,31,193]}})
 print('mcgraw',len(result),sum(len(p['questions']) for p in result))

def extract_gold():
 raw=json.loads((RAW/'mixed-gold.json').read_text(encoding='utf-8'))
 text,offs=combined(raw[194:],start=195)
 markers=list(re.finditer(r'GWC-R(\d\d)\b',text))
 result=[]
 for i,m in enumerate(markers):
  end=markers[i+1].start() if i+1<len(markers) else len(text)
  chunk=text[m.end():end]; nr=int(m.group(1)); answers=[]
  # Only the explicit answer labels form keys; commentary mentioning an answer is not a key.
  am=list(re.finditer(r'答案：\s*',chunk))
  for j,a in enumerate(am):
   nxt=am[j+1].start() if j+1<len(am) else len(chunk)
   following=chunk[a.end():nxt]
   prior=chunk[:a.start()]
   qm=list(re.finditer(r'(?m)^(\d+)\.\s+[A-Z]',prior))
   num=int(qm[-1].group(1)) if qm else j+1
   qmnext=re.search(r'(?m)^\d+\.\s+[A-Z]',following)
   if qmnext:following=following[:qmnext.start()]
   head=re.split(r'解析：|解释：',following,maxsplit=1)[0]
   letters=[]
   for ls in re.findall(r'\(([A-E]+)\)',head):letters.extend(list(ls))
   if nr==4 and num==2:
    # Printed answer names both A and B; preserve the explicit AB summary as an additional check.
    assert re.search(r'答案选\s*AB',following)
    letters=['A','B']
   explanation=compact(following)
   ap=pages_for(m.end()+a.start(),m.end()+a.end()+len(following),offs)
   answers.append({'number':num,'answer':list(dict.fromkeys(letters)) or None,'answerText':compact(head),'explanation':explanation,'answerPages':ap,'answerStatus':'source-key' if letters else 'unverified','notes':[] if letters else ['原书为选句答案：'+compact(head)]})
  translation=re.search(r'原文翻译\s*([\s\S]+?)(?:文章难度|3s\s*版本|文章点拨)',chunk)
  result.append({'number':nr,'id':f'mixed-gold-r{nr:02d}','pages':pages_for(m.start(),end,offs),'translation':compact(translation.group(1)) if translation else None,'answers':answers,'rawText':chunk})
 assert len(result)==40
 src={'id':'mixed-gold','title':'GRE语文高频题目精练与精析 · 阅读解析','fileName':'GRE语文高频题目精练与精析-金皮书.pdf','pages':290,'notes':['40篇阅读分册的配套中文翻译与答案解析，按R编号与题号关联，不另造英文文章。'],'reader':subset('mixed-gold','GRE语文高频题目精练与精析-金皮书.pdf',range(194,291))}
 save('gold-answers.json',{'source':src,'entries':result,'coverage':{'entries':40,'questions':sum(len(p['answers']) for p in result),'letterAnswers':sum(bool(q['answer']) for p in result for q in p['answers'])}})
 print('gold',len(result),sum(len(p['answers']) for p in result))

def export_guide():
 fn='gre备考胜经.pdf';raw=json.loads((RAW/'guide.json').read_text(encoding='utf-8'))
 src={'id':'guide','title':'GRE备考胜经 · 阅读方法与样题','fileName':fn,'pages':356,'notes':['阅读篇112–203页含图片嵌入的练习题。保留原页阅读，不把仅有解析的文本误当完整选择题。'],'reader':subset('guide',fn,range(112,204))}
 groups=[(112,140,'句间关系与指代'),(141,156,'句型与词义'),(157,158,'三大高频题型 · 民族国家'),(159,160,'题干理解'),(161,162,'主旨与指代 · Paule Marshall'),(163,166,'错误选项 · Bearden'),(167,169,'词汇题'),(170,172,'作者态度'),(173,178,'观点与结构'),(179,180,'细节定位'),(181,186,'难度与阅读速度'),(187,188,'驳论文主旨'),(189,191,'长文章主旨'),(192,195,'加强与假设'),(196,200,'逻辑与题材'),(201,203,'多重否定')]
 entries=[]
 for a,b,title in groups:
  entries.append({'id':f'guide-reader-{a}','sourceId':'guide','title':title,'pages':list(range(a,b+1)),'readerPage':a-111,'url':'sources/guide-reading.pdf#page='+str(a-111),'mode':'source-reading','notes':['原文练习及解析请在原页阅读。图片题未计入可自动判分题数。']})
 save('guide.json',{'source':src,'passages':[],'sourceReading':entries,'coverage':{'readingPages':[112,203],'fallbackGroups':len(entries),'structuredQuestions':0,'reason':'题目主要作为图片嵌入，原始页面方式完整保留。'}})
 # The three sentence books have no complete passage/question/choices combination.
 inventory=json.loads((RAW/'inventory.json').read_text(encoding='utf-8'))
 exclusions=[]
 for x in inventory:
  if x['id'].startswith('sentences'):
   exclusions.append({'id':x['id'],'fileName':x['fileName'],'pages':x['pages'],'characters':x['characters'],'classification':'sentence-analysis','includedAsQuestions':False,'reason':'长难句拆解与翻译训练；未发现独立的完整阅读文章、题干和选项组合。陈琦PDF43页的阅读题干仅用作语法示例。' if x['id']=='sentences-chen' else '长难句拆解与翻译训练；未发现独立的完整阅读文章、题干和选项组合。'})
 save('mixed-inventory.json',{'sources':inventory,'excluded':exclusions,'method':'保存全部抽取页文本；综合书阅读章按原页保留；答案仅取原书明确答案字段。'})

extract_mcgraw();extract_gold();export_guide()
