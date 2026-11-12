"""Integrate traceable question banks without changing legacy RC data or IDs."""
from pathlib import Path
from collections import Counter, defaultdict
import copy, hashlib, json, re, shutil, unicodedata
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
APP=Path(__file__).resolve().parents[1]
ROOT=APP.parent;WORK=APP/'data/platform';DIST=APP/'dist'
TYPE_NAMES={'RC1':'RC 单选','RCMultiple':'RC 多选','RCSentence':'RC 选句','TC1':'TC 单空','TC2':'TC 双空','TC3':'TC 三空','TC_LEGACY':'旧版成对选项填空','SE':'SE 六选二','QC':'数量比较','QuantSingle':'数学单选','QuantMultiple':'数学多选','NumericEntry':'数值填空','DI':'数据解释','QuantRecall':'数学回忆自答','QuantDrill':'数学知识练习','Issue':'Issue 写作','Argument':'Argument 写作','WritingExercise':'写作练习'}
def norm(s):return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',s or '').translate(str.maketrans({'“':'"','”':'"','‘':"'",'’':"'"}))).strip()
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def rc_bank():
 old=json.loads((DIST/'data.js').read_text(encoding='utf8').split('=',1)[1].strip().removesuffix(';'))
 bank={'sources':[],'questions':[],'materials':[],'exclusions':[]}
 for src in old['sources']:
  s=copy.deepcopy(src);s.update(source_file=s.get('fileName'),url=s.get('url') or s.get('path') or s.get('reader',{}).get('url'),category='Verbal',group='阅读资料');bank['sources'].append(s)
 for p in old['passages']:
  bank['materials'].append({'id':p['id'],'text':p['text'],'paragraphs':p.get('paragraphs'),'title':p['title'],'length':p.get('length'),'word_count':p.get('wordCount'),'translation':p.get('translation'),'highlights':p.get('highlights',[]),'legacy_passage_id':p['id']})
  for index,q in enumerate(p['questions']):
   first=q['references'][0];s=next(s for s in old['sources'] if s['id']==first['sourceId'])
   question={'question_id':q['id'],'source_id':first['sourceId'],'source_file':s.get('fileName'),'source_page':first.get('pages',p['pages']),'source_section':first.get('section',str(p['number'])),'category':'Verbal','question_type':{'single':'RC1','multiple':'RCMultiple','sentence':'RCSentence'}.get(q['kind'],'RCSentence'),'difficulty':difficulty(first.get('difficulty')),'difficulty_original':first.get('difficulty'),'question_content':q['stem'],'options':q.get('options',[]),'correct_answer':q.get('answer'),'explanation':q.get('explanation'),'answer_status':'verified' if q.get('gradable') else 'needs_review' if q.get('answerStatus')=='conflict' else 'extracted','answer_text':q.get('answerText'),'answer_source':{'source_id':first['sourceId'],'pages':first.get('answerPages',[])},'explanation_source':{'source_id':q.get('explanationSourceId',first['sourceId']),'pages':q.get('explanationPages',[])},'tags':[p['topic'],q['skill'],p['length']],'material_id':p['id'],'question_order':index+1,'legacy_rc_id':q['id'],'legacy_passage_id':p['id'],'highlights':q.get('highlights',p.get('highlights',[])),'raw_text':q['stem'],'notes':q.get('notes',[]),'source_refs':copy.deepcopy(q['references'])}
   bank['questions'].append(question)
 bank['reference_reading']=old.get('sourceReading',[])
 return bank
def difficulty(value):
 v=str(value or '').lower()
 if v in ['easy','简单','基础']:return 'easy'
 if v in ['medium','中等']:return 'medium'
 if v in ['hard','困难']:return 'hard'
 return 'unknown'
def workbook(path,sheets):
 wb=Workbook();wb.remove(wb.active)
 for name,headers,rows in sheets:
  ws=wb.create_sheet(name[:31]);ws.append(headers)
  for row in rows:ws.append([json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for v in row])
  ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions
  for c in ws[1]:c.fill=PatternFill('solid',fgColor='173F35');c.font=Font(color='FFFFFF',bold=True)
  for col in ws.columns:ws.column_dimensions[col[0].column_letter].width=min(75,max(18,max(len(str(c.value or '')) for c in list(col)[:100])+2))
  for row in ws.iter_rows(min_row=2):
   for c in row:c.alignment=Alignment(wrap_text=True,vertical='top')
 wb.save(path)
