'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createServer,browserURL}=require('../scripts/vocabulary-api.cjs');
const TOKEN='unit-test-local-token',KEY='unit-test-api-credential';
const input={word:'opaque',context:'The argument was opaque.',relationMode:'confusable'};
const fixture=word=>({word,meaning:'不透明的；难懂的',synonyms:[{word:'obscure',meaning:'晦涩的',note:'强调难以理解，未必指物理透明度。'}],similar:[{word:'opulent',meaning:'富丽的',note:'拼写部分相似，但不是近义词。'}]});
const success=(word='opaque')=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(fixture(word))}]}]}),{status:200,headers:{'Content-Type':'application/json'}});
async function setup(t,options={}){
  const temporaryBase=path.resolve(os.tmpdir()),dataDirectory=await fs.mkdtemp(path.join(temporaryBase,'gre-vocabulary-api-test-'));
  const {server,token}=createServer({apiKey:KEY,model:'gpt-4.1-mini',token:TOKEN,fetchImpl:async()=>success(),...options,dataDirectory});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{
    await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
    assert.equal(path.dirname(path.resolve(dataDirectory)),temporaryBase);
    assert.ok(path.basename(dataDirectory).startsWith('gre-vocabulary-api-test-'));
    await fs.rm(dataDirectory,{recursive:true,force:true});
  });
  async function request(route='/api/vocabulary',body=input,extras={}){
    const method=extras.method||(route==='/api/status'?'GET':'POST');
    return fetch(url+route,{method,headers:{Origin:'null','X-GRE-Token':token,...(method==='POST'?{'Content-Type':'application/json'}:{}),...extras.headers},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{}),...extras.options});
  }
  return {server,url,request,dataDirectory};
}

