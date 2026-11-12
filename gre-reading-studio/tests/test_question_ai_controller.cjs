'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Core=require('../dist/platform-core.js'),Question=require('../dist/openai-question.js');
const source=fs.readFileSync(path.join(__dirname,'../dist/question-ai.js'),'utf8');
const fixture=(overrides={})=>({question_id:'qa-controller-image',question_type:'QuantSingle',category:'Quant',question_content:'Which value is shown in the diagram?',options:[{id:'A',text:'1'},{id:'B',text:'2'}],correct_answer:null,explanation:'',images:[{src:'question-images/quant/fixture.png',alt:'Test diagram'}],...overrides});
const image={url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(q=fixture()){
  let resolveImage;
  const imageRead=new Promise(resolve=>{resolveImage=resolve;});
  const callbacks=[],calls=[],saved=[],events=new Map(),state={ready:true,auto:true,revision:'config-1'},visibility={shown:true,closed:false};
  const node={dataset:{},innerHTML:'',getClientRects:()=>visibility.shown?[{}]:[],closest:()=>visibility.closed?{}:null};
  const document={body:{},querySelectorAll:()=>[node],addEventListener:(name,callback)=>events.set(name,callback)};
  const window={GRECore:Core,GREOpenAIQuestion:Question,addEventListener(){},
    GREQuestionImages:{load:async src=>{calls.push({type:'image',src});return imageRead;}},
    GREVocabularyAI:{getQuestionServiceState:()=>({...state}),analyzeQuestion:async input=>{calls.push({type:'api',input,revision:state.revision});return {version:1,questionId:input.questionId,status:'answered',answer:['A'],explanation:'The shown value corresponds to A.',reason:'',model:'test-model',generatedAt:1};}}};
  vm.runInNewContext(source,{window,document,location:{protocol:'file:'},requestAnimationFrame:callback=>callbacks.push(callback),MutationObserver:class{observe(){}},setTimeout,clearTimeout});
  const controller=window.GREQuestionAI,record=controller.describe(q,null);
  controller.panelHTML(q,null);node.dataset={questionAi:q.question_id,questionSignature:record.signature};
  controller.init({getResults:()=>({}),saveResult:async(id,result)=>{saved.push({id,result});return true;}});
  const frame=()=>{const callback=callbacks.shift();if(callback)callback();};
  const manual=()=>events.get('click')({target:{closest:()=>({disabled:false,dataset:{questionAiAction:'retry'},closest:()=>node})}});
  return {controller,record,node,state,visibility,calls,saved,resolveImage,frame,manual};
}

for(const [name,change]of [
  ['cleared credentials',h=>{h.state.ready=false;}],
  ['replaced credentials or model',h=>{h.state.revision='config-2';}],
  ['disabled automatic analysis',h=>{h.state.auto=false;}],
  ['navigated away',h=>{h.visibility.shown=false;}],
  ['closed review details',h=>{h.visibility.closed=true;}],
])test(`image loading does not start a paid API call after the user has ${name}`,async()=>{
  const h=harness();h.frame();
  assert.equal(h.calls.filter(c=>c.type==='image').length,1,'analysis waits for the image reader');
  change(h);h.resolveImage(image);await tick();
  assert.equal(h.calls.filter(c=>c.type==='api').length,0);assert.equal(h.saved.length,0);
});

test('a visible current request sends its image and saves the validated reference answer',async()=>{
  const h=harness();h.frame();h.resolveImage(image);await tick();
  const calls=h.calls.filter(c=>c.type==='api');assert.equal(calls.length,1);
  assert.equal(calls[0].input.images.length,1);assert.equal(calls[0].input.images[0].url,image.url);
  assert.equal(calls[0].input.hasImages,true);assert.equal(h.saved.length,1);
  assert.equal(h.saved[0].result.inputSignature,h.record.signature);
});

test('manual analysis remains available when automatic analysis is disabled',async()=>{
  const h=harness();h.state.auto=false;h.frame();assert.equal(h.calls.length,0);
  h.manual();h.resolveImage(image);await tick();
  assert.equal(h.calls.filter(c=>c.type==='api').length,1);assert.equal(h.saved.length,1);
});

test('missing image data is explicitly disclosed to analysis rather than claimed as visible',async()=>{
  const h=harness();h.frame();h.resolveImage(null);await tick();
  const call=h.calls.find(c=>c.type==='api');assert.ok(call);
  assert.equal(call.input.hasImages,true);assert.equal(call.input.images.length,0);
  assert.match(call.input.questionText,/实际提供 0 张/);assert.match(call.input.questionText,/部分图片未能读取/);
});

test('imported cached answers require matching question content, usable metadata and valid option IDs',()=>{
  const q=fixture({images:[]}),h=harness(q),questions=new Map([[q.question_id,q]]),materials=new Map();
  const result={version:1,questionId:q.question_id,inputSignature:h.record.signature,generatedAt:1,model:'test-model',status:'answered',answer:['A'],explanation:'The first option is supported.',reason:''};
  const normalize=value=>h.controller.normalizeCache({[q.question_id]:value},questions,materials);
  assert.equal(normalize(result)[q.question_id].answer[0],'A');
  for(const bad of [{...result,answer:['Z']},{...result,inputSignature:'stale'},{...result,generatedAt:NaN},{...result,version:0},{...result,questionId:'another-question'},{...result,explanation:''}])assert.equal(Object.keys(normalize(bad)).length,0);
  questions.set(q.question_id,{...q,question_content:'Changed source question.'});
  assert.equal(Object.keys(normalize(result)).length,0,'an answer imported for an older question is discarded');
});

test('sentence selection without enumerated options requests the quoted sentence as a free answer',()=>{
  const q=fixture({question_type:'RCSentence',category:'Verbal',options:[],images:[]}),h=harness(q);
  assert.equal(h.record.input.answerMode,'free');assert.match(h.record.input.questionText,/完整引用所选原句/);
  assert.doesNotThrow(()=>Question.validateInput(h.record.input));
});
