"""Extract the user's white and gold reading PDFs, preserving source pages.

Run from the GRE materials directory. Only whitespace and page furniture are
normalized for display; raw page text and original PDFs are retained.
"""
from pathlib import Path
import json, re, shutil, sys, io, bisect
from library_paths import resolve_material, source_url, copy_source, normalize_material_links

ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / 'gre-reading-studio'
sys.path.insert(0, str(ROOT / 'gre800-cards/scripts/vendor'))
from pypdf import PdfReader


def tidy(text):
    return re.sub(r'\s+', ' ', text).strip()


def paragraphs(text):
    return [tidy(t) for t in re.split(r'\n[ \t]*\n', text) if tidy(t)]


def extract_source(sid, file, start, end):
    reader = PdfReader(file)
    rawpath = PROJECT / 'data/raw' / (sid + '-pages.json')
    if rawpath.exists():
        raw = json.loads(rawpath.read_text(encoding='utf-8'))
    else:
        raw = [{'page':i+1,'text':p.extract_text() or ''} for i,p in enumerate(reader.pages)]
        rawpath.parent.mkdir(parents=True, exist_ok=True)
        rawpath.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding='utf-8')
    chunks, offsets, length = [], [], 0
    for p in raw[start-1:end]:
        t = p['text']
        if sid == 'gold40':
            t = re.sub(r'^\s*\d+\s*\n', '', t, count=1)
            t = re.sub(r'^\s*(?:短文章|中文章|长文章|逻辑)\s*$', '', t, flags=re.M)
        else:
            t = re.sub(r'^\s*Unit\s+\d+\s*$', '', t, flags=re.M)
        offsets.append((length, p['page']))
        chunks.append(t + '\n')
        length += len(t) + 1
    full = ''.join(chunks)
    def page_at(pos):
        return offsets[max(0,bisect.bisect_right([o[0] for o in offsets],pos)-1)][1]
    def page_range(a,b):
        return list(range(page_at(a),page_at(max(a,b-1))+1))
    copy_source(file, sid + '.pdf')
    return reader, raw, full, page_range


