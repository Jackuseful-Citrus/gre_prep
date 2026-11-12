/* Real Chrome file:// -> real loopback HTTP integration.
 * Only upstream OpenAI fetch is a fixture. No browser route intercepts localhost. */
'use strict';
const {chromium}=require('C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const {createServer,browserURL}=require('../scripts/vocabulary-api.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),KEY='gre-training-progress-v2';
const BANK=JSON.parse(fs.readFileSync(path.join(ROOT,'gre_question_bank.json'),'utf8'));
const question=BANK.questions.find(q=>q.question_type==='TC1'&&q.gradable);
const results=[],pageErrors=[],externalRequests=[],serverRequests=[],upstreamCalls=[];
const fixture=word=>({word,meaning:'晦涩的；不透明的',synonyms:[{word:'obscure',meaning:'难懂的',note:'强调难理解，不一定指不透光。'}],similar:[{word:'opulent',meaning:'富丽的',note:'形近但不同义。'}]});
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name);}catch(error){results.push({name,ok:false,error:error.stack||error.message});console.log('FAIL',name,error.stack||error.message);}}
const snapshot=page=>page.evaluate(()=>GREPlatform.getState());

(async()=>{
 let browser,context,page,server,serviceStopped=false;
 const stopService=async()=>{if(!server||serviceStopped)return;serviceStopped=true;await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});};
 try{
  const created=createServer({apiKey:'test-only',fetchImpl:async(url,options)=>{
   const body=JSON.parse(options.body),input=JSON.parse(body.input);upstreamCalls.push({url,model:body.model,input});
   assert.equal(url,'https://api.openai.com/v1/responses');
   return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(fixture(input.word))}]}]}),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  server=created.server;server.on('request',req=>serverRequests.push({method:req.method,path:req.url,origin:req.headers.origin,tokenValid:req.headers['x-gre-token']===created.token}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const localOrigin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  context=await browser.newContext({viewport:{width:1360,height:1000}});
  const now=Date.now(),seed={version:2,attempts:[],favorites:[],vocabulary:[{word:'opaque',addedAt:now,sources:[{questionId:question.question_id,questionType:'TC1',source:'QA original book',section:'1',context:question.question_content,addedAt:now}]}],notes:{},essays:[],drafts:{},sessions:[],session:null,migratedBookmarks:[],updatedAt:now};
  await context.addInitScript(({key,seed})=>{if(!sessionStorage.getItem('api-browser-qa-seeded')){localStorage.setItem(key,JSON.stringify(seed));sessionStorage.setItem('api-browser-qa-seeded','1');}},{key:KEY,seed});
  page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>pageErrors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith(localOrigin+'/'))externalRequests.push(request.url());});
  await check('real file launcher passes Chrome preflight, CORS, local authentication and a real HTTP generation POST',async()=>{
   await page.goto(browserURL(server.address().port,created.token));await page.waitForFunction(()=>!!window.GREPlatform&&!!window.GREVocabularyAI);
   await page.waitForFunction(()=>GREPlatform.getState().vocabulary.find(e=>e.word==='opaque')?.ai?.synonyms?.[0]?.word==='obscure');
   await page.locator('[data-ai-word="opaque"] .vocabulary-ai-result').waitFor();
   assert.ok(serverRequests.some(r=>r.method==='OPTIONS'&&r.origin==='null'));
   assert.ok(serverRequests.some(r=>r.method==='GET'&&r.path==='/api/status'&&r.tokenValid&&r.origin==='null'));
   assert.ok(serverRequests.some(r=>r.method==='POST'&&r.path==='/api/vocabulary'&&r.tokenValid&&r.origin==='null'));
   assert.equal(upstreamCalls.length,1);assert.equal(upstreamCalls[0].input.word,'opaque');
   const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);assert.equal(saved.vocabulary[0].ai.synonyms[0].word,'obscure');assert.ok(!JSON.stringify(saved).includes('test-only'));assert.ok(!JSON.stringify(saved).includes(created.token));
  });
  await check('a stopped local service cannot prevent saving a newly collected word',async()=>{
   await stopService();await page.evaluate(id=>GREPlatform.openQuestion(id),question.question_id);await page.locator('.question-stem').waitFor();for(const id of question.correct_answer)await page.locator(`[data-poption="${id}"]`).click();await page.locator('[data-paction="submit"]').click();
   await page.locator('.vocabulary-form [name="word"]').fill('lucid');await page.locator('.vocabulary-form button[type="submit"]').click();
   await page.waitForFunction(()=>GREPlatform.getState().vocabulary.some(e=>e.word==='lucid'));
   await page.evaluate(()=>GREPlatform.go('vocabulary'));await page.waitForFunction(()=>/无法连接|本机服务|连接不可用/.test(document.querySelector('[data-ai-word="lucid"]')?.textContent||document.querySelector('[data-ai-status]')?.textContent||''));
   const current=await snapshot(page);assert.ok(current.vocabulary.find(e=>e.word==='lucid'));assert.ok(!current.vocabulary.find(e=>e.word==='lucid').ai);assert.equal(current.session.responses[question.question_id].correct,true);assert.equal(upstreamCalls.length,1);
  });
  await check('refresh with the service offline still displays cached matches and retains the new word',async()=>{
   await page.reload();await page.waitForFunction(()=>!!window.GREPlatform);await page.evaluate(()=>GREPlatform.go('vocabulary'));await page.locator('[data-ai-word="opaque"] .vocabulary-ai-result').waitFor();
   const saved=await snapshot(page);assert.equal(saved.vocabulary.find(e=>e.word==='opaque').ai.synonyms[0].word,'obscure');assert.ok(saved.vocabulary.some(e=>e.word==='lucid'));assert.equal(upstreamCalls.length,1);
  });
  await check('integration makes no external browser requests and raises no browser runtime errors',async()=>{assert.deepEqual(externalRequests,[]);assert.deepEqual(pageErrors,[]);});
 }finally{
  if(context)await context.close();if(browser)await browser.close();await stopService();
  fs.writeFileSync(path.join(__dirname,'vocabulary-api-browser-report.json'),JSON.stringify({testedAt:new Date().toISOString(),realLocalHTTP:true,mockedOpenAI:true,results,serverRequests,upstreamCallCount:upstreamCalls.length,pageErrors,externalRequests},null,2));
  if(results.some(result=>!result.ok)||pageErrors.length||externalRequests.length)process.exitCode=1;
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