def main():
 banks=[rc_bank()];pending=[]
 for part in ['verbal','quant','awa']:
  path=WORK/f'{part}-bank.json'
  if path.exists():banks.append(read(path))
  else:pending.append(part)
 sources={};materials={};questions=[];lookup={};dups=[];issues=[];refs=[]
 for bank in banks:
  confirmed={qid:'confirmed:'+g['question_ids'][0] for g in bank.get('confirmed_duplicate_groups',[]) for qid in g['question_ids']}
  for s in bank.get('sources',[]):sources[s['id']]=s
  for m in bank.get('materials',[]):materials[m['id']]=m
  refs.extend(bank.get('exclusions',[]));refs.extend(bank.get('reference_reading',[]))
  for original in bank.get('questions',[]):
   q=copy.deepcopy(original)
   q.setdefault('notes',[]);q.setdefault('tags',[]);q.setdefault('options',[]);q.setdefault('source_refs',[])
   q.setdefault('difficulty','unknown');q.setdefault('correct_answer',None);q.setdefault('explanation',None)
   q.setdefault('source_section','');q.setdefault('source_page',[]);q.setdefault('source_file',sources.get(q['source_id'],{}).get('source_file',''))
   q.setdefault('answer_status','extracted')
   candidate_keys={tuple(sorted(str(v) for v in c['answer'])) for c in (q.get('answer_candidates') or []) if isinstance(c,dict) and isinstance(c.get('answer'),list) and c['answer']}
   if len(candidate_keys)>1:q['answer_status']='needs_review';q['notes'].append('原资料的多个答案候选不一致，保留原键且停止评分。')
   q['difficulty']=difficulty(q.get('difficulty'))
   if q.get('correct_answer') is not None and not isinstance(q['correct_answer'],list):q['correct_answer']=[str(q['correct_answer'])]
   if q.get('correct_answer'):q['correct_answer']=[str(v) for v in q['correct_answer']]
   if q['question_type'] in ['Issue','Argument','WritingExercise']:q['category']='AWA'
   if not q.get('question_content','').strip() and not q.get('images'):q['answer_status']='incomplete';q['notes'].append('缺少可展示题干与原题图像。')
   opts=[str(o['id']) for o in q['options']]
   if q.get('blank_groups'):
    opts=[str(o['id']) for group in q['blank_groups'] for o in group['options']]
    if len(opts)!=len(set(opts)):q['answer_status']='needs_review';q['notes'].append('各空选项ID不唯一。')
   if q['question_type']=='SE' and (len(opts)!=6 or q.get('correct_answer') and len(q['correct_answer'])!=2):q['answer_status']='needs_review';q['notes'].append('六选二结构或原答案数量待核验。')
   if q['question_type'] in ['TC1','TC2','TC3']:
    blanks=int(q['question_type'][-1]);q['blank_count']=blanks
    if blanks>1 and (len(q.get('blank_groups',[]))!=blanks or q.get('correct_answer') and len(q['correct_answer'])!=blanks):q['answer_status']='needs_review';q['notes'].append('多空选项组或答案组合待核验。')
   numeric=q['question_type']=='NumericEntry' or q.get('response_type')=='numeric'
   if q.get('correct_answer') and q['category']!='AWA' and not numeric and not set(q['correct_answer'])<=set(opts):q['answer_status']='needs_review';q['notes'].append('原答案无法对应展示选项。')
   if q['answer_status']=='verified' and q['category']!='AWA' and not q.get('correct_answer'):q['answer_status']='extracted'
   q['gradable']=q['category']!='AWA' and q['answer_status']=='verified' and bool(q.get('correct_answer'))
   if not q.get('source_refs'):q['source_refs']=[{'source_id':q['source_id'],'source_file':q['source_file'],'source_page':q['source_page'],'question_id':q['question_id'],'correct_answer':q.get('correct_answer'),'answer_status':q['answer_status']}]
   for ref in q['source_refs']:
    if q.get('answer_candidates'):ref['answer_candidates']=copy.deepcopy(q['answer_candidates'])
    if q.get('notes'):ref.setdefault('notes',copy.deepcopy(q['notes']))
   # Legacy RC IDs/data stay intact. New banks merge only exact wording/structure.
   payload=[q['question_type'],norm(q.get('question_content')),q.get('options'),q.get('blank_groups'),q.get('quantities'),q.get('numeric_format'),q.get('instructions'),q.get('images'),norm(materials.get(q.get('material_id'),{}).get('text')),q.get('highlights')]
   key=q['question_id'] if q.get('legacy_rc_id') else hashlib.sha256(json.dumps(payload,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
   if q['question_id'] in confirmed:key=confirmed[q['question_id']]
   if key in lookup:
    target=lookup[key];dups.append({'retained':target['question_id'],'merged':q['question_id'],'source':q['source_file'],'method':'逐题原图核对确认' if q['question_id'] in confirmed else '严格内容与结构一致'});target['source_refs'].extend(q['source_refs'])
    a,b=target.get('correct_answer'),q.get('correct_answer')
    if a and b and sorted(a)!=sorted(b) or q['answer_status'] in ['needs_review','incomplete'] or len(candidate_keys)>1:
     target.update(answer_status='needs_review',gradable=False);target['notes'].append('同题来源存在待核验、不完整或答案不一致的信息；保留原键并停止评分。')
     if q.get('answer_candidates'):target.setdefault('answer_candidates',[]).extend(copy.deepcopy(q['answer_candidates']))
    elif not a and b and q['gradable'] and target['answer_status'] not in ['needs_review','incomplete']:
     target.update(correct_answer=b,answer_status='verified',gradable=True,answer_source=q.get('answer_source'))
    if not target.get('explanation') and q.get('explanation'):target['explanation']=q['explanation'];target['explanation_source']=q.get('explanation_source')
    continue
   lookup[key]=q;questions.append(q)
   if q['notes'] or q['answer_status'] in ['needs_review','incomplete']:issues.append({'question_id':q['question_id'],'status':q['answer_status'],'notes':q['notes'],'source_file':q['source_file'],'source_page':q['source_page']})
 issues=[{'question_id':q['question_id'],'status':q['answer_status'],'notes':q['notes'],'source_file':q['source_file'],'source_page':q['source_page']} for q in questions if q['notes'] or q['answer_status'] in ['needs_review','incomplete']]
 ids=[q['question_id'] for q in questions];assert len(ids)==len(set(ids)),'Duplicate IDs'
 stats=[]
 for typ in TYPE_NAMES:
  qs=[q for q in questions if q['question_type']==typ]
  if qs:stats.append({'type':typ,'title':TYPE_NAMES[typ],'count':len(qs),'with_answer':sum(bool(q.get('correct_answer')) for q in qs),'gradable':sum(q['gradable'] for q in qs),'with_explanation':sum(bool(q.get('explanation') or q.get('guidance') or q.get('model_essay')) for q in qs),'unverified':sum(q['answer_status']!='verified' for q in qs),'sources':list(dict.fromkeys(q['source_id'] for q in qs))})
 for s in sources.values():
  sq=[q for q in questions if q['source_id']==s['id'] or any(r.get('source_id',r.get('sourceId'))==s['id'] for r in q['source_refs'])]
  s['imported_count']=len(sq);s['types']=list(dict.fromkeys(q['question_type'] for q in sq));s.setdefault('group',{'Verbal':'填空与同义','Quant':'数学资料','AWA':'写作资料'}.get(sq[0]['category'] if sq else s.get('category'),'参考资料'))
 for r in refs:
  if not r.get('source_id') and not r.get('sourceId') and r.get('source_file'):
   match=next((s for s in sources.values() if s.get('source_file')==r['source_file']),None)
   if match:r['source_id']=match['id']
 data={'schema_version':2,'title':'阅间 · GRE 综合训练','questions':questions,'materials':list(materials.values()),'sources':list(sources.values()),'reference_materials':refs,'statistics':stats,'pending_sources':pending,'quality_policy':'只使用本地原题与原答案。verified 表示提取内容与原键已核验；其他状态不计正式正确率。相似题不进行语义合并。'}
 APP.mkdir(exist_ok=True);(APP/'data/platform').mkdir(parents=True,exist_ok=True);(APP/'reports').mkdir(exist_ok=True)
 for name in ['gre_question_bank.json']:(APP/name).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf8')
 # Static script enables file:// without fetch or a server.
 (DIST/'platform-data.js').write_text('window.GRE_PLATFORM_DATA='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf8')
 for part in ['verbal','quant','awa']:
  p=WORK/f'{part}-bank.json'
  dest=APP/'data/platform'/p.name
  if p.exists() and p.resolve()!=dest.resolve():shutil.copy2(p,dest)
 if (WORK/'assets').exists():shutil.copytree(WORK/'assets',DIST,dirs_exist_ok=True)
 report={'counts':stats,'total':len(questions),'duplicates':dups,'quality_issues':issues,'reference_materials':refs,'pending_sources':pending,'legacy_rc_questions_preserved':sum(bool(q.get('legacy_rc_id')) for q in questions),'raw_sources_modified':False}
 (APP/'reports/gre_quality_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
 workbook(APP/'gre_import_report.xlsx',[
  ('题型统计',['题型','数量','有原答案','可判分','有解析/指导','未完整核验','来源'],[[r['title'],r['count'],r['with_answer'],r['gradable'],r['with_explanation'],r['unverified'],r['sources']] for r in stats]),
  ('来源统计',['来源ID','资料名称','来源路径','导入题数','题型','说明'],[[s['id'],s['title'],s.get('source_file'),s['imported_count'],s['types'],s.get('notes')] for s in sources.values()]),
  ('去重记录',['保留ID','合并ID','来源'],[[d['retained'],d['merged'],d['source']] for d in dups]),
  ('质量核验',['题目ID','状态','疑点','来源','页码'],[[r['question_id'],r['status'],r['notes'],r['source_file'],r['source_page']] for r in issues]),
  ('参考与未完整导入',['资料详情'],[[r] for r in refs])])
 inv=read(WORK/'library-inventory-baseline.json');inv['stage']='全库只读扫描及导入后核验';inv['import_statistics']=stats
 for row in inv['files']+inv['archive_members']:
  matches=[s for s in sources.values() if str(s.get('source_file','')).replace('\\','/')==row['source_path'].replace('\\','/') or Path(s.get('source_file','')).name==row['name']]
  if matches:
   sids={s['id'] for s in matches};qs=[q for q in questions if q['source_id'] in sids or any(r.get('source_id',r.get('sourceId')) in sids for r in q['source_refs'])]
   row['question_count']=len(qs);row['question_types']=sorted({q['question_type'] for q in qs});row['answers']=f"{sum(bool(q.get('correct_answer')) for q in qs)}题有原答案；{sum(q['gradable'] for q in qs)}题可判分";row['explanations']=f"{sum(bool(q.get('explanation') or q.get('model_essay') or q.get('guidance') or q.get('explanation_images')) for q in qs)}题有原解析/范文/指导";row['quality']='已核对来源；'+str(sum(q['answer_status']!='verified' for q in qs))+'题未完整核验，见质量报告';row['notes']=[n for s in matches for n in s.get('notes',[])]
   if not qs:row['quality']='参考/解析/扫描资料，未计为可作答题；详见来源说明';row['question_count']=None
  elif row.get('question_types')==['词汇/同义词资料']:
   row.update(question_count=0,answers='不适用',explanations='词汇资料，不作为考试题',quality='保留原资料；不由词表生成题目')
  elif row.get('role')=='项目提取结果/程序数据':
   row['notes'].append('现有项目派生文件，来源已经在原资料与统一题库中登记，避免重复计题。')
 for part in ['verbal','quant','awa']:
  p=WORK/f'inventory-{part}.json'
  if p.exists():inv.setdefault('specialist_inventory',{})[part]=read(p)
 (APP/'gre_library_inventory.json').write_text(json.dumps(inv,ensure_ascii=False,indent=2),encoding='utf8')
 fields=[('name','资料名称'),('source_path','来源路径'),('file_type','资料类型'),('question_types','题型'),('question_count','题目数量'),('answers','答案'),('explanations','解析'),('difficulty','难度/分类'),('quality','数据质量'),('duplicate_of','重复来源'),('role','资料角色'),('notes','说明')]
 workbook(APP/'gre_library_inventory.xlsx',[
  ('全资料检索',[label for _,label in fields],[[row.get(key) for key,_ in fields] for row in inv['files']]),
  ('压缩包成员',[label for _,label in fields],[[row.get(key) for key,_ in fields] for row in inv['archive_members']]),
  ('扫描说明',['项目','内容'],[[k,v] for k,v in inv['summary'].items()])])
 print(json.dumps({'total':len(questions),'by_type':stats,'duplicates':len(dups),'pending':pending},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
