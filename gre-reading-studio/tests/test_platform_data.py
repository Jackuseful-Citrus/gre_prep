"""Independent, offline acceptance checks for the final multi-subject bank.

Run from any directory with Python. This reads source artifacts and writes only
reports/platform-data-acceptance.json; it never rebuilds or edits the database.
"""
from pathlib import Path
from collections import Counter, defaultdict
import ast, copy, hashlib, json, re, sys, unicodedata, logging

APP=Path(__file__).resolve().parents[1]
ROOT=APP.parent
WORK=ROOT/'gre-upgrade-work'
DIST=APP/'dist'
sys.path.insert(0,str(ROOT/'gre800-cards/scripts/vendor'))
from pypdf import PdfReader
from PIL import Image
logging.getLogger('pypdf').setLevel(logging.ERROR)

def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
def norm(s):return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',s or '').translate(str.maketrans({'“':'"','”':'"','‘':"'",'’':"'"}))).strip()
def key_of(s):return s.get('source_id',s.get('sourceId'))
def pages_of(s):return s.get('source_page',s.get('pages',[])) or []

# Six pairs explicitly confirmed against original Quant question images. This
# closed allowlist must not grow merely because the importer labels a new pair.
CONFIRMED_IMAGE_PAIRS={
 frozenset(['gwc600-application-010','gwc600-advanced-061']),
 frozenset(['gwc600-analysis-025','gwc600-advanced-071']),
 frozenset(['gwc600-analysis-029','gwc600-advanced-122']),
 frozenset(['gwc600-analysis-035','gwc600-advanced-058']),
 frozenset(['gwc600-analysis-036','gwc600-advanced-157']),
 frozenset(['gwc600-traps-014','gwc600-advanced-084'])
}
VISUAL_REVIEWS=[
 {'pair':['gwc600-application-010','gwc600-advanced-061'],'finding':'Both original images state the same 2011–2012 Jack/Arnie salary changes, same 2012 equality, and same nearest 0.1 percent response requirement. Only question number, line spacing and watermark differ.'},
 {'pair':['gwc600-traps-014','gwc600-advanced-084'],'finding':'Both original images show Quantity A as greatest 2/(x−y), with 9≤x≤12 and −2≤y≤8, and Quantity B=2. Checked the actual advanced-084-layout.png used by the bank, not the obsolete unreferenced wider crop.'}
]

def dedup_regressions(check):
 """Run only the real builder's in-memory normalization/dedup block.

 Extract its AST before any output/copy/workbook operations. Fixtures are only
 in memory and never enter the user's question bank or original materials.
 """
 tree=ast.parse((APP/'scripts/build_platform.py').read_text('utf8'))
 main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
 def assigns(node,name):return isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id==name for t in node.targets)
 start=next(i for i,n in enumerate(main.body) if assigns(n,'sources'))
 stop=next(i for i,n in enumerate(main.body) if assigns(n,'ids'))
 fn=ast.FunctionDef(name='probe',args=ast.arguments(posonlyargs=[],args=[ast.arg(arg='banks')],kwonlyargs=[],kw_defaults=[],defaults=[]),body=copy.deepcopy(main.body[start:stop])+[ast.Return(value=ast.Name(id='questions',ctx=ast.Load()))],decorator_list=[])
 module=ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[]))
 env={'copy':copy,'hashlib':hashlib,'json':json,'norm':norm,'difficulty':lambda x:x or 'unknown'}
 exec(compile(module,'<actual-builder-dedup-probe>','exec'),env)
 def fixture(qid,status,ans,notes=None,candidates=None):
  q={'question_id':qid,'source_id':qid,'source_file':'test-fixture-only','category':'Verbal','question_type':'TC1','difficulty':'unknown','question_content':'Only an in-memory regression fixture; never a study question.','options':[{'id':c,'text':c} for c in 'ABCDE'],'correct_answer':ans,'answer_status':status,'notes':notes or [],'raw_text':'TEST ONLY'}
  if candidates:q['answer_candidates']=candidates
  return q
 def run(*qs):return env['probe']([{'sources':[{'id':q['source_id']} for q in qs],'questions':list(qs)}])[0]
 for status in ['needs_review','incomplete']:
  q=run(fixture('a',status,None),fixture('b','verified',['A']))
  check(not q['gradable'] and not q.get('correct_answer'),'dedup_regression_no_upgrade_flagged_target',status)
 q=run(fixture('a','extracted',None),fixture('b','verified',['A']))
 check(q['gradable'] and q['correct_answer']==['A'],'dedup_regression_safe_key_transfer','extracted + exact verified source')
 q=run(fixture('a','verified',['A']),fixture('b','verified',['B']))
 check(not q['gradable'] and q['answer_status']=='needs_review','dedup_regression_different_keys_disable_score','A versus B')
 alternatives=[{'answer':['A'],'source_id':'answer-book'},{'answer':['B'],'source_id':'explanation-book'}]
 flagged=fixture('b','needs_review',['A'],['独立答案册与本书解析明示答案不同，疑为版本差异；两版答案保留，不自动评分。'],alternatives)
 q=run(fixture('a','verified',['A']),flagged)
 check(not q['gradable'],'dedup_regression_incoming_conflict_disables_score','Incoming needs_review has same primary key but A/B answer_candidates; note says 不同, not 冲突.')
 traces=[q]+q.get('source_refs',[])+q.get('conflicting_sources',[])
 check(any(t.get('answer_candidates')==alternatives for t in traces),'dedup_regression_conflict_candidates_retained','Incoming alternative raw source keys must remain in canonical provenance.')
 q=run(fixture('a','extracted',None),flagged,fixture('c','verified',['A']))
 check(not q['gradable'],'dedup_regression_later_key_cannot_clear_prior_conflict','Unkeyed source + conflicting source + verified source')

