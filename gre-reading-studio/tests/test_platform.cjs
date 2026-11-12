/* Real Chrome acceptance checks. Every browser context is temporary; no user profile. */
const {chromium}=require('C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const {pathToFileURL}=require('node:url');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),URL=pathToFileURL(path.join(ROOT,'dist/index.html')).href+'#home';
const KEY='gre-training-progress-v2',RC_KEY='gre-reading-studio-progress-v1';
const results=[],pageErrors=[],contexts=[];let bankCount=0,localAssetsChecked=0;
const fresh=()=>({version:2,attempts:[],favorites:[],notes:{},essays:[],drafts:{},sessions:[],session:null,migratedBookmarks:[],updatedAt:0});
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name);}catch(e){results.push({name,ok:false,error:e.message});console.log('FAIL',name,e.message);}}
async function streamText(download){const stream=await download.createReadStream();let chunks=[];for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks).toString('utf8');}
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  async function newPage(seed={},viewport={width:1440,height:1000}){
    const context=await browser.newContext({viewport,acceptDownloads:true});contexts.push(context);
    if(Object.keys(seed).length)await context.addInitScript(({seed})=>{if(!sessionStorage.getItem('qa-seeded')){for(const[k,v]of Object.entries(seed))localStorage.setItem(k,JSON.stringify(v));sessionStorage.setItem('qa-seeded','1');}},{seed});
    const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>pageErrors.push(e.message));
    await page.goto(URL);await page.waitForFunction(()=>!!window.GREPlatform);await page.locator('#platform-main').waitFor({state:'visible'});return page;
  }
  const page=await newPage();
  const state=p=>p.evaluate(()=>window.GREPlatform.getState());
  const open=async(p,q)=>{await p.evaluate(id=>window.GREPlatform.openQuestion(id),q.question_id);await p.locator('#platform-content .question-stem, #essay-text').first().waitFor();};
  const go=async(p,v)=>{await p.evaluate(v=>window.GREPlatform.go(v),v);};
  const choose=async(p,type,gradable=true)=>{const q=await p.evaluate(({type,gradable})=>window.GREPlatform.getBank().questions.find(q=>q.question_type===type&&(gradable===null||q.gradable===gradable)),{type,gradable});assert.ok(q,'No real '+type+' question');return q;};
  const pick=async(p,id)=>p.locator(`[data-poption="${id}"]`).click();
  const submit=async p=>p.locator('[data-paction="submit"]').click();
  const latest=async(p,q)=>(await state(p)).attempts.filter(a=>a.questionId===q.question_id).at(-1);
  const cfg=async(p,key,value)=>{const el=p.locator(`[data-config="${key}"]`);const tag=await el.evaluate(e=>e.tagName);if(tag==='SELECT')await el.selectOption(value);else if(typeof value==='boolean')await el.setChecked(value);else{await el.fill(String(value));await el.dispatchEvent('change');}};
  const importProgress=async(p,input)=>{await go(p,'materials');await p.locator('[data-paction="import-progress"]').click();await p.locator('#platform-import').setInputFiles({name:'progress.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input))});await p.waitForFunction(()=>document.querySelector('#platform-import').value==='');assert.ok(!(await p.locator('#toast').textContent()).includes('导入失败'),await p.locator('#toast').textContent());};
  const tc2=await choose(page,'TC2'),tc3=await choose(page,'TC3'),se=await choose(page,'SE'),qc=await choose(page,'QC'),numeric=await choose(page,'NumericEntry'),di=await page.evaluate(()=>window.GREPlatform.getBank().questions.find(q=>q.question_type==='DI'&&q.gradable&&q.material_id&&q.options?.length)),rc=await choose(page,'RC1'),awa=await choose(page,'Issue',null);
  await check('offline file:// startup and real question bank available',async()=>{assert.equal(pageErrors.length,0);bankCount=await page.evaluate(()=>window.GREPlatform.getBank().questions.length);assert.ok(bankCount>5000);assert.ok(await page.locator('.platform-question-card').count());assert.ok(URL.startsWith('file:'));});
  for(const q of [tc2,tc3])await check(q.question_type+' enforces one selection per blank and all-or-nothing grading',async()=>{
    await open(page,q);assert.equal(await page.locator('.blank-group').count(),q.blank_groups.length);assert.ok(await page.locator('[data-paction="submit"]').isDisabled());
    const first=q.blank_groups[0];await pick(page,first.options[0].id);await pick(page,first.options[1].id);assert.equal(await page.locator('.blank-group').first().locator('.selected').count(),1);assert.ok(await page.locator('[data-paction="submit"]').isDisabled());
    for(const g of q.blank_groups)await pick(page,g.options.find(o=>q.correct_answer.includes(o.id)).id);
    assert.equal(await page.locator('[data-poption].selected').count(),q.blank_groups.length);await submit(page);assert.equal((await latest(page,q)).correct,true);
    await open(page,q);for(const g of q.blank_groups)await pick(page,g.options.find(o=>q.correct_answer.includes(o.id)).id);await pick(page,first.options.find(o=>!q.correct_answer.includes(o.id)).id);await submit(page);assert.equal((await latest(page,q)).correct,false);
  });
  await check('SE requires exactly two, blocks third choice, and grades pair as a set',async()=>{
    await open(page,se);assert.equal(await page.locator('[data-poption]').count(),6);await pick(page,se.correct_answer[0]);assert.ok(await page.locator('[data-paction="submit"]').isDisabled());await pick(page,se.correct_answer[1]);const wrong=se.options.find(o=>!se.correct_answer.includes(o.id));await pick(page,wrong.id);assert.equal(await page.locator('[data-poption].selected').count(),2);assert.equal(await page.locator(`[data-poption="${wrong.id}"]`).getAttribute('aria-pressed'),'false');await page.locator('#p-uncertain').check();await submit(page);assert.equal((await latest(page,se)).correct,true);assert.equal((await latest(page,se)).uncertain,true);
    await go(page,'errors');assert.ok(await page.locator(`[data-popen="${se.question_id}"]`).count());
    await open(page,se);await pick(page,se.correct_answer[0]);await pick(page,wrong.id);await submit(page);assert.equal((await latest(page,se)).correct,false);
  });
  await check('QC uses four answers and original quantities or source image',async()=>{await open(page,qc);assert.equal(await page.locator('[data-poption]').count(),4);assert.ok(await page.locator('.quantity-pair,.question-image').count());await pick(page,qc.correct_answer[0]);await submit(page);assert.equal((await latest(page,qc)).correct,true);});
  await check('numeric entry is free input, accepts exact equivalent fractions, rejects invalid division',async()=>{
    await open(page,numeric);assert.equal(await page.locator('[data-poption]').count(),0);await page.locator('#p-response-text').fill('1/0');assert.ok(await page.locator('[data-paction="submit"]').isDisabled());
    const equiv=await page.evaluate(id=>{const q=window.GREPlatform.getBank().questions.find(q=>q.question_id===id),r=window.GRECore.rational(q.correct_answer[0]);return String(r[0]*2n)+'/'+String(r[1]*2n);},numeric.question_id);
    await page.locator('#p-response-text').fill(equiv);await submit(page);assert.equal((await latest(page,numeric)).correct,true);
    const strict=await page.evaluate(()=>{const c=window.GRECore,q={category:'Quant',question_type:'NumericEntry',answer_status:'verified',gradable:true,correct_answer:['1/2']};return [c.grade(q,{text:'.5'}),c.grade(q,{text:'2/4'}),c.grade(q,{text:'0.5001'}),c.grade(q,{text:'1/0'})];});assert.deepEqual(strict,[true,true,false,false]);
  });
  await check('DI material and diagram load from local original assets',async()=>{
    await open(page,di);assert.ok(di.material_id);assert.ok(await page.locator('.platform-material').count());const imgs=page.locator('.platform-material img');assert.ok(await imgs.count());await imgs.first().scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelectorAll('.platform-material img')].every(i=>i.complete&&i.naturalWidth>0));const refs=await page.locator('.platform-material a[href]').evaluateAll(as=>as.map(a=>a.getAttribute('href')));assert.ok(refs.every(u=>!/^https?:/.test(u)));await pick(page,di.correct_answer[0]);await submit(page);assert.equal((await latest(page,di)).correct,true);
  });
  await check('DI with an embedded table keeps numeric input and its complete original image',async()=>{
    const q=await page.evaluate(()=>window.GREPlatform.getBank().questions.find(q=>q.question_type==='DI'&&q.gradable&&q.response_type==='numeric'&&q.images?.length));assert.ok(q);await open(page,q);assert.equal(await page.locator('[data-poption]').count(),0);await page.locator('.question-image').first().scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelectorAll('.question-panel img')].every(i=>i.complete&&i.naturalWidth>0));await page.locator('#p-response-text').fill(q.correct_answer[0]);await submit(page);assert.equal((await latest(page,q)).correct,true);
  });
  await check('unverified numeric response accepts a symbolic note without inventing a score',async()=>{
    const q=await choose(page,'NumericEntry',false);await open(page,q);await page.locator('#p-response-text').fill('sqrt(2)');assert.ok(!(await page.locator('[data-paction="submit"]').isDisabled()));await submit(page);assert.equal((await latest(page,q)).correct,null);assert.equal((await latest(page,q)).text,'sqrt(2)');
  });
  await check('unverified question never contributes to formal scoring',async()=>{const q=await page.evaluate(()=>window.GREPlatform.getBank().questions.find(q=>!q.gradable&&q.category!=='AWA'&&q.options?.length>0&&!q.blank_groups?.length));assert.ok(q);await open(page,q);await pick(page,q.options[0].id);if(q.question_type==='SE')await pick(page,q.options[1].id);await submit(page);assert.equal((await latest(page,q)).correct,null);});
  await check('combined source/type/difficulty/status filters and count are applied',async()=>{
    await go(page,'home');await cfg(page,'subject','Verbal');await cfg(page,'sources',[tc3.source_id]);await cfg(page,'difficulty',tc3.difficulty);await cfg(page,'status','new');await page.locator('[data-ptype="TC3"]').check();await cfg(page,'count',3);const expected=await page.evaluate(({id,difficulty})=>{const b=window.GREPlatform.getBank(),done=new Set(window.GREPlatform.getState().attempts.map(a=>a.questionId));return b.questions.filter(q=>q.category==='Verbal'&&q.question_type==='TC3'&&q.difficulty===difficulty&&!done.has(q.question_id)&&[q.source_id,...(q.source_refs||[]).map(r=>r.source_id||r.sourceId)].includes(id)).map(q=>q.question_id);},{id:tc3.source_id,difficulty:tc3.difficulty});assert.ok(expected.length>0);await page.locator('[data-paction="start"]').click();const ids=(await state(page)).session.ids;assert.equal(ids.length,Math.min(3,expected.length));assert.ok(ids.every(id=>expected.includes(id)));
  });
  await check('delayed answers remain hidden until session completion',async()=>{
    await go(page,'home');await cfg(page,'mode','exam');await open(page,tc2);for(const id of tc2.correct_answer)await pick(page,id);await submit(page);assert.equal(await page.locator('.option.correct').count(),0);assert.ok((await page.locator('.platform-answer').textContent()).includes('结束后'));await page.locator('[data-paction="finish"]').first().click();assert.ok((await page.locator('#platform-content').textContent()).includes('原资料答案'));
  });
  await check('timer expiry saves completed responses and closes session',async()=>{
    await go(page,'home');await cfg(page,'mode','timed');await cfg(page,'minutes',1);await open(page,qc);await pick(page,qc.correct_answer[0]);await page.evaluate(()=>{const original=Date.now.bind(Date);Date.now=()=>original()+61000;});await page.waitForSelector('.session-result-title');const s=(await state(page)).session;assert.ok(s.endedAt);assert.equal(s.responses[qc.question_id].correct,true);await page.reload();await page.waitForFunction(()=>!!window.GREPlatform);
  });
  await check('favorites, notes and repeated attempt history survive reload',async()=>{
    await open(page,qc);await page.locator('[data-pfavorite]').first().click();await page.locator('details').filter({has:page.locator('#p-note')}).locator('summary').click();await page.locator('#p-note').fill('QA 数量比较笔记');const before=await state(page);await page.reload();await page.waitForFunction(()=>!!window.GREPlatform);const after=await state(page);assert.deepEqual(after.attempts,before.attempts);assert.equal(after.notes[qc.question_id],'QA 数量比较笔记');assert.ok(after.favorites.includes(qc.question_id));
  });
  await check('AWA auto-saves draft, preserves historical versions and exports original essay',async()=>{
    await open(page,awa);await page.locator('#essay-text').fill('First original draft. Evidence matters.');await page.reload();await page.waitForFunction(()=>!!window.GREPlatform);await open(page,awa);assert.equal(await page.locator('#essay-text').inputValue(),'First original draft. Evidence matters.');await page.locator('[data-paction="save-essay"]').click();await page.locator('#essay-text').fill('Second original draft. A revised argument.');await page.locator('[data-paction="save-essay"]').click();const es=(await state(page)).essays.filter(e=>e.questionId===awa.question_id);assert.equal(es.length,2);assert.equal(es[0].text,'First original draft. Evidence matters.');const dl=page.waitForEvent('download');await page.locator('[data-paction="export-essay"]').click();const text=await streamText(await dl);assert.ok(text.includes('Second original draft. A revised argument.'));assert.ok(text.includes(awa.question_content));await page.locator('[data-paction="essay-history"]').click();assert.ok((await page.locator('#platform-content').textContent()).includes('First original draft. Evidence matters.'));
  });
  await check('standalone saved AWA contributes ungraded completed attempts to analysis',async()=>{const s=await state(page);assert.ok(s.attempts.some(a=>a.questionId===awa.question_id&&a.correct===null));});
  await check('mixed session retains original TC, SE, numeric, RC, DI and writing components',async()=>{
    const ids=[tc2,tc3,se,qc,numeric,di,rc,awa].map(q=>q.question_id);const p=await newPage({[KEY]:{...fresh(),favorites:ids,updatedAt:Date.now()}});await cfg(p,'status','saved');await cfg(p,'count',ids.length);await p.locator('[data-paction="start"]').click();const s=(await state(p)).session;assert.equal(s.ids.length,ids.length);assert.deepEqual(new Set(s.ids),new Set(ids));
    for(let i=0;i<s.ids.length;i++){await p.locator(`.platform-qnav [data-pnext="${i}"]`).click();const q=await p.evaluate(id=>window.GREPlatform.getBank().questions.find(q=>q.question_id===id),s.ids[i]);if(q.question_type==='TC2'||q.question_type==='TC3')assert.equal(await p.locator('.blank-group').count(),q.blank_groups.length);if(q.question_type==='SE')assert.equal(await p.locator('[data-poption]').count(),6);if(q.question_type==='NumericEntry')assert.equal(await p.locator('.numeric-entry input').count(),1);if(q.category==='AWA'){await p.locator('#p-response-text').fill('Mixed writing draft.');await submit(p);}if(q.material_id)assert.ok(await p.locator('.platform-material').count());}
    assert.ok((await state(p)).essays.some(e=>e.text==='Mixed writing draft.'));
  });
  let legacySeed,legacyExport;
  await check('existing RC key migrates histories and favorites without altering old notes',async()=>{
    const old=await page.evaluate(id=>{const data=window.GRE_READING_DATA,p=data.passages.find(p=>p.questions.some(q=>q.id===id));return {pid:p.id,qid:id};},rc.question_id);const at=Date.now()-999999;
    legacySeed={version:1,questions:{[old.qid]:{attempts:1,correct:1,graded:1,lastAt:at,lastCorrect:true,uncertain:false,selected:rc.correct_answer,typed:''}},bookmarks:[old.pid],notes:{[old.pid]:'迁移前原阅读笔记'},history:[{qid:old.qid,at,correct:true,uncertain:false}],session:null};
    const p=await newPage({[RC_KEY]:legacySeed});const s=await state(p);assert.ok(s.attempts.some(a=>a.questionId===old.qid&&a.origin==='legacy-rc'));assert.ok(s.favorites.includes(old.qid));assert.equal(await p.evaluate(({key,pid})=>JSON.parse(localStorage.getItem(key)).notes[pid],{key:RC_KEY,pid:old.pid}),'迁移前原阅读笔记');await go(p,'rc');assert.ok(await p.locator('#main').isVisible());assert.ok(await p.locator('.reading-card').count());await go(p,'materials');const dl=p.waitForEvent('download');await p.locator('[data-paction="export-progress"]').click();legacyExport=JSON.parse(await streamText(await dl));assert.deepEqual(legacyExport.legacyRC.notes,legacySeed.notes);
  });
  await check('full progress import restores original RC notes and bookmarks in fresh browser',async()=>{assert.ok(legacyExport);const p=await newPage();await importProgress(p,legacyExport);const old=await p.evaluate(()=>window.GREReadingBridge.readProgress());assert.deepEqual(old.notes,legacySeed.notes);assert.deepEqual(old.bookmarks,legacySeed.bookmarks);assert.equal(old.history.length,1);});
  await check('progress import merges repeated histories instead of replacing them',async()=>{const before=await state(page);await importProgress(page,{progress:before});const after=await state(page);assert.equal(after.attempts.length,before.attempts.length);assert.equal(after.essays.length,before.essays.length);const old=before.attempts[0];const newAttempt={...old,id:'qa-historical-attempt',at:old.at-12345};await importProgress(page,{progress:{...fresh(),attempts:[newAttempt]}});assert.equal((await state(page)).attempts.length,before.attempts.length+1);});
  await check('bank validator rejects invalid TC answer grouping and duplicate answers',async()=>{const checks=await page.evaluate(q=>{const c=window.GRECore,b=window.GREPlatform.getBank(),source=b.sources.find(s=>s.id===q.source_id),base={schema_version:2,sources:[source],materials:[],questions:[q]};let rejected=[];for(const answer of [[q.blank_groups[0].options[0].id,q.blank_groups[0].options[1].id],[q.correct_answer[0],q.correct_answer[0]]]){const copy=JSON.parse(JSON.stringify(base));copy.questions[0].correct_answer=answer;try{c.validateBank(copy);rejected.push(false);}catch{rejected.push(true);}}return rejected;},tc2);assert.deepEqual(checks,[true,true]);});
  await check('full exported question bank imports back including unverified and incomplete sources',async()=>{
    await go(page,'materials');const beforeCount=await page.evaluate(()=>window.GREPlatform.getBank().questions.length),beforeState=await state(page);
    const dl=page.waitForEvent('download');await page.locator('[data-paction="export-bank"]').click();const data=await streamText(await dl),exported=JSON.parse(data);assert.equal(exported.questions.length,beforeCount);assert.ok(exported.questions.some(q=>q.answer_status==='incomplete'));
    await page.locator('[data-paction="import-bank"]').click();await page.locator('#platform-import').setInputFiles({name:'gre_question_bank.json',mimeType:'application/json',buffer:Buffer.from(data)});
    await page.waitForFunction(()=>{const t=document.querySelector('#toast').textContent;return t.includes('已导入')||t.includes('导入失败');},null,{timeout:60000});assert.ok(!(await page.locator('#toast').textContent()).includes('导入失败'),await page.locator('#toast').textContent());
    assert.equal(await page.evaluate(()=>window.GREPlatform.getBank().questions.length),beforeCount);assert.equal((await state(page)).attempts.length,beforeState.attempts.length);
    await page.reload();await page.waitForFunction(()=>!!window.GREPlatform,null,{timeout:60000});assert.equal(await page.evaluate(()=>window.GREPlatform.getBank().questions.length),beforeCount);assert.equal((await state(page)).attempts.length,beforeState.attempts.length);
  });
  await check('legacy version-1 progress can be directly imported without losing RC notes',async()=>{const p=await newPage();await importProgress(p,legacySeed);const old=await p.evaluate(()=>window.GREReadingBridge.readProgress());assert.deepEqual(old.notes,legacySeed.notes);assert.equal(old.history.length,1);});
  await check('imported historic scores for currently unverified questions stay out of formal accuracy',async()=>{
    const p=await newPage(),q=await p.evaluate(()=>window.GREPlatform.getBank().questions.find(q=>!q.gradable&&q.category!=='AWA'));
    await importProgress(p,{progress:{...fresh(),attempts:[{id:'qa-former-grade',questionId:q.question_id,at:Date.now(),correct:true,elapsedMs:1000,selected:[],text:''}]}});
    const stats=await p.evaluate(()=>window.GRECore.stats(window.GREPlatform.getState().attempts,window.GREPlatform.getBank()));assert.equal(stats.total,1);assert.equal(stats.graded,0);assert.equal(stats.correct,0);
  });
  for(const ended of [false,true])await check('restored '+(ended?'completed':'current')+' session clears unverified historic grades and excludes them from summary',async()=>{
    const q=await choose(page,'NumericEntry',false),at=Date.now();
    const restored={id:'qa-restored-'+(ended?'completed':'current'),ids:[q.question_id,qc.question_id],index:0,startedAt:at-10000,endedAt:ended?at:null,mode:'free',minutes:20,instant:true,responses:{
      [q.question_id]:{selected:[],text:'sqrt(2)',uncertain:false,elapsedMs:1000,submitted:true,correct:true},
      [qc.question_id]:{selected:[qc.options.find(o=>!qc.correct_answer.includes(o.id)).id],text:'',uncertain:false,elapsedMs:1000,submitted:true,correct:false}
    }};
    const p=await newPage({[KEY]:{...fresh(),session:restored,updatedAt:at}}),loaded=(await state(p)).session;
    assert.equal(loaded.responses[q.question_id].correct,null);assert.equal(loaded.responses[q.question_id].text,'sqrt(2)');assert.equal(loaded.responses[q.question_id].submitted,true);assert.equal(loaded.responses[qc.question_id].correct,false);
    if(ended)await go(p,'practice');else{await p.locator('[data-paction="resume"]').click();assert.ok((await p.locator('.platform-answer').textContent()).includes('本题不计正式正确率'));await p.locator('[data-paction="finish"]').first().click();}
    await p.locator('.session-result-title').waitFor();
    const stats=await p.locator('.session-summary .stat').evaluateAll(items=>Object.fromEntries(items.map(el=>[el.querySelector('label').textContent,{value:el.querySelector('strong').textContent,note:el.querySelector('small').textContent}])));
    assert.deepEqual(stats['正确率'],{value:'0%',note:'0 / 1 道核验题'});assert.equal(stats['已作答'].value,'2');assert.equal(stats['不计判分'].value,'1');assert.equal((await state(p)).session.responses[q.question_id].correct,null);
  });
  await check('history referring to an unavailable question does not crash session review',async()=>{
    const p=await newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
    await importProgress(p,{progress:{...fresh(),sessions:[{id:'qa-unknown-session',ids:['question-not-present-in-this-library'],startedAt:Date.now()-10000,endedAt:Date.now(),responses:{}}]}});
    await go(p,'analytics');const button=p.locator('[data-session-result="qa-unknown-session"]');if(await button.count())await button.click();await p.waitForTimeout(100);assert.deepEqual(errors,[]);
  });
  await check('mobile UI has no horizontal page overflow and writing editor is usable',async()=>{const p=await newPage({}, {width:390,height:844});await open(p,tc3);assert.ok(await p.locator('.blank-group').count());assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));await open(p,awa);await p.locator('#essay-text').fill('Mobile draft.');assert.equal((await state(p)).drafts[awa.question_id].text,'Mobile draft.');await p.screenshot({path:path.join(__dirname,'qa-platform-mobile.png'),fullPage:true});});
  await check('launcher-equivalent offline page starts random training with accessible local source files',async()=>{
    const p=await newPage();await p.locator('[data-paction="start"]').click();const s=(await state(p)).session;assert.equal(s.ids.length,20);assert.equal(new Set(s.ids).size,20);assert.ok(await p.locator('.question-stem').isVisible());
    const assets=await p.evaluate(()=>{const b=window.GREPlatform.getBank();return [...new Set([...b.sources.map(s=>s.url||s.reader?.url),...b.questions.flatMap(q=>[...(q.images||[]),...(q.explanation_images||[])].map(i=>i.src)),...b.materials.flatMap(m=>(m.images||[]).map(i=>i.src))].filter(Boolean))];});
    for(const rel of assets){assert.ok(!/^(?:https?:|\/)/.test(rel),rel);const full=path.resolve(ROOT,'dist',rel);assert.ok(full.startsWith(path.resolve(ROOT,'dist')+path.sep));assert.ok(fs.existsSync(full),rel);assert.ok(fs.statSync(full).isFile(),rel);if(rel.endsWith('.pdf')){const fd=fs.openSync(full,'r'),magic=Buffer.alloc(5);fs.readSync(fd,magic,0,5,0);fs.closeSync(fd);assert.equal(magic.toString(),'%PDF-',rel);}}
    localAssetsChecked=assets.length;const pdf=assets.find(rel=>rel.endsWith('.pdf'));const pdfPage=await p.context().newPage();await pdfPage.goto(pathToFileURL(path.join(ROOT,'dist',pdf)).href,{waitUntil:'domcontentloaded'});assert.ok(pdfPage.url().startsWith('file:'));await pdfPage.close();
  });
  await check('no uncaught browser runtime errors',async()=>assert.deepEqual(pageErrors,[]));
  await go(page,'home');await page.screenshot({path:path.join(__dirname,'qa-platform-desktop.png'),fullPage:true});
}finally{
  for(const c of contexts)await c.close();await browser.close();
  fs.writeFileSync(path.join(__dirname,'platform-qa-report.json'),JSON.stringify({testedAt:new Date().toISOString(),bankCount,localAssetsChecked,entryURL:URL,results,pageErrors},null,2));
  if(results.some(r=>!r.ok)||pageErrors.length)process.exitCode=1;
}
})().catch(e=>{console.error(e);process.exitCode=1;});