def parse_passages(sid, full, page_range, marker, keys):
    starts = list(re.finditer(marker, full, re.M))
    passages=[]
    problems=[]
    for ix,m in enumerate(starts):
        num=int(m.group(1));a=m.end();b=starts[ix+1].start() if ix+1<len(starts) else len(full)
        block=full[a:b].strip(); shift=full[a:b].find(block); a+=max(0,shift)
        qstarts=list(re.finditer(r'^[ \t]*(\d{1,2})[.．][ \t]+',block,re.M))
        if not qstarts and sid=='gold40' and 25<=num<=34:
            logic=re.search(r'^[ \t]*(?:Which of the following|The argument|The reasoning|The conclusion|In the (?:argument|columnist))[^\n]*',block,re.M)
            if logic:qstarts=[logic]
        if not qstarts:
            problems.append({'passage':num,'problem':'No question boundary detected'})
            ptext=block;questions=[]
        else:
            ptext=block[:qstarts[0].start()].strip();questions=[]
            for qi,qm in enumerate(qstarts):
                qa=qm.start();qb=qstarts[qi+1].start() if qi+1<len(qstarts) else len(block)
                qtext=block[qa:qb].strip()
                number=int(qm.group(1)) if qm.lastindex else 1
                qtext=re.sub(r'^\d{1,2}[.．][ \t]+','',qtext)
                opts=list(re.finditer(r'\(([A-E])\)[ \t]*|^[ \t]*([A-E])[.．][ \t]*',qtext,re.M))
                stem=qtext[:opts[0].start()] if opts else qtext
                options=[]
                for oi,om in enumerate(opts):
                    ob=opts[oi+1].start() if oi+1<len(opts) else len(qtext)
                    ot=qtext[om.end():ob]
                    ot=re.sub(r'Consider each of the choices separately and select all that apply\.\s*$','',ot)
                    options.append({'id':om.group(1) or om.group(2),'text':tidy(ot)})
                sentence=not options and bool(re.search(r'(?:select|choose).{0,40}sentence',stem,re.I))
                kind='sentence' if sentence else ('multiple' if len(options)==3 else 'single' if options else 'open')
                key=keys.get(num,{});answers=key.get('answers',[])
                ans=answers[qi] if qi<len(answers) else None
                letter_answer=list(ans) if ans and re.fullmatch(r'[A-E]+',ans) else None
                notes=[]
                if re.search(r'highlight|boldface|bold face',stem,re.I):
                    notes.append('题干引用原文加粗或高亮内容；保留原 PDF 可核对标记。')
                if options and (len(set(o['id'] for o in options))!=len(options) or len(options) not in [3,5]):
                    notes.append('选项结构待核对原页。');problems.append({'passage':num,'question':number,'problem':'Option count/order','options':[o['id'] for o in options]})
                if letter_answer and any(x not in [o['id'] for o in options] for x in letter_answer):
                    notes.append('原答案与提取选项不一致；暂不自动评分。');letter_answer=None
                q={'id':f'{sid}-p{num:03d}-q{qi+1:02d}','number':number,'stem':tidy(stem),'options':options,'kind':kind,
                   'answer':letter_answer,'explanation':None,'pages':page_range(a+qa,a+qb),
                   'answerPages':key.get('pages',[]) if ans else [],'answerStatus':'source-key' if ans else 'unverified','notes':notes}
                if ans:q['answerText']=ans
                questions.append(q)
        key=keys.get(num,{})
        if len(key.get('answers',[])) != len(questions):
            problems.append({'passage':num,'problem':'Answer/question count mismatch','answers':key.get('answers',[]),'questions':len(questions)})
            for q in questions:
                q['answer']=None;q['answerStatus']='unverified';q['notes'].append('题目数量与答案表不一致，暂不自动评分。')
        passages.append({'id':f'{sid}-p{num:03d}','sourceId':sid,'number':num,
                         'title':f'Passage {num}' if sid=='white' else f'GWC-R{num}',
                         'text':tidy(ptext),'paragraphs':paragraphs(ptext),'pages':page_range(m.start(),b),
                         'questions':questions,'notes':[],'rawText':block})
    return passages,problems


def white_keys(raw):
    # Embedded subset font glyph order visually verified by rendering the
    # original glyph outlines (data/raw/answer-glyphs.png): 句四第 0123456789ABCDEPUint.
    # PDF's ToUnicode cmap is empty; codepoint values equal embedded glyph IDs.
    glyphs='句四第 0123456789ABCDEPUint'
    translation={i+1:c for i,c in enumerate(glyphs)}
    keys={}
    for p in raw[512:]:
        for block in p['text'].split('\x14\x04')[1:]:
            block=block.split('\x15')[0]
            number_encoded,sep,tail=block.partition(' ')
            n=int(''.join(translation[ord(c)] for c in number_encoded))
            # Physical newlines must not be decoded as the digit glyph 5.
            answers=[]
            for cell in tail.split(' '):
                letters=''.join(translation[ord(c)] for c in cell if 15<=ord(c)<=19 or 1<=ord(c)<=3)
                if letters:answers.append(letters)
            keys[n]={'answers':answers,'pages':[p['page']]}
    assert set(keys)==set(range(1,205)), 'White answer table must cover 1–204'
    # Cross-check every overlapping row with the readable duplicate table.
    for m in re.finditer(r'^\s*(19[5-9]|20[0-4])\s+([A-E ]+)$',raw[509]['text'],re.M):
        num=int(m.group(1));expected=m.group(2).split()
        assert keys[num]['answers']==expected,(num,keys[num],expected)
        keys[num]['pages'].append(510)
    (PROJECT/'data/raw/white-decoded-answers.json').write_text(json.dumps(keys,ensure_ascii=False,indent=2),encoding='utf-8')
    return keys


def gold_keys(raw):
    keys={}
    for m in re.finditer(r'^\s*(\d+)\.\s*(.*?)\s*$',raw[-1]['text'],re.M):
        ans=m.group(2).strip()
        keys[int(m.group(1))]={'answers':ans.split('/') if '/' in ans else list(ans),'pages':[45]}
    assert set(keys)==set(range(1,41))
    return keys


