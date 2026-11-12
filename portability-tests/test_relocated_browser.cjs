/* Offline portability check using copied apps and isolated browser profiles. */
const {chromium}=require('C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict');
const {pathToFileURL,fileURLToPath}=require('node:url');
const ROOT=path.resolve(__dirname,'..');
const TEMP=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'GRE-portability-')),'本地副本 中文资料');
const results=[],errors=[],external=[];
const vocabKey='gre800-word-studio-v1';
const url=(base,relative)=>pathToFileURL(path.join(base,relative)).href;
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name);}catch(e){results.push({name,ok:false,error:e.stack||e.message});console.log('FAIL',name,e.message);}}
async function download(page,selector,name){const [result]=await Promise.all([page.waitForEvent('download'),page.locator(selector).click()]);const out=path.join(TEMP,name);await result.saveAs(out);return out;}
function copyApp(relative){fs.cpSync(path.join(ROOT,relative),path.join(TEMP,relative),{recursive:true});}
(async()=>{
 fs.mkdirSync(TEMP,{recursive:true});
 for(const directory of ['gre800-cards/dist','gre-reading-studio/dist','assets','materials'])copyApp(directory);
 for(const name of ['GRE-start.html','使用说明.txt'])copyApp(name);
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const sourceContext=await browser.newContext({acceptDownloads:true});
 const targetContext=await browser.newContext({acceptDownloads:true,viewport:{width:1280,height:900}});
 for(const context of [sourceContext,targetContext])context.on('page',page=>{page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});});
 let vocabExport,trainingExport,wordId,sourceVocab,sourceTraining,questionId;
 try{
  await check('source vocabulary can record a word and export an actual JSON backup',async()=>{
   const page=await sourceContext.newPage();await page.goto(url(ROOT,'gre800-cards/dist/index.html'));await page.locator('[data-confidence="unknown"]').click();
   sourceVocab=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),vocabKey);wordId=Object.keys(sourceVocab.records)[0];assert.ok(wordId);
   await page.locator('[data-nav="progress"]').click();vocabExport=await download(page,'[data-action="export-progress"]','vocab-progress.json');
   const data=JSON.parse(fs.readFileSync(vocabExport,'utf8'));assert.equal(data.format,'gre800-progress');assert.equal(data.state.records[wordId].attempts,sourceVocab.records[wordId].attempts);
  });
  await check('source Verbal random practice can record an answer, note and bookmark and export them',async()=>{
   const page=await sourceContext.newPage();await page.goto(url(ROOT,'gre-reading-studio/dist/index.html'));await page.locator('[data-mock-action="start-subject"]').click();await page.locator('.question-stem').waitFor();
   const q=await page.evaluate(()=>{const s=GREPlatform.getState();return GREPlatform.getBank().questions.find(q=>q.question_id===s.session.ids[0]);});questionId=q.question_id;assert.equal(q.category,'Verbal');
   for(const id of q.correct_answer)await page.locator(`[data-poption="${id}"]`).click();await page.locator('[data-paction="submit"]').click();
   await page.locator('[data-pfavorite]').first().click();await page.locator('details').filter({has:page.locator('#p-note')}).locator('summary').click();await page.locator('#p-note').fill('Local folder migration note / 本地文件夹测试笔记');await page.locator('.question-stem').click();
   await page.evaluate(()=>GREPlatform.go('materials'));sourceTraining=await page.evaluate(()=>GREPlatform.getState());
   assert.equal(sourceTraining.notes[questionId],'Local folder migration note / 本地文件夹测试笔记');assert.ok(sourceTraining.favorites.includes(questionId));
   trainingExport=await download(page,'#portable-save-bar [data-paction="export-progress"]','training-progress.json');assert.ok(JSON.parse(fs.readFileSync(trainingExport,'utf8')).progress.attempts.some(a=>a.questionId===questionId&&a.correct));
  });
  const hub=await targetContext.newPage();
  await check('copied webpage entry opens offline from a different local folder containing spaces and Chinese',async()=>{
   await hub.goto(url(TEMP,'GRE-start.html'));await hub.locator('#open-vocab').waitFor();await hub.locator('#open-training').waitFor();
   for(const id of ['open-vocab','open-training','open-materials']){const href=await hub.locator('#'+id).getAttribute('href');const target=new URL(href,hub.url());assert.ok(fileURLToPath(target).startsWith(TEMP));assert.ok(fs.existsSync(fileURLToPath(target)));}
   const stylesheet=new URL(await hub.locator('link[rel="stylesheet"]').getAttribute('href'),hub.url());assert.ok(fs.existsSync(fileURLToPath(stylesheet)));
   await hub.screenshot({path:path.join(__dirname,'portable-launcher-desktop.png'),fullPage:true});
  });
  await check('copied vocabulary works and restores exported progress in a fresh browser profile',async()=>{
   await hub.locator('#open-vocab').click();await hub.locator('[data-confidence="unknown"]').waitFor();assert.equal(await hub.evaluate(()=>GRE_WORDS.length),800);
   assert.equal(await hub.evaluate(k=>Object.keys(JSON.parse(localStorage.getItem(k)).records).length,vocabKey),0);
   await hub.locator('[data-nav="progress"]').click();await hub.locator('#progress-file').setInputFiles(vocabExport);await hub.locator('[data-action="confirm-import"]').click();
   const imported=await hub.evaluate(k=>JSON.parse(localStorage.getItem(k)),vocabKey);assert.deepEqual(imported.records[wordId],sourceVocab.records[wordId]);
   await hub.reload();assert.equal(await hub.evaluate(({k,id})=>JSON.parse(localStorage.getItem(k)).records[id].attempts,{k:vocabKey,id:wordId}),sourceVocab.records[wordId].attempts);
  });
  await check('copied training app restores exported attempts, notes, bookmarks and unfinished session',async()=>{
   await hub.goto(url(TEMP,'GRE-start.html'));await hub.locator('#open-training').click();await hub.waitForFunction(()=>!!window.GREPlatform);assert.equal((await hub.evaluate(()=>GREPlatform.getState())).attempts.length,0);
   await hub.evaluate(()=>GREPlatform.go('materials'));await hub.locator('#portable-save-bar [data-paction="import-progress"]').click();await hub.locator('#platform-import').setInputFiles(trainingExport);await hub.waitForFunction(()=>document.querySelector('#platform-import').value==='');assert.ok(!(await hub.locator('#toast').innerText()).includes('导入失败'));
   let imported=await hub.evaluate(()=>GREPlatform.getState());assert.equal(imported.notes[questionId],sourceTraining.notes[questionId]);assert.ok(imported.favorites.includes(questionId));assert.deepEqual(imported.attempts,sourceTraining.attempts);assert.deepEqual(imported.session.ids,sourceTraining.session.ids);
   await hub.reload();await hub.waitForFunction(()=>!!window.GREPlatform);await hub.locator('[data-mock-action="resume-subject"]').click();await hub.locator('.question-stem').waitFor();imported=await hub.evaluate(()=>GREPlatform.getState());assert.equal(imported.session.responses[questionId].correct,true);
  });
  await check('copied training app draws real random Verbal questions after migration',async()=>{
   await hub.evaluate(()=>GREPlatform.go('mock'));await hub.locator('[data-mock-action="start-subject"]').click();await hub.locator('.question-stem').waitFor();
   const result=await hub.evaluate(()=>{const s=GREPlatform.getState(),bank=GREPlatform.getBank();return {ids:s.session.ids,categories:s.session.ids.map(id=>bank.questions.find(q=>q.question_id===id).category)};});assert.equal(result.ids.length,20);assert.equal(new Set(result.ids).size,20);assert.ok(result.categories.every(c=>c==='Verbal'));
  });
  await check('copied original PDF and Quant diagram remain readable through relative references',async()=>{
   const result=await hub.evaluate(()=>{const bank=GREPlatform.getBank();const q=bank.questions.find(q=>q.category==='Quant'&&q.gradable&&q.images?.length);return {id:q.question_id,source:bank.sources.find(s=>s.id===q.source_id).url,images:q.images};});assert.ok(result.id);
   const pdf=path.resolve(TEMP,'gre-reading-studio/dist',result.source.split('#')[0]);assert.equal(fs.readFileSync(pdf).subarray(0,5).toString(),'%PDF-');
   await hub.evaluate(id=>GREPlatform.openQuestion(id),result.id);await hub.locator('.question-stem').waitFor();const img=hub.locator('.question-panel img').first();await img.scrollIntoViewIfNeeded();await hub.waitForFunction(()=>[...document.querySelectorAll('.question-panel img')].some(i=>i.complete&&i.naturalWidth>0));assert.ok((await img.getAttribute('src')).length);
  });
  await check('webpage entry also fits narrow screens without page overflow',async()=>{
   await hub.goto(url(TEMP,'GRE-start.html'));await hub.setViewportSize({width:390,height:844});assert.ok(await hub.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await hub.screenshot({path:path.join(__dirname,'portable-launcher-mobile.png'),fullPage:true});
  });
  await check('all relocation and import flows have no external requests or runtime errors',async()=>{assert.deepEqual(external,[]);assert.deepEqual(errors,[]);});
 }finally{
  await browser.close();
  fs.writeFileSync(path.join(__dirname,'relocated-browser-report.json'),JSON.stringify({testedAt:new Date().toISOString(),runtime:'Windows Chrome; no running Linux distribution was available',copiedPath:TEMP,sourcePath:ROOT,results,pageErrors:errors,externalRequests:external},null,2));
 }
 if(results.some(r=>!r.ok))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
