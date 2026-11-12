"""Build the independent reading library. Extraction files remain unchanged.

Only exact normalized passage/question/option matches share an answer. Formatting
sentence marks and repeated whitespace are ignored, never word boundaries.
Conflicting keys disable scoring. Fuzzy matches are deliberately not merged.
"""
import copy
import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = ['gold40', 'gwc290', 'white', 'mcgraw', 'crown', 'reading170', 'reading300', 'guide']
TOPICS = {
    '自然科学': r'\b(?:species|evolution|planet|solar|geolog\w*|biolog\w*|cell|cells|bacteria|protein|climate|ocean|earth|astronom\w*|mammal\w*|fossil\w*|physics|physicist\w*|genetic\w*|ecolog\w*|neuron\w*|organism\w*|ecosystem\w*)\b',
    '人文艺术': r'\b(?:poet\w*|poem\w*|poetry|novel\w*|literary|literature|composer\w*|music\w*|painting\w*|painter\w*|artist\w*|sculpture|drama|theater|theatre|fiction|aesthetic\w*|philosoph\w*)\b',
    '商业经济': r'\b(?:econom\w*|business\w*|market\w*|profit\w*|corporat\w*|financial|finance|consumer\w*|revenue\w*|industry|industries|unemployment|inflation|investment\w*|manufactur\w*)\b',
    '社会历史': r'\b(?:histor\w*|politic\w*|societ\w*|sociolog\w*|women|woman|gender|feminist\w*|labor|labour|colonial\w*|civil|legal|law|laws|government\w*|anthropolog\w*|archaeolog\w*|culture\w*|cultural|democra\w*|immigr\w*)\b'
}

def norm(text):
    text = re.sub(r'\bQ\d+', '', text or '')
    # Circled sentence indices are print annotations rather than sentence content.
    text = re.sub('[❶-❿①-⑳]', '', text)
    text = unicodedata.normalize('NFKC', text).translate(str.maketrans({'“':'"','”':'"','‘':"'",'’':"'"}))
    return re.sub(r'\s+', ' ', text).strip().lower()

def skill(q):
    text = q['stem'].lower()
    if q.get('kind') == 'sentence' or re.search(r'select.*sentence', text): return '选句'
    if re.search(r'weaken|undermin|call into question|cast.*doubt', text): return '削弱'
    if re.search(r'strengthen|support.*argument|support.*conclusion', text): return '加强'
    if re.search(r'assumption|depends on|argument.*assumes', text): return '假设'
    if re.search(r'boldface|highlighted|function|role|in order to|serves to', text): return '结构与作用'
    if re.search(r'main point|main idea|primary purpose|primarily concerned|best.*summari|central', text): return '主旨'
    if re.search(r'attitude|tone|skeptic|view.*best', text): return '态度'
    if re.search(r'meaning|means|refers to|most nearly', text): return '词义与指代'
    if re.search(r'infer|suggests|implies|would.*agree|most likely', text): return '推断'
    if re.search(r'explain|resolve|discrepancy|paradox', text): return '解释'
    return '细节与理解'

def topic(p):
    text = p['text'].lower()
    if len(p['questions']) == 1 and skill(p['questions'][0]) in ['加强', '削弱', '假设', '解释']:
        return '逻辑论证'
    scores = {k: len(re.findall(v, text)) for k,v in TOPICS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] else '综合阅读'