test('status exposes configuration and model, never credentials',async t=>{
  const {request,dataDirectory}=await setup(t);const response=await request('/api/status');
  assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'null');
  const text=await response.text();assert.deepEqual(JSON.parse(text),{configured:true,model:'gpt-4.1-mini',features:{config:true,progress:true,shutdown:true,question:true},location:path.join(dataDirectory,'progress.json')});assert.ok(!text.includes(KEY));assert.ok(!text.includes(TOKEN));
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('loopback host, allowed Origin and session token are required; preflight is bounded',async t=>{
  const {url,request}=await setup(t);
  for(const headers of [{'X-GRE-Token':'wrong'},{'X-GRE-Token':''}])assert.equal((await request('/api/status',null,{headers})).status,401);
  for(const headers of [{Origin:'https://untrusted.example'},{Origin:''}])assert.equal((await request('/api/status',null,{headers})).status,403);
  const badHost=await new Promise((resolve,reject)=>require('node:http').get(url+'/api/status',{headers:{Host:'untrusted.example',Origin:'null','X-GRE-Token':TOKEN}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));assert.equal(badHost,403);
  assert.equal((await request('/api/status',null,{headers:{Origin:url}})).status,200);
  const options=await request('/api/vocabulary',null,{method:'OPTIONS',headers:{'X-GRE-Token':'','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-gre-token','Access-Control-Request-Private-Network':'true'}});
  assert.equal(options.status,204);assert.equal(options.headers.get('access-control-allow-private-network'),'true');assert.notEqual(options.headers.get('access-control-allow-origin'),'*');
  assert.equal((await request('/api/vocabulary',null,{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization'}})).status,403);
});

test('REST request uses strict Responses schema, no stored responses, and parses output messages',async t=>{
  let captured;const {request}=await setup(t,{fetchImpl:async(url,options)=>{captured={url,options};return success();}});
  const response=await request();assert.equal(response.status,200);const result=await response.json();
  assert.equal(captured.url,'https://api.openai.com/v1/responses');assert.equal(captured.options.headers.Authorization,`Bearer ${KEY}`);
  const body=JSON.parse(captured.options.body);assert.equal(body.store,false);assert.equal(body.max_output_tokens,1800);assert.equal(body.model,'gpt-4.1-mini');assert.equal(body.text.format.type,'json_schema');assert.equal(body.text.format.strict,true);assert.equal(body.text.format.schema.additionalProperties,false);assert.deepEqual(JSON.parse(body.input),input);
  assert.equal(result.word,'opaque');assert.equal(result.relationMode,'confusable');assert.equal(result.version,1);assert.ok(Number.isFinite(result.generatedAt));assert.deepEqual(result.synonyms,fixture('opaque').synonyms);
  assert.ok(!JSON.stringify(result).includes(KEY));
});

test('missing API key is explicit and does not call OpenAI',async t=>{
  let calls=0;const {request}=await setup(t,{apiKey:'',fetchImpl:async()=>{calls++;return success();}});
  assert.equal((await request('/api/status').then(r=>r.json())).configured,false);
  const response=await request();assert.equal(response.status,503);assert.equal((await response.json()).code,'KEY_NOT_CONFIGURED');assert.equal(calls,0);
});

test('invalid words, modes, oversized bodies and malformed JSON never reach OpenAI',async t=>{
  let calls=0;const {request}=await setup(t,{fetchImpl:async()=>{calls++;return success();}});
  for(const body of [{...input,word:'<script>'},{...input,context:'a'.repeat(1201)},{...input,relationMode:'anything'},null,{},'{'])assert.equal((await request('/api/vocabulary',body)).status,400);
  assert.equal((await request('/api/vocabulary',{...input,context:'a'.repeat(9000)})).status,413);
  assert.equal((await request('/api/vocabulary',input,{headers:{'Content-Type':'text/plain'}})).status,415);assert.equal(calls,0);
});

test('cache distinguishes context and relation mode and normalizes duplicate words',async t=>{
  let calls=0;const {request}=await setup(t,{fetchImpl:async()=>{calls++;return success();}});
  const first=await (await request()).json();
  const cached=await (await request('/api/vocabulary',{...input,word:'  OPAQUE  '})).json();
  assert.deepEqual(cached,first);assert.equal(calls,1);
  const related=await (await request('/api/vocabulary',{...input,relationMode:'related'})).json();assert.equal(related.relationMode,'related');assert.equal(calls,2);
  await request('/api/vocabulary',{...input,context:'A different sense.'});assert.equal(calls,3);
});

test('concurrent duplicates share one request and only two unique requests may run',async t=>{
  let calls=0;const releases=[];
  const {request}=await setup(t,{fetchImpl:async(url,options)=>{calls++;const word=JSON.parse(JSON.parse(options.body).input).word;await new Promise(resolve=>releases.push(resolve));return success(word);}});
  const first=request(),duplicate=request(),second=request('/api/vocabulary',{...input,word:'lucid'});
  for(let i=0;i<100&&calls<2;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(calls,2);
  const busy=await request('/api/vocabulary',{...input,word:'arcane'});assert.equal(busy.status,429);assert.equal((await busy.json()).code,'LOCAL_BUSY');
  for(const release of releases)release();
  const responses=await Promise.all([first,duplicate,second]);assert.deepEqual(responses.map(r=>r.status),[200,200,200]);assert.equal(calls,2);
});

test('upstream errors are sanitized and failures are not cached or automatically retried',async t=>{
  for(const [status,code]of [[401,'AUTH_FAILED'],[403,'ACCESS_DENIED'],[429,'RATE_LIMITED'],[404,'MODEL_ERROR'],[500,'UPSTREAM_ERROR']]){
    let calls=0;const {request}=await setup(t,{fetchImpl:async()=>{calls++;return new Response('upstream details '+KEY,{status});}});
    for(let i=0;i<2;i++){const response=await request(),text=await response.text();assert.equal(JSON.parse(text).code,code);assert.ok(!text.includes(KEY));assert.ok(!text.includes('upstream details'));}
    assert.equal(calls,2);
  }
});

test('timeout, refusal, incomplete output and malformed model JSON are explicit failures',async t=>{
  const cases=[
    {code:'TIMEOUT',fetchImpl:async()=>{throw new DOMException('test','TimeoutError');}},
    {code:'NETWORK_ERROR',fetchImpl:async()=>{throw Error(KEY);}},
    {code:'REFUSED',data:{output:[{content:[{type:'refusal',refusal:'No'}]}]}},
    {code:'INCOMPLETE_RESPONSE',data:{status:'incomplete',output:[]}},
    {code:'INVALID_RESPONSE',data:{output:[{content:[{type:'output_text',text:'not JSON'}]}]}},
    {code:'INVALID_RESPONSE',data:{output:[{content:[{type:'output_text',text:JSON.stringify({...fixture('opaque'),synonyms:[{word:'<script>',meaning:'x',note:''}]})}]}]}}
  ];
  for(const c of cases){const {request}=await setup(t,{fetchImpl:c.fetchImpl||(async()=>new Response(JSON.stringify(c.data),{status:200}))});const response=await request(),text=await response.text();assert.equal(JSON.parse(text).code,c.code);assert.ok(!text.includes(KEY));}
});

test('launcher keeps the original file path and puts only the local session in the URL fragment',()=>{
  const url=new URL(browserURL(43187,TOKEN));assert.equal(url.protocol,'file:');assert.ok(url.pathname.endsWith('/gre-reading-studio/dist/index.html'));
  assert.equal(url.search,'');assert.deepEqual(JSON.parse(decodeURIComponent(url.hash.slice('#gre-ai='.length))),{url:'http://127.0.0.1:43187',token:TOKEN});assert.ok(!url.href.includes(KEY));
});

test('web configuration changes the next mocked API request, never persists or echoes credentials, and clear disables API use',async t=>{
  const replacement='unit-test-replacement-api-key',captured=[];
  const {request,dataDirectory}=await setup(t,{apiKey:'',fetchImpl:async(url,options)=>{captured.push(options);return success();}});
  const response=await request('/api/config',{apiKey:`  ${replacement}  `,model:'gpt-4.1'});
  assert.equal(response.status,200);const text=await response.text(),configured=JSON.parse(text);
  assert.equal(configured.configured,true);assert.equal(configured.model,'gpt-4.1');
  assert.ok(!text.includes(replacement));assert.ok(!text.includes(TOKEN));assert.equal(captured.length,0);
  assert.equal((await request()).status,200);assert.equal(captured.length,1);
  assert.equal(captured[0].headers.Authorization,`Bearer ${replacement}`);
  assert.equal(JSON.parse(captured[0].body).model,'gpt-4.1');
  const cleared=await request('/api/config',{clear:true});assert.equal(cleared.status,200);assert.equal((await cleared.json()).configured,false);
  assert.equal((await request('/api/status').then(r=>r.json())).configured,false);
  const missing=await request();assert.equal(missing.status,503);assert.equal((await missing.json()).code,'KEY_NOT_CONFIGURED');assert.equal(captured.length,1);
  assert.deepEqual(await fs.readdir(dataDirectory),[]);
});

test('invalid web configuration preserves existing credentials and returns only safe validation errors',async t=>{
  const captured=[];const {request,dataDirectory}=await setup(t,{fetchImpl:async(url,options)=>{captured.push(options);return success();}});
  const invalid=[null,{}, {apiKey:''},{apiKey:'contains space'}, {apiKey:'contains\nnewline'}, {apiKey:'a'.repeat(4097)}, {apiKey:'do-not-echo-this-key',model:'invalid model'}, {apiKey:'do-not-echo-this-key',model:{}}];
  for(const body of invalid){
    const response=await request('/api/config',body),text=await response.text();
    assert.equal(response.status,400);assert.equal(JSON.parse(text).code,'INVALID_CONFIG');assert.ok(!text.includes('do-not-echo-this-key'));assert.ok(!text.includes(KEY));
  }
  assert.equal((await request('/api/config','{')).status,400);
  assert.equal((await request('/api/config',{apiKey:'a'.repeat(9000)})).status,413);
  assert.equal((await request()).status,200);assert.equal(captured[0].headers.Authorization,`Bearer ${KEY}`);
  assert.equal(JSON.parse(captured[0].body).model,'gpt-4.1-mini');
  assert.deepEqual(await fs.readdir(dataDirectory),[]);
});

for(const clearFirst of [false,true])test(`reconfiguring ${clearFirst?'after clearing':'directly'} does not reuse old pending work or its late cache result`,{timeout:10000},async t=>{
  const replacement='unit-test-next-generation-key',calls=[];
  let releaseOld,oldStarted,newStarted;
  const oldGate=new Promise(resolve=>{releaseOld=resolve;});
  const oldSignal=new Promise(resolve=>{oldStarted=resolve;});
  const newSignal=new Promise(resolve=>{newStarted=resolve;});
  const responseFor=meaning=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...fixture('opaque'),meaning})}]}]}),{status:200});
  const {request}=await setup(t,{fetchImpl:async(url,options)=>{
    calls.push(options.headers.Authorization);
    if(options.headers.Authorization===`Bearer ${KEY}`){oldStarted();await oldGate;return responseFor('旧配置的结果');}
    newStarted();return responseFor('新配置的结果');
  }});
  const first=request();let second;
  try{
    await oldSignal;
    if(clearFirst){
      assert.equal((await request('/api/config',{clear:true})).status,200);
      assert.equal((await request()).status,503);
    }
    assert.equal((await request('/api/config',{apiKey:replacement})).status,200);
    second=request();
    let timer;
    try{
      const independent=await Promise.race([newSignal.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1500);})]);
      assert.equal(independent,true,'The new configuration must begin its own request while old work remains pending.');
    }finally{clearTimeout(timer);}
    const secondResponse=await second;assert.equal(secondResponse.status,200);assert.equal((await secondResponse.json()).meaning,'新配置的结果');
    releaseOld();
    const firstResponse=await first;assert.equal(firstResponse.status,200);assert.equal((await firstResponse.json()).meaning,'旧配置的结果');
    const cached=await request();assert.equal(cached.status,200);assert.equal((await cached.json()).meaning,'新配置的结果');
    assert.deepEqual(calls,[`Bearer ${KEY}`,`Bearer ${replacement}`]);
  }finally{releaseOld();await Promise.allSettled([first,...(second?[second]:[])]);}
});

