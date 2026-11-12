/* Browser acceptance tests: ephemeral Chromium contexts, no real user profile. */
const { chromium } = require('C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const URL = pathToFileURL(path.join(ROOT, 'dist/index.html')).href + '#rc';
const KEY = 'gre-reading-studio-progress-v1';
const results = [], pageErrors = [];
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name);}catch(e){results.push({name,ok:false,error:e.message});console.log('FAIL',name,e.message);}}
const fresh = () => ({version:1,questions:{},bookmarks:[],notes:{},history:[],session:null});
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto(URL);await page.waitForSelector('.reading-card');
  const data=await page.evaluate(()=>window.GRE_READING_DATA);
  const state=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
  async function open(p,qindex=0){
    await page.locator('nav [data-view="library"]').click();
    await page.locator('[data-action="clear-filters"]').click();
    await page.locator('#search').fill(p.text.slice(0,85));
    await page.locator(`[data-open="${p.id}"]`).click();
    if(qindex)await page.locator(`.question-dots [data-question="${qindex}"]`).click();
    await page.waitForSelector('.question-stem');
  }
  const choose=(kind,graded=true)=>{for(const p of data.passages){const i=p.questions.findIndex(q=>q.kind===kind&&q.gradable===graded&&q.options.length);if(i>=0)return {p,q:p.questions[i],i};}throw Error('No '+kind+' question');};
  const single=choose('single'),multi=choose('multiple'),sentence=choose('sentence'),ungraded=choose('single',false);
  await check('load library and no runtime errors',async()=>{assert.equal(pageErrors.length,0);assert.equal(await page.locator('.reading-card').count(),12);assert.ok(data.passages.length>300);});
  await check('single selection, wrong answer, retry and uncertain correct answer',async()=>{
    await open(single.p,single.i);assert.equal(await page.locator('.feedback').count(),0);assert.equal(await page.locator('.option.correct').count(),0);
    const wrong=single.q.options.find(o=>!single.q.answer.includes(o.id));
    await page.locator(`[data-option="${wrong.id}"]`).click();await page.locator('[data-action="submit"]').click();
    assert.equal((await state()).questions[single.q.id].lastCorrect,false);
    await page.locator('[data-action="retry"]').click();await page.locator(`[data-option="${single.q.answer[0]}"]`).click();await page.locator('#uncertain').check();await page.locator('[data-action="submit"]').click();
    const r=(await state()).questions[single.q.id];assert.equal(r.attempts,2);assert.equal(r.correct,1);assert.equal(r.graded,2);assert.equal(r.uncertain,true);
    await page.locator('nav [data-view="review"]').click();assert.ok(await page.locator(`[data-open="${single.p.id}"]`).count());
  });
  await check('notes and bookmark survive page reload',async()=>{
    await open(single.p,single.i);await page.locator('details').filter({has:page.locator('#reading-note')}).locator('summary').click();
    await page.locator('#reading-note').fill('QA 笔记：先找转折，再定位依据。');
    await page.locator(`[data-bookmark="${single.p.id}"]`).click();await page.reload();await page.locator('#resume').click();
    assert.equal(await page.locator('#reading-note').inputValue(),'QA 笔记：先找转折，再定位依据。');assert.ok((await state()).bookmarks.includes(single.p.id));
  });
  await check('multiple choices toggle and grade by exact complete selection',async()=>{
    await open(multi.p,multi.i);const first=multi.q.answer[0];await page.locator(`[data-option="${first}"]`).click();await page.locator(`[data-option="${first}"]`).click();assert.equal(await page.locator('.option.selected').count(),0);
    for(const id of multi.q.answer)await page.locator(`[data-option="${id}"]`).click();
    await page.locator('[data-action="submit"]').click();assert.equal((await state()).questions[multi.q.id].lastCorrect,true);
  });
  await check('sentence options select and grade original sentence answer',async()=>{
    await open(sentence.p,sentence.i);assert.ok(await page.locator(`[data-option="${sentence.q.answer[0]}"]`).count());await page.locator(`[data-option="${sentence.q.answer[0]}"]`).click();await page.locator('[data-action="submit"]').click();assert.equal((await state()).questions[sentence.q.id].lastCorrect,true);
  });
  await check('unverified question records attempt without affecting graded count',async()=>{
    await open(ungraded.p,ungraded.i);await page.locator('[data-option]').first().click();await page.locator('[data-action="submit"]').click();const r=(await state()).questions[ungraded.q.id];assert.equal(r.lastCorrect,null);assert.equal(r.graded,0);assert.equal(r.attempts,1);
  });
  await check('PDF source and answer references use local files and page anchors',async()=>{
    await open(single.p,single.i);await page.locator('[data-option]').first().click();await page.locator('[data-action="submit"]').click();
    const hrefs=await page.locator('.original-links a').evaluateAll(as=>as.map(a=>a.getAttribute('href')));assert.ok(hrefs.length>=2);
    for(const href of hrefs){assert.match(href,/^sources\/[a-zA-Z0-9._/-]+\.pdf#page=\d+$/);assert.ok(fs.existsSync(path.join(ROOT,'dist',href.split('#')[0])),href);}
  });
  await check('session summary excludes ungraded question from accuracy',async()=>{
    await open(ungraded.p,ungraded.i);await page.locator('[data-option]').first().click();await page.locator('[data-action="submit"]').click();await page.locator('[data-action="finish"]').first().click();
    assert.equal(await page.locator('.session-summary .stat').nth(1).locator('strong').textContent(),'—');
    assert.equal(await page.locator('.session-summary .stat').nth(2).locator('strong').textContent(),'1');
  });
  await check('JSON export contains notes, history and independent application key',async()=>{
    await page.locator('nav [data-view="progress"]').click();const dl=page.waitForEvent('download');await page.locator('[data-action="export"]').click();const download=await dl;const target=path.join(__dirname,'qa-export.json');await download.saveAs(target);const exported=JSON.parse(fs.readFileSync(target,'utf8'));assert.equal(exported.app,'gre-reading-studio');assert.equal(exported.notes[single.p.id],'QA 笔记：先找转折，再定位依据。');assert.ok(exported.history.length>=5);
  });
  await check('invalid JSON import preserves every existing record',async()=>{
    const before=await state();await page.locator('#import-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{oops')});await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('导入失败'));assert.deepEqual(await state(),before);
  });
  await check('valid import merges notes/bookmarks and repeated import deduplicates history',async()=>{
    const imported=fresh(),now=Date.now();imported.bookmarks=[sentence.p.id];imported.notes[sentence.p.id]='导入的句子笔记';imported.questions[sentence.q.id]={attempts:3,correct:2,graded:3,lastAt:now,lastCorrect:true,uncertain:false,selected:sentence.q.answer,typed:''};imported.history=[{qid:sentence.q.id,at:now,correct:true,uncertain:false}];
    const file={name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))};
    await page.locator('#import-file').setInputFiles(file);await page.waitForTimeout(120);const count=(await state()).history.length;
    await page.locator('#import-file').setInputFiles(file);await page.waitForTimeout(120);const r=await state();assert.equal(r.history.length,count);assert.equal(r.notes[sentence.p.id],'导入的句子笔记');assert.equal(r.questions[sentence.q.id].attempts,3);
  });
  await check('all primary views fit mobile width',async()=>{
    await page.setViewportSize({width:375,height:812});for(const view of ['library','review','progress','sources']){await page.locator(`nav [data-view="${view}"]`).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),view);}
    await open(single.p,single.i);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'study');await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(150);await page.screenshot({path:path.join(__dirname,'qa-mobile-study.png'),fullPage:true});
  });
  await check('desktop library screenshot and overflow',async()=>{await page.setViewportSize({width:1440,height:1000});await page.locator('nav [data-view="library"]').click();await page.locator('[data-action="clear-filters"]').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(150);await page.screenshot({path:path.join(__dirname,'qa-desktop-library.png'),fullPage:true});});
  await check('no unexpected runtime errors in core interactions',async()=>assert.deepEqual(pageErrors,[]));
  await check('corrupt saved JSON is retained and surfaced without overwriting',async()=>{
    const c=await browser.newContext();const p=await c.newPage();await p.addInitScript(([k])=>localStorage.setItem(k,'{damaged'),[KEY]);await p.goto(URL);await p.waitForSelector('.notice');assert.equal(await p.evaluate(k=>localStorage.getItem(k),KEY),'{damaged');assert.ok(await p.locator('.reading-card').count());await c.close();
  });
  await check('malformed imported session indices cannot crash resume',async()=>{
    const c=await browser.newContext();const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(URL);await p.waitForSelector('.reading-card');
    const imported=fresh();imported.session={ids:[single.p.id],index:0.5,questionIndex:0.5,startedAt:Date.now(),answers:{},drafts:{}};
    await p.locator('#import-file').setInputFiles({name:'odd-session.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});await p.waitForTimeout(100);await p.locator('#resume').click();await p.waitForTimeout(100);assert.equal(errors.length,0,errors.join('; '));assert.equal(await p.locator('.question-stem').count(),1);await c.close();
  });
  await check('imported attempt counters cannot exceed 100 percent accuracy',async()=>{
    const c=await browser.newContext();const p=await c.newPage();await p.goto(URL);await p.waitForSelector('.reading-card');const imported=fresh();imported.questions[single.q.id]={attempts:2,correct:900,graded:100,lastAt:Date.now(),lastCorrect:true};
    await p.locator('#import-file').setInputFiles({name:'bad-counters.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});await p.waitForTimeout(100);const saved=await p.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);assert.equal(saved.questions[single.q.id].graded,2);assert.equal(saved.questions[single.q.id].correct,2);await c.close();
  });
  await check('oversized imported sessions clamp indices after truncation',async()=>{
    const c=await browser.newContext();const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(URL);await p.waitForSelector('.reading-card');const imported=fresh();imported.session={ids:Array(101).fill(single.p.id),index:100,questionIndex:999,startedAt:Date.now(),answers:{},drafts:{}};
    await p.locator('#import-file').setInputFiles({name:'long-session.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});await p.waitForTimeout(100);await p.locator('#resume').click();await p.waitForTimeout(100);assert.deepEqual(errors,[]);assert.equal(await p.locator('.question-stem').count(),1);const saved=await p.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);assert.ok(saved.session.index<saved.session.ids.length);await c.close();
  });
  fs.writeFileSync(path.join(__dirname,'app-qa-report.json'),JSON.stringify({checkedAt:new Date().toISOString(),stats:data.stats,results,pageErrors},null,2));
  await browser.close();console.log(JSON.stringify({passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length}));
  if(results.some(r=>!r.ok))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
