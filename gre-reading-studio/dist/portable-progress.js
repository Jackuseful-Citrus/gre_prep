/* Browser progress is the default; a chosen folder is an optional automatic backup. */
(()=>{
  'use strict';
  const E=window.GRECore.escape;
  let adapter=null,epoch=0,storeId=null,revision=0,savedAt=null,fileLocation='',needsRead=true,dirty=true,version=0,restoring=false,running=null,conflict=null,mergeRequested=false,debounce=null,maxWait=null,state='offline',message='',directory=null,directoryGranted=false,emptyStoreId=null,initializing=true,initialization=null;
  const MAX_BYTES=80*1024*1024,FORMAT='gre-portable-progress',isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  let barObserver=null;
  const browser={state:'pending',dirty:true,savedAt:null,running:null,version:0,timer:null};
  const stateOf=()=>({state:directory?state:browser.state,dirty:directory?dirty:browser.dirty,storeId,revision,savedAt:directory?savedAt:browser.savedAt,location:directory?fileLocation:'当前浏览器',connected:available(),conflict:!!conflict,storage:directory?'folder':'browser',needsPermission:!!directory&&!directoryGranted,browserSaved:!browser.dirty,browserState:browser.state});
  function render(){
    const bar=document.getElementById('portable-save-bar');if(!bar)return;
    document.body.classList.add('has-portable-save-bar');
    if(!barObserver&&typeof ResizeObserver==='function'){barObserver=new ResizeObserver(()=>document.documentElement.style.setProperty('--portable-save-height',`${Math.ceil(bar.getBoundingClientRect().height)}px`));barObserver.observe(bar);}
    let text=message;
    if(!text){
      if(directory){
        if(state==='saving')text='正在保存文件夹备份…';
        else if(state==='restoring')text='正在读取所选文件夹中的进度…';
        else if(state==='conflict')text='另一页面更新了文件夹备份，点击“合并后保存”。';
        else if(!directoryGranted)text='浏览器继续保存；请授权所选文件夹以恢复自动备份。';
        else if(dirty)text='有新进度，等待文件夹自动备份…';
        else text='已保存到所选备份文件夹';
      }else if(browser.state==='saving'||browser.state==='pending')text='正在保存到此浏览器…';
      else if(browser.state==='error')text='浏览器保存失败，请立即导出备份。';
      else text='已自动保存到此浏览器';
    }
    const busy=initializing||state==='saving'||state==='restoring',canChoose=typeof window.showDirectoryPicker==='function';
    const timestamp=directory?savedAt:browser.savedAt,date=timestamp?new Date(timestamp):null,dateText=date&&!Number.isNaN(date.getTime())?date.toLocaleString('zh-CN'):'';
    const detail=directory?(browser.dirty?'浏览器副本尚未保存成功；请保留文件夹备份。':'当前浏览器也保留一份记录。'):canChoose?'可选：自动备份到电脑、同步盘或 U 盘中的任意文件夹。':'可导出、导入备份，在不同浏览器或电脑之间继续学习。';
    const html=`<div class="portable-save-main"><span class="portable-save-indicator ${state==='error'||state==='conflict'||browser.state==='error'?'has-error':''}" aria-hidden="true"></span><div class="portable-save-copy"><span data-portable-status role="status">${E(text)}</span><small>${E(detail)}${dateText?` 上次保存：${E(dateText)}`:''}</small></div><div class="portable-save-actions"><button type="button" class="button small" data-portable-action="save" ${busy?'disabled':''}>${state==='conflict'?'合并后保存':busy?'保存中…':'保存进度'}</button>${canChoose?`<button type="button" class="button secondary small" data-portable-action="choose-folder" ${busy?'disabled':''}>${directory?'更换备份文件夹':'选择备份文件夹'}</button>`:''}${directory&&!directoryGranted?'<button type="button" class="button secondary small" data-portable-action="grant">授权文件夹</button>':''}<button type="button" class="button secondary small" data-paction="export-progress" ${initializing?'disabled':''}>导出进度</button><button type="button" class="button secondary small" data-paction="import-progress" ${busy?'disabled':''}>导入进度</button></div></div>${directory?`<details class="portable-save-location"><summary>文件夹备份位置</summary><span>${E(fileLocation)}</span> <button type="button" class="text-link" data-portable-action="disconnect" ${busy?'disabled':''}>停止文件夹备份</button></details>`:''}`;
    if(bar.innerHTML!==html)bar.innerHTML=html;
    bar.dataset.state=stateOf().state;
  }
  function persistBrowser(){
    clearTimeout(browser.timer);
    if(!adapter)return Promise.resolve(stateOf());
    if(browser.running)return browser.running.then(()=>browser.dirty?persistBrowser():stateOf());
    browser.running=(async()=>{
      while(browser.dirty){
        const captured=browser.version;browser.state='saving';render();
        if(await adapter.persistBrowser()===false)throw Error('Browser storage unavailable');
        browser.dirty=browser.version!==captured;browser.savedAt=Date.now();browser.state=browser.dirty?'pending':'saved';render();
      }
      return stateOf();
    })().catch(error=>{browser.dirty=true;browser.state='error';render();throw error;}).finally(()=>{browser.running=null;});
    return browser.running;
  }
  function scheduleBrowser(){clearTimeout(browser.timer);browser.timer=setTimeout(()=>void persistBrowser().catch(()=>{}),0);}
  function cancelTimers(){clearTimeout(debounce);clearTimeout(maxWait);debounce=null;maxWait=null;}
  function failure(error){
    const code=String(error?.code||'').toUpperCase();
    if(code==='PROGRESS_CONFLICT')return '另一页面更新了进度，点击“合并后保存”。';
    if(error?.name==='NotAllowedError'||error?.name==='SecurityError'||code==='FOLDER_PERMISSION')return '尚未获得文件夹写入权限，请点击“授权文件夹”或重新选择备份文件夹。';
    if(error?.name==='NotFoundError')return '文件夹备份失败：所选位置不可用，请恢复连接或选择其他文件夹。';
    if(error?.name==='QuotaExceededError'||code==='PROGRESS_TOO_LARGE')return '保存失败：磁盘空间不足或进度文件超过 80 MB，请检查后重试。';
    if(code.includes('READ_ONLY')||code==='EACCES'||code==='EPERM')return '文件夹备份失败：所选文件夹不可写，请检查文件夹权限。';
    if(code.includes('SPACE')||code==='ENOSPC')return '保存失败：磁盘空间不足，请清理后再点击“保存进度”。';
    if(code.includes('CORRUPT')||code.includes('INVALID_PROGRESS')||code==='PROGRESS_INVALID')return '无法读取或保存备份，请保留原文件并检查文件是否损坏。';
    if(code==='TIMEOUT')return '文件夹备份超时，请检查保存位置后重试。';
    return '文件夹备份失败，请检查保存位置与权限；也可以导出备份。';
  }
  function envelope(data){
    if(!data||typeof data.storeId!=='string'||!data.storeId||!Number.isSafeInteger(data.revision)||data.revision<0||data.document!==null&&typeof data.document!=='object')throw Object.assign(Error('Invalid progress response'),{code:'PROGRESS_INVALID'});
    return data;
  }
  function available(){return !!directory&&directoryGranted;}
  function folderProblem(code){return Object.assign(Error(code),{code});}
  function cleanDocument(raw){
    if(!isObject(raw)||raw.app!=='gre-training-studio'||!isObject(raw.progress))throw folderProblem('PROGRESS_INVALID');
    const p=raw.progress;if(p.version!==2||!Array.isArray(p.attempts)||!Array.isArray(p.favorites))throw folderProblem('PROGRESS_INVALID');
    for(const key of ['vocabulary','essays','sessions','migratedBookmarks'])if(p[key]!==undefined&&!Array.isArray(p[key]))throw folderProblem('PROGRESS_INVALID');
    for(const key of ['notes','drafts'])if(p[key]!==undefined&&!isObject(p[key]))throw folderProblem('PROGRESS_INVALID');
    if(p.session!==undefined&&p.session!==null&&!isObject(p.session))throw folderProblem('PROGRESS_INVALID');
    const selected={app:'gre-training-studio',progress:p};
    if(raw.legacyRC!=null){if(!isObject(raw.legacyRC)||raw.legacyRC.version!==1||!isObject(raw.legacyRC.questions)||!Array.isArray(raw.legacyRC.bookmarks))throw folderProblem('PROGRESS_INVALID');selected.legacyRC=raw.legacyRC;}
    if(raw.mock!=null){if(!isObject(raw.mock)||raw.mock.version!==1||!Array.isArray(raw.mock.history))throw folderProblem('PROGRESS_INVALID');selected.mock=raw.mock;}
    if(raw.importedBanks!=null){if(!Array.isArray(raw.importedBanks)||raw.importedBanks.some(bank=>!isObject(bank)||bank.schema_version!==2||!Array.isArray(bank.questions)))throw folderProblem('PROGRESS_INVALID');selected.importedBanks=raw.importedBanks;}
    return JSON.parse(JSON.stringify(selected));
  }
  async function handleStorage(value){
    return new Promise((resolve,reject)=>{
      const open=indexedDB.open('gre-portable-folder-v1',1);
      open.onupgradeneeded=()=>open.result.createObjectStore('handles');open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{const db=open.result,tx=db.transaction('handles',value===undefined?'readonly':'readwrite'),store=tx.objectStore('handles'),request=value===undefined?store.get('progress'):store.put(value,'progress');let result=null;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};tx.onabort=()=>{db.close();reject(tx.error);};};
    });
  }
  async function loadDirectory(){
    try{const handle=await handleStorage();if(!handle||handle.kind!=='directory')return;directory=handle;emptyStoreId=crypto.randomUUID();directoryGranted=await directory.queryPermission({mode:'readwrite'})==='granted';fileLocation=`${directory.name}/progress.json`;}
    catch{directoryGranted=false;}
  }
  async function readFolder(target=directory){
    let file;
    try{file=await(await target.getFileHandle('progress.json')).getFile();}
    catch(error){if(error.name==='NotFoundError')return {storeId:emptyStoreId,revision:0,savedAt:0,document:null,location:`${target.name}/progress.json`};throw error;}
    if(file.size>MAX_BYTES)throw folderProblem('PROGRESS_CORRUPT');
    let data;try{data=JSON.parse(await file.text());if(!isObject(data)||data.format!==FORMAT||data.version!==1||typeof data.storeId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.storeId)||!Number.isSafeInteger(data.revision)||data.revision<1||!Number.isSafeInteger(data.savedAt)||data.savedAt<0)throw Error();data.document=cleanDocument(data.document);}catch{throw folderProblem('PROGRESS_CORRUPT');}
    return {...data,location:`${target.name}/progress.json`};
  }
  async function writeFolderFile(target,name,text){
    const file=await target.getFileHandle(name,{create:true}),stream=await file.createWritable({mode:'exclusive'});
    try{await stream.write(text);await stream.close();}catch(error){try{await stream.abort();}catch{}throw error;}
  }
  async function writeFolder(input){
    const target=directory,expectedStore=storeId;
    const document=cleanDocument(input.document);
    const write=async()=>{
      const current=await readFolder(target);
      if(current.revision!==input.revision||current.storeId!==expectedStore)throw Object.assign(folderProblem('PROGRESS_CONFLICT'),{current});
      const next={format:FORMAT,version:1,storeId:current.storeId,revision:current.revision+1,savedAt:Date.now(),document};
      const text=JSON.stringify(next);if(new Blob([text]).size>MAX_BYTES)throw folderProblem('PROGRESS_TOO_LARGE');
      if(current.document!==null){const {location,...previous}=current;await writeFolderFile(target,'progress.previous.json',JSON.stringify(previous));}
      // Recheck after backup creation before replacing the current snapshot.
      const latest=await readFolder(target);
      if(latest.revision!==current.revision||latest.storeId!==current.storeId)throw Object.assign(folderProblem('PROGRESS_CONFLICT'),{current:latest});
      await writeFolderFile(target,'progress.json',text);
      return {...next,location:`${target.name}/progress.json`};
    };
    return navigator.locks?.request?navigator.locks.request(`gre-progress-folder:${target.name}`,write):write();
  }
  function readProgress(){return readFolder();}
  function writeProgress(input){return writeFolder(input);}
  async function chooseDirectory(){
    if(initializing||running)throw folderProblem('PROGRESS_BUSY');
    if(typeof window.showDirectoryPicker!=='function'){message='此浏览器不支持文件夹自动备份；仍会保存到浏览器，也可使用“导出备份”和“导入备份”。';render();throw folderProblem('DIRECTORY_UNSUPPORTED');}
    try{
      const selected=await window.showDirectoryPicker({id:'gre-progress',mode:'readwrite'});
      directory=selected;directoryGranted=true;emptyStoreId=crypto.randomUUID();epoch++;needsRead=true;dirty=true;version++;storeId=null;revision=0;savedAt=null;fileLocation=`${directory.name}/progress.json`;conflict=null;message='';
      try{await handleStorage(directory);}catch{}
      return await synchronize();
    }catch(error){if(error.name==='AbortError'){if(!directory){message='已取消文件夹选择；浏览器保存方式不变。';render();}throw error;}state='error';message=failure(error);render();throw error;}
  }
  async function grantDirectory(){
    if(!directory)return;
    try{directoryGranted=await directory.requestPermission({mode:'readwrite'})==='granted';if(!directoryGranted)throw folderProblem('FOLDER_PERMISSION');message='';await synchronize(true);}
    catch(error){state='error';message=failure(error);render();}
  }
  function schedule(){
    if(!adapter||!available()||conflict)return;
    clearTimeout(debounce);debounce=setTimeout(()=>{void synchronize().catch(()=>{});},800);
    if(!maxWait)maxWait=setTimeout(()=>{void synchronize().catch(()=>{});},3000);
  }
  function changed(){
    if(restoring)return;
    dirty=true;version++;message='';browser.dirty=true;browser.version++;browser.state='pending';
    if(!running&&state!=='conflict')state='pending';
    render();scheduleBrowser();schedule();
  }
  async function restoreDocument(data,turn){
    if(data.document!==null){restoring=true;state='restoring';render();try{await adapter.restore(data.document);}finally{restoring=false;}}
    if(turn!==epoch)return false;
    storeId=data.storeId;revision=data.revision;savedAt=data.savedAt||null;fileLocation=typeof data.location==='string'?data.location:fileLocation;
    dirty=true;version++;needsRead=false;conflict=null;message='';browser.dirty=true;browser.version++;await persistBrowser().catch(()=>{});return true;
  }
  async function work(){
    cancelTimers();
    if(!adapter)throw Object.assign(Error('Progress is not initialized'),{code:'NO_SESSION'});
    if(!available())throw Object.assign(Error('Progress folder unavailable'),{code:'NO_SESSION'});
    while(dirty||needsRead||conflict){
      const turn=epoch;
      if(conflict){
        if(!mergeRequested)throw Object.assign(Error('Progress changed in another page'),{code:'PROGRESS_CONFLICT',current:conflict});
        mergeRequested=false;
        // Read again: another page may have saved since the conflict was first shown.
        const latest=envelope(await readProgress());
        if(turn!==epoch)continue;
        if(!await restoreDocument(latest,turn))continue;
      }else if(needsRead){
        state='restoring';message='';render();
        const data=envelope(await readProgress());
        if(turn!==epoch)continue;
        if(!await restoreDocument(data,turn))continue;
      }
      if(!available())throw Object.assign(Error('Progress folder unavailable'),{code:'NO_SESSION'});
      state='saving';message='';render();
      const captured=version,document=await adapter.snapshot();
      if(turn!==epoch)continue;
      const response=await writeProgress({revision,document});
      if(turn!==epoch)continue;
      if(!response||response.storeId!==storeId||!Number.isSafeInteger(response.revision)||response.revision<=revision)throw Object.assign(Error('Unacknowledged progress save'),{code:'PROGRESS_INVALID'});
      revision=response.revision;savedAt=response.savedAt||null;fileLocation=typeof response.location==='string'?response.location:fileLocation;
      dirty=version!==captured;state=dirty?'pending':'saved';message='';render();
    }
    return stateOf();
  }
  function synchronize(merge=false){
    if(merge)mergeRequested=true;
    if(running)return running.then(()=>dirty||needsRead?synchronize(merge):stateOf());
    running=work().catch(error=>{
      dirty=true;
      if(String(error.code).toUpperCase()==='PROGRESS_CONFLICT'){
        try{conflict=envelope(error.current);}catch{conflict={storeId,revision,savedAt,document:null};}
        state='conflict';message='';
      }else{state='error';message=failure(error);if(directory&&(error.name==='NotAllowedError'||error.name==='SecurityError'))directoryGranted=false;}
      render();throw error;
    }).finally(()=>{running=null;cancelTimers();});
    return running;
  }
  async function saveNow(){
    browser.dirty=true;browser.version++;message='';
    if(!directory)return persistBrowser();
    // Permission requests stay in the user action's call stack.
    if(!directoryGranted){try{directoryGranted=await directory.requestPermission({mode:'readwrite'})==='granted';if(!directoryGranted)throw folderProblem('FOLDER_PERMISSION');}catch(error){state='error';message=failure(error);render();void persistBrowser().catch(()=>{});throw error;}}
    await persistBrowser().catch(()=>{});
    return synchronize(true);
  }
  async function disconnectDirectory(){
    if(initializing||running)return;
    try{await handleStorage(null);}catch{message='未能清除文件夹设置，请重试。';render();return;}
    cancelTimers();directory=null;directoryGranted=false;epoch++;storeId=null;revision=0;savedAt=null;fileLocation='';needsRead=true;dirty=true;conflict=null;state='offline';message='';render();
  }
  function init(options){
    if(!options||typeof options.snapshot!=='function'||typeof options.restore!=='function'||typeof options.persistBrowser!=='function')throw Error('GREPortable needs snapshot, restore and browser persistence adapters');
    adapter=options;render();initialization=(async()=>{await loadDirectory();initializing=false;await persistBrowser().catch(()=>{});if(directory&&directoryGranted)await synchronize().catch(()=>{});render();return stateOf();})();return initialization;
  }
  function ready(){return initialization?initialization.then(()=>running?running.catch(()=>stateOf()):stateOf()):Promise.resolve(stateOf());}
  window.addEventListener('beforeunload',event=>{if(adapter&&(browser.dirty||directory&&dirty)){event.preventDefault();event.returnValue='';}});
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-portable-action]');if(!button)return;
    if(button.dataset.portableAction==='save')void saveNow().catch(()=>{});
    if(button.dataset.portableAction==='choose-folder')void chooseDirectory().catch(()=>{});
    if(button.dataset.portableAction==='grant')void grantDirectory();
    if(button.dataset.portableAction==='disconnect')void disconnectDirectory();
  });
  window.GREPortable={init,changed,saveNow,ready,getState:stateOf,chooseDirectory,grantDirectory,disconnectDirectory};
})();