const portableDocument=word=>({
  app:'gre-training-studio',
  progress:{version:2,attempts:[{questionId:'q1',answer:'A'}],favorites:['q1'],vocabulary:[{word:word||'opaque',addedAt:1,sources:[]}],notes:{q1:'笔记'},session:null},
  legacyRC:{version:1,questions:{q2:{answer:'B'}},bookmarks:[],history:[]},
  mock:{version:1,active:null,history:[]},
  importedBanks:[{schema_version:2,questions:[{id:'imported-q1'}],sources:[],materials:[]}]
});

test('progress can be saved and reopened without an API key; credentials and caller paths are excluded',async t=>{
  let calls=0;const {request,dataDirectory}=await setup(t,{apiKey:'',fetchImpl:async()=>{calls++;return success();}});
  const emptyResponse=await request('/api/progress',null,{method:'GET'});assert.equal(emptyResponse.status,200);
  const empty=await emptyResponse.json();assert.equal(empty.revision,0);assert.equal(empty.document,null);assert.equal(empty.savedAt,0);
  const document=portableDocument(),response=await request('/api/progress',{revision:0,document:{...document,apiKey:KEY,token:TOKEN,settings:{apiKey:KEY},path:'../outside.json'},path:'../outside.json'});
  assert.equal(response.status,200);const saved=await response.json();
  assert.equal(saved.revision,1);assert.equal(saved.storeId,empty.storeId);assert.ok(saved.savedAt>0);assert.deepEqual(saved.document,document);
  assert.equal(saved.location,path.join(dataDirectory,'progress.json'));
  assert.deepEqual(await request('/api/progress',null,{method:'GET'}).then(r=>r.json()),saved);
  const contents=await fs.readFile(path.join(dataDirectory,'progress.json'),'utf8');
  assert.ok(!contents.includes(KEY));assert.ok(!contents.includes(TOKEN));assert.ok(!contents.includes('outside.json'));
  assert.deepEqual(await fs.readdir(dataDirectory),['progress.json']);assert.equal(calls,0);
});

