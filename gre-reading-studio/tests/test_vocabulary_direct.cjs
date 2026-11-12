/* Direct browser OpenAI acceptance. All HTTP requests are intercepted; keys are fake. */
'use strict';
const {chromium}=require('C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),FILE=pathToFileURL(path.join(ROOT,'dist/index.html')).href;
const BANK=JSON.parse(fs.readFileSync(path.join(ROOT,'gre_question_bank.json'),'utf8'));
const question=BANK.questions.find(q=>q.question_type==='TC1'&&q.gradable);
const KEY='gre-training-progress-v2',FAKE_KEY='sk-qa-direct-never-a-real-key',API='https://api.openai.com/v1/responses',LOCAL='http://127.0.0.1:43992';
const results=[],errors=[],unexpected=[],contexts=[];
const browserPath=process.env.GRE_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const vocabulary=words=>words.map(word=>({word,addedAt:Date.now(),sources:[{questionId:question.question_id,questionType:'TC1',source:'Direct API QA',section:'1',context:question.question_content,addedAt:Date.now()}]}));
const match=input=>({word:input.word,meaning:'晦涩的；不透明的',synonyms:[{word:'obscure',meaning:'难懂的',note:'语境不同，不一定互换。'}],similar:[{word:'opulent',meaning:'富裕的',note:'形近但不同义。'}]});
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name);}catch(error){results.push({name,ok:false});console.error('FAIL',name,error.stack);}}
async function configure(p,key=FAKE_KEY){await p.locator('[data-ai-key]').fill(key);await p.locator('[data-ai-action="configure"]').click();}
const completed=p=>p.waitForFunction(()=>GREPlatform.getState().vocabulary[0]?.ai?.meaning);
const errorText=p=>p.locator('[data-ai-word]').first().locator('[data-ai-entry-status]');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:browserPath});
 try{
  async function setup({words=['opaque'],legacy=false,status=200,hold=null}={}){
   const c=await browser.newContext({viewport:{width:1280,height:1000}});contexts.push(c);
   const seed={version:2,attempts:[],favorites:[],vocabulary:vocabulary(words),notes:{},essays:[],drafts:{},sessions:[],session:null,migratedBookmarks:[],updatedAt:Date.now()};
   await c.addInitScript(({key,seed})=>{if(!sessionStorage.getItem('direct-qa-seeded')){localStorage.setItem(key,JSON.stringify(seed));sessionStorage.setItem('direct-qa-seeded','1');}},{key:KEY,seed});
   const traffic=[],control={status,abort:false,hold};
   await c.route('**/*',async route=>{
    const request=route.request(),url=request.url();if(!/^https?:/.test(url))return route.continue();
    const headers={'access-control-allow-origin':'null','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type,Authorization,X-GRE-Token','access-control-allow-private-network':'true','content-type':'application/json'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    const data=request.method()==='POST'?request.postDataJSON():null;traffic.push({url,headers:request.headers(),data});
    if(url===LOCAL+'/api/status')return route.fulfill({status:200,headers,body:JSON.stringify({configured:false,model:'gpt-4.1-mini'})});
    if(url!==API){unexpected.push(url);return route.abort();}
    const thisStatus=control.status;if(control.hold)await control.hold;if(control.abort)return route.abort('failed');
    if(thisStatus!==200)return route.fulfill({status:thisStatus,headers,body:JSON.stringify({error:{message:'Do not echo '+FAKE_KEY,code:'test_error'}})});
    const input=JSON.parse(data.input),body={id:'resp_qa',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(match(input))}]}]};
    return route.fulfill({status:200,headers,body:JSON.stringify(body)});
   });
   const p=await c.newPage();p.on('pageerror',error=>errors.push(error.message));p.on('dialog',dialog=>dialog.accept());p.setDefaultTimeout(10000);
   await p.goto(FILE+(legacy?'#gre-ai='+encodeURIComponent(JSON.stringify({url:LOCAL,token:'a'.repeat(64)})):'#vocabulary'));
   await p.waitForFunction(()=>window.GREPlatform&&window.GREVocabularyAI&&window.GREOpenAIVocabulary);await p.evaluate(()=>GREPlatform.go('vocabulary'));
   if(legacy)await p.waitForFunction(()=>GREVocabularyAI.getServiceState().localAvailable);
   return {p,c,traffic,control};
  }
  let success;
  await check('the offline webpage accepts a key without a helper, empties the input, and automatically matches words',async()=>{
   success=await setup();const {p,traffic}=success;assert.equal(await p.locator('[data-ai-action="configure"]').isEnabled(),true);assert.equal(traffic.length,0);await configure(p);assert.equal(await p.locator('[data-ai-key]').inputValue(),'');await completed(p);
   assert.match(await p.locator('[data-ai-status]').innerText(),/网页直连已配置/);assert.equal(await p.evaluate(()=>GREVocabularyAI.getServiceState().localAvailable),false);assert.match(await p.locator('[data-ai-word]').innerText(),/obscure/);assert.match(await p.locator('[data-ai-word]').innerText(),/opulent/);
  });
  await check('Bearer credentials only go to the official Responses endpoint and use strict schema with store:false',async()=>{
   const calls=success.traffic.filter(call=>call.url===API);assert.equal(calls.length,1);assert.equal(calls[0].headers.authorization,'Bearer '+FAKE_KEY);assert.equal(calls[0].data.store,false);assert.equal(calls[0].data.text.format.strict,true);assert.equal(calls[0].data.model,'gpt-4.1-mini');assert.equal(JSON.parse(calls[0].data.input).word,'opaque');assert.ok(success.traffic.every(call=>!call.headers.authorization||call.url===API));
  });
  await check('the key is absent from browser storage, progress snapshots, rendered markup, and service state',async()=>{
   const text=await success.p.evaluate(async()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage},progress:GREPlatform.getState(),snapshot:await GREPlatform.snapshotPortable(),service:GREVocabularyAI.getServiceState(),html:document.documentElement.outerHTML}));assert.ok(!text.includes(FAKE_KEY));assert.ok(text.includes('obscure'));
  });
  await check('clearing the key stops new matching while retaining cached explanations',async()=>{
   const {p,traffic}=success,count=traffic.length;await p.locator('[data-ai-action="clear-key"]').click();assert.match(await p.locator('[data-ai-config-status]').innerText(),/已清除/);assert.equal(await p.locator('[data-ai-action="clear-key"]').isDisabled(),true);await p.locator('[data-ai-mode]').selectOption('related');assert.equal(await p.locator('[data-ai-action="match-page"]').isDisabled(),true);await p.waitForTimeout(150);assert.equal(traffic.length,count);await p.locator('[data-ai-mode]').selectOption('confusable');assert.match(await p.locator('[data-ai-word]').innerText(),/obscure/);
  });
  await check('reload forgets the key while persisted vocabulary results remain available offline',async()=>{
   const {p,traffic}=success;await configure(p);const count=traffic.length;await p.reload();await p.waitForFunction(()=>window.GREPlatform);await p.evaluate(()=>GREPlatform.go('vocabulary'));await p.locator('.vocabulary-ai-result').waitFor();assert.equal(await p.locator('[data-ai-key]').inputValue(),'');assert.equal(await p.locator('[data-ai-action="clear-key"]').isDisabled(),true);assert.equal(await p.locator('[data-ai-action="match-page"]').isDisabled(),true);assert.equal(traffic.length,count);
  });
  await check('401 displays a safe error and accepts a replacement key without losing the word',async()=>{
   const {p,control,traffic}=await setup({status:401});await configure(p);await p.waitForFunction(()=>document.querySelector('[data-ai-entry-status]')?.textContent.includes('无效'));assert.equal(await p.evaluate(()=>GREPlatform.getState().vocabulary[0].word),'opaque');assert.ok(!(await p.locator('body').innerText()).includes(FAKE_KEY));control.status=200;await configure(p,'sk-qa-replacement-not-real');await completed(p);assert.equal(traffic.at(-1).headers.authorization,'Bearer sk-qa-replacement-not-real');
  });
  await check('429 preserves the word and allows an explicit successful retry',async()=>{
   const {p,control,traffic}=await setup({status:429});await configure(p);await p.waitForFunction(()=>document.querySelector('[data-ai-entry-status]')?.textContent.includes('额度'));assert.equal(await p.locator('[data-ai-retry]').isEnabled(),true);control.status=200;await p.locator('[data-ai-retry]').click();await completed(p);assert.equal(traffic.filter(call=>call.url===API).length,2);
  });
  await check('a browser network failure preserves local progress and supports retry',async()=>{
   const {p,control}=await setup();control.abort=true;await configure(p);await p.waitForFunction(()=>document.querySelector('[data-ai-entry-status]')?.textContent.includes('网络'));assert.equal(await p.evaluate(()=>GREPlatform.getState().vocabulary.length),1);control.abort=false;await p.locator('[data-ai-retry]').click();await completed(p);
  });
  await check('an older helper without config features still permits direct key input',async()=>{
   const {p,traffic}=await setup({legacy:true});await configure(p);await completed(p);assert.equal(traffic.filter(call=>call.url===API).length,1);assert.ok(!traffic.some(call=>call.url===LOCAL+'/api/config'));assert.ok(traffic.filter(call=>call.url.startsWith(LOCAL)).every(call=>!call.headers.authorization&&!JSON.stringify(call.data).includes(FAKE_KEY)));
  });
  await check('a late authentication error from an old key cannot disable a newly configured key',async()=>{
   let release;const hold=new Promise(resolve=>{release=resolve;}),{p,control,traffic}=await setup({status:401,hold});await configure(p);await p.waitForFunction(()=>document.querySelector('[data-ai-entry-status]')?.textContent.includes('正在匹配'));control.status=200;control.hold=null;await configure(p,'sk-qa-newer-key-not-real');release();await completed(p);assert.equal(traffic.at(-1).headers.authorization,'Bearer sk-qa-newer-key-not-real');assert.match(await p.locator('[data-ai-status]').innerText(),/网页直连已配置/);
  });
  await check('clearing a key while a response is pending prevents the old response from restarting matching',async()=>{
   let release;const hold=new Promise(resolve=>{release=resolve;}),{p,traffic}=await setup({hold});await configure(p);await p.waitForFunction(()=>document.querySelector('[data-ai-entry-status]')?.textContent.includes('正在匹配'));await p.locator('[data-ai-action="clear-key"]').click();release();await p.waitForFunction(()=>!document.querySelector('[data-ai-entry-status]')?.textContent.includes('正在匹配'));assert.equal(traffic.filter(call=>call.url===API).length,1);assert.equal(await p.evaluate(()=>!!GREPlatform.getState().vocabulary[0].ai),false);assert.equal(await p.locator('[data-ai-action="match-page"]').isDisabled(),true);
  });
  await check('no unexpected requests or uncaught browser errors',async()=>{assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);});
 }finally{for(const context of contexts)await context.close();await browser.close();}
 if(results.some(result=>!result.ok))process.exitCode=1;
})();
