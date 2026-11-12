/* Connection regression: isolated file:// tabs and a mocked loopback service.
 * No real service, API key, user browser profile, or OpenAI request is used. */
'use strict';
const {chromium}=require('C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),FILE=pathToFileURL(path.join(ROOT,'dist/index.html')).href;
const BANK=JSON.parse(fs.readFileSync(path.join(ROOT,'gre_question_bank.json'),'utf8'));
const question=BANK.questions.find(q=>q.question_type==='TC1'&&q.gradable);
const KEY='gre-training-progress-v2',CONNECTION_KEY='gre-vocabulary-ai-connection-v1',SESSION_KEY='gre-vocabulary-ai-session-v1';
const TOKEN_A='a'.repeat(64),TOKEN_B='b'.repeat(64),ENDPOINT='http://127.0.0.1:43991';
const browserPath=process.env.GRE_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe',browserName=/msedge/i.test(browserPath)?'edge':'chrome';
const results=[],errors=[],external=[],contexts=[];
const connection=(token=TOKEN_A,url=ENDPOINT)=>({url,token});
const launch=(token=TOKEN_A,url=ENDPOINT)=>FILE+'#gre-ai='+encodeURIComponent(JSON.stringify(connection(token,url)));
const snapshot=p=>p.evaluate(()=>GREPlatform.getState());
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name);}catch(error){results.push({name,ok:false,error:error.stack||error.message});console.log('FAIL',name,error.stack||error.message);}}
async function ready(p){await p.waitForFunction(()=>document.querySelector('[data-ai-status]')?.textContent.includes('已连接'));}
async function tokenInTab(p,token){await p.waitForFunction(({key,token})=>JSON.parse(sessionStorage.getItem(key)||'null')?.token===token,{key:SESSION_KEY,token});}

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:browserPath});
 try{
  async function setup(){
   const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});contexts.push(context);
   const now=Date.now(),seed={version:2,attempts:[],favorites:[],vocabulary:[{word:'opaque',addedAt:now,sources:[{questionId:question.question_id,questionType:'TC1',source:'Connection regression source',section:'1',context:question.question_content,addedAt:now}]}],notes:{[question.question_id]:'Keep this existing note.'},essays:[],drafts:{},sessions:[],session:null,migratedBookmarks:[],updatedAt:now};
   await context.addInitScript(({key,seed})=>{
    if(!location.pathname.endsWith('/dist/index.html'))return;
    if(!localStorage.getItem('connection-qa-seeded')){localStorage.setItem(key,JSON.stringify(seed));localStorage.setItem('connection-qa-seeded','1');localStorage.setItem('gre-vocabulary-ai-preferences-v1',JSON.stringify({auto:false,relationMode:'confusable'}));}
   },{key:KEY,seed});
   const control={token:TOKEN_A},traffic=[],pages=[];
   await context.route('**/*',async route=>{
    const request=route.request(),url=request.url();if(!/^https?:/.test(url))return route.continue();
    if(!url.startsWith(ENDPOINT+'/')){external.push(url);return route.abort();}
    const headers={'access-control-allow-origin':'null','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type,X-GRE-Token','access-control-allow-private-network':'true','content-type':'application/json'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    const token=request.headers()['x-gre-token'];traffic.push({url,method:request.method(),token,page:pages.indexOf(request.frame().page())});
    if(url.endsWith('/api/status'))return route.fulfill({status:token===control.token?200:401,headers,body:JSON.stringify(token===control.token?{configured:true,model:'gpt-4.1-mini'}:{code:'LOCAL_AUTH_REQUIRED',error:'连接已过期'})});
    return route.fulfill({status:500,headers,body:JSON.stringify({code:'UNEXPECTED_GENERATION',error:'Automatic generation should be off in connection tests.'})});
   });
   async function newPage(url=FILE+'#vocabulary'){
    const p=await context.newPage();pages.push(p);p.setDefaultTimeout(12000);p.on('pageerror',error=>errors.push(error.message));
    await p.goto(url);await p.waitForFunction(()=>!!window.GREPlatform&&!!window.GREVocabularyAI);await p.evaluate(()=>GREPlatform.go('vocabulary'));return p;
   }
   return {context,control,traffic,pages,newPage,seed};
  }
  const shared=await setup();let oldTab,launchTab,plainTab,original;
  await check('an ordinary unpaired page offers an actionable connection button without network requests',async()=>{
   oldTab=await shared.newPage();original=await snapshot(oldTab);
   assert.equal(await oldTab.locator('[data-ai-action="connect"]').isDisabled(),false);
   await oldTab.locator('[data-ai-action="connect"]').click();assert.equal(shared.traffic.length,0);
   assert.match(await oldTab.locator('[data-ai-settings]').innerText(),/启动|连接|运行/);
  });
  await check('launching a paired tab connects an already-open ordinary tab without a reload',async()=>{
   await oldTab.evaluate(()=>window.connectionTestUnreloaded=true);
   launchTab=await shared.newPage(launch());await ready(launchTab);await ready(oldTab);await tokenInTab(oldTab,TOKEN_A);
   assert.equal(await oldTab.evaluate(()=>window.connectionTestUnreloaded),true);
   assert.ok(shared.traffic.some(r=>r.page===0&&r.token===TOKEN_A&&r.method==='GET'));
   assert.ok(!(await launchTab.url()).includes(TOKEN_A));
  });
  await check('a fresh ordinary tab restores the shared local connection and preserves progress',async()=>{
   plainTab=await shared.newPage();await ready(plainTab);await tokenInTab(plainTab,TOKEN_A);
   assert.deepEqual((await snapshot(plainTab)).vocabulary,original.vocabulary);assert.deepEqual((await snapshot(plainTab)).notes,original.notes);
   assert.equal(await plainTab.evaluate(key=>JSON.parse(localStorage.getItem(key)).token,CONNECTION_KEY),TOKEN_A);
  });
  await check('restarting the launcher with a new token replaces stale connection tokens across existing tabs',async()=>{
   shared.control.token=TOKEN_B;const rotated=await shared.newPage(launch(TOKEN_B));await ready(rotated);
   for(const tab of [oldTab,launchTab,plainTab]){await tokenInTab(tab,TOKEN_B);await ready(tab);}
   for(const p of [oldTab,launchTab,plainTab])assert.ok(shared.traffic.some(r=>r.page===shared.pages.indexOf(p)&&r.token===TOKEN_B&&r.method==='GET'));
   await plainTab.reload();await plainTab.waitForFunction(()=>!!window.GREPlatform);await plainTab.evaluate(()=>GREPlatform.go('vocabulary'));await ready(plainTab);await tokenInTab(plainTab,TOKEN_B);
  });
  await check('a same-document launcher hash change is consumed and connects without reloading the application',async()=>{
   const isolated=await setup(),p=await isolated.newPage();await p.evaluate(()=>window.connectionTestUnreloaded=true);
   await p.evaluate(hash=>location.hash=hash,'gre-ai='+encodeURIComponent(JSON.stringify(connection())));await ready(p);await tokenInTab(p,TOKEN_A);
   assert.equal(await p.evaluate(()=>window.connectionTestUnreloaded),true);assert.ok(!(await p.url()).includes(TOKEN_A));assert.equal(await p.evaluate(key=>JSON.parse(localStorage.getItem(key)).token,CONNECTION_KEY),TOKEN_A);
  });
  await check('progress exports exclude both the shared local token and any connection metadata',async()=>{
   await oldTab.evaluate(()=>GREPlatform.go('materials'));const pending=oldTab.waitForEvent('download');await oldTab.locator('[data-paction="export-progress"]').click();const downloaded=await pending,raw=fs.readFileSync(await downloaded.path(),'utf8'),backup=JSON.parse(raw);
   assert.ok(!raw.includes(TOKEN_A)&&!raw.includes(TOKEN_B));assert.ok(!raw.includes(CONNECTION_KEY)&&!raw.includes(SESSION_KEY)&&!raw.includes('OPENAI_API_KEY'));assert.deepEqual(backup.progress.vocabulary,original.vocabulary);assert.deepEqual(backup.progress.notes,original.notes);
  });
  await check('invalid launch endpoints cannot make cross-network requests or persist a connection',async()=>{
   for(const url of ['https://attacker.invalid','http://127.0.0.1:43991/extra','http://user:secret@127.0.0.1:43991']){
    const isolated=await setup(),p=await isolated.newPage(launch(TOKEN_A,url));assert.equal(isolated.traffic.length,0);assert.equal(await p.evaluate(key=>localStorage.getItem(key),CONNECTION_KEY),null);assert.equal(await p.locator('[data-ai-action="connect"]').isDisabled(),false);
   }
  });
  await check('the generated local handoff file opens the original application with its complete connection fragment',async()=>{
   const {writeLaunchPage}=require('../scripts/vocabulary-api.cjs');assert.equal(typeof writeLaunchPage,'function');
   const directory=fs.mkdtempSync(path.join(os.tmpdir(),'GRE handoff 中文 ')),created=await writeLaunchPage(43991,TOKEN_A,{directory});
   const file=typeof created==='string'?created:created.path||created.filePath;assert.ok(file&&fs.existsSync(file));
   const isolated=await setup(),p=await isolated.newPage(pathToFileURL(file).href);await ready(p);await tokenInTab(p,TOKEN_A);assert.ok(p.url().startsWith(FILE));assert.deepEqual((await snapshot(p)).notes,isolated.seed.notes);
  });
  await check('connection-only verification never reaches OpenAI or generates vocabulary and raises no page errors',async()=>{
   assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.equal(shared.traffic.filter(r=>r.method==='POST').length,0);
  });
 }finally{
  for(const context of contexts)await context.close();await browser.close();
  fs.writeFileSync(path.join(__dirname,`vocabulary-connection-${browserName}-report.json`),JSON.stringify({testedAt:new Date().toISOString(),browser:browserName,mockedLocalService:true,results,pageErrors:errors,externalRequests:external},null,2));
  if(results.some(r=>!r.ok)||errors.length||external.length)process.exitCode=1;
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