def gold_bold(reader,passages):
    """Retain bold source spans needed by highlighted-sentence questions."""
    for p in passages:
        spans=[]
        for pn in p['pages']:
            runs=[]
            def visitor(text,cm,tm,font,size):
                if text.strip():runs.append((text, bool(font and 'Bold' in str(font.get('/BaseFont','')))))
            reader.pages[pn-1].extract_text(visitor_text=visitor)
            current=''
            for text,bold in runs+[("",False)]:
                if bold:current+=text
                elif current:
                    s=tidy(current);current=''
                    if len(s)>15 and not s.startswith('GWC'):spans.append(s)
        compact=lambda s:re.sub(r'\s+','',s)
        p['highlightedText']=[s for s in spans if compact(s) in compact(p['text'])]


def gold_explanations(passages):
    path=PROJECT/'data/gold-answers.json'
    if not path.exists():return []
    data=json.loads(path.read_text(encoding='utf-8'))
    by_number={e['number']:e for e in data['entries']}
    for p in passages:
        entry=by_number.get(p['number'])
        if not entry:continue
        p['translation']=entry['translation']
        p['translationPages']=entry['pages']
        p['translationSourceId']='mixed-gold'
        answers={a['number']:a for a in entry['answers']}
        for q in p['questions']:
            a=answers.get(q['number'])
            if not a:continue
            q['explanation']=a['explanation']
            q['explanationPages']=a['answerPages']
            q['explanationSourceId']='mixed-gold'
            if a.get('answer') and q.get('answer') and a['answer']!=q['answer']:
                q['notes'].append('两份原资料答案不一致，暂不自动评分。')
                q['alternateAnswer']=a['answer'];q['answer']=None;q['answerStatus']='conflict'
    return [data['source']]


def main():
    all_reports=[]
    for sid,pattern,title,start,end in [('white','白皮书','GRE 阅读白皮书',8,509),('gold40','R1-R40','金皮书 · GWC 阅读 R1–R40',2,44)]:
        file=resolve_material(source_id=sid)
        reader,raw,full,page_range=extract_source(sid,file,start,end)
        keys=white_keys(raw) if sid=='white' else gold_keys(raw)
        marker=r'^[ \t]*Passage\s+(\d+)[ \t]*$' if sid=='white' else r'^[ \t]*GWC-R(\d+)[ \t]*$'
        passages,problems=parse_passages(sid,full,page_range,marker,keys)
        supplementary=[]
        if sid=='gold40':
            gold_bold(reader,passages)
            supplementary=gold_explanations(passages)
        expected=204 if sid=='white' else 40
        assert sorted(p['number'] for p in passages)==list(range(1,expected+1))
        coverage={'expectedPassages':expected,'extractedPassages':len(passages),'questions':sum(len(p['questions']) for p in passages),
                  'keyedQuestions':sum(q['answerStatus']=='source-key' for p in passages for q in p['questions']),
                  'autoGradableQuestions':sum(bool(q['answer']) for p in passages for q in p['questions']),
                  'explanations':sum(bool(q['explanation']) for p in passages for q in p['questions']),
                  'translations':sum(bool(p.get('translation')) for p in passages),
                  'answerConflicts':[q['id'] for p in passages for q in p['questions'] if q.get('alternateAnswer')],
                  'sourcePages':len(reader.pages),'contentPages':[start,end],'issues':problems}
        result={'source':{'id':sid,'title':title,'fileName':file.relative_to(ROOT).as_posix(),'pages':len(reader.pages),'path':source_url(source_id=sid),
                         'notes':['保留原始 PDF 及逐页文字。展示文字仅合并换行；原材料拼写、语法及词内空格未静默改写。','答案按原资料答案表录入，未对原答案正确性作额外保证。'],
                         'supplementarySources':supplementary},
                'passages':passages,'coverage':coverage}
        (PROJECT/'data'/(sid+'.json')).write_text(json.dumps(normalize_material_links(result),ensure_ascii=False,indent=2),encoding='utf-8')
        all_reports.append({'source':sid,**coverage})
    (PROJECT/'data/white-gold-validation.json').write_text(json.dumps(all_reports,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(all_reports,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
