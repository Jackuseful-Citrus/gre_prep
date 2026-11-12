/* Local Chrome acceptance for the two-subject random-practice entry.
 * Uses real local questions, isolated profiles, and no user browser state. */
const {chromium}=require('C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),URL=pathToFileURL(path.join(ROOT,'dist/mock.html')).href;
const BANK=JSON.parse(fs.readFileSync(path.join(ROOT,'gre_question_bank.json'),'utf8'));
const Core=require('../dist/platform-core.js'),Mock=require('../dist/mock-core.js');
const questions=new Map(BANK.questions.map(q=>[q.question_id,q]));
const MOCK_KEY='gre-mock-exams-v1',RC_KEY='gre-reading-studio-progress-v1';
const results=[],pageErrors=[],externalRequests=[],contexts=[];
const allowed={Verbal:new Set(['TC1','TC2','TC3','SE','RC1','RCMultiple','RCSentence']),Quant:new Set(['QC','QuantSingle','QuantMultiple','NumericEntry','DI'])};
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name);}catch(e){results.push({name,ok:false,error:e.message});console.log('FAIL',name,e.stack||e.message);}}
const snapshot=p=>p.evaluate(()=>window.GREPlatform.getState());
const mockState=p=>p.evaluate(()=>window.GREMockExam.getState());
const action=(p,name)=>p.locator(`[data-mock-action="${name}"]`).first();
const go=(p,view)=>p.evaluate(view=>window.GREPlatform.go(view),view);
async function setup(p){await go(p,'mock');await p.locator('[data-subject-choice="Verbal"]').waitFor();}
async function start(p){await action(p,'start-subject').click();await p.locator('#platform-content .question-stem').waitFor();return (await snapshot(p)).session;}
function assertSession(s,subject,count){assert.equal(s.ids.length,count);assert.equal(new Set(s.ids).size,count);assert.equal(s.mode,'free');assert.equal(s.instant,true);assert.equal(s.endedAt,null);for(const id of s.ids){const q=questions.get(id);assert.ok(q);assert.equal(q.category,subject);assert.ok(allowed[subject].has(q.question_type),q.question_type);assert.equal(q.gradable,true);assert.equal(q.answer_status,'verified');}}
async function answer(p,q){if(Core.mode(q)==='numeric')await p.locator('#p-response-text').fill(q.correct_answer[0]);else for(const id of q.correct_answer)await p.locator(`[data-poption="${id}"]`).click();await p.locator('[data-paction="submit"]').click();}
async function config(p,key,value){const el=p.locator(`[data-config="${key}"]`),tag=await el.evaluate(e=>e.tagName);if(tag==='SELECT')await el.selectOption(value);else if(typeof value==='boolean')await el.setChecked(value);else{await el.fill(String(value));await el.dispatchEvent('change');}}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  async function newPage(seed={},viewport={width:1440,height:1000}){
   const context=await browser.newContext({viewport,acceptDownloads:true});contexts.push(context);
   if(Object.keys(seed).length)await context.addInitScript(({seed})=>{if(!sessionStorage.getItem('subject-qa-seeded')){for(const[k,v]of Object.entries(seed))localStorage.setItem(k,JSON.stringify(v));sessionStorage.setItem('subject-qa-seeded','1');}},{seed});
   const p=await context.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>pageErrors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))externalRequests.push(r.url());});
   await p.goto(URL);await p.waitForFunction(()=>!!window.GREPlatform&&!!window.GREMockExam);await p.locator('[data-subject-choice="Verbal"]').waitFor();return p;
  }
  const page=await newPage();let firstSession,answeredQuestion;
  await check('offline launcher opens two choices with Verbal and 20 selected',async()=>{
   assert.ok(page.url().endsWith('/index.html#mock'));assert.equal(await page.locator('[data-subject-choice]').count(),2);assert.equal(await page.locator('[data-subject-choice="Verbal"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-subject-choice="Quant"]').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#subject-count').inputValue(),'20');assert.equal(await page.locator('[data-subject-count="20"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#mock-order').count(),0);assert.equal(await action(page,'start').count(),0);assert.ok((await action(page,'start-subject').innerText()).includes('Verbal'));
   await page.screenshot({path:path.join(__dirname,'qa-subject-desktop.png'),fullPage:true});
  });
  await check('one click immediately starts 20 real Verbal questions without AWA or timed sections',async()=>{
   firstSession=await start(page);assertSession(firstSession,'Verbal',20);assert.equal(await page.locator('#essay-text,#mock-answer-text').count(),0);assert.equal(await page.locator('#mock-content').isVisible(),false);assert.equal((await mockState(page)).active,null);assert.match(await page.locator('#p-timer').innerText(),/用时/);
  });
  await check('submitted random-practice answer immediately shows result and records exact grading',async()=>{
   answeredQuestion=questions.get(firstSession.ids[0]);await answer(page,answeredQuestion);await page.locator('.platform-answer').waitFor();const s=await snapshot(page),r=s.session.responses[answeredQuestion.question_id];assert.equal(r.submitted,true);assert.equal(r.correct,true);assert.ok((await page.locator('.platform-answer').innerText()).includes('原资料答案'));assert.ok(s.attempts.some(a=>a.questionId===answeredQuestion.question_id&&a.correct===true));assert.equal(await page.locator('.option.correct').count()>0||Core.mode(answeredQuestion)==='numeric',true);
  });
  await check('favorites, notes, submitted answers, and current random session survive reload and resume',async()=>{
   await page.locator('[data-pfavorite]').first().click();await page.locator('details').filter({has:page.locator('#p-note')}).locator('summary').click();await page.locator('#p-note').fill('两科随机刷题：依据与错因。');await page.locator('.platform-qnav [data-pnext="1"]').click();const before=await snapshot(page);
   await page.reload();await page.waitForFunction(()=>!!window.GREPlatform);const after=await snapshot(page);assert.deepEqual(after.attempts,before.attempts);assert.equal(after.notes[answeredQuestion.question_id],'两科随机刷题：依据与错因。');assert.ok(after.favorites.includes(answeredQuestion.question_id));assert.deepEqual(after.session.ids,before.session.ids);assert.equal(after.session.index,1);assert.equal(after.session.responses[answeredQuestion.question_id].correct,true);
   await action(page,'resume-subject').waitFor();assert.ok((await page.locator('.subject-practice-resume').innerText()).includes('1 / 20'));await action(page,'resume-subject').click();await page.locator('.question-stem').waitFor();assert.equal((await snapshot(page)).session.id,before.session.id);assert.equal((await snapshot(page)).session.index,1);
  });
  await check('completing random practice creates reviewable analytics history',async()=>{
   const before=(await snapshot(page)).session;await page.locator('[data-paction="finish"]').first().click();await page.locator('.session-result-title').waitFor();const state=await snapshot(page);assert.ok(state.sessions.some(s=>s.id===before.id&&s.endedAt));await go(page,'analytics');const link=page.locator(`[data-session-result="${before.id}"]`);await link.click();await page.locator('.session-result-title').waitFor();assert.equal((await snapshot(page)).session.id,before.id);
  });
  await check('starting twice produces different random question sets',async()=>{
   await setup(page);const s1=await start(page);await setup(page);const s2=await start(page);assertSession(s1,'Verbal',20);assertSession(s2,'Verbal',20);assert.notDeepEqual([...s1.ids].sort(),[...s2.ids].sort());
  });
  await check('preset count controls change the actual Verbal question count',async()=>{
   await setup(page);await page.locator('[data-subject-count="30"]').click();assert.equal(await page.locator('#subject-count').inputValue(),'30');const s=await start(page);assertSession(s,'Verbal',30);
  });
  for(const count of [1,7,100])await check('custom Verbal count '+count+' produces exactly that many unique questions',async()=>{
   await setup(page);await page.locator('#subject-count').fill(String(count));const s=await start(page);assertSession(s,'Verbal',count);
  });
  await check('invalid custom counts preserve current practice and show a useful error',async()=>{
   const p=await newPage();for(const value of ['0','101','2.5','']){await p.locator('#subject-count').fill(value);await action(p,'start-subject').click();assert.equal((await snapshot(p)).session,null);assert.ok(await p.locator('[data-subject-choice="Verbal"]').isVisible());assert.match(await p.locator('#toast').innerText(),/1.?100|整数|题量/);}
  });
  await check('Quant selection starts only verified modern math questions with requested count',async()=>{
   await setup(page);await page.locator('[data-subject-choice="Quant"]').click();assert.equal(await page.locator('[data-subject-choice="Quant"]').getAttribute('aria-pressed'),'true');assert.ok((await action(page,'start-subject').innerText()).includes('Quant'));await page.locator('#subject-count').fill('12');const s=await start(page);assertSession(s,'Quant',12);assert.match(await page.locator('#p-timer').innerText(),/用时/);
  });
  await check('Quant random question original figures load and its answer grades immediately',async()=>{
   const s=(await snapshot(page)).session,q=questions.get(s.ids[0]);const images=page.locator('.question-panel img,.platform-material img');if(await images.count()){await images.first().scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelectorAll('.question-panel img,.platform-material img')].filter(i=>i.loading!=='lazy'||i.getBoundingClientRect().top<innerHeight).every(i=>i.complete&&i.naturalWidth>0));}await answer(page,q);assert.equal((await snapshot(page)).session.responses[q.question_id].correct,true);assert.ok(await page.locator('.platform-answer').isVisible());
  });
  await check('plain index.html defaults to Verbal while offering to resume the saved Quant practice',async()=>{
   const before=(await snapshot(page)).session;await page.goto(pathToFileURL(path.join(ROOT,'dist/index.html')).href);await page.waitForFunction(()=>!!window.GREPlatform);await page.locator('[data-subject-choice="Verbal"]').waitFor();assert.equal(await page.locator('[data-subject-choice="Verbal"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#subject-count').inputValue(),'20');assert.ok((await action(page,'resume-subject').innerText()).includes('Quant'));await action(page,'resume-subject').click();await page.locator('.question-stem').waitFor();assert.equal((await snapshot(page)).session.id,before.id);
  });
  await check('subject practice resets residual subject, type, source, difficulty, status, and timed settings',async()=>{
   const p=await newPage();await go(p,'home');await config(p,'subject','AWA');await config(p,'mode','exam');await config(p,'minutes',1);await config(p,'count',2);await config(p,'status','wrong');await config(p,'difficulty','hard');await config(p,'instant',false);await config(p,'wrongFirst',true);
   const source=await p.locator('[data-config="sources"] option').first().getAttribute('value');await config(p,'sources',[source]);const type=p.locator('[data-ptype="Issue"]');if(await type.count())await type.check();await setup(p);const s=await start(p);assertSession(s,'Verbal',20);assert.ok(new Set(s.ids.map(id=>questions.get(id).source_id)).size>1);assert.match(await p.locator('#p-timer').innerText(),/用时/);
  });
  const oldRC=BANK.questions.find(q=>q.legacy_rc_id&&q.gradable),at=Date.now()-86400000;
  const legacy={version:1,questions:{[oldRC.question_id]:{attempts:1,correct:1,graded:1,lastAt:at,lastCorrect:true,uncertain:false,selected:oldRC.correct_answer,typed:''}},bookmarks:[oldRC.legacy_passage_id],notes:{[oldRC.legacy_passage_id]:'Original RC note retained during subject practice.'},history:[{qid:oldRC.question_id,at,correct:true,uncertain:false}],session:null};
  await check('original RC attempts, bookmarks, and passage notes remain intact',async()=>{
   const p=await newPage({[RC_KEY]:legacy});await start(p);const rc=await p.evaluate(()=>window.GREReadingBridge.readProgress());assert.deepEqual(rc.notes,legacy.notes);assert.deepEqual(rc.bookmarks,legacy.bookmarks);assert.ok(rc.history.some(h=>h.qid===oldRC.question_id&&h.at===at));assert.ok((await snapshot(p)).attempts.some(a=>a.questionId===oldRC.question_id&&a.at===at));
  });
  await check('old five-section mock archive is preserved and its detailed review remains accessible',async()=>{
   const now=Date.now()-600000,e=Mock.createExam(BANK,{order:'VQVQ'},now);const q=questions.get(e.sections[1].ids[0]);e.responses[q.question_id]={selected:q.correct_answer.slice(),text:'',marked:false,elapsedMs:1000};for(let i=1;i<=5;i++)Mock.advance(e,BANK,now+i*1000);assert.ok(e.endedAt);
   const p=await newPage({[MOCK_KEY]:{version:1,active:null,history:[e],updatedAt:now+5000}});await start(p);assert.equal((await mockState(p)).history[0].id,e.id);await setup(p);await p.locator('.subject-legacy-history summary').click();await p.locator(`[data-mock-history="${e.id}"]`).click();await p.locator('.mock-results-table').waitFor();assert.equal(await p.locator('.mock-review-question').count(),55);assert.equal((await mockState(p)).history[0].sections.length,5);assert.ok((await snapshot(p)).sessions.some(s=>s.mockExamId===e.id));
  });
  await check('an unfinished old mock retains five sections and its original deadline while new practice starts',async()=>{
   const now=Date.now()-1000,e=Mock.createExam(BANK,{order:'QVQV'},now);const p=await newPage({[MOCK_KEY]:{version:1,active:e,history:[],updatedAt:now}});assert.ok(await action(p,'resume').isVisible());await start(p);let old=(await mockState(p)).active;assert.equal(old.id,e.id);assert.equal(old.sections.length,5);assert.equal(old.sections[0].deadline,e.sections[0].deadline);await setup(p);await action(p,'resume').click();await p.locator('#mock-answer-text').waitFor();old=(await mockState(p)).active;assert.equal(old.currentSection,0);assert.equal(old.sections[0].deadline,e.sections[0].deadline);
  });
  await check('mobile selection and random practice remain usable without horizontal overflow',async()=>{
   const p=await newPage({}, {width:390,height:844});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await p.screenshot({path:path.join(__dirname,'qa-subject-mobile.png'),fullPage:true});await p.locator('#subject-count').fill('5');const s=await start(p);assertSession(s,'Verbal',5);assert.ok(await p.locator('.question-stem').isVisible());assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  });
  await check('all new flows run locally without external requests or uncaught browser errors',async()=>{assert.deepEqual(externalRequests,[]);assert.deepEqual(pageErrors,[]);});
 }finally{
  for(const c of contexts)await c.close();await browser.close();fs.writeFileSync(path.join(__dirname,'subject-qa-report.json'),JSON.stringify({testedAt:new Date().toISOString(),entryURL:URL,bankCount:BANK.questions.length,results,pageErrors,externalRequests},null,2));if(results.some(r=>!r.ok)||pageErrors.length||externalRequests.length)process.exitCode=1;
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
