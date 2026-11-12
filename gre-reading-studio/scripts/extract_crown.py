"""Structure all 219 Crown XGPR passages without inventing missing keys."""
from pathlib import Path
import json,re,sys,shutil,bisect,collections
from extract_white_gold import tidy,paragraphs,gold_bold
from library_paths import resolve_material, source_url, copy_source, normalize_material_links
ROOT=Path(__file__).resolve().parents[2]
PROJECT=ROOT/'gre-reading-studio'
sys.path.insert(0,str(ROOT/'gre800-cards/scripts/vendor'))
from pypdf import PdfReader


def main():
    pdf=resolve_material(source_id='crown')
    reader=PdfReader(pdf)
    rawpath=PROJECT/'data/raw/crown-pages.json'
    if rawpath.exists():raw=json.loads(rawpath.read_text(encoding='utf-8'))
    else:
        raw=[{'page':i+1,'text':p.extract_text() or ''} for i,p in enumerate(reader.pages)]
        rawpath.parent.mkdir(parents=True, exist_ok=True)
        rawpath.write_text(json.dumps(raw,ensure_ascii=False,indent=2),encoding='utf-8')
    full='';offsets=[];headings=[]
    for p in raw[3:]:
        t=re.sub(r'^皇冠[^\n]*\n关注[^\n]*\n\d+\s*\n','',p['text'])
        for m in re.finditer(r'^(第[一二三四]部分[^\n]*|SECTION\s+\d+[^\n]*)',t,re.M):
            headings.append((len(full)+m.start(),m.group(1).strip()))
        t=re.sub(r'^(?:第[一二三四]部分[^\n]*|SECTION\s+\d+[^\n]*)',lambda m:' '*len(m.group()),t,flags=re.M)
        offsets.append((len(full),p['page']))
        full+=t+'\n'
    def page_at(pos):return offsets[max(0,bisect.bisect_right([o[0] for o in offsets],pos)-1)][1]
    def page_range(a,b):return list(range(page_at(a),page_at(max(a,b-1))+1))
    starts=list(re.finditer(r'^[ \t]*XGPR\s*(\d+)[ \t]*$',full,re.M))
    assert len(starts)==219 and {int(m.group(1)) for m in starts}==set(range(1,220))
    passages=[];issues=[]
    for pi,m in enumerate(starts):
        n=int(m.group(1));a=m.end();b=starts[pi+1].start() if pi+1<len(starts) else len(full)
        block=full[a:b].strip();a+=full[a:b].find(block)
        qstarts=list(re.finditer(r'^[ \t]*(\d{1,2})[.)．][ \t]+',block,re.M))
        if not qstarts:
            logic=re.search(r'^[ \t]*(?:The argument is vulnerable|Which of the following|The conclusion of the argument)[^\n]*',block,re.M)
            if logic:qstarts=[logic]
        if n==51:
            # The second question is printed without its numeral in the PDF.
            missing_number=re.search(r'^The author mentions “visual artists[^\n]*',block,re.M)
            assert missing_number is not None
            qstarts.append(missing_number)
        ptext=block[:qstarts[0].start()].strip() if qstarts else block
        questions=[];pnotes=[]
        for qi,qm in enumerate(qstarts):
            qa=qm.start();qb=qstarts[qi+1].start() if qi+1<len(qstarts) else len(block)
            qraw=block[qa:qb].strip();qtext=re.sub(r'^\d{1,2}[.)．][ \t]+','',qraw)
            number=int(qm.group(1)) if qm.lastindex else qi+1
            notes=[]
            if n==51 and qi==1:notes.append('原 PDF 本题漏印题号，按篇内顺序显示为第 2 题。')
            # XGPR005 repeats E at the page break; retain raw source, normalize
            # the first inline E marker and de-duplicate only identical text.
            if n==5:
                qtext=re.sub(r'(?<=year\.) E\. ', '\nE. ', qtext)
                notes.append('原 PDF 跨页重复印出 E 选项；展示中合并相同重复项，原页与原始提取保留。')
            opts=list(re.finditer(r'\(([A-E])\)[ \t]*|^[ \t]*([A-E])[.)．][ \t]*',qtext,re.M))
            stem=qtext[:opts[0].start()] if opts else qtext
            options=[]
            for oi,om in enumerate(opts):
                ob=opts[oi+1].start() if oi+1<len(opts) else len(qtext)
                ot=qtext[om.end():ob]
                ot=re.sub(r'Consider each of the choices separately and select all that apply\.\s*$','',ot)
                candidate={'id':om.group(1) or om.group(2),'text':tidy(ot)}
                if candidate not in options:options.append(candidate)
            sentence=not options and bool(re.search(r'(?:select|choose).{0,60}sentence',stem,re.I))
            kind='sentence' if sentence else ('multiple' if len(options)==3 else 'single' if options else 'open')
            if re.search(r'highlight|boldface|bold face',stem,re.I):notes.append('题干引用原文加粗/高亮内容，可对照原文标注或 PDF。')
            if options and (len(options) not in [3,5] or len(set(o['id'] for o in options))!=len(options)):
                notes.append('原始选项结构待核对，保留原文与原页。')
                issues.append({'passage':n,'question':number,'problem':'Option count/order','ids':[o['id'] for o in options]})
            if not options and not sentence:
                notes.append('题目未能确认选项结构，请结合原页阅读。')
                issues.append({'passage':n,'question':number,'problem':'Open/no choices','stem':tidy(stem)[:150]})
            questions.append({'id':f'crown-p{n:03d}-q{qi+1:02d}','number':number,'stem':tidy(stem),'options':options,
                              'kind':kind,'answer':None,'explanation':None,'pages':page_range(a+qa,a+qb),'answerPages':[],
                              'answerStatus':'unverified','notes':notes})
        if not questions:
            pnotes.append('正文题目边界待核对，请查看原页。');issues.append({'passage':n,'problem':'No question boundary'})
        # Determine the original group at the passage's position; book ordering
        # is not numeric because version 4.0 additions appear within sections.
        section='';part=''
        for pos,heading in headings:
            if pos>m.start():break
            if heading.startswith('第'):part=heading
            else:section=heading
        ptext=re.sub(r'Consider each of the choices separately and select all that apply\.\s*$','',ptext)
        passages.append({'id':f'crown-p{n:03d}','sourceId':'crown','number':n,'title':f'XGPR{n:03d}',
                         'text':tidy(ptext),'paragraphs':paragraphs(ptext),'questions':questions,
                         'pages':page_range(m.start(),a+len(block)),'notes':pnotes,'rawText':block,
                         'sourceSection':part+' · '+section})
    gold_bold(reader,passages)
    coverage={'sourcePages':len(reader.pages),'expectedPassages':219,'extractedPassages':len(passages),
              'questions':sum(len(p['questions']) for p in passages),'keyedQuestions':0,
              'numberedQuestionMarkers':len(re.findall(r'^\s*\d{1,2}[.)．]\s+',full,re.M)),
              'unnumberedQuestions':4,
              'issues':issues}
    source={'id':'crown','title':'皇冠 GRE 高频阅读 4.0','fileName':'皇冠GRE阅读篇4.0版.pdf',
            'archivePath':'Archive.zip / 皇冠GRE阅读篇4.0版.pdf','pages':175,'path':source_url(source_id='crown'),
            'notes':['从用户文件夹内 Archive.zip 提取。全部 XGPR001–XGPR219 均保留。',
                     '资料要求到公众号获取答案；本地文件未附答案，本来源不提供推测答案。',
                     '保留原 PDF、逐页文字与篇目 rawText；仅清理页眉、页码、栏目标题及显示换行。']}
    (PROJECT/'data/crown.json').write_text(json.dumps(normalize_material_links({'source':source,'passages':passages,'coverage':coverage}),ensure_ascii=False,indent=2),encoding='utf-8')
    (PROJECT/'data/crown-validation.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2),encoding='utf-8')
    copy_source(pdf, 'crown.pdf')
    print(json.dumps(coverage,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