def reference(p, q=None):
    out = {k: copy.deepcopy(p.get(k)) for k in ['sourceId','number','pages','section','difficulty'] if p.get(k) is not None}
    out['passageId'] = p['id']
    if q:
        out.update({k: copy.deepcopy(q.get(k)) for k in ['answer','answerText','answerStatus','alternateAnswer','answerPages','explanation','explanationPages','explanationSourceId','notes'] if q.get(k) is not None})
        out.update(questionId=q['id'], questionNumber=q['number'], pages=q.get('pages',p['pages']))
    return out

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--exclude', nargs='*', default=[], help='Only for preview while extraction is in progress')
    args = parser.parse_args()
    sources, library, by_text, docs, audit = {}, [], {}, [], []
    original_count = original_questions = 0
    for name in NAMES:
        if name in args.exclude:
            audit.append({'source': name, 'status':'pending'})
            continue
        path = ROOT/'data'/f'{name}.json'
        if not path.exists():
            audit.append({'source': name, 'status':'pending'})
            continue
        data = json.loads(path.read_text(encoding='utf-8'))
        source = copy.deepcopy(data['source'])
        source['url'] = source.get('path') or source.get('pdfUrl') or source.get('reader',{}).get('url') or source.get('url')
        source['coverage'] = data.get('coverage',{})
        source['passageCount'] = len(data.get('passages',[]))
        source['questionCount'] = sum(len(p['questions']) for p in data.get('passages',[]))
        sources[source['id']] = source
        for extra in source.get('supplementarySources',[]) + data.get('supplementarySources',[]) + data.get('additionalSources',[]):
            extra = copy.deepcopy(extra)
            extra['url'] = extra.get('path') or extra.get('pdfUrl') or extra.get('reader',{}).get('url') or extra.get('url')
            sources[extra['id']] = extra
        docs.extend(data.get('sourceReading',[]))
        audit.append({'source':name,'status':'included','passages':source['passageCount'],'questions':source['questionCount'],'coverage':data.get('coverage')})
        for original in data.get('passages',[]):
            original_count += 1
            original_questions += len(original['questions'])
            p = copy.deepcopy(original)
            key = norm(p['text'])
            assert key, p['id']
            ref = reference(p)
            if key in by_text:
                existing = by_text[key]
                existing['references'].append(ref)
                for field in ['translation','translationPages','translationSourceId']:
                    if p.get(field) and not existing.get(field): existing[field] = p[field]
            else:
                existing = p
                existing['references'] = [ref]
                existing['questions'] = []
                existing['id'] = 'p-' + hashlib.sha256(key.encode()).hexdigest()[:14]
                existing['_questions'] = {}
                existing['highlights'] = p.get('highlights') or p.get('highlightedText') or []
                library.append(existing)
                by_text[key] = existing
            for q in original['questions']:
                # Preserve option order and labels; no semantic/fuzzy answer transfer.
                qkey = norm(q['stem']) + '|' + '|'.join(o['id']+':'+norm(o['text']) for o in q.get('options',[]))
                if re.search(r'highlight|boldface|bold.face|indicated|underlined', q['stem'], re.I):
                    highlights = original.get('highlights') or original.get('highlightedText') or []
                    marks = [norm(h if isinstance(h,str) else h.get('text','')) for h in highlights]
                    qkey += '|highlights:' + ('|'.join(sorted(marks)) if any(marks) else original['id'])
                if qkey in existing['_questions']:
                    item = existing['_questions'][qkey]
                    item['references'].append(reference(original,q))
                    if not item.get('explanation') and q.get('explanation'):
                        for field in ['explanation','explanationPages','explanationSourceId']:
                            if q.get(field): item[field] = q[field]
                else:
                    item = copy.deepcopy(q)
                    item['highlights'] = copy.deepcopy(original.get('highlights') or original.get('highlightedText') or [])
                    item['id'] = existing['id']+'-q-'+hashlib.sha256(qkey.encode()).hexdigest()[:12]
                    item['references'] = [reference(original,q)]
                    existing['_questions'][qkey] = item
                    existing['questions'].append(item)
    conflicts, invalid = [], []
    for p in library:
        del p['_questions']
        p['wordCount'] = len(re.findall(r"\b[A-Za-z]+(?:['’-][A-Za-z]+)*\b",p['text']))
        p['length'] = '短篇' if p['wordCount'] <= 180 else '中篇' if p['wordCount'] <= 350 else '长篇'
        for q in p['questions']:
            keys = {tuple(sorted(r['answer'])) for r in q['references'] if r.get('answer')}
            explicit_conflict = any('conflict' in str(r.get('answerStatus','')) or r.get('alternateAnswer') for r in q['references'])
            q['skill'] = skill(q)
            q['answer'] = list(next(iter(keys))) if len(keys)==1 and not explicit_conflict else None
            q['answerStatus'] = 'conflict' if len(keys)>1 or explicit_conflict else 'source-key' if q['answer'] else 'unverified'
            if q['answerStatus']=='conflict': conflicts.append(q['id'])
            options = {o['id'] for o in q.get('options',[])}
            if q['answer'] and not set(q['answer']) <= options:
                invalid.append(q['id']); q['answer'] = None; q['answerStatus'] = 'unverified'
                q.setdefault('notes',[]).append('原答案无法完整对应当前选项，请核对原页。')
            if q['answer'] and len(q['answer'])>1: q['kind']='multiple'
            q['gradable'] = bool(q['answer'])
        p['topic'] = topic(p)
        p['skills'] = sorted({q['skill'] for q in p['questions']})
        p['sourceIds'] = list(dict.fromkeys(r['sourceId'] for r in p['references']))
        p['gradableCount'] = sum(q['gradable'] for q in p['questions'])
        p['preview'] = re.sub('[❶-❿①-⑳]', '', p['text'])[:220]
    questions = [q for p in library for q in p['questions']]
    stats = {'passages':len(library),'questions':len(questions),'gradable':sum(q['gradable'] for q in questions),'ungraded':sum(not q['gradable'] for q in questions),'conflicts':len(conflicts),'originalPassages':original_count,'originalQuestions':original_questions,'mergedPassages':original_count-len(library),'sourceReading':len(docs),'topics':dict(Counter(p['topic'] for p in library))}
    result = {'version':1,'sources':list(sources.values()),'passages':library,'sourceReading':docs,'stats':stats,'classificationNote':'主题和题型由关键词规则自动归类；难度仅沿用原资料标记。完全一致的文章与题目合并来源，文字或选项不同的版本分别保留。'}
    (ROOT/'dist'/'data.js').write_text('window.GRE_READING_DATA='+json.dumps(result,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
    (ROOT/'data'/'build-report.json').write_text(json.dumps({'stats':stats,'conflicts':conflicts,'invalidKeys':invalid,'sources':audit},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(stats, ensure_ascii=False,indent=2))
    assert not invalid, 'Unmapped keys must be reviewed: '+str(invalid)

if __name__=='__main__': main()
