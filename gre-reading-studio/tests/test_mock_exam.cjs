/* Real-bank Chrome acceptance. Uses temporary profiles and never changes production questions. */
const {chromium}=require('C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),URL=pathToFileURL(path.join(ROOT,'dist/mock.html')).href;
const BANK=JSON.parse(fs.readFileSync(path.join(ROOT,'gre_question_bank.json'),'utf8'));
const Core=require('../dist/platform-core.js'),Mock=require('../dist/mock-core.js');
const questions=new Map(BANK.questions.map(q=>[q.question_id,q]));
const MOCK_KEY='gre-mock-exams-v1',RC_KEY='gre-reading-studio-progress-v1';
const contexts=[],results=[],pageErrors=[],externalRequests=[];
const progress=active=>({version:1,active,history:[],updatedAt:Date.now()});
const exam=(now=Date.now())=>Mock.createExam(BANK,{order:'VQVQ'},now);
const clone=x=>JSON.parse(JSON.stringify(x));
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name);}catch(e){results.push({name,ok:false,error:e.message});console.log('FAIL',name,e.stack||e.message);}}
async function downloadedText(download){const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);return Buffer.concat(chunks).toString('utf8');}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  async function newPage(seed={},viewport={width:1440,height:1000}){
   const context=await browser.newContext({viewport,acceptDownloads:true});contexts.push(context);
   if(Object.keys(seed).length)await context.addInitScript(({seed})=>{if(!sessionStorage.getItem('mock-qa-seeded')){for(const[k,v]of Object.entries(seed))localStorage.setItem(k,JSON.stringify(v));sessionStorage.setItem('mock-qa-seeded','1');}},{seed});
   const p=await context.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>pageErrors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))externalRequests.push(r.url());});
   await p.goto(URL);await p.waitForFunction(()=>!!window.GREPlatform&&!!window.GREMockExam);await p.locator('#mock-content').waitFor({state:'visible'});return p;
  }
  const state=p=>p.evaluate(()=>window.GREMockExam.getState());
  const platform=p=>p.evaluate(()=>window.GREPlatform.getState());
  const action=(p,name)=>p.locator(`[data-mock-action="${name}"]`).first();
  const click=(p,name)=>action(p,name).click();
  const current=async p=>{const s=await state(p),e=s.active;return {state:s,exam:e,section:e?.sections[e.currentSection],q:e?questions.get(e.sections[e.currentSection].ids[e.index]):null};};
  async function jump(p,index){await click(p,'review');await p.locator(`[data-mock-jump="${index}"]`).click();}
  async function jumpType(p,type){const c=await current(p),index=c.section.ids.findIndex(id=>questions.get(id).question_type===type);assert.ok(index>=0,'No '+type+' in current section');await jump(p,index);return questions.get(c.section.ids[index]);}
  const option=(p,id)=>p.locator(`[data-mock-option="${id}"]`).first();
  async function answer(p,q){if(Core.mode(q)==='numeric')await p.locator('#mock-answer-text').fill(q.correct_answer[0]);else for(const id of q.correct_answer)await option(p,id).click();}
  async function finishSection(p){await click(p,'end-section');await click(p,'confirm-section');}
  const oldRC=BANK.questions.find(q=>q.legacy_rc_id&&q.gradable),oldAt=Date.now()-86400000;
  const legacySeed={version:1,questions:{[oldRC.question_id]:{attempts:1,correct:1,graded:1,lastAt:oldAt,lastCorrect:true,uncertain:false,selected:oldRC.correct_answer,typed:''}},bookmarks:[oldRC.legacy_passage_id],notes:{[oldRC.legacy_passage_id]:'Existing RC note — preserve exactly.'},history:[{qid:oldRC.question_id,at:oldAt,correct:true,uncertain:false}],session:null};
  const page=await newPage({[RC_KEY]:legacySeed});let completed,fullExport;
  await check('launcher mock.html opens the local mock setup without a server',async()=>{assert.ok(page.url().endsWith('/index.html#mock'));assert.ok(await action(page,'start').isVisible());assert.ok((await page.locator('#mock-content').innerText()).includes('118'));assert.equal(await page.locator('#main').isVisible(),false);});
  await check('starts one Issue plus 54 real verified objective questions in five exact-timing sections',async()=>{
   await page.locator('#mock-order').selectOption('VQVQ');await click(page,'start');await page.locator('#mock-answer-text').waitFor();const e=(await state(page)).active;
   assert.deepEqual(e.sections.map(s=>s.id),['AWA','V1','Q1','V2','Q2']);assert.deepEqual(e.sections.map(s=>s.ids.length),[1,12,12,15,15]);assert.deepEqual(e.sections.map(s=>s.minutes),[30,18,21,23,26]);assert.equal(e.sections.reduce((n,s)=>n+s.minutes,0),118);
   const ids=e.sections.flatMap(s=>s.ids);assert.equal(ids.length,55);assert.equal(new Set(ids).size,55);assert.equal(questions.get(ids[0]).question_type,'Issue');assert.ok(ids.slice(1).every(id=>questions.get(id).gradable&&questions.get(id).answer_status==='verified'));assert.equal(await page.locator('#mock-answer-text').getAttribute('spellcheck'),'false');assert.equal(await action(page,'calculator').count(),0);
  });
  await check('Issue draft survives refresh and the absolute section deadline is unchanged',async()=>{
   await page.locator('#mock-answer-text').fill('An original timed essay. Evidence should be weighed against competing explanations.');const before=(await state(page)).active;await page.reload();await page.waitForFunction(()=>!!window.GREPlatform);await click(page,'resume');const after=(await state(page)).active;
   assert.equal(after.sections[0].deadline,before.sections[0].deadline);assert.equal(await page.locator('#mock-answer-text').inputValue(),before.responses[before.sections[0].ids[0]].text);
  });
  await check('section-end confirmation can be cancelled without changing sections',async()=>{await click(page,'end-section');assert.ok(await page.locator('[role="dialog"]').isVisible());await click(page,'close-modal');assert.equal((await state(page)).active.currentSection,0);await finishSection(page);assert.equal((await state(page)).active.sections[0].endReason,'manual');assert.equal((await state(page)).active.currentSection,1);assert.equal(await action(page,'previous').isDisabled(),true);});
  await check('TC2 and TC3 keep per-blank selection and allow answer changes during the section',async()=>{
   for(const type of ['TC2','TC3']){const q=await jumpType(page,type);assert.equal(await page.locator('#mock-content .blank-group').count(),q.blank_groups.length);const g=q.blank_groups[0];await option(page,g.options[0].id).click();await option(page,g.options[1].id).click();let r=(await state(page)).active.responses[q.question_id];assert.equal(r.selected.filter(id=>g.options.some(o=>o.id===id)).length,1);for(const group of q.blank_groups)await option(page,group.options.find(o=>q.correct_answer.includes(o.id)).id).click();r=(await state(page)).active.responses[q.question_id];assert.equal(Core.grade(q,r),true);}
  });
  await check('SE enforces an exact pair, blocks a third selection, and keeps saved choices',async()=>{
   const q=await jumpType(page,'SE');assert.equal(await page.locator('#mock-content [data-mock-option]').count(),6);await answer(page,q);const wrong=q.options.find(o=>!q.correct_answer.includes(o.id));await option(page,wrong.id).click();assert.deepEqual(new Set((await state(page)).active.responses[q.question_id].selected),new Set(q.correct_answer));await option(page,q.correct_answer[0]).click();assert.equal((await state(page)).active.responses[q.question_id].selected.length,1);await option(page,q.correct_answer[0]).click();
  });
  await check('mark and review stay within the current section and restore the marked question',async()=>{
   const c=await current(page),i=c.exam.index;await click(page,'mark');assert.equal((await state(page)).active.responses[c.q.question_id].marked,true);await click(page,'review');assert.equal(await page.locator('[data-mock-jump]').count(),12);assert.ok((await page.locator(`[data-mock-jump="${i}"]`).innerText()).includes('★'));await page.locator('[data-mock-jump="0"]').click();assert.equal((await state(page)).active.index,0);await jump(page,i);assert.equal((await state(page)).active.responses[c.q.question_id].marked,true);
  });
  await check('answers, explanations, answer-page links, and calculator remain hidden in Verbal',async()=>{
   assert.equal(await page.locator('#mock-content .platform-answer,.explanation-text,.original-links').count(),0);assert.equal(await page.locator('#mock-content a[href$=".pdf"]').count(),0);assert.equal(await action(page,'calculator').count(),0);assert.ok(!(await page.locator('#mock-content').innerText()).includes('原资料答案：'));await page.screenshot({path:path.join(__dirname,'qa-mock-desktop.png'),fullPage:true});
  });
  await check('submitting a section locks previous questions and starts the next section budget',async()=>{const before=(await state(page)).active.sections[1];await finishSection(page);const e=(await state(page)).active;assert.equal(e.currentSection,2);assert.ok(e.sections[1].endedAt);assert.ok(e.sections[1].endedAt<before.deadline);assert.equal(e.sections[2].deadline-e.sections[2].startedAt,21*60000);assert.equal(e.sections[2].startedAt,e.sections[1].endedAt);assert.ok(await action(page,'previous').isDisabled());await click(page,'review');assert.equal(await page.locator('[data-mock-jump]').count(),12);await click(page,'close-modal');});
  await check('Quant calculator follows precedence, handles error, and transfers numeric answers',async()=>{
   const q=await jumpType(page,'NumericEntry');await click(page,'calculator');const key=async k=>page.locator(`[data-mock-calc="${k}"]`).click();for(const k of ['C','1','+','2','×','4','='])await key(k);assert.equal(await page.locator('#mock-calc-display').textContent(),'9');await click(page,'calc-transfer');assert.equal(await page.locator('#mock-answer-text').inputValue(),'9');
   await click(page,'calculator');for(const k of ['C','6','÷','0','='])await key(k);assert.match(await page.locator('#mock-calc-display').textContent(),/error/i);await key('C');await click(page,'close-modal');const r=Core.rational(q.correct_answer[0]),equivalent=String(r[0]*2n)+'/'+String(r[1]*2n);await page.locator('#mock-answer-text').fill(equivalent);assert.equal(Core.grade(q,(await state(page)).active.responses[q.question_id]),true);
  });
  await check('QC and Quant multiple choice use their original response structures',async()=>{const qc=await jumpType(page,'QC');assert.equal(await page.locator('#mock-content [data-mock-option]').count(),4);await answer(page,qc);const q=await jumpType(page,'QuantMultiple');assert.ok(await page.locator('#mock-content [data-mock-option]').count()>1);await answer(page,q);assert.equal(Core.grade(q,(await state(page)).active.responses[q.question_id]),true);});
  await check('DI original figures load locally and can be enlarged during the exam',async()=>{
   const q=await jumpType(page,'DI');const imgs=page.locator('#mock-content .mock-figure img');assert.ok(await imgs.count()>0);await page.waitForFunction(()=>[...document.querySelectorAll('#mock-content .mock-figure img')].every(i=>i.complete&&i.naturalWidth>0));await page.locator('[data-mock-image]').first().click();assert.ok(await page.locator('.mock-enlarged-image').isVisible());await click(page,'close-modal');await answer(page,q);assert.equal(await page.locator('#mock-content .platform-answer').count(),0);
  });
  await check('complete five sections, include all omitted questions in the raw score denominator, save essay',async()=>{
   await finishSection(page);assert.equal((await state(page)).active.currentSection,3);await finishSection(page);assert.equal((await state(page)).active.currentSection,4);await finishSection(page);await page.waitForFunction(()=>window.GREMockExam.getState().history.length===1);
   const s=await state(page);assert.equal(s.active,null);completed=s.history[0];const summary=Mock.summary(completed,BANK);assert.equal(summary.total.total,54);assert.ok(summary.total.omitted>0);assert.ok(summary.total.correct>0);const raw=await page.locator('#mock-content .stat').first().innerText();assert.ok(raw.includes(summary.total.correct+' / 54'),raw);
   await page.waitForFunction(id=>window.GREPlatform.getState().sessions.some(s=>s.mockExamId===id),completed.id);const p=await platform(page);assert.ok(p.essays.some(e=>e.origin==='mock'&&e.text.includes('An original timed essay.')));assert.ok(p.attempts.some(a=>a.origin==='mock'&&a.correct===true));assert.equal(await page.locator('#mock-content .mock-review-question').count(),55);assert.ok(await page.locator('#mock-content .platform-answer').count()>=54);assert.ok((await page.locator('#mock-content').innerText()).includes('不是 GRE 官方分数'));
  });
  await check('mock results do not invent scaled scores and analytics keeps the whole-exam denominator',async()=>{
   assert.equal(await page.locator('#mock-content [data-scaled-score],#mock-content .scaled-score').count(),0);await page.evaluate(()=>window.GREPlatform.go('analytics'));const row=page.locator('tr').filter({has:page.locator(`[data-session-result="mock:${completed.id}"]`)});const correct=Mock.summary(completed,BANK).total.correct;assert.ok((await row.innerText()).includes(Math.round(correct/54*100)+'%'),await row.innerText());await row.locator('button').click();await page.waitForSelector('#mock-content .mock-results-table');
  });
  await check('original RC history, bookmark and note survive full mock integration',async()=>{const old=await page.evaluate(()=>window.GREReadingBridge.readProgress());assert.equal(old.notes[oldRC.legacy_passage_id],legacySeed.notes[oldRC.legacy_passage_id]);assert.ok(old.bookmarks.includes(oldRC.legacy_passage_id));assert.ok(old.history.some(h=>h.qid===oldRC.question_id&&h.at===oldAt));});
  await check('mock backup export and repeated import preserve archive without duplicate attempts',async()=>{
   const before=await platform(page),dl=page.waitForEvent('download');await click(page,'export');const exported=JSON.parse(await downloadedText(await dl));assert.equal(exported.history.length,1);assert.equal(exported.history[0].id,completed.id);await page.evaluate(async data=>{await window.GREMockExam.importProgress(data);await window.GREMockExam.importProgress(data);},exported);assert.equal((await state(page)).history.length,1);assert.equal((await platform(page)).attempts.length,before.attempts.length);assert.equal((await platform(page)).essays.length,before.essays.length);
  });
  await check('combined platform progress export includes mock and imports to a fresh browser',async()=>{
   await page.evaluate(()=>window.GREPlatform.go('materials'));const dl=page.waitForEvent('download');await page.locator('[data-paction="export-progress"]').click();fullExport=JSON.parse(await downloadedText(await dl));assert.equal(fullExport.mock.history[0].id,completed.id);const p=await newPage();await p.evaluate(()=>window.GREPlatform.go('materials'));await p.locator('[data-paction="import-progress"]').click();await p.locator('#platform-import').setInputFiles({name:'full-progress.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fullExport))});await p.waitForFunction(()=>document.querySelector('#platform-import').value==='');assert.ok(!(await p.locator('#toast').innerText()).includes('导入失败'),await p.locator('#toast').innerText());assert.equal((await state(p)).history.length,1);assert.equal((await platform(p)).attempts.length,fullExport.progress.attempts.length);assert.equal((await p.evaluate(()=>window.GREReadingBridge.readProgress())).notes[oldRC.legacy_passage_id],legacySeed.notes[oldRC.legacy_passage_id]);await p.reload();await p.waitForFunction(()=>!!window.GREPlatform);assert.equal((await state(p)).history.length,1);assert.equal((await platform(p)).attempts.length,fullExport.progress.attempts.length);
  });
  const importCombined=async(p,payload)=>{await p.locator('[data-paction="import-progress"]').click();await p.locator('#platform-import').setInputFiles({name:'combined-regression.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});await p.waitForFunction(()=>document.querySelector('#platform-import').value==='');return p.locator('#toast').innerText();};
  const stores=p=>p.evaluate(()=>Object.fromEntries(['gre-training-progress-v2','gre-reading-studio-progress-v1','gre-mock-exams-v1'].map(key=>[key,localStorage.getItem(key)])));
  await check('combined import preserves five RC attempts at the mock timestamp and enriches legacy responses without duplicates',async()=>{
   assert.ok(fullExport);const payload=clone(fullExport),e=payload.mock.history[0],section=e.sections.find(s=>s.ids.some(id=>questions.get(id).legacy_rc_id)),qid=section.ids.find(id=>questions.get(id).legacy_rc_id),q=questions.get(qid),at=section.endedAt;
   e.responses[qid]={...e.responses[qid],selected:q.correct_answer.slice(),text:'',elapsedMs:1234};
   payload.legacyRC.history=payload.legacyRC.history.filter(h=>h.qid!==qid);
   for(let i=4;i>=0;i--)payload.legacyRC.history.push({qid,at:at-i*1000,correct:true,uncertain:false});
   payload.legacyRC.questions[qid]={attempts:5,correct:5,graded:5,lastAt:at,lastCorrect:true,uncertain:false,selected:q.correct_answer.slice(),typed:''};
   payload.progress.attempts=payload.progress.attempts.filter(a=>a.questionId!==qid);
   payload.progress.attempts.push({id:`rc:${qid}:${at}`,questionId:qid,at,correct:true,elapsedMs:1234,selected:q.correct_answer.slice(),text:'',uncertain:false,sessionId:'mock:'+e.id,origin:'mock'});
   const session=payload.progress.sessions.find(s=>s.mockExamId===e.id);session.responses[qid]={selected:q.correct_answer.slice(),text:'',uncertain:false,elapsedMs:1234,submitted:true,correct:true};
   for(const existingLegacy of [false,true]){
    const p=await newPage(existingLegacy?{[RC_KEY]:payload.legacyRC}:{});await p.evaluate(()=>window.GREPlatform.go('materials'));
    if(existingLegacy){const simple=(await platform(p)).attempts.find(a=>a.id===`rc:${qid}:${at}`);assert.equal(simple.elapsedMs,null);assert.deepEqual(simple.selected,[]);}
    for(let pass=0;pass<2;pass++){
     const message=await importCombined(p,payload);assert.ok(!message.includes('导入失败'),message);
     const rc=await p.evaluate(()=>window.GREReadingBridge.readProgress()),ps=await platform(p);
     assert.equal(rc.questions[qid].attempts,5);assert.equal(rc.questions[qid].graded,5);assert.equal(rc.questions[qid].correct,5);assert.equal(rc.questions[qid].lastAt,at);assert.equal(rc.history.filter(h=>h.qid===qid).length,5);
     const records=ps.attempts.filter(a=>a.questionId===qid);assert.equal(records.length,5);const rich=records.find(a=>a.id===`rc:${qid}:${at}`);assert.equal(rich.elapsedMs,1234);assert.deepEqual(rich.selected,q.correct_answer);assert.equal((await state(p)).history.length,1);
    }
   }
  });
  await check('invalid legacy RC data rejects a valid combined mock backup before any of the three stores change',async()=>{
   const p=await newPage({[RC_KEY]:legacySeed});await p.evaluate(()=>window.GREPlatform.go('materials'));const payload=clone(fullExport);payload.legacyRC={version:1,questions:null,bookmarks:[],history:[]};
   const before=await stores(p),beforePlatform=await platform(p),beforeMock=await state(p),beforeRC=await p.evaluate(()=>window.GREReadingBridge.readProgress());
   const message=await importCombined(p,payload);assert.ok(message.includes('导入失败'),message);assert.deepEqual(await stores(p),before);assert.deepEqual(await platform(p),beforePlatform);assert.deepEqual(await state(p),beforeMock);assert.deepEqual(await p.evaluate(()=>window.GREReadingBridge.readProgress()),beforeRC);
  });
  await check('invalid mockVisitedIds is rejected atomically and duplicate or foreign IDs cannot inflate the score denominator',async()=>{
   const p=await newPage();await p.evaluate(()=>window.GREPlatform.go('materials'));const invalid=clone(fullExport),session=invalid.progress.sessions.find(s=>s.kind==='mock');session.mockVisitedIds='x';const before=await stores(p),beforePlatform=await platform(p),beforeMock=await state(p);
   const message=await importCombined(p,invalid);assert.ok(message.includes('导入失败'),message);assert.deepEqual(await stores(p),before);assert.deepEqual(await platform(p),beforePlatform);assert.deepEqual(await state(p),beforeMock);
   await p.evaluate(()=>window.GREPlatform.go('analytics'));assert.ok(await p.locator('#platform-content').isVisible());await p.evaluate(()=>window.GREPlatform.go('materials'));
   const payload=clone(fullExport),good=payload.progress.sessions.find(s=>s.kind==='mock'),ids=good.mockVisitedIds.slice(),external=BANK.questions.find(q=>!good.ids.includes(q.question_id)).question_id,awa=completed.sections[0].ids[0];assert.equal(ids.length,54);good.mockVisitedIds=[...ids,...ids,external,'not-a-real-library-question',awa];
   const ok=await importCombined(p,payload);assert.ok(!ok.includes('导入失败'),ok);const restored=(await platform(p)).sessions.find(s=>s.id===good.id);assert.equal(restored.mockVisitedIds.length,54);assert.deepEqual(new Set(restored.mockVisitedIds),new Set(ids));await p.evaluate(()=>window.GREPlatform.go('analytics'));const row=p.locator('tr').filter({has:p.locator(`[data-session-result="${good.id}"]`)});assert.ok((await row.innerText()).includes(Math.round(Mock.summary(completed,BANK).total.correct/54*100)+'%'));
  });
  await check('invalid imported exam is rejected without modifying saved history',async()=>{const before=await state(page),broken=clone(before);broken.history[0].sections[1].minutes=99;const failure=await page.evaluate(async x=>{try{await window.GREMockExam.importProgress(x);return '';}catch(e){return e.message;}},broken);assert.ok(failure);assert.deepEqual((await state(page)).history,before.history);});
  await check('select-in-passage RC sentence responds to a real sentence and its alternate choice',async()=>{
   const e=exam(),used=new Set(e.sections.flatMap(s=>s.ids).map(id=>questions.get(id).material_id).filter(Boolean));const q=BANK.questions.find(q=>q.question_type==='RCSentence'&&Mock.eligible(q,BANK)&&!used.has(q.material_id));assert.ok(q);const s=e.sections[1],removed=s.ids.at(-1);s.ids[s.ids.length-1]=q.question_id;delete e.responses[removed];e.responses[q.question_id]={selected:[],text:'',marked:false,elapsedMs:0};Mock.advance(e,BANK,Date.now());e.index=s.ids.length-1;Mock.restore(e,BANK);const p=await newPage({[MOCK_KEY]:progress(e)});await click(p,'resume');assert.ok(await p.locator('.mock-sentence').count()>0);await p.locator(`.mock-sentence[data-mock-option="${q.correct_answer[0]}"]`).click();assert.deepEqual((await state(p)).active.responses[q.question_id].selected,q.correct_answer);assert.equal(await p.locator(`.option[data-mock-option="${q.correct_answer[0]}"]`).getAttribute('aria-pressed'),'true');
  });
  await check('timer expiration automatically locks Issue and advances without a scheduled break',async()=>{
   const e=exam(Date.now()-30*60000+3000),p=await newPage({[MOCK_KEY]:progress(e)});await click(p,'resume');await p.locator('#mock-answer-text').fill('Saved before timer expiry.');await p.waitForFunction(()=>window.GREMockExam.getState().active.currentSection===1,null,{timeout:10000});const next=(await state(p)).active;assert.equal(next.sections[0].endReason,'timeout');assert.equal(next.sections[1].startedAt,next.sections[0].deadline);assert.equal(next.responses[e.sections[0].ids[0]].text,'Saved before timer expiry.');assert.equal(await action(p,'pause').count(),0);
  });
  await check('reopening after 119 minutes catches up every expired section and archives all 54 omissions',async()=>{
   const e=exam(Date.now()-119*60000),p=await newPage({[MOCK_KEY]:progress(e)});await p.waitForFunction(()=>window.GREMockExam.getState().history.length===1);const s=await state(p);assert.equal(s.active,null);assert.equal(s.history[0].endedAt-e.startedAt,118*60000);assert.ok(s.history[0].sections.every(s=>s.endReason==='timeout'));if(await p.locator(`[data-mock-history="${e.id}"]`).count())await p.locator(`[data-mock-history="${e.id}"]`).click();assert.ok((await p.locator('#mock-content .stat').first().innerText()).includes('0 / 54'));await p.reload();await p.waitForFunction(()=>!!window.GREPlatform);assert.equal((await state(p)).history.length,1);
  });
  await check('aborting preserves answered work and marks unentered sections as unentered',async()=>{
   const p=await newPage();await click(p,'start');await p.locator('#mock-answer-text').fill('Aborted but retained essay.');await click(p,'end-exam');await click(p,'close-modal');assert.ok((await state(p)).active);await click(p,'end-exam');await click(p,'confirm-abort');const h=(await state(p)).history[0];assert.equal(h.aborted,true);assert.equal(h.sections.filter(s=>s.startedAt).length,1);assert.ok((await p.locator('.mock-results-table').innerText()).includes('未进入'));assert.ok((await p.locator('#mock-content .stat').first().innerText()).includes('0 / 0'));
  });
  await check('mobile mock setup, writing editor and multi-blank question fit the viewport',async()=>{
   const p=await newPage({}, {width:390,height:844});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await p.locator('#mock-order').selectOption('VQVQ');await click(p,'start');await p.locator('#mock-answer-text').fill('Mobile mock essay.');assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await finishSection(p);await jumpType(p,'TC3');assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await p.screenshot({path:path.join(__dirname,'qa-mock-mobile.png'),fullPage:true});
  });
  await check('no uncaught browser runtime errors and no external requests during local mock work',async()=>{assert.deepEqual(pageErrors,[]);assert.deepEqual(externalRequests,[]);});
 }finally{
  for(const c of contexts)await c.close();await browser.close();
  fs.writeFileSync(path.join(__dirname,'mock-qa-report.json'),JSON.stringify({testedAt:new Date().toISOString(),entryURL:URL,bankCount:BANK.questions.length,results,pageErrors,externalRequests},null,2));
  if(results.some(r=>!r.ok)||pageErrors.length)process.exitCode=1;
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
