'use strict';
(() => {
  const DATA = window.GRE_READING_DATA;
  const KEY = 'gre-reading-studio-progress-v1';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if (!DATA?.passages?.length) { $('#content').textContent = '题库尚未加载，请确认 data.js 与网页位于同一文件夹。'; return; }
  const passages = new Map(DATA.passages.map(p => [p.id,p]));
  const sources = new Map(DATA.sources.map(s => [s.id,s]));
  const questions = new Map(DATA.passages.flatMap(p => p.questions.map(q => [q.id,{q,p}])));
  const emptyState = () => ({version:1,questions:{},bookmarks:[],notes:{},notesUpdatedAt:{},history:[],session:null,updatedAt:0});
  let state = emptyState(), storageAvailable = true, storageWarning = '', toastTimer;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = validateState(JSON.parse(raw));
  } catch (err) { storageAvailable = false; storageWarning = '学习记录未能读取。请先导出当前记录，并检查浏览器存储权限；原有存储不会被覆盖。'; }
  let view = 'library', page = 1, reviewTab = 'wrong';
  const filters = {search:'',topic:'全部主题',source:'',skill:'',length:'',status:'',gradable:false};
  const searchText = new Map(DATA.passages.map(p=>[p.id,[p.title,p.text,...p.questions.map(q=>q.stem)].join(' ').toLowerCase()]));
  function validateState(input) {
    if (!input || input.version !== 1 || !input.questions || typeof input.questions !== 'object' || Array.isArray(input.questions) || !Array.isArray(input.bookmarks) || !Array.isArray(input.history)) throw Error('不兼容的记录格式');
    const out=emptyState();
    for (const [id,r] of Object.entries(input.questions)) {
      if (!questions.has(id) || !r || !Number.isFinite(r.attempts) || r.attempts < 0 || !Number.isFinite(r.lastAt)) continue;
      const attempts=Math.floor(r.attempts),graded=Number.isFinite(r.graded)?Math.min(attempts,Math.max(0,Math.floor(r.graded))):0,correct=Number.isFinite(r.correct)?Math.min(graded,Math.max(0,Math.floor(r.correct))):0;
      out.questions[id]={attempts,correct,graded,lastAt:r.lastAt,lastCorrect:typeof r.lastCorrect==='boolean'?r.lastCorrect:null,uncertain:r.uncertain===true,selected:Array.isArray(r.selected)?r.selected.filter(x=>typeof x==='string').slice(0,30):[],typed:typeof r.typed==='string'?r.typed.slice(0,5000):''};
    }
    out.bookmarks=[...new Set(input.bookmarks.filter(id=>passages.has(id)))];
    for (const [id,note] of Object.entries(input.notes||{})) if(passages.has(id)&&typeof note==='string')out.notes[id]=note.slice(0,10000);
    out.history=input.history.filter(h=>h&&questions.has(h.qid)&&Number.isFinite(h.at)&&(h.correct===null||typeof h.correct==='boolean')).slice(-30000).map(h=>({qid:h.qid,at:h.at,correct:h.correct,uncertain:h.uncertain===true}));
    const s=input.session;
    if(s&&Array.isArray(s.ids)&&s.ids.length&&s.ids.every(id=>passages.has(id))&&Number.isFinite(s.startedAt)){
      const ids=s.ids.slice(0,100),index=Number.isFinite(s.index)?Math.max(0,Math.min(Math.trunc(s.index),ids.length-1)):0;
      const questionIndex=Number.isFinite(s.questionIndex)?Math.max(0,Math.min(Math.trunc(s.questionIndex),passages.get(ids[index]).questions.length-1)):0;
      out.session={ids,index,questionIndex,startedAt:s.startedAt,endedAt:Number.isFinite(s.endedAt)?s.endedAt:null,limitMinutes:Number.isFinite(s.limitMinutes)?Math.max(0,Math.min(180,s.limitMinutes)):0,answers:{},drafts:{}};
      const sessionQuestionIds=new Set(ids.flatMap(id=>passages.get(id).questions.map(q=>q.id)));
      for(const [id,a] of Object.entries(s.answers||{}))if(sessionQuestionIds.has(id)&&a&&Array.isArray(a.selected))out.session.answers[id]={selected:a.selected.filter(x=>typeof x==='string'),typed:typeof a.typed==='string'?a.typed.slice(0,5000):'',correct:typeof a.correct==='boolean'?a.correct:null,uncertain:a.uncertain===true};
      for(const [id,a] of Object.entries(s.drafts||{}))if(sessionQuestionIds.has(id)&&a)out.session.drafts[id]={selected:Array.isArray(a.selected)?a.selected.filter(x=>typeof x==='string'):[],typed:typeof a.typed==='string'?a.typed.slice(0,5000):'',uncertain:a.uncertain===true};
    }
    out.updatedAt=Number.isFinite(input.updatedAt)?input.updatedAt:Math.max(0,...out.history.map(h=>h.at));
    for(const [id,at]of Object.entries(input.notesUpdatedAt||{}))if(passages.has(id)&&Number.isFinite(at))out.notesUpdatedAt[id]=at;
    return out;
  }
  let savedContent=JSON.stringify({...state,updatedAt:0});
  function persist({preserveTimestamp=false,silent=false,force=false,refresh=true}={}) {
    const content=JSON.stringify({...state,updatedAt:0}),changed=content!==savedContent;
    if(!changed&&!force)return storageAvailable;
    if(changed&&!preserveTimestamp)state.updatedAt=Date.now();
    savedContent=content;
    if(storageAvailable)try { localStorage.setItem(KEY,JSON.stringify(state)); }
    catch (e) { storageAvailable=false; storageWarning='浏览器无法保存记录；可在学习记录页导出备份。'; toast(storageWarning); }
    if(refresh)updateRail();
    if(!silent)window.dispatchEvent(new CustomEvent('gre-rc-progress'));
    if(changed&&!silent&&!preserveTimestamp)window.GREPortable?.changed();
    return storageAvailable;
  }
  function toast(message) { clearTimeout(toastTimer); $('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3800); }
  function updateRail(){const n=Object.keys(state.questions).length;$('#side-count').textContent=`${n} / ${DATA.stats.questions}`;$('#side-bar').style.width=`${Math.min(100,n/DATA.stats.questions*100)}%`;$('#resume').hidden=!state.session||!!state.session.endedAt||view==='study';}
  function setHeader(title,desc,kicker='READING STUDIO'){ $('#page-title').textContent=title;$('#page-description').textContent=desc;$('#page-kicker').textContent=kicker; }
  function navigate(next){view=next;page=1;render();window.scrollTo({top:0});}
  function render(){
    document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'page':'false');});
    if(view==='study')renderStudy();else if(view==='sources')renderSources();else if(view==='progress')renderProgress();else renderLibrary();
    updateRail();
  }
  const sourceTitle=id=>sources.get(id)?.title||id;
  const shortSource=id=>({'gold40':'金皮书','gwc290':'GWC 290','white':'阅读白皮书','mcgraw':'McGraw-Hill','crown':'皇冠阅读','reading170':'阅读 170','reading300':'阅读 300','guide':'备考胜经'}[id]||sourceTitle(id));
  function pdfLink(sourceId,pages=[]) {
    const s=sources.get(sourceId); if(!s)return '#';
    const url=s.url||s.path||s.pdfUrl||s.reader?.url;
    const local=typeof url==='string'&&url.startsWith('../../materials/sources/')?url.slice('../../materials/'.length):url;
    if(!local||!/^sources\/[a-zA-Z0-9._/-]+\.pdf$/.test(local)||local.split('/').includes('..'))return '#';
    const p=pages[0]||1, mapped=s.reader?.pageMap?.[p]||p;
    return `${url}#page=${mapped}`;
  }
  function sourceLinks(refs,answer=false){return refs.map(r=>{const pages=answer?r.answerPages:r.pages;return pages?.length?`<a target="_blank" rel="noopener" href="${esc(pdfLink(r.sourceId,pages))}">${esc(shortSource(r.sourceId))} · 原 PDF 第 ${esc(pages.join('、'))} 页 ↗</a>`:'';}).join('');}
  const isReview=q=>state.questions[q.id]&&(state.questions[q.id].lastCorrect===false||state.questions[q.id].uncertain);
  function filtered(){
    const text=filters.search.trim().toLowerCase();
    return DATA.passages.filter(p=>{
      if(view==='review'&&(reviewTab==='saved'?!state.bookmarks.includes(p.id):!p.questions.some(isReview)))return false;
      if(text&&!searchText.get(p.id).includes(text))return false;
      if(filters.topic!=='全部主题'&&p.topic!==filters.topic)return false;
      if(filters.source&&!p.sourceIds.includes(filters.source))return false;
      if(filters.skill&&!p.skills.includes(filters.skill))return false;
      if(filters.length&&p.length!==filters.length)return false;
      if(filters.gradable&&p.gradableCount!==p.questions.length)return false;
      const done=p.questions.filter(q=>state.questions[q.id]).length;
      return !filters.status||(filters.status==='new'?done===0:filters.status==='done'?done===p.questions.length:done>0&&done<p.questions.length);
    });
  }
  function options(values,chosen,label){return `<option value="">${label}</option>`+values.map(v=>{const [id,text]=Array.isArray(v)?v:[v,v];return `<option value="${esc(id)}" ${chosen===id?'selected':''}>${esc(text)}</option>`;}).join('');}
  function filterMarkup(){return `<div class="filters"><label class="field">搜索原文或题干<input id="search" data-filter="search" type="search" placeholder="例如：evolution、poetry…" value="${esc(filters.search)}"></label><label class="field">资料来源<select data-filter="source">${options(DATA.sources.filter(s=>s.passageCount).map(s=>[s.id,s.title]),filters.source,'全部来源')}</select></label><label class="field">题目考法<select data-filter="skill">${options([...new Set(DATA.passages.flatMap(p=>p.skills))].sort(),filters.skill,'全部题型')}</select></label><label class="field">文章篇幅<select data-filter="length">${options(['短篇','中篇','长篇'],filters.length,'全部篇幅')}</select></label><label class="field">学习状态<select data-filter="status">${options([['new','未练习'],['partial','练习中'],['done','已练习']],filters.status,'全部状态')}</select></label></div>`;}
  function card(p){
    const done=p.questions.filter(q=>state.questions[q.id]).length,saved=state.bookmarks.includes(p.id),r=p.references[0];
    const title=p.title&&p.title.length>22?p.title:p.preview.split(/(?<=[.!?])\s/)[0];
    return `<article class="reading-card"><div class="card-top"><span class="card-no">${esc(shortSource(r.sourceId))} · ${esc(r.number??'')} ${p.sourceIds.length>1?` / ${p.sourceIds.length} 个来源`:''}</span><button class="bookmark ${saved?'saved':''}" data-bookmark="${p.id}" aria-label="${saved?'取消收藏':'收藏文章'}" aria-pressed="${saved}">${saved?'★':'☆'}</button></div><h3>${esc(title)}</h3><p class="preview" lang="en">${esc(p.preview)}</p><div class="tags"><span class="tag">${esc(p.topic)}</span><span class="tag neutral">${p.length} · ${p.wordCount} 词</span>${p.questions.length>p.gradableCount?'<span class="tag warm">含待核验答案</span>':''}${r.difficulty?`<span class="tag neutral">${esc(r.difficulty)}</span>`:''}</div><div class="card-bottom"><span class="tiny">${p.questions.length} 题 · ${done?`已练 ${done} 题`:'未练习'}</span><button class="text-link" data-open="${p.id}">开始阅读 →</button></div></article>`;
  }
  function libraryResults(){const list=filtered();const pageCount=Math.max(1,Math.ceil(list.length/12));page=Math.min(page,pageCount);return `<div class="library-heading"><h2>${view==='review'?(reviewTab==='saved'?'收藏的文章':'需要再读一次'):'全部阅读'} <span class="muted">/ ${list.length} 篇</span></h2><div class="row"><label><input type="checkbox" data-filter="gradable" ${filters.gradable?'checked':''}>仅可自动评分</label><button class="text-link" data-action="clear-filters">重置筛选</button></div></div>${list.length?`<div class="cards">${list.slice((page-1)*12,page*12).map(card).join('')}</div><div class="pager"><button class="button secondary small" data-page="${page-1}" ${page===1?'disabled':''}>← 上一页</button><span>${page} / ${pageCount}</span><button class="button secondary small" data-page="${page+1}" ${page===pageCount?'disabled':''}>下一页 →</button></div>`:'<div class="empty"><h2>这里暂时很安静。</h2><p>调整筛选条件，或先完成一篇阅读。</p></div>'}`;}
  function renderLibrary(){
    const reviewing=view==='review';setHeader(reviewing?'把模糊的思路，再读清楚。':'在字里行间，找到思路。',reviewing?'答错或答对但不确定的题目，都会留在这里。':'从一篇开始。读文章、找依据，再核对原书答案。','A LITTLE READING, EVERY DAY');
    const topics=['全部主题',...Object.keys(DATA.stats.topics)];
    $('#content').innerHTML=`${storageWarning?`<div class="notice">${esc(storageWarning)}</div>`:''}${reviewing?`<div class="topic-tabs"><button data-review="wrong" class="topic-tab ${reviewTab==='wrong'?'active':''}">错题与不确定</button><button data-review="saved" class="topic-tab ${reviewTab==='saved'?'active':''}">我的收藏 <small>${state.bookmarks.length}</small></button></div>`:`<section class="hero"><div class="hero-copy"><p class="eyebrow">MAKE ROOM FOR A GOOD PASSAGE</p><h2>今天，也给阅读留一点时间。</h2><p>按自己的节奏练习。在文章与选项之间，练习定位信息、理解逻辑和判断依据。</p><div class="practice-setup"><label class="field">本次篇数<input id="batch-count" type="number" min="1" max="30" value="3"></label><label class="field">计时（分钟）<select id="batch-minutes"><option value="0">自由练习</option><option value="5">5 分钟</option><option value="10">10 分钟</option><option value="20">20 分钟</option><option value="30">30 分钟</option></select></label><button class="button" data-action="random">随机开练 ↗</button></div><p class="source-note">从当前筛选结果中抽取；设定计时后，到时提醒，可继续完成。</p></div><div class="hero-side"><label>YOUR READING LIBRARY</label><div class="hero-numbers"><strong>${DATA.stats.passages}</strong><span>篇 /</span><strong>${DATA.stats.questions}</strong><span>题</span></div><p class="tiny">${DATA.stats.gradable} 题可按原书答案评分<br>${DATA.stats.ungraded} 题保留原页，待核验或自行比对</p></div></section>`}<div class="topic-tabs">${topics.map(t=>`<button class="topic-tab ${filters.topic===t?'active':''}" data-topic="${esc(t)}">${esc(t)}<small>${t==='全部主题'?DATA.stats.passages:DATA.stats.topics[t]}</small></button>`).join('')}</div>${filterMarkup()}<div id="library-results">${libraryResults()}</div><p class="source-note">${esc(DATA.classificationNote)}</p>`;
  }
  function shuffle(arr){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  function start(ids,limitMinutes=0){if(!ids.length){toast('没有符合筛选条件的文章。');return;}state.session={ids,index:0,questionIndex:0,startedAt:Date.now(),endedAt:null,limitMinutes,answers:{},drafts:{}};persist();navigate('study');}
  function active(){const s=state.session,p=passages.get(s.ids[s.index]);s.questionIndex=Math.min(s.questionIndex,p.questions.length-1);return {s,p,q:p.questions[s.questionIndex]};}
  function markedParagraph(text,p){
    const highlights=(active().q.highlights||p.highlights||[]).map(h=>typeof h==='string'?h:h?.text).filter(Boolean),ranges=[];
    for(const h of highlights){let at=text.indexOf(h);while(at!==-1){ranges.push([at,at+h.length]);at=text.indexOf(h,at+h.length);}}
    ranges.sort((a,b)=>a[0]-b[0]);const merged=[];for(const r of ranges){const last=merged.at(-1);if(last&&last[1]>=r[0])last[1]=Math.max(last[1],r[1]);else merged.push([...r]);}
    let output='',at=0;for(const [start,end]of merged){output+=esc(text.slice(at,start))+`<mark>${esc(text.slice(start,end))}</mark>`;at=end;}return (output+esc(text.slice(at))).replace(/\bQ(\d+)(?=[A-Za-z])/g,'<sup class="question-marker" title="原资料题号定位标记">Q$1</sup>');
  }
  function renderStudy(){
    if(!state.session){navigate('library');return;}
    if(state.session.endedAt){renderSummary();return;}
    const {s,p,q}=active(),a=s.answers[q.id],d=s.drafts[q.id]||{selected:[],typed:'',uncertain:false};
    setHeader('沉下心，读懂这一篇。',`${p.topic} · ${p.length} · ${p.wordCount} 词`,'FOCUS ON THE PASSAGE');
    const highlights=(q.highlights||p.highlights||[]).map(h=>typeof h==='string'?h:h?.text).filter(Boolean);
    $('#content').innerHTML=`<div class="study-toolbar"><div class="row"><button class="text-link" data-view="library">← 返回题库</button><span class="tiny">本次第 ${s.index+1} / ${s.ids.length} 篇</span><span class="tag">${esc(shortSource(p.references[0].sourceId))}</span></div><div class="row"><span class="timer" id="timer"></span><button class="button secondary small" data-bookmark="${p.id}">${state.bookmarks.includes(p.id)?'★ 已收藏':'☆ 收藏文章'}</button><button class="button ghost small" data-action="finish">结束本次</button></div></div><div class="study-layout"><article class="panel passage-panel"><div class="row space-between"><span class="eyebrow">PASSAGE ${esc(p.references[0].number??'')}</span><span class="tag neutral">${esc(p.topic)}</span></div><h2>${esc(p.title)}</h2><div class="passage-text" lang="en">${(p.paragraphs?.length?p.paragraphs:[p.text]).map((t,i)=>`<p><span class="paragraph-number">${String(i+1).padStart(2,'0')}</span>${markedParagraph(t,p)}</p>`).join('')}</div>${highlights.length?`<details class="annotation"><summary>原文加粗 / 高亮片段（${highlights.length}）</summary>${highlights.map(h=>`<p lang="en">${esc(h)}</p>`).join('')}</details>`:''}${p.notes?.length?`<details class="annotation"><summary>原材料说明</summary><ul>${p.notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul></details>`:''}<div class="original-links">${sourceLinks(p.references)}</div>${p.translation?`<details class="annotation"><summary>展开配套原书译文</summary><p>${esc(p.translation)}</p></details>`:''}<details class="annotation"><summary>我的阅读笔记 ${state.notes[p.id]?'· 已记录':''}</summary><label class="field"><span>写下定位依据、段落逻辑或易错点</span><textarea id="reading-note" data-note="${p.id}" maxlength="10000" placeholder="例如：转折后的句子才是作者观点…">${esc(state.notes[p.id]||'')}</textarea></label><div class="notes-save" id="note-status">输入后自动保存</div></details></article><div><section class="panel question-panel"><div class="row space-between"><h2>Question ${s.questionIndex+1}<span class="muted"> / ${p.questions.length}</span></h2><span class="tag">${esc(q.skill)}</span></div><p class="question-stem" lang="en">${esc(q.stem)}</p><p class="question-kind">${q.kind==='multiple'?'多选题 · 选择所有符合的选项':q.kind==='sentence'?'选句题 · 选择或写下对应原句':'单选题 · 选择一个答案'}${!q.gradable?' · 本题不计自动正确率':''}</p>${q.options?.length?`<div class="options">${q.options.map(o=>{const selected=(a?.selected||d.selected).includes(o.id),correct=a&&q.answer?.includes(o.id),incorrect=a&&q.gradable&&selected&&!correct;return `<button class="option ${q.kind==='multiple'?'multiple':''} ${selected?'selected':''} ${correct?'correct':''} ${incorrect?'incorrect':''}" data-option="${esc(o.id)}" aria-pressed="${selected}" ${a?'disabled':''}><span class="option-key">${esc(o.id)}</span><span class="option-text" lang="en">${esc(o.text)}</span></button>`;}).join('')}</div>`:`<label class="field">记录你的答案（例如：第二段第三句，或粘贴原句）<textarea id="typed-answer" maxlength="5000" ${a?'disabled':''}>${esc(a?.typed||d.typed)}</textarea></label>`}${a?feedback(q,a):`<div class="submit-row"><label class="confidence"><input type="checkbox" id="uncertain" ${d.uncertain?'checked':''}>这题我还不太确定</label><button class="button" id="submit-answer" data-action="submit" ${d.selected.length||d.typed.trim()?'':'disabled'}>${q.gradable?'提交答案':'记录并查看原资料'} →</button></div>`}<div class="question-pager"><button class="button ghost small" data-question="${s.questionIndex-1}" ${s.questionIndex===0?'disabled':''}>← 上一题</button><button class="button secondary small" data-question="${s.questionIndex+1}" ${s.questionIndex===p.questions.length-1?'disabled':''}>下一题 →</button></div><div class="question-dots" aria-label="题目导航">${p.questions.map((item,i)=>{const result=s.answers[item.id];return `<button data-question="${i}" class="${i===s.questionIndex?'active':''} ${result?(result.correct===false?'wrong':'done'):''}" aria-label="第 ${i+1} 题${result?'，已作答':''}" ${i===s.questionIndex?'aria-current="step"':''}>${i+1}</button>`;}).join('')}</div></section><div class="study-bottom"><button class="button secondary" data-passage="${s.index-1}" ${s.index===0?'disabled':''}>← 上一篇</button>${s.index<s.ids.length-1?`<button class="button" data-passage="${s.index+1}">下一篇 →</button>`:'<button class="button" data-action="finish">完成本次练习 ✓</button>'}</div><p class="source-note">题型和主题为自动归类。原资料答案保留；启用 API 后，缺失的答案或解析会在提交后自动补充。</p></div></div>`;
    tick();
  }
  function feedback(q,a){return originalFeedback(q,a)+(window.GREQuestionAI?.legacyPanelHTML(q.id)||'');}
  function originalFeedback(q,a){
    const title=a.correct===true?(a.uncertain?'答对了，再巩固一次。':'答对了，思路很清楚。'):a.correct===false?'再看一眼，依据藏在哪里？':q.answerStatus==='conflict'?'不同资料的答案有冲突。':'已记录，回到原文核对。';
    const answer=q.answer?.join('、')||q.answerText||q.references.map(r=>r.answerText).filter(Boolean).join(' / ');
    return `<section class="feedback ${a.correct===false?'wrong':a.correct===null?'ungraded':''}" aria-live="polite"><h3>${title}</h3>${answer?`<p class="answer">${q.answerStatus==='conflict'?'所选版本印刷答案':'原资料答案'}：${esc(answer)}</p>`:'<p>本地资料未提供可确认的答案；此题保留作答记录，不计入正确率。</p>'}${a.correct===null?'<p>本题未自动判分。可通过下面的原页入口检查答案与排版。</p>':''}${a.uncertain?'<p>已加入「错题与不确定」，下次可以再练。</p>':''}${q.explanation?`<details open><summary>原书解析</summary><p>${esc(q.explanation)}</p>${q.explanationSourceId?`<div class="original-links">${sourceLinks([{sourceId:q.explanationSourceId,pages:q.explanationPages}])}</div>`:''}</details>`:'<p>此版本未附逐题解析。</p>'}${q.notes?.length?`<details><summary>题目核验说明</summary>${q.notes.map(n=>`<p>${esc(n)}</p>`).join('')}</details>`:''}<details><summary>查看答案出处与不同版本</summary>${q.references.map(r=>`<p>${esc(sourceTitle(r.sourceId))}：${esc(r.answer?.join('、')||r.answerText||'未附答案')} ${r.answerStatus==='conflict'?'（来源冲突）':''}</p>`).join('')}<div class="original-links">${sourceLinks(q.references,true)}${sourceLinks(q.references)}</div></details><div class="row" style="margin-top:13px"><button class="text-link" data-action="retry">重新作答</button></div></section>`;
  }
  function draft(){const {s,q}=active();return s.drafts[q.id] ||= {selected:[],typed:'',uncertain:false};}
  function submit(){
    const {s,p,q}=active();if(s.answers[q.id])return;const d=draft();if(!d.selected.length&&!d.typed.trim())return;
    const correct=q.gradable&&q.answer?d.selected.length===q.answer.length&&q.answer.every(id=>d.selected.includes(id)):null;
    const a={selected:[...d.selected],typed:d.typed,uncertain:d.uncertain,correct};s.answers[q.id]=a;
    const old=state.questions[q.id]||{attempts:0,correct:0,graded:0};state.questions[q.id]={attempts:old.attempts+1,correct:old.correct+(correct===true?1:0),graded:old.graded+(correct!==null?1:0),lastAt:Date.now(),lastCorrect:correct,uncertain:d.uncertain,selected:[...d.selected],typed:d.typed};
    state.history.push({qid:q.id,at:Date.now(),correct,uncertain:d.uncertain});state.history=state.history.slice(-30000);persist();renderStudy();
  }
  function tick(){const el=$('#timer');if(!el||!state.session)return;const elapsed=Math.max(0,Math.floor(((state.session.endedAt||Date.now())-state.session.startedAt)/1000)),limit=state.session.limitMinutes*60,remaining=limit-elapsed;el.textContent=limit?(remaining<0?'已超时 ':'剩余 ')+formatTime(Math.abs(remaining)):'用时 '+formatTime(elapsed);if(limit&&remaining<0)el.style.color='#a57744';}
  const formatTime=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  function stat(label,value,note){return `<div class="stat"><label>${label}</label><strong>${value}</strong><small>${note}</small></div>`;}
  function renderSummary(){
    const s=state.session,ans=Object.values(s.answers),graded=ans.filter(a=>a.correct!==null),correct=graded.filter(a=>a.correct),total=s.ids.reduce((n,id)=>n+passages.get(id).questions.length,0);
    setHeader('读过的每一篇，都有收获。','记录已保存在当前浏览器，可以随时返回复习。','SESSION COMPLETE');
    $('#content').innerHTML=`<section class="panel session-summary"><p class="eyebrow">ONE STEP AT A TIME</p><h2>本次练习完成</h2><p class="muted">${s.ids.length} 篇文章 · 用时 ${formatTime(Math.floor((s.endedAt-s.startedAt)/1000))}</p><div class="stats">${stat('已作答',ans.length,`共 ${total} 题`)}${stat('正确率',graded.length?Math.round(correct.length/graded.length*100)+'%':'—',`${correct.length} / ${graded.length} 道已判分题`)}${stat('待自行核对',ans.length-graded.length,'不计入正确率')}${stat('未作答',total-ans.length,'保留为未练习')}</div><div class="row" style="justify-content:center"><button class="button" data-view="review">去复习错题 →</button><button class="button secondary" data-action="reopen-session">回看本次文章</button><button class="button ghost" data-view="library">返回题库</button></div></section>`;
  }
  function renderProgress(){
    setHeader('让每一次阅读，都留下痕迹。','正确率只统计有明确原书答案的作答；不确定的题目仍待复习。','YOUR READING JOURNEY');
    const all=Object.values(state.questions),graded=all.reduce((n,r)=>n+r.graded,0),correct=all.reduce((n,r)=>n+r.correct,0),review=all.filter(r=>r.lastCorrect===false||r.uncertain).length;
    const days=Array.from({length:7},(_,i)=>{const day=new Date();day.setDate(day.getDate()-6+i);const key=day.toLocaleDateString('en-CA');const h=state.history.filter(h=>new Date(h.at).toLocaleDateString('en-CA')===key);return {label:`${day.getMonth()+1}/${day.getDate()}`,n:h.length,graded:h.filter(r=>r.correct!==null).length,correct:h.filter(r=>r.correct===true).length};}),max=Math.max(1,...days.map(d=>d.n));
    $('#content').innerHTML=`${storageWarning?`<div class="notice">${esc(storageWarning)}</div>`:''}<div class="stats">${stat('练习过的题目',all.length,`题库共 ${DATA.stats.questions} 题`)}${stat('累计正确率',graded?Math.round(correct/graded*100)+'%':'—',`${correct} / ${graded} 次已判分作答`)}${stat('待复习',review,'答错或仍不确定')}${stat('收藏文章',state.bookmarks.length,'留给下一次精读')}</div><div class="two-columns"><section class="panel"><h2>主题练习进度</h2><p class="muted" style="margin-top:8px">已练习题目 / 该主题全部题目</p><div class="bar-list">${Object.keys(DATA.stats.topics).map(t=>{const qs=DATA.passages.filter(p=>p.topic===t).flatMap(p=>p.questions),done=qs.filter(q=>state.questions[q.id]).length;return `<div class="bar-row"><span>${esc(t)}</span><div class="bar-track"><div class="bar-fill" style="width:${done/qs.length*100}%"></div></div><span>${Math.round(done/qs.length*100)}%</span></div>`;}).join('')}</div></section><section class="panel"><h2>最近七天</h2><p class="muted" style="margin-top:8px">每日作答次数，悬停查看正确率</p><div class="trend">${days.map(d=>`<div class="trend-day" title="${d.label}：${d.n} 次作答，正确率 ${d.graded?Math.round(d.correct/d.graded*100)+'%':'无已判分作答'}"><span class="trend-count">${d.n}</span><div class="trend-bar" style="height:${Math.max(2,d.n/max*100)}px"></div><span>${d.label}</span></div>`).join('')}</div></section></div><section class="panel data-tools"><div><h2>带走你的学习记录</h2><p style="margin-top:9px">导出为 JSON 备份；导入会合并记录，同一题保留最近的版本。阅读记录独立保存，不会覆盖背词记录。</p></div><div class="row"><button class="button secondary" data-action="export">导出进度 ↓</button><button class="button" data-action="import">导入进度 ↑</button></div></section>`;
  }
  function renderSources(){
    setHeader('回到出处，读得更踏实。','保留原始资料、PDF 页码与答案出处；图片题和阅读方法可直接打开原页。','THE SOURCE SHELF');
    $('#content').innerHTML=`<div class="notice">共整理 ${DATA.stats.originalPassages} 个原始篇目，合并 ${DATA.stats.mergedPassages} 个完全一致的篇目后，保留 ${DATA.stats.passages} 篇。${DATA.stats.conflicts} 道题存在来源答案冲突，已停止自动评分。文字不同的版本分别保留；自动归类不代表官方分类。</div><div class="source-list">${DATA.sources.map(s=>`<article class="panel source-card"><p class="eyebrow">SOURCE MATERIAL</p><h2>${esc(s.title)}</h2><div class="row">${s.passageCount?`<span class="tag">${s.passageCount} 篇</span><span class="tag neutral">${s.questionCount} 题</span>`:'<span class="tag warm">配套解析 / 原页阅读</span>'}<span class="tag neutral">原书 ${s.pages} 页</span></div>${(s.notes||[]).map(n=>`<p>${esc(n)}</p>`).join('')}<div class="row"><a class="button secondary small" href="${esc(pdfLink(s.id,s.reader?.originalPages?.slice(0,1)||[1]))}" target="_blank" rel="noopener">打开原 PDF ↗</a>${s.passageCount?`<button class="text-link" data-source="${s.id}">练习该来源 →</button>`:''}</div><details><summary>文件及提取说明</summary><p>${esc(s.fileName||'')}</p>${coverageText(s.coverage)}</details></article>`).join('')}</div>${DATA.sourceReading.length?`<h2 class="section-heading">原页阅读 · 方法与图片样题</h2><p class="muted">下列内容保留原排版，不计入网页可自动评分题数。</p><div class="doc-list">${DATA.sourceReading.map(d=>`<a class="doc-card" href="${esc(pdfLink(d.sourceId,d.pages))}" target="_blank" rel="noopener"><strong>${esc(d.title)} ↗</strong><span>${esc(shortSource(d.sourceId))} · 原 PDF ${d.pages?.[0]||''}${d.pages?.length>1?'–'+d.pages.at(-1):''} 页</span></a>`).join('')}</div>`:''}<p class="source-note">填空、数学、写作资料及无独立阅读题组的长难句讲解未混入阅读题库。已检查 ZIP / RAR 内阅读文件，重复归档不重复计数。原提取内容与完整审计保存在项目 data 文件夹。</p>`;
  }
  function coverageText(coverage){if(!coverage)return '';const issues=coverage.issues||coverage.notes||[];return Array.isArray(issues)?issues.map(i=>`<p>${esc(typeof i==='string'?i:JSON.stringify(i))}</p>`).join(''):'';}
  function exportProgress(){const content=JSON.stringify({...state,exportedAt:new Date().toISOString(),app:'gre-reading-studio'},null,2),url=URL.createObjectURL(new Blob([content],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`gre-reading-progress-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('学习记录已导出。');}
  async function importProgress(file){if(!file)return;try{if(file.size>15*1024*1024)throw Error('文件超过 15 MB');const imported=validateState(JSON.parse(await file.text()));for(const [id,r]of Object.entries(imported.questions))if(!state.questions[id]||r.lastAt>state.questions[id].lastAt)state.questions[id]=r;state.bookmarks=[...new Set([...state.bookmarks,...imported.bookmarks])];state.notes={...imported.notes,...state.notes};state.history=[...new Map([...state.history,...imported.history].map(h=>[`${h.qid}/${h.at}`,h])).values()].sort((a,b)=>a.at-b.at).slice(-30000);if(!state.session&&imported.session)state.session=imported.session;persist();render();toast('进度已合并。');}catch(e){toast('导入失败：'+e.message);}finally{$('#import-file').value='';}}
  document.addEventListener('click',event=>{
    const b=event.target.closest('button,a');if(!b)return;
    if(b.dataset.view){navigate(b.dataset.view);return;}
    if(b.matches('.brand')){event.preventDefault();navigate('library');return;}
    if(b.id==='resume'){navigate('study');return;}
    if(b.dataset.open){start([b.dataset.open]);return;}
    if(b.dataset.topic){filters.topic=b.dataset.topic;page=1;renderLibrary();return;}
    if(b.dataset.source){Object.assign(filters,{search:'',topic:'全部主题',source:b.dataset.source,skill:'',length:'',status:'',gradable:false});navigate('library');return;}
    if(b.dataset.review){reviewTab=b.dataset.review;page=1;renderLibrary();return;}
    if(b.dataset.page){page=Number(b.dataset.page);$('#library-results').innerHTML=libraryResults();$('#library-results').scrollIntoView({block:'start'});return;}
    if(b.dataset.bookmark){const id=b.dataset.bookmark;state.bookmarks=state.bookmarks.includes(id)?state.bookmarks.filter(v=>v!==id):[...state.bookmarks,id];persist();render();return;}
    if(b.dataset.option){const {s,q}=active();if(s.answers[q.id])return;const d=draft();d.selected=q.kind==='multiple'?(d.selected.includes(b.dataset.option)?d.selected.filter(x=>x!==b.dataset.option):[...d.selected,b.dataset.option]):[b.dataset.option];persist();document.querySelectorAll('[data-option]').forEach(el=>{const selected=d.selected.includes(el.dataset.option);el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));});$('#submit-answer').disabled=!d.selected.length;return;}
    if(b.dataset.question!==undefined){const {s,p}=active();s.questionIndex=Math.max(0,Math.min(p.questions.length-1,Number(b.dataset.question)));persist();renderStudy();return;}
    if(b.dataset.passage!==undefined){state.session.index=Number(b.dataset.passage);state.session.questionIndex=0;persist();renderStudy();window.scrollTo({top:0});return;}
    const action=b.dataset.action;
    if(action==='clear-filters'){Object.assign(filters,{search:'',topic:'全部主题',source:'',skill:'',length:'',status:'',gradable:false});page=1;renderLibrary();}
    if(action==='random'){const count=Number($('#batch-count').value);if(!Number.isInteger(count)||count<1||count>30){toast('本次篇数请输入 1–30 的整数。');return;}start(shuffle(filtered()).slice(0,count).map(p=>p.id),Number($('#batch-minutes').value));}
    if(action==='submit')submit();
    if(action==='retry'){const {s,q}=active();delete s.answers[q.id];s.drafts[q.id]={selected:[],typed:'',uncertain:false};persist();renderStudy();}
    if(action==='finish'){state.session.endedAt=Date.now();persist();render();window.scrollTo({top:0});}
    if(action==='reopen-session'){state.session.endedAt=null;state.session.index=0;state.session.questionIndex=0;persist();renderStudy();}
    if(action==='export')exportProgress();if(action==='import')$('#import-file').click();
  });
  document.addEventListener('input',event=>{
    const el=event.target;
    if(el.id==='search'){filters.search=el.value;page=1;$('#library-results').innerHTML=libraryResults();}
    if(el.dataset.note){state.notes[el.dataset.note]=el.value;state.notesUpdatedAt[el.dataset.note]=Date.now();persist();$('#note-status').textContent=storageAvailable?'已自动保存':'未保存，可导出备份';}
    if(el.id==='typed-answer'){draft().typed=el.value;persist();$('#submit-answer').disabled=!el.value.trim();}
  });
  document.addEventListener('change',event=>{const el=event.target;if(el.dataset.filter&&el.id!=='search'){filters[el.dataset.filter]=el.type==='checkbox'?el.checked:el.value;page=1;$('#library-results').innerHTML=libraryResults();}if(el.id==='uncertain'){draft().uncertain=el.checked;persist();}if(el.id==='import-file')importProgress(el.files[0]);});
  window.GREReadingBridge={
    navigate,
    persistProgress:()=>persist({preserveTimestamp:true,silent:true,force:true,refresh:false}),
    readProgress:()=>JSON.parse(JSON.stringify(state)),
    validateProgress:input=>validateState(input),
    restoreProgress:input=>{const next=validateState(input);state=next;persist({preserveTimestamp:true,silent:true,force:true});render();return JSON.parse(JSON.stringify(state));},
    mergeProgress:input=>{
      const imported=validateState(input);
      for(const [id,r]of Object.entries(imported.questions))if(!state.questions[id]||r.lastAt>state.questions[id].lastAt)state.questions[id]=r;
      state.bookmarks=[...new Set([...state.bookmarks,...imported.bookmarks])];state.notes={...imported.notes,...state.notes};
      state.history=[...new Map([...state.history,...imported.history].map(h=>[`${h.qid}/${h.at}`,h])).values()].sort((a,b)=>a.at-b.at);
      if(!state.session&&imported.session)state.session=imported.session;persist();
    },
    openPassage:id=>{if(passages.has(id))start([id]);},
    recordExternal:(id,response,correct,at,options)=>{
      if(!questions.has(id))return;
      const old=state.questions[id]||{attempts:0,correct:0,graded:0};
      state.questions[id]={attempts:old.attempts+1,correct:old.correct+(correct===true?1:0),graded:old.graded+(correct!==null?1:0),lastAt:at,lastCorrect:correct,uncertain:response.uncertain===true,selected:response.selected||[],typed:response.text||''};
      state.history.push({qid:id,at,correct,uncertain:response.uncertain===true});persist(options);
    }
  };
  setInterval(tick,1000);render();
})();
