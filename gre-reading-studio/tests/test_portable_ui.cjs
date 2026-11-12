/* Portable UI acceptance using isolated browser profiles and browser-owned test folders.
 * No user progress, API keys, external networks, or removable drives are touched. */
'use strict';
const {chromium}=require('C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const assert=require('node:assert/strict'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const errors=[],results=[];
const doc=words=>({app:'gre-training-studio',progress:{version:2,attempts:[],favorites:[],vocabulary:words.map(word=>({word})),notes:{}}});
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS',name);}catch(error){results.push({name,ok:false});console.error('FAIL',name,error.stack);}}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const contexts=[];
 try{
  async function context(){const c=await browser.newContext();await c.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><body><div id="portable-save-bar"></div>'}));contexts.push(c);return c;}
  async function page(c,{words=[],api=false,restoreFailure=false,permission=null,grantPermission='granted'}={}){
   const p=await c.newPage();p.on('pageerror',error=>errors.push(error.message));await p.goto('https://gre-portable.test/test.html');
   await p.evaluate(async({document,api,restoreFailure,permission,grantPermission})=>{
    window.GRECore={escape:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
    window.current=document;window.restores=0;window.restoringFailure=restoreFailure;
    window.serviceState={localAvailable:api,configured:false,features:api?{progress:true,shutdown:true}:{},connectionId:1};
    window.GREVocabularyAI={getServiceState:()=>serviceState,connect:async()=>{},request:async(path,body)=>{const result=await window.qaRequest(path,body);if(result?.error)throw Object.assign(Error(result.error),result);return result;}};
    window.folder=await(await navigator.storage.getDirectory()).getDirectoryHandle('test-progress',{create:true});
    if(permission)FileSystemDirectoryHandle.prototype.queryPermission=async()=>permission;
    FileSystemDirectoryHandle.prototype.requestPermission=async()=>grantPermission;
    window.showDirectoryPicker=async()=>folder;
    window.snapshot=async()=>JSON.parse(JSON.stringify(current));
    window.restore=async incoming=>{restores++;if(restoringFailure)throw Error('test restore refused');const words=[...new Set([...current.progress.vocabulary,...incoming.progress.vocabulary].map(item=>item.word))];current={...incoming,progress:{...incoming.progress,vocabulary:words.map(word=>({word}))}};};
   },{document:doc(words),api,restoreFailure,permission,grantPermission});
   await p.addScriptTag({path:path.join(ROOT,'dist/portable-progress.js')});
   await p.evaluate(()=>GREPortable.init({snapshot,restore}));return p;
  }
  const read=p=>p.evaluate(async()=>JSON.parse(await(await(await folder.getFileHandle('progress.json')).getFile()).text()));
  const mutate=(p,word)=>p.evaluate(word=>{current.progress.vocabulary.push({word});GREPortable.changed();},word);
  await check('the first Save click opens the folder picker synchronously and merges the selected progress before saving',async()=>{
   const isolated=await context(),q=await page(isolated,{words:['browser-before-first-save']});
   await q.evaluate(async document=>{
    const existing={format:'gre-portable-progress',version:1,storeId:crypto.randomUUID(),revision:1,savedAt:Date.now(),document};
    const stream=await(await folder.getFileHandle('progress.json',{create:true})).createWritable();await stream.write(JSON.stringify(existing));await stream.close();
    window.pickerCalls=0;window.pickerInClick=false;window.connectCalls=0;
    GREVocabularyAI.connect=async()=>{connectCalls++;};
    window.showDirectoryPicker=()=>{pickerCalls++;pickerInClick=navigator.userActivation.isActive;return Promise.resolve(folder);};
   },doc(['disk-before-first-save']));
   await q.locator('[data-portable-action="save"]').click();await q.waitForFunction(()=>GREPortable.getState().state==='saved');
   assert.deepEqual(await q.evaluate(()=>({calls:pickerCalls,inClick:pickerInClick,connects:connectCalls})),{calls:1,inClick:true,connects:0});
   assert.equal(await q.evaluate(()=>GREPortable.getState().dirty),false);assert.equal(await q.evaluate(()=>restores),1);assert.deepEqual((await read(q)).document.progress.vocabulary.map(item=>item.word).sort(),['browser-before-first-save','disk-before-first-save'].sort());
  });
  await check('canceling the first Save folder picker leaves progress unsaved without creating a file',async()=>{
   const isolated=await context(),q=await page(isolated,{words:['still-unsaved']});await q.evaluate(()=>{window.pickerCalls=0;window.showDirectoryPicker=()=>{pickerCalls++;return Promise.reject(new DOMException('Selection canceled','AbortError'));};});
   await q.locator('[data-portable-action="save"]').click();await q.waitForFunction(()=>document.querySelector('[data-portable-status]').textContent.includes('已取消'));
   const status=await q.evaluate(()=>GREPortable.getState());assert.equal(status.dirty,true);assert.equal(status.savedAt,null);assert.notEqual(status.state,'saved');assert.equal(await q.evaluate(()=>pickerCalls),1);assert.doesNotMatch(await q.locator('[data-portable-status]').innerText(),/已保存/);
   assert.equal(await q.evaluate(async()=>{try{await folder.getFileHandle('progress.json');return true;}catch(error){if(error.name==='NotFoundError')return false;throw error;}}),false);
   const cancellation=await q.evaluate(async()=>{let returned=false,pickerBeforeReturn=false;window.showDirectoryPicker=()=>{pickerBeforeReturn=!returned;return Promise.reject(new DOMException('Selection canceled','AbortError'));};const saving=GREPortable.saveNow();returned=true;try{await saving;return {name:'resolved',pickerBeforeReturn};}catch(error){return {name:error.name,pickerBeforeReturn};}});assert.deepEqual(cancellation,{name:'AbortError',pickerBeforeReturn:true});
  });
  await check('an unsupported directory picker gives webpage browser guidance without contacting a helper',async()=>{
   const isolated=await context(),q=await page(isolated);await q.evaluate(()=>{window.showDirectoryPicker=undefined;GREVocabularyAI.connect=async()=>{throw Error('must not connect');};});await q.locator('[data-portable-action="save"]').click();await q.waitForFunction(()=>GREPortable.getState().state==='error');const text=await q.locator('[data-portable-status]').innerText();assert.match(text,/Chrome.*Edge/);assert.doesNotMatch(text,/启动器|本机服务/);assert.equal(await q.evaluate(()=>GREPortable.getState().dirty),true);
  });
  let c,p;
  await check('folder selection writes real browser filesystem files, preserves format, and excludes unrelated settings',async()=>{
   c=await context();p=await page(c,{words:['opaque']});await p.evaluate(()=>{current.apiKey='do-not-export';});
   await p.locator('[data-portable-action="choose-folder"]').click();await p.waitForFunction(()=>GREPortable.getState().state==='saved');
   const data=await read(p);assert.equal(data.format,'gre-portable-progress');assert.equal(data.revision,1);assert.equal(data.document.progress.vocabulary[0].word,'opaque');assert.ok(!JSON.stringify(data).includes('do-not-export'));assert.match(await p.locator('[data-portable-status]').innerText(),/已保存/);
  });
  await check('changes auto-save with a previous snapshot and the Save button waits for acknowledgement',async()=>{
   await mutate(p,'lucid');await p.waitForFunction(()=>GREPortable.getState().revision===2);const current=await read(p);assert.equal(current.document.progress.vocabulary.length,2);
   const previous=await p.evaluate(async()=>JSON.parse(await(await(await folder.getFileHandle('progress.previous.json')).getFile()).text()));assert.equal(previous.revision,1);assert.equal(previous.document.progress.vocabulary.length,1);
   await mutate(p,'abstruse');const state=await p.evaluate(()=>GREPortable.saveNow());assert.equal(state.dirty,false);assert.equal((await read(p)).document.progress.vocabulary.length,3);
  });
  let second;
  await check('a new page restores the persisted directory handle and merges existing file progress before saving',async()=>{
   second=await page(c,{words:['new-page']});assert.ok(await second.evaluate(()=>restores>=1));const saved=await read(second);assert.deepEqual(saved.document.progress.vocabulary.map(item=>item.word).sort(),['opaque','lucid','abstruse','new-page'].sort());assert.equal(await second.evaluate(()=>GREPortable.getState().storage),'folder');
  });
  await check('two open pages cannot silently overwrite each other and explicit merge preserves both sides',async()=>{
   await mutate(p,'first-page');const rejected=await p.evaluate(async()=>{try{await GREPortable.saveNow();return false;}catch(error){return error.code;}});assert.equal(rejected,'PROGRESS_CONFLICT');assert.equal(await p.evaluate(()=>GREPortable.getState().state),'conflict');assert.equal((await read(p)).document.progress.vocabulary.some(item=>item.word==='first-page'),false);
   await p.locator('[data-portable-action="save"]').click();await p.waitForFunction(()=>GREPortable.getState().state==='saved');const words=(await read(p)).document.progress.vocabulary.map(item=>item.word);assert.ok(words.includes('first-page'));assert.ok(words.includes('new-page'));
  });
  await check('a malformed existing progress file is never overwritten',async()=>{
   const isolated=await context(),q=await page(isolated,{words:['keep-local']});await q.evaluate(async()=>{const stream=await(await folder.getFileHandle('progress.json',{create:true})).createWritable();await stream.write('{broken');await stream.close();});
   await q.locator('[data-portable-action="choose-folder"]').click();await q.waitForFunction(()=>GREPortable.getState().state==='error');assert.equal(await q.evaluate(async()=>await(await(await folder.getFileHandle('progress.json')).getFile()).text()),'{broken');assert.equal(await q.evaluate(()=>current.progress.vocabulary[0].word),'keep-local');
  });
  await check('restore failure stops saving and keeps the original disk snapshot untouched',async()=>{
   const isolated=await context(),q=await page(isolated,{words:['keep-disk']});await q.locator('[data-portable-action="choose-folder"]').click();await q.waitForFunction(()=>GREPortable.getState().state==='saved');const before=await read(q);
   const r=await page(isolated,{words:['keep-browser'],restoreFailure:true});assert.equal(await r.evaluate(()=>GREPortable.getState().state),'error');assert.deepEqual(await read(r),before);
  });
  await check('restored directory permission is requested by a user action before any file is written',async()=>{
   const isolated=await context(),q=await page(isolated,{words:['permission-disk']});await q.locator('[data-portable-action="choose-folder"]').click();await q.waitForFunction(()=>GREPortable.getState().state==='saved');const before=await read(q);
   const r=await page(isolated,{words:['permission-browser'],permission:'prompt'});assert.equal(await r.evaluate(()=>GREPortable.getState().needsPermission),true);assert.deepEqual(await read(r),before);await r.locator('[data-portable-action="grant"]').click();await r.waitForFunction(()=>GREPortable.getState().state==='saved');assert.equal((await read(r)).document.progress.vocabulary.length,2);
  });
  await check('an interrupted write preserves the existing file, remains dirty, and can be retried',async()=>{
   const isolated=await context(),q=await page(isolated,{words:['before-failure']});await q.locator('[data-portable-action="choose-folder"]').click();await q.waitForFunction(()=>GREPortable.getState().state==='saved');const before=await read(q);
   await q.evaluate(()=>{const real=FileSystemFileHandle.prototype.createWritable;window.failWrites=true;FileSystemFileHandle.prototype.createWritable=function(...args){if(failWrites&&this.name==='progress.json')throw new DOMException('test write failed','NotAllowedError');return real.apply(this,args);};});
   await mutate(q,'after-failure');assert.equal(await q.evaluate(async()=>{try{await GREPortable.saveNow();return false;}catch{return true;}}),true);assert.deepEqual(await read(q),before);assert.equal(await q.evaluate(()=>GREPortable.getState().dirty),true);assert.equal(await q.evaluate(()=>dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
   await q.evaluate(()=>{failWrites=false;});await q.locator('[data-portable-action="grant"]').click();await q.waitForFunction(()=>GREPortable.getState().state==='saved');assert.equal((await read(q)).document.progress.vocabulary.length,2);
  });
  await check('local service saves and restores even when no OpenAI key is configured',async()=>{
   const isolated=await context();let stored={storeId:'741ce320-a5b6-4e96-9bec-38b532e99a18',revision:2,savedAt:Date.now(),document:doc(['server-word'])};let posts=0;
   await isolated.exposeFunction('qaRequest',async(url,body)=>{if(url==='/api/progress'&&!body)return structuredClone(stored);if(url==='/api/progress'){posts++;if(body.revision!==stored.revision)return {error:'conflict',code:'PROGRESS_CONFLICT',current:stored};stored={...stored,revision:stored.revision+1,savedAt:Date.now(),document:body.document};return structuredClone(stored);}throw Error('Unexpected URL');});
   const q=await page(isolated,{words:['browser-word'],api:true});assert.equal(await q.evaluate(()=>GREPortable.getState().state),'saved');assert.equal(posts,1);assert.deepEqual(stored.document.progress.vocabulary.map(item=>item.word).sort(),['server-word','browser-word'].sort());
   await mutate(q,'another');await q.evaluate(()=>GREPortable.saveNow());assert.equal(posts,2);assert.equal(stored.document.progress.vocabulary.length,3);
  });
  await check('old local services without progress support do not receive nonexistent API requests',async()=>{
   const isolated=await context();let requests=0;await isolated.exposeFunction('qaRequest',()=>{requests++;throw Error('Unexpected request');});const q=await page(isolated);await q.evaluate(()=>{serviceState.localAvailable=true;window.dispatchEvent(new Event('gre-local-service'));});await q.waitForTimeout(50);assert.equal(requests,0);assert.match(await q.locator('[data-portable-status]').innerText(),/进度文件夹|新版/);
  });
  await check('Save and exit shuts down only after the final progress write succeeds',async()=>{
   const isolated=await context();let stored={storeId:'741ce320-a5b6-4e96-9bec-38b532e99a18',revision:0,savedAt:0,document:null},fail=false;const calls=[];
   await isolated.exposeFunction('qaRequest',async(url,body)=>{calls.push(url+(body?' POST':' GET'));if(url==='/api/shutdown')return {stopped:true};if(!body)return structuredClone(stored);if(fail)return {error:'write failed',code:'PROGRESS_WRITE_FAILED'};stored={...stored,revision:stored.revision+1,savedAt:Date.now(),document:body.document};return structuredClone(stored);});
   const q=await page(isolated,{words:['exit-word'],api:true});fail=true;await mutate(q,'not-yet-saved');await q.evaluate(()=>GREPortable.saveAndExit());assert.ok(!calls.includes('/api/shutdown POST'));assert.equal(await q.evaluate(()=>GREPortable.getState().dirty),true);fail=false;await q.evaluate(()=>GREPortable.saveAndExit());assert.equal(calls.at(-1),'/api/shutdown POST');assert.equal(calls.at(-2),'/api/progress POST');assert.equal(await q.evaluate(()=>GREPortable.getState().state),'stopped');
  });
  await check('no uncaught browser errors',async()=>{assert.deepEqual(errors,[]);});
 }finally{for(const context of contexts)await context.close();await browser.close();}
 if(results.some(result=>!result.ok))process.exitCode=1;
})();