test('progress API reports conflicts with the current saved state and preserves the other edits in a recovery file',async t=>{
  const {request,dataDirectory}=await setup(t,{apiKey:''});
  const first=await request('/api/progress',{revision:0,document:portableDocument('opaque')}).then(r=>r.json());
  const conflictResponse=await request('/api/progress',{revision:0,document:portableDocument('lucid')});
  assert.equal(conflictResponse.status,409);const conflict=await conflictResponse.json();assert.equal(conflict.code,'PROGRESS_CONFLICT');
  assert.equal(conflict.current.storeId,first.storeId);assert.equal(conflict.current.revision,1);assert.deepEqual(conflict.current.document,first.document);
  assert.equal((await request('/api/progress',null,{method:'GET'}).then(r=>r.json())).document.progress.vocabulary[0].word,'opaque');
  const recoveries=(await fs.readdir(dataDirectory)).filter(name=>name.startsWith('progress.recovery.'));
  assert.equal(recoveries.length,1);const recovery=JSON.parse(await fs.readFile(path.join(dataDirectory,recoveries[0]),'utf8'));
  assert.equal(recovery.document.progress.vocabulary[0].word,'lucid');
  const retry=await request('/api/progress',{revision:1,document:portableDocument('lucid')});assert.equal(retry.status,200);assert.equal((await retry.json()).revision,2);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDirectory,'progress.previous.json'),'utf8')).revision,1);
});

