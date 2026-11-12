/* Offline acceptance for question vocabulary. Uses isolated Chrome contexts,
 * real bundled questions, and the same import/export controls as the user. */
const {chromium}=require('C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),URL=pathToFileURL(path.join(ROOT,'dist/index.html')).href;
const BANK=JSON.parse(fs.readFileSync(path.join(ROOT,'gre_question_bank.json'),'utf8'));
const Core=require('../dist/platform-core.js');
const materials=new Map(BANK.materials.map(m=>[m.id,m]));
const KEY='gre-training-progress-v2',results=[],pageErrors=[],externalRequests=[],contexts=[];
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gre-vocabulary-qa-'));
const byType=t=>BANK.questions.find(q=>q.question_type===t&&q.gradable);
const reading=length=>BANK.questions.find(q=>q.question_type==='RC1'&&q.gradable&&materials.get(q.material_id)?.length===length);
const snapshot=p=>p.evaluate(()=>GREPlatform.getState());
const go=(p,view)=>p.evaluate(view=>GREPlatform.go(view),view);
const panel=(p,q)=>p.locator(`.vocabulary-panel[data-vocab-question="${q.question_id}"]`);
async function open(p,q){await p.evaluate(id=>GREPlatform.openQuestion(id),q.question_id);await p.locator('.question-stem').waitFor();}
async function answer(p,q){
 if(Core.mode(q)==='numeric')await p.locator('#p-response-text').fill(q.correct_answer[0]);
 else for(const id of q.correct_answer)await p.locator(`[data-poption="${id}"]`).click();
 await p.locator('[data-paction="submit"]').click();
}
async function addManual(p,q,word){
 const form=panel(p,q).locator('.vocabulary-form');
 await form.locator('[name="word"]').fill(word);
 await form.locator('button[type="submit"]').click();
}
async function importBackup(p,data){
 await go(p,'materials');
 await p.locator('[data-paction="import-progress"]').click();
 await p.locator('#platform-import').setInputFiles({name:'vocabulary-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
 await p.waitForFunction(()=>document.querySelector('#platform-import').value==='');
 assert.doesNotMatch(await p.locator('#toast').innerText(),/导入失败/);
}
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name);}catch(e){results.push({name,ok:false,error:e.stack||e.message});console.log('FAIL',name,e.stack||e.message);}}

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  async function newPage(seed,viewport={width:1440,height:1000}){
   const context=await browser.newContext({viewport,acceptDownloads:true});contexts.push(context);
   if(seed)await context.addInitScript(({key,seed})=>{if(!sessionStorage.getItem('vocabulary-qa-seeded')){localStorage.setItem(key,JSON.stringify(seed));sessionStorage.setItem('vocabulary-qa-seeded','1');}},{key:KEY,seed});
   const p=await context.newPage();p.setDefaultTimeout(12000);
   p.on('pageerror',e=>pageErrors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))externalRequests.push(r.url());});
   await p.goto(URL);await p.waitForFunction(()=>!!window.GREPlatform&&!!window.GREVocabulary);return p;
  }
  const p=await newPage(),tc=byType('TC1'),tc2=byType('TC2');let word,backup;
  await check('vocabulary appears only after submitting an eligible question and saves the selected word with its source',async()=>{
   await open(p,tc);assert.equal(await p.locator('.vocabulary-panel').count(),0);
   await answer(p,tc);await panel(p,tc).waitFor();
   const button=panel(p,tc).locator('[data-vocab-word]').first();word=await button.getAttribute('data-vocab-word');assert.ok(word);
   await button.click();
   const s=await snapshot(p),entry=s.vocabulary.find(e=>e.word===word);
   assert.ok(entry);assert.equal(entry.sources.length,1);assert.equal(entry.sources[0].questionId,tc.question_id);assert.ok(entry.sources[0].context.trim());assert.ok(entry.sources[0].source.trim());
   const saved=panel(p,tc).locator(`[data-vocab-word="${word}"]`).first();assert.equal(await saved.isDisabled(),true);assert.equal(await saved.getAttribute('aria-pressed'),'true');
   assert.equal(s.session.responses[tc.question_id].correct,true);
  });
  await check('case and whitespace variants do not duplicate a word or its same-question source',async()=>{
   await addManual(p,tc,'  '+word.toUpperCase()+'  ');
   const entries=(await snapshot(p)).vocabulary.filter(e=>e.word===word);assert.equal(entries.length,1);assert.equal(entries[0].sources.length,1);
  });
  await check('the same word on another question preserves both sources without duplicate vocabulary entries',async()=>{
   await open(p,tc2);await answer(p,tc2);await addManual(p,tc2,word);
   const entries=(await snapshot(p)).vocabulary.filter(e=>e.word===word);assert.equal(entries.length,1);
   assert.deepEqual(new Set(entries[0].sources.map(s=>s.questionId)),new Set([tc.question_id,tc2.question_id]));
  });
  await check('saved vocabulary and submitted answers survive reload and resume',async()=>{
   const before=await snapshot(p);await p.reload();await p.waitForFunction(()=>!!window.GREPlatform);
   const after=await snapshot(p);assert.deepEqual(after.vocabulary,before.vocabulary);assert.deepEqual(after.attempts,before.attempts);
   await p.locator('[data-mock-action="resume-subject"]').click();await panel(p,tc2).waitFor();
   assert.equal((await snapshot(p)).session.responses[tc2.question_id].submitted,true);
  });
  await check('completed-session review keeps vocabulary collection available for answered questions',async()=>{
   await p.locator('[data-paction="finish"]').first().click();await p.locator('.session-result-title').waitFor();
   const review=panel(p,tc2);await review.locator('xpath=ancestor::details').first().locator('summary').first().click();
   await addManual(p,tc2,'under the weather');assert.ok((await snapshot(p)).vocabulary.some(e=>e.word==='under the weather'));
  });
  for(const type of ['TC3','SE','TC_LEGACY','RCMultiple','RCSentence'])await check(type+' supports vocabulary after its normal answer submission',async()=>{
   const q=byType(type);assert.ok(q);await open(p,q);assert.equal(await p.locator('.vocabulary-panel').count(),0);await answer(p,q);assert.ok(await panel(p,q).isVisible());assert.ok(await panel(p,q).locator('[data-vocab-word]').count()>0);
  });
  for(const length of ['短篇','中篇'])await check(length+' RC supports passage vocabulary',async()=>{
   const q=reading(length);assert.ok(q);await open(p,q);await answer(p,q);assert.ok(await panel(p,q).isVisible());
   const passageWords=(materials.get(q.material_id).text||materials.get(q.material_id).paragraphs?.join(' ')||'').toLowerCase().match(/[a-z]{3,}/g)||[];
   const candidates=await panel(p,q).locator('[data-vocab-word]').evaluateAll(es=>es.map(e=>e.dataset.vocabWord));assert.ok(passageWords.some(w=>candidates.includes(w)));
  });
  await check('long RC, Quant, and writing do not offer the new vocabulary panel',async()=>{
   for(const q of [reading('长篇'),byType('QuantSingle')]){assert.ok(q);await open(p,q);await answer(p,q);assert.equal(await p.locator('.vocabulary-panel').count(),0);}
   const writing=BANK.questions.find(q=>q.category==='AWA');await p.evaluate(id=>GREPlatform.openQuestion(id),writing.question_id);await p.locator('#essay-text').waitFor();assert.equal(await p.locator('.vocabulary-panel').count(),0);
  });
  await check('the wordbook exposes saved words and supports case-insensitive search',async()=>{
   await p.locator('#platform-nav [data-pview="vocabulary"]').click();await p.locator('.vocabulary-entry').first().waitFor();
   await p.locator('#vocabulary-search').fill(word.toUpperCase());assert.ok((await p.locator('.vocabulary-entry').allTextContents()).some(t=>t.toLowerCase().includes(word)));
   await p.locator('#vocabulary-search').fill('no-match-for-vocabulary-qa');assert.equal(await p.locator('.vocabulary-entry').count(),0);
   await p.locator('#vocabulary-search').fill('');assert.ok(await p.locator('.vocabulary-entry').count()>=2);
  });
  await check('an actual progress download includes vocabulary, and import into a fresh profile restores it exactly',async()=>{
   await go(p,'materials');const downloaded=p.waitForEvent('download');await p.locator('[data-paction="export-progress"]').click();
   const file=path.join(temp,'progress.json');await(await downloaded).saveAs(file);backup=JSON.parse(fs.readFileSync(file,'utf8'));assert.deepEqual(backup.progress.vocabulary,(await snapshot(p)).vocabulary);
   const fresh=await newPage();await importBackup(fresh,backup);assert.deepEqual((await snapshot(fresh)).vocabulary,backup.progress.vocabulary);
   await importBackup(fresh,backup);assert.deepEqual((await snapshot(fresh)).vocabulary,backup.progress.vocabulary);
   await fresh.reload();await fresh.waitForFunction(()=>!!window.GREPlatform);assert.deepEqual((await snapshot(fresh)).vocabulary,backup.progress.vocabulary);
  });
  await check('old backups without vocabulary load safely and merge without erasing saved words',async()=>{
   assert.ok(backup);const old=JSON.parse(JSON.stringify(backup));delete old.progress.vocabulary;
   const oldProfile=await newPage(old.progress);assert.deepEqual((await snapshot(oldProfile)).vocabulary,[]);
   const before=(await snapshot(p)).vocabulary;await importBackup(p,old);assert.deepEqual((await snapshot(p)).vocabulary,before);
  });
  await check('removing a word from the wordbook persists without changing question history',async()=>{
   const before=(await snapshot(p)).attempts;await go(p,'vocabulary');await p.locator(`[data-vocab-remove="${word}"]`).click();
   assert.ok(!(await snapshot(p)).vocabulary.some(e=>e.word===word));assert.deepEqual((await snapshot(p)).attempts,before);
   await p.reload();await p.waitForFunction(()=>!!window.GREPlatform);assert.ok(!(await snapshot(p)).vocabulary.some(e=>e.word===word));
  });
  await check('collection reports an unsaved word when both localStorage and IndexedDB fail',async()=>{
   const failing=await newPage();await open(failing,tc);await answer(failing,tc);await panel(failing,tc).waitFor();
   await failing.evaluate(()=>{
    Storage.prototype.setItem=function(){throw new DOMException('QA storage full','QuotaExceededError');};
    IDBDatabase.prototype.transaction=function(){throw new DOMException('QA database unavailable','InvalidStateError');};
   });
   const chip=panel(failing,tc).locator('[data-vocab-word]').first(),failedWord=await chip.getAttribute('data-vocab-word');await chip.click();
   await failing.waitForFunction(()=>/未保存|未能保存|导出/.test(document.querySelector('#toast').textContent));
   assert.ok((await snapshot(failing)).vocabulary.some(e=>e.word===failedWord));
   assert.match(await panel(failing,tc).locator('.vocabulary-count').innerText(),/未保存|未能保存|导出/);
   assert.doesNotMatch(await failing.locator('#toast').innerText(),/已保存「/);
  });
  await check('duplicate words preserve the context of the group actually clicked, including the stem for option words',async()=>{
   const q=BANK.questions.find(q=>q.question_id==='verbal-gwc1500-s072-q03');assert.ok(q);
   for(const fromStem of [true,false]){
    const contextPage=await newPage();await open(contextPage,q);await answer(contextPage,q);
    const area=panel(contextPage,q),matches=area.locator('[data-vocab-word="powerful"]');assert.equal(await matches.count(),2);
    const chip=fromStem?matches.last():matches.first();
    if(fromStem)await chip.locator('xpath=ancestor::details').locator('summary').click();
    const clickedContext=await chip.getAttribute('data-vocab-context');assert.ok(clickedContext);
    assert.notEqual(clickedContext,await (fromStem?matches.first():matches.last()).getAttribute('data-vocab-context'));
    await chip.click();
    const entry=(await snapshot(contextPage)).vocabulary.find(e=>e.word==='powerful'),savedContext=entry.sources[0].context;
    if(fromStem)assert.equal(savedContext,clickedContext);
    else{assert.ok(savedContext.startsWith(clickedContext),'the clicked option text is retained first');assert.ok(savedContext.includes(q.question_content),'option source must also retain the original question stem');}
   }
  });
  await check('phone layout supports collecting and viewing words without horizontal overflow',async()=>{
   const mobile=await newPage(undefined,{width:390,height:844});await open(mobile,tc2);await answer(mobile,tc2);await panel(mobile,tc2).locator('[data-vocab-word]').first().click();
   await panel(mobile,tc2).scrollIntoViewIfNeeded();assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
   await mobile.locator('#toast').waitFor({state:'hidden'});await mobile.evaluate(()=>scrollTo(0,0));
   await mobile.screenshot({path:path.join(__dirname,'qa-vocabulary-mobile.png'),fullPage:true});await go(mobile,'vocabulary');assert.ok(await mobile.locator('.vocabulary-entry').first().isVisible());assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  });
  await check('vocabulary works offline without external requests or uncaught browser errors',async()=>{assert.deepEqual(externalRequests,[]);assert.deepEqual(pageErrors,[]);});
 }finally{
  for(const c of contexts)await c.close();await browser.close();
  fs.writeFileSync(path.join(__dirname,'vocabulary-qa-report.json'),JSON.stringify({testedAt:new Date().toISOString(),entryURL:URL,results,pageErrors,externalRequests},null,2));
  if(results.some(r=>!r.ok)||pageErrors.length||externalRequests.length)process.exitCode=1;
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
