/* Question AI browser acceptance. All HTTP is intercepted; credentials are fake. */
'use strict';
const {chromium}=require(process.env.GRE_PLAYWRIGHT||'C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),FILE=pathToFileURL(path.join(ROOT,'dist/index.html')).href;
const BANK=JSON.parse(fs.readFileSync(path.join(ROOT,'gre_question_bank.json'),'utf8'));
const Mock=require('../dist/mock-core.js');
const known=BANK.questions.find(q=>q.question_type==='TC1'&&q.gradable&&!q.explanation);
const missing=BANK.questions.find(q=>q.question_type==='TC1'&&!q.gradable&&!q.correct_answer&&!q.explanation&&q.options?.length);
const complete=BANK.questions.find(q=>q.category!=='AWA'&&q.gradable&&q.explanation?.length>30&&q.options?.length);
const reading=BANK.questions.find(q=>q.question_type==='RC1'&&q.gradable&&!q.explanation&&q.material_id);
const awa=BANK.questions.find(q=>q.category==='AWA');
assert.ok(known&&missing&&complete&&reading&&awa,'bank contains representative fixtures');
const KEY='gre-training-progress-v2',FAKE_KEY='sk-qa-question-not-a-real-key',NEW_KEY='sk-qa-question-newer-not-real';
const API='https://api.openai.com/v1/responses',OUT=process.env.GRE_QUESTION_QA_OUTPUT||'C:/Temp/gre-question-ai-qa';
const results=[],errors=[],unexpected=[],contexts=[];
const state=p=>p.evaluate(()=>GREPlatform.getState());
const go=(p,view)=>p.evaluate(view=>GREPlatform.go(view),view);
const area=p=>p.locator('[data-question-ai]').first();
const cached=(p,q)=>p.waitForFunction(id=>['answered','insufficient'].includes(GREPlatform.getState().questionAnalysis?.[id]?.status),q.question_id);
const count=traffic=>traffic.filter(item=>item.url===API).length;
const requestInput=data=>JSON.parse(typeof data.input==='string'?data.input:data.input.flatMap(item=>item.content||[]).find(item=>item.type==='input_text').text);
const seed=extra=>({version:2,attempts:[],favorites:[],vocabulary:[],notes:{},essays:[],drafts:{},sessions:[],session:null,migratedBookmarks:[],updatedAt:Date.now(),...extra});
const output=input=>({status:'answered',answer:input.knownAnswer?.length?input.knownAnswer:input.blankGroups?.length?input.blankGroups.map(group=>group.optionIds[0]):[input.options?.[0]?.id||'1'],explanation:'这是测试用 AI 解析：依据题干中的逻辑关系，逐项比较后得到此参考结论。',reason:''});
const response=value=>({id:'resp_question_qa',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}]});

async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name);}catch(error){results.push({name,ok:false,error:error.stack});console.error('FAIL',name,error.stack);}}
async function settle(p){await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await p.waitForTimeout(120);}
async function settingsOpen(p){const body=p.locator('[data-ai-settings-body]').first();await body.waitFor({state:'attached'});if(!await body.isVisible())await p.locator('[data-ai-action="toggle-settings"]').first().click();}
async function configure(p,key=FAKE_KEY){await settingsOpen(p);await p.locator('[data-ai-key]').first().fill(key);await p.locator('[data-ai-action="configure"]').first().click();await p.waitForFunction(()=>GREVocabularyAI.getQuestionServiceState().ready);}
async function open(p,q){await p.evaluate(id=>GREPlatform.openQuestion(id),q.question_id);await p.locator(q.category==='AWA'?'#essay-text':'.question-stem').first().waitFor();}
async function submit(p,q){const choices=q.correct_answer?.length?q.correct_answer:q.blank_groups?.length>1?q.blank_groups.map(group=>group.options[0].id):[q.options[0].id];for(const id of choices)await p.locator(`[data-poption="${id}"]`).click();await p.locator('[data-paction="submit"]').click();}
async function noOverflow(p,label){const size=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+1,`${label}: ${JSON.stringify(size)}`);}