test('progress API rejects malformed input and refuses to replace a corrupt save',async t=>{
  const {request,dataDirectory}=await setup(t,{apiKey:''});
  for(const body of [null,{}, {revision:-1,document:portableDocument()}, {revision:0,document:{app:'gre-training-studio',progress:{version:2,attempts:{},favorites:[]}}}]){
    const response=await request('/api/progress',body);assert.equal(response.status,400);assert.equal((await response.json()).code,'PROGRESS_INVALID');
  }
  assert.deepEqual(await fs.readdir(dataDirectory),[]);
  await fs.writeFile(path.join(dataDirectory,'progress.json'),'{corrupted');
  for(const extras of [{method:'GET'},{method:'POST'}]){
    const response=await request('/api/progress',{revision:0,document:portableDocument()},extras);
    assert.equal(response.status,500);assert.equal((await response.json()).code,'PROGRESS_CORRUPT');
  }
  assert.equal(await fs.readFile(path.join(dataDirectory,'progress.json'),'utf8'),'{corrupted');
  assert.deepEqual(await fs.readdir(dataDirectory),['progress.json']);
});

test('config, progress and shutdown require the same local token, origin, host, JSON and allowed methods',async t=>{
  let calls=0;const {request,url,dataDirectory}=await setup(t,{fetchImpl:async()=>{calls++;return success();}});
  for(const route of ['/api/config','/api/progress','/api/shutdown']){
    const body=route==='/api/config'?{apiKey:'replacement-test-key'}:route==='/api/progress'?{revision:0,document:portableDocument()}:{};
    for(const token of ['', 'incorrect'])assert.equal((await request(route,body,{headers:{'X-GRE-Token':token}})).status,401);
    assert.equal((await request(route,body,{headers:{Origin:'https://untrusted.example'}})).status,403);
    const invalidHost=await new Promise((resolve,reject)=>{
      const req=require('node:http').request(url+route,{method:'POST',headers:{Host:'untrusted.example',Origin:'null','X-GRE-Token':TOKEN,'Content-Type':'application/json'}},res=>{res.resume();resolve(res.statusCode);});
      req.on('error',reject);req.end(JSON.stringify(body));
    });
    assert.equal(invalidHost,403);
    assert.equal((await request(route,body,{headers:{'Content-Type':'text/plain'}})).status,415);
    assert.equal((await request(route,body,{method:'DELETE'})).status,405);
    assert.equal((await request(route,'{')).status,400);
    const preflight=await request(route,null,{method:'OPTIONS',headers:{'X-GRE-Token':'','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-gre-token'}});
    assert.equal(preflight.status,204);
    assert.equal((await request(route,null,{method:'OPTIONS',headers:{'Access-Control-Request-Method':'DELETE'}})).status,403);
  }
  for(const route of ['/api/config','/api/shutdown'])assert.equal((await request(route,null,{method:'GET'})).status,405);
  assert.equal((await request('/api/progress',null,{method:'GET',headers:{'X-GRE-Token':'wrong'}})).status,401);
  const status=await request('/api/status',null,{headers:{Origin:url}}).then(r=>r.json());assert.equal(status.configured,true);
  assert.deepEqual(await fs.readdir(dataDirectory),[]);assert.equal(calls,0);
});

test('authenticated shutdown stops only its own local server',async t=>{
  const {request,server}=await setup(t);
  const closed=new Promise(resolve=>server.once('close',resolve));
  const response=await request('/api/shutdown',{});assert.equal(response.status,200);assert.deepEqual(await response.json(),{stopped:true});
  await closed;assert.equal(server.listening,false);
});
