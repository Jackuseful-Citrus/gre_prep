from pathlib import Path
import sys,json
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parents[1]
m=json.loads((root/'data/mcgraw.json').read_text(encoding='utf-8'))
g=json.loads((root/'data/gold-answers.json').read_text(encoding='utf-8'))
guide=json.loads((root/'data/guide.json').read_text(encoding='utf-8'))
checks=[]
def ok(name,value):
 assert value,name
 checks.append(name)
ok('15 unique McGraw reading passages',len(m['passages'])==15 and len({p['id'] for p in m['passages']})==15)
qs=[q for p in m['passages'] for q in p['questions']]
ok('40 reading questions',len(qs)==40)
ok('Every question has exactly five labelled nonempty options',all([x['id'] for x in q['options']]==list('ABCDE') and all(x['text'] for x in q['options']) for q in qs))
ok('39 explicit source keys and one unverified sample',sum(q['answer'] is not None for q in qs)==39 and sum(q['answerStatus']=='unverified' for q in qs)==1)
ok('Every source key is in the options and has answer-page provenance',all(q['answer'][0] in list('ABCDE') and q['answerPages'] and q['explanation'] for q in qs if q['answer']))
ok('All passage and question page references are valid',all(p['pages'] and all(1<=n<=477 for n in p['pages']) for p in m['passages']) and all(q['pages'] and all(1<=n<=477 for n in q['pages']) for q in qs))
ok('No extracted formula control codes in McGraw reading text',all('/H' not in p['text'] and '/H' not in json.dumps(p['questions']) for p in m['passages']))
ok('All 40 gold book entries retained in numeric order',[p['number'] for p in g['entries']]==list(range(1,41)))
ok('All 40 translations nonempty',all(p['translation'] for p in g['entries']))
ok('90 answer entries, including 2 sentence answers',sum(len(p['answers']) for p in g['entries'])==90 and sum(q['answer'] is None for p in g['entries'] for q in p['answers'])==2)
ok('R04 Q2 preserves both source answers A and B',g['entries'][3]['answers'][1]['answer']==['A','B'])
ok('R39 source inconsistency remains visible',g['entries'][38]['answers'][2]['answer']==['B','D'] and 'B 选项对' in g['entries'][38]['answers'][2]['explanation'])
ok('Guide source reader spans all reading chapter pages',guide['source']['reader']['originalPages']==list(range(112,204)))
ok('16 guide topic groups cover chapter without gaps',sum([x['pages'] for x in guide['sourceReading']],[])==list(range(112,204)))
ok('All three source PDF artifacts exist',all((root/'dist'/d['source']['reader']['url']).exists() for d in [m,g,guide]))
report={'passed':len(checks),'checks':checks,'knownLimitations':['McGraw 2010题型示例缺原书答案，未自动判分。','备考胜经嵌入图片题通过PDF阅读模式保留。','金皮书R39第3题来源答案和解析矛盾，由gold40合并流程显式标记，不能静默改答案。']}
(root/'data/mixed-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
