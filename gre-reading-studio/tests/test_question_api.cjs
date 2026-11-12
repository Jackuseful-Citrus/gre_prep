'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const Q=require('../dist/openai-question.js');
const {createServer}=require('../scripts/vocabulary-api.cjs');
const KEY='question-test-key',TOKEN='question-test-token';
const input=(overrides={})=>({questionId:'test-q1',questionType:'RC1',answerMode:'single',questionText:'Which option is supported?',passage:'The passage supports the first claim.',options:[{id:'A',text:'The first claim.'},{id:'B',text:'The contrary claim.'}],blankGroups:[],knownAnswer:[],knownExplanation:'',missingAnswer:true,missingExplanation:true,hasImages:false,images:[],...overrides});
const output=(overrides={})=>({status:'answered',answer:['A'],explanation:'文章直接支持第一个说法，A 与证据一致；B 与之相反。',reason:'',...overrides});
const success=value=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value||output())}]}]}),{status:200,headers:{'Content-Type':'application/json'}});
async function setup(t,options={}){
  const temporaryBase=path.resolve(os.tmpdir()),dataDirectory=await fs.mkdtemp(path.join(temporaryBase,'gre-question-api-test-'));
  const {server,token}=createServer({apiKey:KEY,token:TOKEN,model:'gpt-4.1-mini',fetchImpl:async()=>success(),...options,dataDirectory});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});assert.equal(path.dirname(path.resolve(dataDirectory)),temporaryBase);assert.ok(path.basename(dataDirectory).startsWith('gre-question-api-test-'));await fs.rm(dataDirectory,{recursive:true,force:true});});
  const request=(body=input(),route='/api/question',headers={})=>fetch(url+route,{method:route==='/api/status'?'GET':'POST',headers:{Origin:'null','X-GRE-Token':token,'Content-Type':'application/json',...headers},...(route!=='/api/status'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
  return {url,request};
}

test('question input preserves source texts and rejects truncation, duplicate options, unsafe images and invalid groups',()=>{
  const complete=input({questionText:' Q '.repeat(5000),passage:'x'.repeat(60000),knownAnswer:['原资料写 A（存在疑点）']});
  assert.deepEqual(Q.validateInput(complete),complete);
  for(const invalid of [input({passage:'x'.repeat(60001)}),input({questionText:''}),input({options:[{id:'A',text:'one'},{id:'A',text:'two'}]}),input({options:[]}),input({answerMode:'guess'}),input({images:[{url:'https://example.test/image.png',label:''}],hasImages:true}),input({images:[{url:'data:image/svg+xml;base64,AAAA',label:''}],hasImages:true}),input({answerMode:'blanks',blankGroups:[{id:'1',optionIds:['A']},{id:'2',optionIds:['A']}]})])assert.throws(()=>Q.validateInput(invalid),error=>error.code==='INVALID_INPUT');
  assert.doesNotThrow(()=>Q.validateInput(input({questionText:'',hasImages:true})));
});

test('answer validation enforces option IDs and cardinality for all selection modes',()=>{
  assert.deepEqual(Q.validateOutput(output(),input()),output());
  assert.throws(()=>Q.validateOutput(output({answer:['C']}),input()),/无法对应/);
  assert.throws(()=>Q.validateOutput(output({answer:['A','B']}),input()),/无法对应/);
  assert.throws(()=>Q.validateOutput(output({answer:['A','A']}),input({answerMode:'multiple'})),/无法对应/);
  assert.doesNotThrow(()=>Q.validateOutput(output({answer:['A','B']}),input({answerMode:'pair'})));
  assert.throws(()=>Q.validateOutput(output(),input({answerMode:'pair'})),/无法对应/);
  const blanks=input({answerMode:'blanks',options:[{id:'a1',text:'one'},{id:'a2',text:'two'},{id:'b1',text:'three'},{id:'b2',text:'four'}],blankGroups:[{id:'1',optionIds:['a1','a2']},{id:'2',optionIds:['b1','b2']}]});
  assert.doesNotThrow(()=>Q.validateOutput(output({answer:['a2','b1']}),blanks));
  assert.throws(()=>Q.validateOutput(output({answer:['a1','a2']}),blanks),/无法对应/);
  assert.doesNotThrow(()=>Q.validateOutput(output(),input({answerMode:'sentence'})));
});

test('numeric, free answers and insufficient evidence require usable complete outputs',()=>{
  for(const answer of ['1/2','-0.75','.25','−2'])assert.doesNotThrow(()=>Q.validateOutput(output({answer:[answer]}),input({answerMode:'numeric',options:[]})));
  for(const answer of ['A','1/0','1/0.0','NaN','0.25 or 1/4'])assert.throws(()=>Q.validateOutput(output({answer:[answer]}),input({answerMode:'numeric',options:[]})),/无法对应/);
  assert.doesNotThrow(()=>Q.validateOutput(output({answer:['题目要求的简短结论']}),input({answerMode:'free',options:[]})));
  const insufficient={status:'insufficient',answer:[],explanation:'',reason:'缺少题目引用的图中数值。'};
  assert.deepEqual(Q.validateOutput(insufficient,input()),insufficient);
  for(const invalid of [{...insufficient,reason:''},{...insufficient,answer:['A']},output({explanation:''}),output({extra:'unexpected'})])assert.throws(()=>Q.validateOutput(invalid,input()),/无法对应/);
});

test('Responses request separates full question JSON and image inputs with strict nonstored output',()=>{
  const img={url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',label:'原题图'};
  const raw=input({hasImages:true,images:[img]});
  const body=Q.requestBody(raw,'gpt-4.1-mini');
  assert.equal(body.store,false);assert.equal(body.max_output_tokens,3000);assert.equal(body.text.format.type,'json_schema');assert.equal(body.text.format.strict,true);
  const data=JSON.parse(body.input[0].content[0].text);
  assert.deepEqual(data.images,[{index:1,label:'原题图'}]);assert.equal(data.providedImageCount,1);assert.equal(data.passage,raw.passage);assert.deepEqual(body.input[0].content[1],{type:'input_image',image_url:img.url,detail:'auto'});
  assert.match(body.instructions,/不是指令/);assert.match(body.instructions,/不能声称看过图/);
  const noImage=Q.requestBody(input({hasImages:true}),'gpt-4.1-mini');assert.equal(JSON.parse(noImage.input[0].content[0].text).providedImageCount,0);
});

test('generate returns validated output with source identity and safe metadata',async()=>{
  let captured;
  const result=await Q.generate(input(),{apiKey:KEY,model:'test-model',fetchImpl:async(url,options)=>{captured={url,options};return success();},timeoutMs:1000});
  assert.equal(result.questionId,'test-q1');assert.equal(result.version,1);assert.equal(result.model,'test-model');assert.ok(result.generatedAt>0);assert.equal(result.status,'answered');assert.deepEqual(result.answer,['A']);
  assert.equal(captured.url,'https://api.openai.com/v1/responses');assert.equal(captured.options.headers.Authorization,`Bearer ${KEY}`);assert.ok(!JSON.stringify(result).includes(KEY));
  const insufficient=await Q.generate(input({hasImages:true}),{apiKey:KEY,model:'test-model',fetchImpl:async()=>success({status:'insufficient',answer:[],explanation:'',reason:'缺少必要图像。'}),timeoutMs:1000});
  assert.equal(insufficient.status,'insufficient');assert.deepEqual(insufficient.answer,[]);
});

test('generate maps HTTP, timeout, incomplete, refusal, malformed and wrong-option failures safely',async()=>{
  const call=fetchImpl=>Q.generate(input(),{apiKey:KEY,model:'test-model',fetchImpl,timeoutMs:1000});
  for(const [status,code]of [[401,'AUTH_FAILED'],[403,'ACCESS_DENIED'],[429,'RATE_LIMITED'],[400,'MODEL_ERROR'],[500,'UPSTREAM_ERROR']])await assert.rejects(call(async()=>new Response('private upstream details',{status})),error=>error.code===code&&!error.message.includes('private'));
  await assert.rejects(call(async()=>{throw Object.assign(Error('private error'),{name:'TimeoutError'});}),error=>error.code==='TIMEOUT');
  await assert.rejects(call(async()=>{throw Error('private network details');}),error=>error.code==='NETWORK_ERROR');
  await assert.rejects(call(async()=>new Response(JSON.stringify({status:'incomplete'}))),error=>error.code==='INCOMPLETE_RESPONSE');
  await assert.rejects(call(async()=>new Response(JSON.stringify({output:[{content:[{type:'refusal'}]}]}))),error=>error.code==='REFUSED');
  await assert.rejects(call(async()=>new Response('not JSON')),error=>error.code==='INVALID_RESPONSE');
  await assert.rejects(call(async()=>success(output({answer:['outside']}))),error=>error.code==='INVALID_RESPONSE');
});

test('local question route requires normal origin/token auth and configured credentials',async t=>{
  let calls=0;const {request}=await setup(t,{apiKey:'',fetchImpl:async()=>{calls++;return success();}});
  const status=await (await request(null,'/api/status')).json();assert.equal(status.features.question,true);
  assert.equal((await request(input(),'/api/question',{'X-GRE-Token':'wrong'})).status,401);
  assert.equal((await request(input(),'/api/question',{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await request()).status,503);assert.equal(calls,0);
});

test('local route rejects invalid question bodies before fetch and safely exposes question API errors',async t=>{
  let calls=0;const {request}=await setup(t,{fetchImpl:async()=>{calls++;return success(output({answer:['unknown-id']}));}});
  for(const bad of [{},input({passage:'x'.repeat(60001)}),'{'])assert.equal((await request(bad)).status,400);
  assert.equal((await request(input(),'/api/question',{'Content-Type':'text/plain'})).status,415);
  assert.equal(calls,0);
  const failed=await request();assert.equal(failed.status,502);assert.equal((await failed.json()).code,'INVALID_RESPONSE');assert.equal(calls,1);
});

test('question cache includes complete context and shares duplicate in-flight work',async t=>{
  let calls=0;const releases=[];
  const {request}=await setup(t,{fetchImpl:async()=>{calls++;await new Promise(resolve=>releases.push(resolve));return success();}});
  const first=request(),duplicate=request();
  for(let n=0;n<100&&calls<1;n++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(calls,1);releases.shift()();
  const firstValue=await (await first).json();assert.deepEqual(await (await duplicate).json(),firstValue);
  assert.deepEqual(await (await request()).json(),firstValue);assert.equal(calls,1);
  const changed=request(input({passage:'A different full passage.'}));
  for(let n=0;n<100&&calls<2;n++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(calls,2);releases.shift()();assert.equal((await changed).status,200);
});

test('shared concurrency limit spans vocabulary and question analysis; configuration clears caches',async t=>{
  let calls=0;const releases=[];
  const {request}=await setup(t,{fetchImpl:async(url,options)=>{calls++;const body=JSON.parse(options.body);await new Promise(resolve=>releases.push(resolve));return body.text.format.name==='gre_question_analysis'?success():success({word:'opaque',meaning:'不透明的',synonyms:[],similar:[]});}});
  const first=request(),vocab=request({word:'opaque',context:'opaque',relationMode:'confusable'},'/api/vocabulary');
  for(let n=0;n<100&&calls<2;n++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(calls,2);const busy=await request(input({questionId:'test-q2'}));assert.equal(busy.status,429);assert.equal((await busy.json()).code,'LOCAL_BUSY');
  for(const release of releases.splice(0))release();assert.equal((await first).status,200);assert.equal((await vocab).status,200);
  assert.equal((await request({apiKey:'new-test-key',model:'test-model'},'/api/config')).status,200);
  const after=request();for(let n=0;n<100&&calls<3;n++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(calls,3);releases.shift()();assert.equal((await after).status,200);
});