(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.GRE_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  async function setup({saved=seed(),viewport={width:1440,height:1000},mock={}}={}){
   const c=await browser.newContext({viewport,acceptDownloads:true,reducedMotion:'reduce'});contexts.push(c);
   await c.addInitScript(({key,saved})=>{if(!sessionStorage.getItem('question-qa-seeded')){localStorage.setItem(key,JSON.stringify(saved));sessionStorage.setItem('question-qa-seeded','1');}},{key:KEY,saved});
   const traffic=[],control={status:200,abort:false,hold:null,mode:'answer',build:null,...mock};
   await c.route('**/*',async route=>{
    const request=route.request(),url=request.url();if(!/^https?:/.test(url))return route.continue();
    const headers={'access-control-allow-origin':'null','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type,Authorization,X-GRE-Token','content-type':'application/json'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    const data=request.method()==='POST'?request.postDataJSON():null;traffic.push({url,headers:request.headers(),data});
    if(url!==API){unexpected.push(url);return route.abort();}
    const snapshot={...control},input=requestInput(data);
    if(snapshot.hold)await snapshot.hold;
    if(snapshot.abort)return route.abort('failed');
    if(snapshot.status!==200)return route.fulfill({status:snapshot.status,headers,body:JSON.stringify({error:{message:'Do not render '+FAKE_KEY,code:'qa_error'}})});
    let body;
    if(snapshot.mode==='refusal')body={id:'resp_question_refusal',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'Mock refusal'}]}]};
    else if(snapshot.mode==='invalid')body=response({...output(input),answer:['NOT_AN_OPTION']});
    else if(snapshot.mode==='insufficient')body=response({status:'insufficient',answer:[],explanation:'',reason:'原题信息不足，无法可靠确定答案。'});
    else body=response(snapshot.build?snapshot.build(input):output(input));
    return route.fulfill({status:200,headers,body:JSON.stringify(body)});
   });
   const p=await c.newPage();p.setDefaultTimeout(12000);p.on('pageerror',error=>errors.push(error.message));p.on('dialog',dialog=>dialog.accept());
   await p.goto(FILE+'#vocabulary');await p.waitForFunction(()=>window.GREPlatform&&window.GREVocabularyAI&&window.GREQuestionAI);await go(p,'vocabulary');
   return {p,c,traffic,control};
  }

  let success;
  await check('settings collapse preserves typed input and enabled key without exposing it in saved state',async()=>{
   success=await setup();const {p,traffic}=success;await settingsOpen(p);
   await p.locator('[data-ai-key]').fill(FAKE_KEY);await p.locator('[data-ai-model]').fill('gpt-4.1-mini');
   const toggle=p.locator('[data-ai-action="toggle-settings"]');await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await p.locator('[data-ai-settings-body]').isVisible(),false);
   await toggle.click();assert.equal(await p.locator('[data-ai-key]').inputValue(),FAKE_KEY);assert.equal(await p.locator('[data-ai-model]').inputValue(),'gpt-4.1-mini');
   await p.locator('[data-ai-action="configure"]').click();await p.waitForFunction(()=>GREVocabularyAI.getQuestionServiceState().ready);
   assert.equal(await p.locator('[data-ai-key]').inputValue(),'');assert.equal(count(traffic),0);
   await toggle.click();assert.equal(await p.evaluate(()=>GREVocabularyAI.getQuestionServiceState().ready),true);await toggle.click();
   const saved=await p.evaluate(async()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage},state:GREPlatform.getState(),snapshot:await GREPlatform.snapshotPortable(),service:GREVocabularyAI.getQuestionServiceState(),html:document.documentElement.outerHTML}));assert.ok(!saved.includes(FAKE_KEY));
  });

  await check('known answer with missing explanation is analyzed only after submission using strict Responses schema',async()=>{
   const {p,traffic}=success;await open(p,known);assert.equal(await p.locator('[data-question-ai]').count(),0);assert.equal(count(traffic),0);
   await submit(p,known);await cached(p,known);await area(p).locator('[data-question-ai-explanation]').waitFor();
   assert.match(await area(p).innerText(),/AI/);assert.match(await area(p).locator('[data-question-ai-explanation]').innerText(),/测试用 AI 解析/);
   assert.match(await p.locator('.platform-answer').first().innerText(),/原资料答案/);
   assert.equal((await state(p)).session.responses[known.question_id].correct,true);
   assert.equal(count(traffic),1);const request=traffic.find(item=>item.url===API),input=requestInput(request.data);
   assert.equal(request.headers.authorization,'Bearer '+FAKE_KEY);assert.equal(request.data.store,false);assert.equal(request.data.text.format.name,'gre_question_analysis');assert.equal(request.data.text.format.strict,true);
   assert.equal(input.questionId,known.question_id);assert.equal(input.questionType,known.question_type);assert.equal(input.missingAnswer,false);assert.equal(input.missingExplanation,true);assert.deepEqual(input.knownAnswer,known.correct_answer);assert.equal(input.questionText,known.question_content);assert.deepEqual(input.options.map(option=>option.id),known.options.map(option=>option.id));
   assert.ok(!JSON.stringify(input).includes(FAKE_KEY));
  });

  await check('rendering, navigation and reload reuse the cache without another request or retained key',async()=>{
   const {p,traffic}=success,before=(await state(p)).questionAnalysis[known.question_id],requests=count(traffic);
   await p.locator(`[data-pfavorite="${known.question_id}"]`).click();await settle(p);assert.equal(count(traffic),requests);
   await go(p,'vocabulary');await go(p,'practice');await area(p).locator('[data-question-ai-explanation]').waitFor();assert.equal(count(traffic),requests);
   await p.reload();await p.waitForFunction(()=>window.GREPlatform&&window.GREQuestionAI);await go(p,'practice');await area(p).locator('[data-question-ai-explanation]').waitFor();
   assert.deepEqual((await state(p)).questionAnalysis[known.question_id],before);assert.equal(count(traffic),requests);assert.equal(await p.evaluate(()=>GREVocabularyAI.getQuestionServiceState().ready),false);
   assert.ok(!JSON.stringify(await p.evaluate(()=>({local:{...localStorage},session:{...sessionStorage},state:GREPlatform.getState()}))).includes(FAKE_KEY));success.backup=await p.evaluate(()=>GREPlatform.snapshotPortable());await success.c.close();
  });

  await check('portable backup restores cached question analysis in a fresh profile without a key or network call',async()=>{
   const {p,c,traffic}=await setup();await p.evaluate(backup=>GREPlatform.restorePortable(backup),success.backup);await open(p,known);await submit(p,known);await area(p).locator('[data-question-ai-explanation]').waitFor();
   assert.deepEqual((await state(p)).questionAnalysis[known.question_id],success.backup.progress.questionAnalysis[known.question_id]);assert.equal(count(traffic),0);assert.ok(!JSON.stringify(success.backup).includes(FAKE_KEY));await c.close();
  });

  await check('missing answer and explanation show an AI reference while original answer and grading stay unchanged',async()=>{
   const {p,c,traffic}=await setup();await configure(p);await open(p,missing);const original=await p.evaluate(id=>{const q=GREPlatform.getBank().questions.find(q=>q.question_id===id);return {answer:q.correct_answer,gradable:q.gradable,explanation:q.explanation};},missing.question_id);
   await submit(p,missing);await cached(p,missing);await area(p).locator('[data-question-ai-answer]').waitFor();assert.match(await area(p).innerText(),/AI\s*参考答案/);assert.ok(await area(p).locator('[data-question-ai-answer]').isVisible());
   const saved=await state(p);assert.equal(saved.session.responses[missing.question_id].correct,null);assert.equal(saved.attempts.at(-1).correct,null);
   assert.deepEqual(await p.evaluate(id=>{const q=GREPlatform.getBank().questions.find(q=>q.question_id===id);return {answer:q.correct_answer,gradable:q.gradable,explanation:q.explanation};},missing.question_id),original);
   const input=requestInput(traffic[0].data);assert.equal(input.missingAnswer,true);assert.equal(input.missingExplanation,true);assert.deepEqual(input.knownAnswer,[]);await c.close();
  });

  await check('reading analysis includes its passage and answer context',async()=>{
   const {p,c,traffic}=await setup();await configure(p);await open(p,reading);await submit(p,reading);await cached(p,reading);
   const input=requestInput(traffic[0].data),material=BANK.materials.find(m=>m.id===reading.material_id);
   assert.equal(input.passage,material.text);assert.ok(input.passage.length>100);assert.deepEqual(input.knownAnswer,reading.correct_answer);await c.close();
  });

  await check('complete questions and writing do not trigger question analysis',async()=>{
   const {p,c,traffic}=await setup();await configure(p);await open(p,complete);await submit(p,complete);await settle(p);assert.equal(await p.locator('[data-question-ai]').count(),0);assert.equal(count(traffic),0);
   await open(p,awa);await p.locator('#essay-text').fill('This is an isolated browser test essay.');await p.locator('[data-paction="save-essay"]').click();await settle(p);assert.equal(count(traffic),0);assert.equal(await p.locator('[data-question-ai]').count(),0);await c.close();
  });

  await check('review analysis starts when the submitted question detail opens, without analyzing unopened questions',async()=>{
   const at=Date.now(),ids=[known.question_id,missing.question_id,complete.question_id],responses=Object.fromEntries(ids.map(id=>{const q=BANK.questions.find(q=>q.question_id===id);return [id,{selected:q.correct_answer||[q.options[0].id],text:'',submitted:true,correct:q.gradable?true:null,uncertain:false,elapsedMs:1000}];}));
   const saved=seed({session:{id:'qa-review',ids,index:0,startedAt:at-10000,endedAt:at,mode:'free',instant:false,responses}});
   const {p,c,traffic}=await setup({saved});await configure(p);await go(p,'practice');await p.locator('.session-summary').waitFor();await settle(p);assert.equal(count(traffic),0);
   const detail=p.locator('#platform-content > .stack > details.panel').first();await detail.locator('summary').first().click();await cached(p,known);assert.equal(count(traffic),1);assert.equal(requestInput(traffic[0].data).questionId,known.question_id);
   await detail.locator('summary').first().click();await detail.locator('summary').first().click();await settle(p);assert.equal(count(traffic),1);assert.equal((await state(p)).questionAnalysis[missing.question_id],undefined);await c.close();
  });

  await check('legacy reading generates only after answering and stores its analysis in the shared question cache',async()=>{
   const {p,c,traffic}=await setup();await configure(p);await go(p,'rc');
   const index=await p.evaluate(q=>{const passage=GRE_READING_DATA.passages.find(item=>item.id===q.legacy_passage_id);GREReadingBridge.openPassage(passage.id);return passage.questions.findIndex(item=>item.id===q.legacy_rc_id);},reading);
   assert.ok(index>=0);await p.locator(`#content .question-dots [data-question="${index}"]`).click();await settle(p);assert.equal(count(traffic),0);assert.equal(await p.locator('#content [data-question-ai]').count(),0);
   for(const id of reading.correct_answer)await p.locator(`#content [data-option="${id}"]`).click();await p.locator('#content [data-action="submit"]').click();await cached(p,reading);await p.locator('#content [data-question-ai-explanation]').waitFor();
   assert.equal(count(traffic),1);assert.equal(await p.evaluate(id=>GREReadingBridge.readProgress().session.answers[id].correct,reading.legacy_rc_id),true);await c.close();
  });

  await check('active mock exams never call analysis; completed review requests only the opened question',async()=>{
   const at=Date.now()-1000,exam=Mock.createExam(BANK,{order:'VQVQ'},at,()=>0.23);Mock.advance(exam,BANK,at+1);
   const section=exam.sections[exam.currentSection],qid=section.ids.find(id=>{const q=BANK.questions.find(item=>item.question_id===id);return !q.explanation&&!q.explanation_images?.length;});
   assert.ok(qid,'deterministic mock includes a question needing analysis');const q=BANK.questions.find(item=>item.question_id===qid);exam.index=section.ids.indexOf(qid);
   const {p,c,traffic}=await setup();await configure(p);await p.evaluate(active=>GREMockExam.restorePortable({version:1,active,history:[],updatedAt:Date.now()}),exam);await go(p,'mock');await p.locator('[data-mock-action="resume"]').click();
   await p.locator('.mock-prompt').first().waitFor();for(const id of q.correct_answer)await p.locator(`[data-mock-option="${id}"]`).click();await p.locator('[data-mock-action="mark"]').click();await settle(p);assert.equal(count(traffic),0);assert.equal(await p.locator('#mock-content [data-question-ai]').count(),0);
   await p.locator('[data-mock-action="end-exam"]').click();await p.locator('[data-mock-action="confirm-abort"]').click();await p.locator('.mock-results-table').waitFor();await settle(p);assert.equal(count(traffic),0);
   const detail=p.locator('.mock-review-question').filter({has:p.locator(`[data-question-ai="${qid}"]`)});await detail.locator('summary').first().click();await cached(p,q);assert.equal(count(traffic),1);assert.equal(requestInput(traffic[0].data).questionId,qid);
   await detail.locator('summary').first().click();await detail.locator('summary').first().click();await settle(p);assert.equal(count(traffic),1);await c.close();
  });

  for(const [label,mock,pattern]of [['invalid answer',{mode:'invalid'},/结果不完整|答案无法对应/],['model refusal',{mode:'refusal'},/未得到可用/],['network error',{abort:true},/无法连接/],['model configuration error',{status:404},/模型.*不可用|请求配置不可用/]]){
   await check(`${label} preserves grading, avoids automatic retry loops, and allows explicit retry`,async()=>{
    const {p,c,traffic,control}=await setup({mock});await configure(p);await open(p,missing);await submit(p,missing);
    await p.waitForFunction(pattern=>{const el=document.querySelector('[data-question-ai-action="retry"]');return el&&!el.disabled&&new RegExp(pattern).test(document.querySelector('[data-question-ai-status]')?.textContent||'');},pattern.source);assert.match(await area(p).locator('[data-question-ai-status]').innerText(),pattern);
    const retry=await area(p).locator('[data-question-ai-action="retry"]').elementHandle();await settle(p);assert.equal(await retry.evaluate(node=>node.isConnected),true,'idle retry button must not be replaced every frame');
    assert.equal((await state(p)).session.responses[missing.question_id].correct,null);assert.equal((await state(p)).questionAnalysis?.[missing.question_id]?.status==='answered',false);
    await p.locator(`[data-pfavorite="${missing.question_id}"]`).click();await go(p,'vocabulary');await go(p,'practice');await settle(p);assert.equal(count(traffic),1);
    control.mode='answer';control.abort=false;control.status=200;await area(p).locator('[data-question-ai-action="retry"]').click();await cached(p,missing);assert.equal(count(traffic),2);await c.close();
   });
  }

  await check('insufficient information is displayed and cached without inventing an answer or retrying',async()=>{
   const {p,c,traffic}=await setup({mock:{mode:'insufficient'}});await configure(p);await open(p,missing);await submit(p,missing);await cached(p,missing);await area(p).locator('[data-question-ai-status]').filter({hasText:'信息不足'}).waitFor();assert.match(await area(p).innerText(),/信息不足/);
   assert.deepEqual((await state(p)).questionAnalysis[missing.question_id].answer,[]);await go(p,'vocabulary');await go(p,'practice');await settle(p);assert.equal(count(traffic),1);await c.close();
  });

  await check('clearing the key during an in-flight analysis prevents the old result from being cached',async()=>{
   let release;const hold=new Promise(resolve=>release=resolve),{p,c,traffic}=await setup({mock:{hold}});
   try{await configure(p);await open(p,missing);await submit(p,missing);await p.waitForFunction(()=>/分析|生成|请求/.test(document.querySelector('[data-question-ai-status]')?.textContent||''));
    for(let i=0;i<100&&!count(traffic);i++)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(count(traffic),1);
    await go(p,'vocabulary');await settingsOpen(p);await p.locator('[data-ai-action="clear-key"]').click();assert.equal(await p.evaluate(()=>GREVocabularyAI.getQuestionServiceState().ready),false);release();await settle(p);await go(p,'practice');await settle(p);
    assert.equal((await state(p)).questionAnalysis?.[missing.question_id]?.status==='answered',false);assert.equal(count(traffic),1);
   }finally{release();await c.close();}
  });

  await check('a stale authentication error cannot disable a replacement key or overwrite its successful analysis',async()=>{
   let release;const hold=new Promise(resolve=>release=resolve),{p,c,traffic,control}=await setup({mock:{status:401,hold}});
   try{await configure(p);await open(p,missing);await submit(p,missing);for(let i=0;i<100&&!count(traffic);i++)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(count(traffic),1);
    control.status=200;control.hold=null;await go(p,'vocabulary');await configure(p,NEW_KEY);release();await go(p,'practice');
    await cached(p,missing);assert.equal(await p.evaluate(()=>GREVocabularyAI.getQuestionServiceState().ready),true);assert.equal(traffic.at(-1).headers.authorization,'Bearer '+NEW_KEY);assert.equal(count(traffic),2);
   }finally{release();await c.close();}
  });

  await check('automatic analysis can be disabled and API settings can be opened from the question',async()=>{
   const {p,c,traffic}=await setup();await configure(p);await p.locator('[data-ai-auto-question]').uncheck();await open(p,missing);await submit(p,missing);await settle(p);assert.equal(count(traffic),0);
   await area(p).locator('[data-question-ai-action="settings"]').click();await p.locator('[data-ai-key]').first().waitFor();assert.equal(await p.locator('[data-ai-settings-body]').first().isVisible(),true);assert.equal(await p.locator('[data-ai-auto-question]').first().isChecked(),false);await c.close();
  });

  await check('mobile analysis and collapsible settings fit the viewport and escape model text',async()=>{
   const injection='<img src=x onerror="window.qaQuestionInjected=true">';const {p,c}=await setup({viewport:{width:390,height:844},mock:{build:input=>({...output(input),explanation:injection})}});await configure(p);await noOverflow(p,'mobile settings');await p.locator('[data-ai-action="toggle-settings"]').click();await noOverflow(p,'mobile collapsed settings');await open(p,missing);await submit(p,missing);await cached(p,missing);await area(p).locator('[data-question-ai-explanation]').waitFor();
   assert.ok((await area(p).innerText()).includes(injection));assert.equal(await area(p).locator('img,script').count(),0);assert.equal(await p.evaluate(()=>!!window.qaQuestionInjected),false);await noOverflow(p,'mobile question analysis');await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await p.screenshot({path:path.join(OUT,'question-ai-mobile.png'),fullPage:true,animations:'disabled'});await c.close();
  });

  await check('no unexpected network requests or uncaught browser errors occurred',async()=>{assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);});
 }finally{
  for(const context of contexts)await context.close();await browser.close();
  fs.writeFileSync(path.join(OUT,'question-ai-browser-report.json'),JSON.stringify({testedAt:new Date().toISOString(),mockedOpenAI:true,results,errors,unexpected},null,2));
  if(results.some(result=>!result.ok)||errors.length||unexpected.length)process.exitCode=1;
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
