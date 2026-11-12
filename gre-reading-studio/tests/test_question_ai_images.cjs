/* Lazy image loader checks; the browser's only API request is intercepted. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.GRE_PLAYWRIGHT||'C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const build=require('../scripts/build_question_ai_images.cjs'),C=require('../dist/platform-core.js');
const ROOT=path.resolve(__dirname,'..'),BANK=JSON.parse(fs.readFileSync(path.join(ROOT,'gre_question_bank.json'),'utf8'));
const API='https://api.openai.com/v1/responses',KEY='sk-image-loader-qa-not-real';
async function loaderChecks(){
  const src='question-images/example.png',url='data:image/png;base64,iVBORw0KGgo=',scripts=[],timers=new Map();let nextTimer=0;
  const document={currentScript:{src:'file:///app/question-images-ai.js'},head:{appendChild(script){scripts.push(script);}},createElement(){return {remove(){this.removed=true;}};}};
  const sandbox={window:{},document,URL,Map,Set,setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}};
  vm.runInNewContext(build.loaderSource({[src]:1}),sandbox);
  const loader=sandbox.window.GREQuestionImages;
  assert.equal(await loader.load('../secret.png'),null);assert.equal(await loader.load('https://example.com/image.png'),null);assert.equal(scripts.length,0);
  const failed=loader.load(src),duplicate=loader.load(src);assert.equal(scripts.length,1);scripts[0].onerror();assert.equal(await failed,null);assert.equal(await duplicate,null);
  const timed=loader.load(src);assert.equal(scripts.length,2);[...timers.values()][0]();assert.equal(await timed,null);
  const retry=loader.load(src);assert.equal(scripts.length,3);document.currentScript=scripts[2];loader.register(1,[[src,url]]);scripts[2].onload();assert.equal((await retry).url,url);assert.equal((await loader.load(src)).url,url);assert.equal(scripts.length,3);
  assert.ok(scripts.every(script=>script.removed));assert.equal(timers.size,0);
  console.log('PASS fixed mapping, concurrent load deduplication, missing chunk retry, timeout cleanup and cache');
}
async function browserCheck(){
  const supported=new Set(build.eligibleAssets(BANK));
  const question=BANK.questions.find(q=>q.category!=='AWA'&&!q.explanation&&!q.explanation_images?.length&&C.mode(q)==='single'&&q.options?.length&&q.images?.some(image=>supported.has(image.src)));
  assert.ok(question,'a current-bank single-choice image question lacks an explanation');
  const src=question.images.find(image=>supported.has(image.src)).src,expected=build.imageData(src);
  assert.ok(expected);assert.equal(build.imageData('question-images/../index.html'),null);assert.equal(build.imageData('sources/private.txt'),null);
  const browser=await chromium.launch({headless:true,executablePath:process.env.GRE_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext(),errors=[],unexpected=[],chunks=[];let requests=0;
  try{
    await context.route('**/*',async route=>{
      const request=route.request(),url=request.url();
      if(url.includes('/question-image-data/'))chunks.push(url);
      if(!/^https?:/.test(url))return route.continue();
      if(url!==API){unexpected.push(url);return route.abort();}
      const headers={'access-control-allow-origin':'null','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'Content-Type,Authorization','content-type':'application/json'};
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
      requests++;
      assert.equal(request.headers().authorization,'Bearer '+KEY);
      const body=request.postDataJSON(),content=body.input.flatMap(item=>item.content||[]),input=JSON.parse(content.find(item=>item.type==='input_text').text);
      assert.equal(input.questionId,question.question_id);assert.ok(content.some(item=>item.type==='input_image'&&item.image_url===expected.url),'the original local image bytes reach the mocked API');
      const answer=input.knownAnswer.length?input.knownAnswer:[input.options[0].id],output={status:'answered',answer,explanation:'测试解析：已读取随题提供的原始图片，并依据题意核对答案。',reason:''};
      return route.fulfill({status:200,headers,body:JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]})});
    });
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
    await page.goto(pathToFileURL(path.join(ROOT,'dist/index.html')).href+'#vocabulary');
    await page.waitForFunction(()=>window.GREPlatform&&window.GREQuestionAI&&window.GREVocabularyAI);
    if(!await page.evaluate(()=>!!window.GREQuestionImages))await page.addScriptTag({url:pathToFileURL(path.join(ROOT,'dist/question-images-ai.js')).href});
    await page.evaluate(()=>GREPlatform.go('vocabulary'));
    if(!await page.locator('[data-ai-settings-body]').isVisible())await page.locator('[data-ai-action="toggle-settings"]').click();
    await page.locator('[data-ai-key]').fill(KEY);await page.locator('[data-ai-action="configure"]').click();
    await page.waitForFunction(()=>GREVocabularyAI.getQuestionServiceState().ready);
    await page.evaluate(id=>GREPlatform.openQuestion(id),question.question_id);
    assert.equal(chunks.length,0,'image chunks are not loaded before submitting');
    await page.locator(`[data-poption="${question.options[0].id}"]`).click();await page.locator('[data-paction="submit"]').click();
    await page.waitForFunction(id=>GREPlatform.getState().questionAnalysis?.[id]?.status==='answered',question.question_id);
    assert.equal(requests,1);assert.ok(chunks.length>0);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    assert.ok(!await page.evaluate(key=>JSON.stringify({local:{...localStorage},state:GREPlatform.getState()}).includes(key),KEY));
    console.log('PASS actual file:// question image lazily reaches mocked API after submission; no external traffic or browser errors');
  }finally{await context.close();await browser.close();}
}
(async()=>{await loaderChecks();await browserCheck();})().catch(error=>{console.error(error);process.exitCode=1;});
