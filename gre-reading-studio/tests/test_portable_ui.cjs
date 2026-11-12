/* Progress UI acceptance using isolated browser profiles and browser-owned test folders.
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
    window.browserWrites=0;window.browserFailure=false;
    window.persistBrowser=async()=>{browserWrites++;if(browserFailure)return false;localStorage.setItem('qa-progress',JSON.stringify(current));return true;};
    window.restore=async incoming=>{restores++;if(restoringFailure)throw Error('test restore refused');const words=[...new Set([...current.progress.vocabulary,...incoming.progress.vocabulary].map(item=>item.word))];current={...incoming,progress:{...incoming.progress,vocabulary:words.map(word=>({word}))}};};
   },{document:doc(words),api,restoreFailure,permission,grantPermission});
   await p.addScriptTag({path:path.join(ROOT,'dist/portable-progress.js')});
   await p.evaluate(()=>GREPortable.init({snapshot,restore,persistBrowser}));return p;
  }
  const read=p=>p.evaluate(async()=>JSON.parse(await(await(await folder.getFileHandle('progress.json')).getFile()).text()));
  const mutate=(p,word)=>p.evaluate(word=>{current.progress.vocabulary.push({word});GREPortable.changed();},word);
  await check('browser autosave and Save work without selecting a folder or triggering a leave-page warning',async()=>{
   const isolated=await context(),q=await page(isolated,{words:['browser-default']});
   await q.evaluate(()=>{window.pickerCalls=0;window.showDirectoryPicker=()=>{pickerCalls++;throw Error('must not ask for a folder');};});
   assert.equal(await q.evaluate(()=>GREPortable.getState().storage),'browser');
   assert.equal(await q.evaluate(()=>GREPortable.getState().dirty),false);
   assert.equal(await q.evaluate(()=>dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);
   await mutate(q,'automatic');await q.waitForFunction(()=>!GREPortable.getState().dirty);
   await q.locator('[data-portable-action="save"]').click();await q.waitForFunction(()=>GREPortable.getState().state==='saved');
   assert.equal(await q.evaluate(()=>pickerCalls),0);assert.deepEqual(await q.evaluate(()=>JSON.parse(localStorage.getItem('qa-progress')).progress.vocabulary.map(item=>item.word)),['browser-default','automatic']);
  });
  await check('folder selection opens the picker synchronously and merges existing progress before backup',async()=>{
   const isolated=await context(),q=await page(isolated,{words:['browser-before-first-save']});
   await q.evaluate(async document=>{
    const existing={format:'gre-portable-progress',version:1,storeId:crypto.randomUUID(),revision:1,savedAt:Date.now(),document};
    const stream=await(await folder.getFileHandle('progress.json',{create:true})).createWritable();await stream.write(JSON.stringify(existing));await stream.close();
    window.pickerCalls=0;window.pickerInClick=false;window.connectCalls=0;
    GREVocabularyAI.connect=async()=>{connectCalls++;};
    window.showDirectoryPicker=()=>{pickerCalls++;pickerInClick=navigator.userActivation.isActive;return Promise.resolve(folder);};
   },doc(['disk-before-first-save']));
   await q.locator('[data-portable-action="choose-folder"]').click();await q.waitForFunction(()=>GREPortable.getState().storage==='folder'&&GREPortable.getState().state==='saved');
   assert.deepEqual(await q.evaluate(()=>({calls:pickerCalls,inClick:pickerInClick,connects:connectCalls})),{calls:1,inClick:true,connects:0});
   assert.equal(await q.evaluate(()=>GREPortable.getState().dirty),false);assert.equal(await q.evaluate(()=>restores),1);assert.deepEqual((await read(q)).document.progress.vocabulary.map(item=>item.word).sort(),['browser-before-first-save','disk-before-first-save'].sort());
  });
  await check('canceling optional folder selection preserves browser autosave and creates no backup file',async()=>{
   const isolated=await context(),q=await page(isolated,{words:['still-unsaved']});await q.evaluate(()=>{window.pickerCalls=0;window.showDirectoryPicker=()=>{pickerCalls++;return Promise.reject(new DOMException('Selection canceled','AbortError'));};});
   await q.locator('[data-portable-action="choose-folder"]').click();await q.waitForFunction(()=>document.querySelector('[data-portable-status]').textContent.includes('已取消'));
   const status=await q.evaluate(()=>GREPortable.getState());assert.equal(status.dirty,false);assert.ok(status.savedAt);assert.equal(status.state,'saved');assert.equal(await q.evaluate(()=>pickerCalls),1);assert.equal(await q.evaluate(()=>dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);
   assert.equal(await q.evaluate(async()=>{try{await folder.getFileHandle('progress.json');return true;}catch(error){if(error.name==='NotFoundError')return false;throw error;}}),false);
   const cancellation=await q.evaluate(async()=>{let returned=false,pickerBeforeReturn=false;window.showDirectoryPicker=()=>{pickerBeforeReturn=!returned;return Promise.reject(new DOMException('Selection canceled','AbortError'));};const saving=GREPortable.chooseDirectory();returned=true;try{await saving;return {name:'resolved',pickerBeforeReturn};}catch(error){return {name:error.name,pickerBeforeReturn};}});assert.deepEqual(cancellation,{name:'AbortError',pickerBeforeReturn:true});
  });
  await check('browsers without a directory picker still save normally and expose export/import fallback',async()=>{
   const isolated=await context(),q=await page(isolated);await q.evaluate(()=>{window.showDirectoryPicker=undefined;GREVocabularyAI.connect=async()=>{throw Error('must not connect');};});await q.locator('[data-portable-action="save"]').click();await q.waitForFunction(()=>GREPortable.getState().state==='saved');const text=await q.locator('[data-portable-status]').innerText();assert.match(text,/浏览器/);assert.doesNotMatch(text,/启动器|本机服务/);assert.equal(await q.evaluate(()=>GREPortable.getState().dirty),false);assert.equal(await q.locator('[data-portable-action="choose-folder"]').count(),0);assert.equal(await q.locator('[data-paction="export-progress"]').count(),1);assert.equal(await q.locator('[data-paction="import-progress"]').count(),1);
  });
  await check('browser storage failure remains unsaved, warns on close, and retries without requesting a folder',async()=>{
   const isolated=await context(),q=await page(isolated,{words:['before-failure']});await q.evaluate(()=>{browserFailure=true;});await mutate(q,'keep-in-memory');await q.waitForFunction(()=>GREPortable.getState().state==='error');assert.equal(await q.evaluate(()=>GREPortable.getState().dirty),true);assert.equal(await q.evaluate(()=>dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);assert.deepEqual(await q.evaluate(()=>JSON.parse(localStorage.getItem('qa-progress')).progress.vocabulary.map(item=>item.word)),['before-failure']);await q.evaluate(()=>{browserFailure=false;});await q.locator('[data-portable-action="save"]').click();await q.waitForFunction(()=>!GREPortable.getState().dirty);assert.equal(await q.evaluate(()=>dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);
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
  await check('stopping optional folder backup preserves the file and returns to browser-only saving after reopening',async()=>{
   const isolated=await context(),q=await page(isolated,{words:['keep-folder-backup']});await q.locator('[data-portable-action="choose-folder"]').click();await q.waitForFunction(()=>GREPortable.getState().storage==='folder'&&!GREPortable.getState().dirty);const before=await read(q);await q.evaluate(()=>GREPortable.disconnectDirectory());assert.equal(await q.evaluate(()=>GREPortable.getState().storage),'browser');await mutate(q,'browser-only');await q.waitForFunction(()=>!GREPortable.getState().dirty);assert.deepEqual(await read(q),before);const reopened=await page(isolated);assert.equal(await reopened.evaluate(()=>GREPortable.getState().storage),'browser');
  });
  await check('no uncaught browser errors',async()=>{assert.deepEqual(errors,[]);});
 }finally{for(const context of contexts)await context.close();await browser.close();}
 if(results.some(result=>!result.ok))process.exitCode=1;
})();