def main():
 failures=[];warnings=[];checks=Counter();pdfs={};images=set()
 def check(condition,code,detail):
  checks[code]+=1
  if not condition:failures.append({'check':code,'detail':detail})
 b=read(APP/'gre_question_bank.json');questions=b['questions'];sources={s['id']:s for s in b['sources']};materials={m['id']:m for m in b['materials']};ids={q['question_id']:q for q in questions}
 quality=read(APP/'reports/gre_quality_report.json')
 old= json.loads((DIST/'data.js').read_text('utf8').split('=',1)[1].strip().removesuffix(';'))
 baseline=read(WORK/'baseline.json');inventory=read(WORK/'reports/gre_library_inventory.json')
 check(len(ids)==len(questions),'unique_question_id',len(questions))
 check(len(sources)==len(b['sources']),'unique_source_id',len(sources))
 check(len(materials)==len(b['materials']),'unique_material_id',len(materials))
 check(not b.get('pending_sources'),'no_pending_banks',b.get('pending_sources'))
 js=json.loads((DIST/'platform-data.js').read_text('utf8').split('=',1)[1].strip().removesuffix(';'))
 check(js==b,'file_and_browser_bank_equal','gre_question_bank.json / platform-data.js')

 # Original reading engine, data, styling and all vocabulary files remain intact.
 for rel,digest in baseline.items():
  if rel in ['gre-reading-studio/dist/index.html','gre-reading-studio/dist/app.js']:continue  # Navigation shell/record bridge are intentionally extended.
  p=ROOT/rel
  check(p.exists() and sha(p)==digest,'legacy_hash_preserved',rel)
 oldq={q['id']:(p,q) for p in old['passages'] for q in p['questions']}
 check(len(oldq)==3322,'legacy_expected_count',len(oldq))
 for qid,(p,q) in oldq.items():
  nq=ids.get(qid);check(nq is not None,'legacy_id_retained',qid)
  if not nq:continue
  check(nq.get('legacy_rc_id')==qid and nq.get('material_id')==p['id'],'legacy_question_material_link',qid)
  check(nq['question_content']==q['stem'] and nq['options']==q.get('options',[]) and nq['correct_answer']==q.get('answer'),'legacy_content_key_preserved',qid)
  check(materials.get(p['id'],{}).get('text')==p['text'],'legacy_passage_preserved',p['id'])
  check(nq['gradable']==bool(q.get('gradable')),'legacy_scoring_preserved',qid)
 for row in inventory['files']:
  if row.get('role')!='原始资料' or not row.get('sha256'):continue
  p=ROOT/row['source_path']
  check(p.is_file() and sha(p)==row['sha256'],'original_material_hash_preserved',row['source_path'])

 # Resolve local source documents once, including subset PDFs with original page maps.
 def source_url(s):return s.get('url') or s.get('path') or s.get('reader',{}).get('url')
 for sid,s in sources.items():
  url=source_url(s)
  check(bool(url),'source_url_present',sid)
  if not url:continue
  check(not re.match(r'^[a-z]+://',url,re.I),'offline_source_url',{'source':sid,'url':url})
  path=DIST/url.split('#')[0]
  check(path.is_file(),'source_file_exists',{'source':sid,'url':url})
  if path.is_file() and path.suffix.lower()=='.pdf':
   try:pdfs[sid]=len(PdfReader(path).pages)
   except Exception as e:check(False,'source_pdf_readable',{'source':sid,'error':str(e)})
   reader=s.get('reader',{});pm=reader.get('pageMap',s.get('pageMap',{}))
   if pm:check(all(1<=int(v)<=pdfs.get(sid,0) for v in pm.values()),'subset_page_map_valid',sid)
   elif s.get('pages'):check(pdfs.get(sid)==s['pages'],'source_pdf_page_count',{'source':sid,'declared':s.get('pages'),'actual':pdfs.get(sid)})
 def pagecheck(sid,pages,where):
  check(sid in sources,'source_reference_resolves',{'where':where,'source':sid})
  if sid not in sources:return
  s=sources[sid];maximum=s.get('pages');pm=s.get('reader',{}).get('pageMap',s.get('pageMap',{}))
  if isinstance(pages,int):pages=[pages]
  check(isinstance(pages,list),'page_list_shape',where)
  if not isinstance(pages,list):return
  for page in pages:
   if isinstance(page,dict):continue # page-backed reference material stores {page,text}.
   check(isinstance(page,int) and page>=1 and (not isinstance(maximum,int) or page<=maximum),'source_page_in_range',{'where':where,'page':page,'source':sid,'max':maximum})
   if pm:check(str(page) in pm,'subset_original_page_available',{'where':where,'page':page,'source':sid})
 def imagecheck(entry,where):
  src=entry if isinstance(entry,str) else entry.get('src') or entry.get('url')
  check(bool(src),'image_src_present',where)
  if not src:return
  path=DIST/src
  check(path.is_file(),'image_file_exists',{'where':where,'image':src})
  if path.is_file() and src not in images:
   try:
    with Image.open(path) as im:im.verify()
   except Exception as e:check(False,'image_decodable',{'image':src,'error':str(e)})
   images.add(src)

 for q in questions:
  qid=q['question_id'];typ=q['question_type'];cat=q['category'];opts=q.get('options',[]);opids=[str(o['id']) for o in opts];ans=q.get('correct_answer') or []
  check(bool(q.get('question_content','').strip()) or bool(q.get('images')),'question_visible',qid)
  check(len(opids)==len(set(opids)),'unique_option_id',qid)
  check(q['answer_status'] in ['verified','extracted','needs_review','incomplete'],'known_quality_status',qid)
  check(q['gradable']==(cat!='AWA' and q['answer_status']=='verified' and bool(ans)),'gradable_status_consistency',qid)
  pagecheck(q['source_id'],q.get('source_page',[]),qid)
  for r in q.get('source_refs',[]):pagecheck(key_of(r),pages_of(r),qid+' ref')
  for field in ['answer_source','explanation_source','guidance_source']:
   ref=q.get(field)
   if ref and key_of(ref):pagecheck(key_of(ref),pages_of(ref),qid+' '+field)
  if q.get('material_id'):check(q['material_id'] in materials,'question_material_exists',qid)
  for field in ['images','explanation_images']:
   for im in q.get(field,[]):imagecheck(im,qid+' '+field)
  if not q['gradable']:continue
  numeric=typ=='NumericEntry' or q.get('response_type')=='numeric'
  if numeric:
   check(not opts,'numeric_has_no_fake_choices',qid)
   check(bool(q.get('numeric_format')),'numeric_format_present',qid)
  else:check(set(ans)<=set(opids),'answer_options_exist',qid)
  if typ=='SE':check(len(opts)==6 and len(ans)==2 and len(set(ans))==2,'se_two_of_six',qid)
  if typ in ['TC1','TC_LEGACY','RC1','QC','QuantSingle']:check(len(ans)==1,'single_answer_cardinality',qid)
  if typ in ['TC2','TC3']:
   n=int(typ[-1]);groups=q.get('blank_groups',[])
   check(len(groups)==n and len(ans)==n and q['blank_count']==n,'tc_whole_question_shape',qid)
   gids=[o['id'] for g in groups for o in g['options']]
   check(len(gids)==len(set(gids)) and set(gids)==set(opids),'tc_unique_complete_groups',qid)
   check(all(sum(a in [o['id'] for o in g['options']] for a in ans)==1 for g in groups),'tc_one_correct_per_group',qid)
  if typ=='QC':check(len(opts)==4 and (q.get('quantities') or q.get('images')),'qc_comparison_visible',qid)
  if typ in ['QuantMultiple','RCMultiple']:check(len(ans)>=1 and len(ans)==len(set(ans)),'multiple_answer_set',qid)
  if cat!='AWA':check(bool(q.get('answer_source')),'gradable_answer_provenance',qid)
 for mid,m in materials.items():
  if m.get('source_id'):pagecheck(m['source_id'],m.get('source_page',[]),'material '+mid)
  for field in ['images','explanation_images']:
   for im in m.get(field,[]):imagecheck(im,'material '+mid+' '+field)

 # Every input item must have exactly one retained question or explicit dedup mapping.
 duplist=quality.get('duplicates',[]);dups={d['merged']:d['retained'] for d in duplist}
 check(len(dups)==len(duplist),'unique_dedup_mapping',len(duplist))
 all_input={};bankmat={};partcounts={};input_materials=[];confirmed_groups=[];unconfirmed_groups=[]
 for part in ['verbal','quant','awa']:
  p=WORK/f'{part}-bank.json';copy=APP/'data/platform'/p.name
  check(p.is_file() and copy.is_file(),'input_bank_present',part)
  if not p.exists():continue
  check(copy.is_file() and sha(copy)==sha(p),'build_uses_latest_staging_bank',part)
  inp=read(p);partcounts[part]=len(inp['questions']);all_input.update({q['question_id']:q for q in inp['questions']});bankmat.update({m['id']:m for m in inp.get('materials',[])});input_materials.extend(inp.get('materials',[]))
  confirmed_groups.extend(inp.get('confirmed_duplicate_groups',[]))
  unconfirmed_groups.extend(g.get('question_ids',[]) if isinstance(g,dict) else g for g in inp.get('do_not_merge',[])+inp.get('possible_duplicate_groups',[]))
 check({frozenset(g['question_ids']) for g in confirmed_groups}==CONFIRMED_IMAGE_PAIRS,'closed_confirmed_image_pair_allowlist','Only the six explicitly reviewed Quant pairs may differ in image paths.')
 confirmed_reasons={frozenset(g['question_ids']):g.get('reason') for g in confirmed_groups}
 methods={d['merged']:d.get('method') for d in duplist}
 for group in unconfirmed_groups:
  targets=[qid if qid in ids else dups.get(qid) for qid in group]
  check(all(t in ids for t in targets) and len(set(targets))==len(group),'unconfirmed_visual_variants_never_merged',group)
 for m in input_materials:check(materials.get(m['id'])==m,'every_input_material_preserved',m['id'])
 for qid,q in all_input.items():
  retained=qid if qid in ids else dups.get(qid)
  check(retained in ids,'every_source_question_accounted',qid)
  if retained not in ids:continue
  target=ids[retained];rs=[r for r in target.get('source_refs',[]) if r.get('question_id')==qid]
  for field in ['images','explanation_images']:
   for im in q.get(field,[]):imagecheck(im,'original '+qid+' '+field)
  # Specialist banks may already have merged AWA duplicates. Preserve those raw
  # input references too, not just the specialist bank's surviving question ID.
  for original_ref in q.get('source_refs',[]):
   same=[r for r in target.get('source_refs',[]) if r.get('question_id')==original_ref.get('question_id') and key_of(r)==key_of(original_ref) and pages_of(r)==pages_of(original_ref)]
   check(bool(same),'specialist_original_references_preserved',{'input':qid,'original_reference':original_ref.get('question_id'),'source':key_of(original_ref)})
  if qid in dups:
   check(bool(rs),'dedup_keeps_source_question_reference',qid)
   for r in rs:
    if q.get('correct_answer') and q['category']!='AWA':check(r.get('correct_answer')==q['correct_answer'],'dedup_keeps_original_key',qid)
  if qid==retained and q.get('answer_status') in ['needs_review','incomplete']:
   check(not target.get('gradable'),'never_upgrade_flagged_retained_question',qid)
  candidates=[a.get('answer') for a in q.get('answer_candidates',[]) if a.get('answer')]
  conflict=len({tuple(sorted(a)) for a in candidates})>1 or any(re.search(r'冲突|答案.*不同|不一致',str(n)) for n in q.get('notes',[]))
  if conflict:
   check(not target.get('gradable'),'conflicting_input_never_becomes_gradable',{'input':qid,'retained':retained})
   if qid in dups:
    preserved=target.get('answer_candidates') or any(r.get('answer_candidates') or r.get('notes') for r in rs)
    check(bool(preserved),'dedup_preserves_conflict_details',{'input':qid,'retained':retained})
 for qid,ret in dups.items():
  check(qid in all_input and ret in ids,'dedup_mapping_resolves',{'merged':qid,'retained':ret})
  if qid not in all_input or ret not in ids:continue
  a=all_input[qid];z=ids[ret]
  pair=frozenset([qid,ret]);confirmed=pair in CONFIRMED_IMAGE_PAIRS
  if confirmed:
   check(bool(confirmed_reasons.get(pair)) and methods.get(qid)=='逐题原图核对确认','image_pair_review_evidence_present',sorted(pair))
   check(a.get('question_type')==z.get('question_type') and a.get('options')==z.get('options') and sorted(a.get('correct_answer') or [])==sorted(z.get('correct_answer') or []),'confirmed_image_pair_type_options_answers_equal',sorted(pair))
   def raw_without_number(s):return re.sub(r'\s+','',re.sub(r'^\s*\d+\.\s*','',s or ''))
   check(raw_without_number(a.get('raw_text'))==raw_without_number(all_input[ret].get('raw_text')),'confirmed_image_pair_original_text_equal',sorted(pair))
   notes=list(z.get('notes',[]))+[n for r in z.get('source_refs',[]) for n in r.get('notes',[])]
   check(all(n in notes for n in a.get('notes',[])),'confirmed_image_pair_notes_preserved',qid)
  # Source IDs, prose line wraps and provenance may differ; question semantics and exact options may not.
  for field in ['question_type','options','blank_groups','quantities','numeric_format','instructions','images','highlights']:
   if field=='images' and confirmed:continue
   check(a.get(field)==z.get(field),'dedup_structure_identical',{'merged':qid,'retained':ret,'field':field})
  check(norm(a.get('question_content'))==norm(z.get('question_content')),'dedup_text_identical',qid)
  amat=bankmat.get(a.get('material_id'),{});zmat=materials.get(z.get('material_id'),{})
  check(norm(amat.get('text'))==norm(zmat.get('text')),'dedup_shared_material_identical',qid)
  ak,bk=a.get('correct_answer'),z.get('correct_answer')
  if ak and bk and sorted(ak)!=sorted(bk):check(not z.get('gradable'),'different_source_keys_disable_scoring',qid)
 expected=len(oldq)+sum(partcounts.values())-len(dups)
 check(expected==len(questions),'all_bank_totals_accounted',{'expected':expected,'actual':len(questions),'inputs':partcounts,'duplicates':len(dups)})
 counter=Counter(q['question_type'] for q in questions);stats={s['type']:s for s in b['statistics']}
 check(set(counter)==set(stats),'statistics_cover_every_type',{'actual_types':dict(counter),'stat_types':list(stats)})
 for typ,n in counter.items():
  rows=[q for q in questions if q['question_type']==typ];s=stats.get(typ,{})
  expected_fields={'count':n,'with_answer':sum(bool(q.get('correct_answer')) for q in rows),'gradable':sum(q['gradable'] for q in rows),'with_explanation':sum(bool(q.get('explanation') or q.get('guidance') or q.get('model_essay')) for q in rows),'unverified':sum(q['answer_status']!='verified' for q in rows)}
  for field,value in expected_fields.items():check(s.get(field)==value,'type_statistic_exact',{'type':typ,'field':field,'expected':value,'actual':s.get(field)})
 check(sum(s['count'] for s in stats.values())==len(questions),'statistics_total',len(questions))
 check(quality.get('total')==len(questions),'quality_report_total',quality.get('total'))
 for sid,src in sources.items():
  actual=sum(q['source_id']==sid or any(key_of(r)==sid for r in q.get('source_refs',[])) for q in questions)
  check(src.get('imported_count')==actual,'source_statistic_exact',{'source':sid,'expected':actual,'actual':src.get('imported_count')})
 referenced_image_count=len(images)
 # Decode even currently unreferenced source crops retained for traceability.
 for path in (DIST/'question-images').rglob('*'):
  if path.is_file() and path.suffix.lower() in ['.png','.jpg','.jpeg','.webp','.gif']:
   imagecheck(path.relative_to(DIST).as_posix(),'all local question-image assets')
 dedup_regressions(check)
 report={'passed':not failures,'question_count':len(questions),'types':dict(counter),'source_count':len(sources),'image_files_checked':len(images),'referenced_image_files_checked':referenced_image_count,'questions_with_explanation_images':sum(bool(q.get('explanation_images')) for q in questions),'pdf_files_checked':len(pdfs),'checks':dict(checks),'failure_count':len(failures),'failures':failures,'warnings':warnings,'visual_duplicate_reviews':VISUAL_REVIEWS}
 out=APP/'reports/platform-data-acceptance.json';out.parent.mkdir(exist_ok=True);out.write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf8')
 print(json.dumps({k:v for k,v in report.items() if k not in ['failures','warnings','checks']},ensure_ascii=False))
 for failure in failures[:35]:print(json.dumps(failure,ensure_ascii=False))
 if failures:raise SystemExit(1)

if __name__=='__main__':main()
