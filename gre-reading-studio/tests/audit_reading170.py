from pathlib import Path
import sys,json,re
sys.stdout.reconfigure(encoding='utf-8')
P=Path(__file__).resolve().parents[1]
d=json.loads((P/'data/reading170.json').read_text(encoding='utf-8'));ps=d['passages'];qs=[q for p in ps for q in p['questions']];checks=[]
def ok(name,value):
 assert value,name
 checks.append(name)
ok('Actual source has 249 stimuli and 507 questions',len(ps)==249 and len(qs)==507)
ok('Unique passage and question IDs',len({p['id'] for p in ps})==len(ps) and len({q['id'] for q in qs})==len(qs))
ok('All passage bodies and question stems are nonempty',all(len(p['text'])>80 for p in ps) and all(q['stem'] for q in qs))
ok('Main reading numbers cover 1 through 139 exactly',[p['number'] for p in ps[:139]]==list(range(1,140)))
ok('39 practice-test stimuli, including eight logical questions',len(ps[139:178])==39 and sum(len(p['questions'])==1 for p in ps[139:178])==8)
ok('71 actual logical-booklet questions; no phantom explanation #10',len(ps[178:])==71 and not any(p['sourceKey']=='logic-解释题-10' for p in ps))
ok('Original answer-table count equals extracted question count',not d['coverage']['warnings'])
ok('All selectable answers exist in their options',all(q['answer'] and set(q['answer'])<=set(o['id'] for o in q['options']) for q in qs))
ok('Choice questions use complete ABC or ABCDE sequences',all([o['id'] for o in q['options']] in [list('ABC'),list('ABCDE')] for q in qs if q['kind']!='sentence'))
ok('All 507 questions include source explanation and provenance',all(q['explanation'] and q['explanationPages'] and q['answerPages'] and q['pages'] for q in qs))
ok('All 249 stimuli include the original Chinese translation',all(p['translation'] for p in ps))
ok('Every highlight is a literal substring of its passage',all(h in p['text'] for p in ps for h in p['highlights']))
ok('All nine boldface problems retain two or more emphasized fragments',all(len(p['highlights'])>=2 for p in ps if p['section']=='逻辑 · Boldface'))
ok('Missing paragraph break on PDF223 is repaired at the original sentence boundary',next(p for p in ps if p['sourceKey']=='logic-解释题-4')['text'].startswith('Observations of the Arctic') and 'Observations' not in next(p for p in ps if p['sourceKey']=='logic-解释题-3')['questions'][0]['options'][-1]['text'])
ok('Difficulty values are sourced from exact table rows',sum(bool(p.get('difficultySource')) for p in ps)==178 and all(1<=float(p['difficulty'])<=5 for p in ps if p.get('difficulty') is not None))
ok('Sentence selection preserves paragraph-specific answer mapping',next(p for p in ps if p['sourceKey']=='main-115')['questions'][0]['answer']==['S5'])
ok('Complete exercise and explanation PDFs and original difficulty workbook exist',all((P/'dist/sources'/n).exists() for n in ['reading170-exercises.pdf','reading170-explained.pdf','difficulty.xlsx']))
report={'passed':len(checks),'checks':checks,'passages':len(ps),'questions':len(qs),'sentenceQuestions':sum(q['kind']=='sentence' for q in qs),'highlightedPassages':sum(bool(p['highlights']) for p in ps),'notes':['The exercise source filename advertises 80 logical questions, but the actual file has 79: 71 booklet plus 8 practice-test logic stimuli. An orphan explanation #10 answer exists only in the key. No question text was invented.','All answer letters come from the original key and agree with the matched explanation book. This is source-consistency verification, not independent adjudication of the publisher’s answer quality.']}
(P/'data/reading170-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
