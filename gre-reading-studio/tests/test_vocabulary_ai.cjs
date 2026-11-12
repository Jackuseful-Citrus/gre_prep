/* Browser acceptance for local-proxy vocabulary enrichment.
 * All HTTP is intercepted: these tests never call OpenAI or use an API key. */
const {chromium}=require('C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),FILE=pathToFileURL(path.join(ROOT,'dist/index.html')).href;
const BANK=JSON.parse(fs.readFileSync(path.join(ROOT,'gre_question_bank.json'),'utf8'));
const question=BANK.questions.find(q=>q.question_type==='TC1'&&q.gradable);
const KEY='gre-training-progress-v2',TOKEN='a'.repeat(64),ENDPOINT='http://127.0.0.1:43187';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gre-vocabulary-ai-qa-'));
const results=[],pageErrors=[],externalRequests=[],contexts=[];
const snapshot=p=>p.evaluate(()=>GREPlatform.getState());
const go=(p,view)=>p.evaluate(view=>GREPlatform.go(view),view);
const aiArea=(p,word)=>p.locator(`[data-ai-word="${word}"]`);
const state=entries=>({version:2,attempts:[],favorites:[],vocabulary:entries,notes:{},essays:[],drafts:{},sessions:[],session:null,migratedBookmarks:[],updatedAt:Date.now()});
const entry=(word='opaque')=>({word,addedAt:Date.now(),sources:[{questionId:question.question_id,questionType:question.question_type,source:'QA original book',section:'Question 1',context:question.question_content,addedAt:Date.now()}]});
const match=({word,relationMode='confusable'},extra={})=>({version:1,word,meaning:'晦涩的；不透明的',synonyms:[{word:'obscure',meaning:'难懂的；模糊的',note:'强调不清楚或难以理解，不一定指物体不透光。'},{word:'abstruse',meaning:'深奥难懂的',note:'多形容思想或论述。'}],similar:relationMode==='related'?[{word:'ambiguity',meaning:'歧义；含混',note:'语义相关，但词性不同，不能直接替换。'}]:[{word:'opulent',meaning:'富裕的；华丽的',note:'形似但不同义，不能替换 opaque。'}],relationMode,model:'gpt-4.1-mini',generatedAt:Date.now(),...extra});
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name);}catch(e){results.push({name,ok:false,error:e.stack||e.message});console.log('FAIL',name,e.stack||e.message);}}
async function completed(p,word){await p.waitForFunction(word=>GREPlatform.getState().vocabulary.find(e=>e.word===word)?.ai?.meaning,word);}
async function importBackup(p,backup){await go(p,'materials');await p.locator('[data-paction="import-progress"]').click();await p.locator('#platform-import').setInputFiles({name:'ai-progress.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await p.waitForFunction(()=>!document.querySelector('#platform-import').value);assert.doesNotMatch(await p.locator('#toast').innerText(),/导入失败/);}

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  async function newPage({entries=[entry()],connection=true,viewport={width:1440,height:1000},mock={}}={}){
   const context=await browser.newContext({viewport,acceptDownloads:true});contexts.push(context);
   await context.addInitScript(({key,seed})=>{if(!sessionStorage.getItem('ai-qa-seeded')){localStorage.setItem(key,JSON.stringify(seed));sessionStorage.setItem('ai-qa-seeded','1');}},{key:KEY,seed:state(entries)});
   const traffic=[],control={configured:true,postStatus:200,postCode:'rate_limit',postError:'请求过于频繁，请稍后重试。',response:null,hold:null,statusHold:null,...mock};
   await context.route('**/*',async route=>{
    const request=route.request(),url=request.url();
    if(!/^https?:/.test(url))return route.continue();
    if(!url.startsWith(ENDPOINT+'/')){externalRequests.push(url);return route.abort();}
    const headers={'access-control-allow-origin':'null','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type,X-GRE-Token','access-control-allow-private-network':'true','content-type':'application/json'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    const data=request.method()==='POST'?request.postDataJSON():null;traffic.push({url,method:request.method(),data,token:request.headers()['x-gre-token']});
    if(url.endsWith('/api/status')){if(control.statusHold)await control.statusHold;return route.fulfill({status:200,headers,body:JSON.stringify({configured:control.configured,model:'gpt-4.1-mini'})});}
    if(url.endsWith('/api/vocabulary')){
     if(control.hold)await control.hold;
     const body=control.postStatus===200?(control.response?control.response(data):match(data)):{error:control.postError,code:control.postCode};
     return route.fulfill({status:control.postStatus,headers,body:JSON.stringify(body)});
    }
    return route.fulfill({status:404,headers,body:'{}'});
   });
   const p=await context.newPage();p.setDefaultTimeout(12000);p.on('pageerror',error=>pageErrors.push(error.message));
   const connectionData=typeof connection==='object'?connection:{url:ENDPOINT,token:TOKEN};
   await p.goto(FILE+(connection?'#gre-ai='+encodeURIComponent(JSON.stringify(connectionData)):'#vocabulary'));
   await p.waitForFunction(()=>!!window.GREPlatform&&!!window.GREVocabularyAI);
   await go(p,'vocabulary');return {p,traffic,control};
  }
  let successful,backup;
  await check('the ordinary file app remains offline and keeps existing saved words without an AI connection',async()=>{
   const {p,traffic}=await newPage({connection:false});await aiArea(p,'opaque').waitFor();
   assert.equal((await snapshot(p)).vocabulary[0].word,'opaque');assert.equal(traffic.length,0);assert.match(await p.locator('[data-ai-settings]').innerText(),/打开阅间|连接|本机/);
  });
  await check('a local launch automatically matches words, keeps synonyms and confusables distinct, and authenticates only to the local proxy',async()=>{
   successful=await newPage();const {p,traffic}=successful;await completed(p,'opaque');
   const area=aiArea(p,'opaque');await area.locator('.vocabulary-ai-result').waitFor();const text=await area.innerText();
   assert.match(text,/obscure/);assert.match(text,/abstruse/);assert.match(text,/opulent/);assert.match(text,/近义/);assert.match(text,/易混|形近/);assert.match(text,/AI/);
   assert.equal(traffic.filter(r=>r.method==='POST').length,1);assert.ok(traffic.every(r=>r.token===TOKEN));
   assert.equal(traffic.find(r=>r.method==='POST').data.context,question.question_content);
   assert.ok(!(await p.url()).includes(TOKEN));
  });
  await check('matched results survive reload without another generation request',async()=>{
   const {p,traffic}=successful,before=(await snapshot(p)).vocabulary[0].ai,count=traffic.filter(r=>r.method==='POST').length;
   await p.reload();await p.waitForFunction(()=>!!window.GREPlatform);await go(p,'vocabulary');await aiArea(p,'opaque').locator('.vocabulary-ai-result').waitFor();
   assert.deepEqual((await snapshot(p)).vocabulary[0].ai,before);assert.equal(traffic.filter(r=>r.method==='POST').length,count);
  });
  await check('progress export and fresh-profile import keep cached matches without exporting the local connection token',async()=>{
   const {p}=successful;await go(p,'materials');const promise=p.waitForEvent('download');await p.locator('[data-paction="export-progress"]').click();const file=path.join(temp,'ai-progress.json');await(await promise).saveAs(file);
   const raw=fs.readFileSync(file,'utf8');backup=JSON.parse(raw);assert.ok(backup.progress.vocabulary[0].ai);assert.ok(!raw.includes(TOKEN));assert.ok(!/OPENAI_API_KEY|X-GRE-Token|gre-vocabulary-ai-session/.test(raw));
   const fresh=await newPage({entries:[],connection:false});await importBackup(fresh.p,backup);await go(fresh.p,'vocabulary');await aiArea(fresh.p,'opaque').locator('.vocabulary-ai-result').waitFor();
   assert.deepEqual((await snapshot(fresh.p)).vocabulary[0].ai,backup.progress.vocabulary[0].ai);assert.equal(fresh.traffic.length,0);
  });
  await check('saving a newly answered question word automatically generates its vocabulary match',async()=>{
   const {p,traffic}=await newPage({entries:[]});await p.evaluate(id=>GREPlatform.openQuestion(id),question.question_id);await p.locator('.question-stem').waitFor();for(const id of question.correct_answer)await p.locator(`[data-poption="${id}"]`).click();await p.locator('[data-paction="submit"]').click();
   const chip=p.locator('.vocabulary-panel [data-vocab-word]').first(),word=await chip.getAttribute('data-vocab-word');await chip.click();await completed(p,word);
   assert.equal((await snapshot(p)).session.responses[question.question_id].correct,true);assert.equal(traffic.filter(r=>r.method==='POST').length,1);await go(p,'vocabulary');assert.ok(await aiArea(p,word).locator('.vocabulary-ai-result').isVisible());
  });
  await check('API errors preserve the word and allow an explicit successful retry',async()=>{
   const {p,traffic,control}=await newPage({mock:{postStatus:429}});await p.waitForFunction(()=>document.querySelector('[data-ai-word]')?.textContent.includes('请求过于频繁'));
   assert.equal((await snapshot(p)).vocabulary[0].word,'opaque');assert.ok(!(await snapshot(p)).vocabulary[0].ai);const attempts=traffic.filter(r=>r.method==='POST').length;
   await p.locator('#vocabulary-search').fill('opaque');assert.equal(traffic.filter(r=>r.method==='POST').length,attempts);
   control.postStatus=200;await aiArea(p,'opaque').locator('[data-ai-retry="opaque"]').click();await completed(p,'opaque');assert.equal(traffic.filter(r=>r.method==='POST').length,attempts+1);
  });
  await check('the real uppercase TIMEOUT code displays a specific timeout message and supports retry',async()=>{
   const {p,traffic,control}=await newPage({mock:{postStatus:504,postCode:'TIMEOUT',postError:'OpenAI 请求超时，请稍后重试。'}});
   await p.waitForFunction(()=>/超时/.test(document.querySelector('[data-ai-word="opaque"]')?.textContent||''));
   assert.ok(!(await snapshot(p)).vocabulary[0].ai);assert.equal(traffic.filter(r=>r.method==='POST').length,1);
   control.postStatus=200;await aiArea(p,'opaque').locator('[data-ai-retry="opaque"]').click();await completed(p,'opaque');assert.equal(traffic.filter(r=>r.method==='POST').length,2);
  });
  await check('words collected while connection status is pending are matched after connection without reopening the wordbook',async()=>{
   let release;const statusHold=new Promise(resolve=>release=resolve);
   try{
    const {p,traffic}=await newPage({entries:[],mock:{statusHold}});
    await p.evaluate(id=>GREPlatform.openQuestion(id),question.question_id);await p.locator('.question-stem').waitFor();for(const id of question.correct_answer)await p.locator(`[data-poption="${id}"]`).click();await p.locator('[data-paction="submit"]').click();
    const chip=p.locator('.vocabulary-panel [data-vocab-word]').first(),word=await chip.getAttribute('data-vocab-word');await chip.click();assert.ok((await snapshot(p)).vocabulary.some(e=>e.word===word));assert.equal(traffic.filter(r=>r.method==='POST').length,0);
    release();await completed(p,word);assert.equal(traffic.filter(r=>r.method==='POST').length,1);assert.ok(await p.locator('.question-stem').isVisible());assert.equal(await p.locator('.vocabulary-entry').count(),0);
   }finally{release();}
  });
  await check('a proxy without an API key reports configuration status without spending generation requests',async()=>{
   const {p,traffic}=await newPage({mock:{configured:false}});await p.waitForFunction(()=>/配置|密钥|Key|key/.test(document.querySelector('[data-ai-status]')?.textContent||''));
   assert.equal(traffic.filter(r=>r.method==='POST').length,0);assert.equal((await snapshot(p)).vocabulary[0].word,'opaque');
  });
  await check('changing similar-word mode requests semantic relatives and retains the new mode',async()=>{
   const {p,traffic}=await newPage();await completed(p,'opaque');await p.locator('[data-ai-mode]').selectOption('related');
   await p.waitForFunction(()=>GREPlatform.getState().vocabulary[0].ai?.relationMode==='related');assert.match(await aiArea(p,'opaque').innerText(),/ambiguity/);assert.match(await aiArea(p,'opaque').innerText(),/相关/);
   assert.equal(traffic.filter(r=>r.method==='POST').length,2);
  });
  await check('removing a word while matching is in flight cannot bring it back',async()=>{
   let release;const hold=new Promise(resolve=>release=resolve),{p,traffic}=await newPage({mock:{hold}});
   await p.waitForFunction(()=>/正在|匹配|排队/.test(document.querySelector('[data-ai-word]')?.textContent||''));
   for(let i=0;i<250&&!traffic.some(r=>r.method==='POST');i++)await new Promise(resolve=>setTimeout(resolve,20));
   assert.ok(traffic.some(r=>r.method==='POST'),'a generation request must actually be in flight');
   await p.locator('[data-vocab-remove="opaque"]').click();const delivered=p.waitForResponse(response=>response.url().endsWith('/api/vocabulary'));release();await(await delivered).finished();await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal((await snapshot(p)).vocabulary.length,0);
   await p.reload();await p.waitForFunction(()=>!!window.GREPlatform);assert.equal((await snapshot(p)).vocabulary.length,0);
  });
  await check('AI text is escaped rather than interpreted as HTML',async()=>{
   const injection='<img src=x onerror="window.aiInjected=true">';const {p}=await newPage({mock:{response:data=>match(data,{meaning:injection,synonyms:[{word:'obscure',meaning:injection,note:injection}]})}});await completed(p,'opaque');await aiArea(p,'opaque').locator('.vocabulary-ai-result').waitFor();
   assert.equal(await aiArea(p,'opaque').locator('img,script').count(),0);assert.equal(await p.evaluate(()=>!!window.aiInjected),false);assert.ok((await aiArea(p,'opaque').innerText()).includes(injection));
  });
  await check('untrusted connection URLs are rejected without any outbound requests',async()=>{
   const before=externalRequests.length,{p,traffic}=await newPage({connection:{url:'https://example.invalid',token:TOKEN}});assert.equal(traffic.length,0);assert.equal(externalRequests.length,before);assert.equal((await snapshot(p)).vocabulary[0].word,'opaque');
  });
  await check('mobile vocabulary explanations wrap cleanly without horizontal page overflow',async()=>{
   const {p}=await newPage({viewport:{width:390,height:844}});await completed(p,'opaque');await aiArea(p,'opaque').locator('.vocabulary-ai-result').waitFor();
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(__dirname,'qa-vocabulary-ai-mobile.png'),fullPage:true});
  });
  await check('all AI tests use only the intercepted local proxy and produce no uncaught browser errors',async()=>{assert.deepEqual(externalRequests,[]);assert.deepEqual(pageErrors,[]);});
 }finally{
  for(const context of contexts)await context.close();await browser.close();fs.writeFileSync(path.join(__dirname,'vocabulary-ai-qa-report.json'),JSON.stringify({testedAt:new Date().toISOString(),mockedOpenAI:true,results,pageErrors,externalRequests},null,2));if(results.some(r=>!r.ok)||pageErrors.length||externalRequests.length)process.exitCode=1;
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
