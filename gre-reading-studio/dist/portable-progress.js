/* Portable progress stays beside the app. A browser save succeeds only after disk acknowledgement. */
(()=>{
  'use strict';
  const E=window.GRECore.escape;
  let adapter=null,service=null,connectionId=null,epoch=0,storeId=null,revision=0,savedAt=null,fileLocation='',needsRead=true,dirty=true,version=0,restoring=false,running=null,conflict=null,mergeRequested=false,debounce=null,maxWait=null,state='offline',message='',stopped=false,stopping=false,directory=null,directoryGranted=false,emptyStoreId=null,initializing=true,initialization=null;
  const MAX_BYTES=80*1024*1024,FORMAT='gre-portable-progress',isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  let barObserver=null;
  const stateOf=()=>({state,dirty,storeId,revision,savedAt,location:fileLocation,connected:available(),conflict:!!conflict,storage:directory?'folder':'service',needsPermission:!!directory&&!directoryGranted});
  function render(){
    const bar=document.getElementById('portable-save-bar');if(!bar)return;
    document.body.classList.add('has-portable-save-bar');
    if(!barObserver&&typeof ResizeObserver==='function'){barObserver=new ResizeObserver(()=>document.documentElement.style.setProperty('--portable-save-height',`${Math.ceil(bar.getBoundingClientRect().height)}px`));barObserver.observe(bar);}
    let text=message;
    if(!text){
      if(stopped)text=dirty?'服务已停止，页面还有新进度，请重新启动后保存。':'进度已保存，服务已停止，可以关闭页面并安全弹出 U 盘。';
      else if(state==='saving')text='保存中…';
      else if(state==='restoring')text='正在读取应用文件夹中的进度…';
      else if(state==='conflict')text='另一页面更新了进度，点击“合并后保存”。';
      else if(directory&&!directoryGranted)text='请授权上次选择的进度文件夹，之后可自动保存。';
      else if(!directory&&!service?.localAvailable)text=typeof window.showDirectoryPicker==='function'?'点击“保存进度”选择 U 盘中的文件夹，之后即可自动保存。':'请使用 Chrome 或 Edge 打开网页并选择进度文件夹。';
      else if(!directory&&!service.features?.progress)text='请选择进度文件夹，之后即可在网页中自动保存。';
      else if(dirty)text='有新进度，等待自动保存…';
      else text=directory?'已保存到所选进度文件夹':'已保存到应用文件夹';
    }
    const busy=initializing||state==='saving'||state==='restoring'||stopping,date=savedAt?new Date(savedAt):null,dateText=date&&!Number.isNaN(date.getTime())?date.toLocaleString('zh-CN'):'';
    const html=`<div class="portable-save-main"><span class="portable-save-indicator ${state==='error'||state==='conflict'?'has-error':''}" aria-hidden="true"></span><div class="portable-save-copy"><span data-portable-status role="status">${E(text)}</span>${dateText?`<small data-portable-saved-at>上次保存：${E(dateText)}</small>`:''}</div><div class="portable-save-actions"><button type="button" class="button secondary small" data-portable-action="choose-folder" ${busy?'disabled':''}>${directory?'更换进度文件夹':'选择进度文件夹'}</button>${directory&&!directoryGranted?'<button type="button" class="button small" data-portable-action="grant">授权保存</button>':''}<button type="button" class="button secondary small" data-portable-action="save" ${busy||stopped?'disabled':''}>${state==='conflict'?'合并后保存':busy?'保存中…':'保存进度'}</button>${service?.localAvailable&&service?.features?.shutdown?`<button type="button" class="button secondary small" data-portable-action="exit" ${busy||stopped?'disabled':''}>保存并退出</button>`:''}</div></div>${fileLocation?`<details class="portable-save-location"><summary>保存位置</summary><span>${E(fileLocation)}</span></details>`:''}`;
    if(bar.innerHTML!==html)bar.innerHTML=html;
    bar.dataset.state=state;
  }
  function cancelTimers(){clearTimeout(debounce);clearTimeout(maxWait);debounce=null;maxWait=null;}
  function failure(error){
    const code=String(error?.code||'').toUpperCase();
    if(code==='PROGRESS_CONFLICT')return '另一页面更新了进度，点击“合并后保存”。';
    if(error?.name==='NotAllowedError'||error?.name==='SecurityError'||code==='FOLDER_PERMISSION')return '尚未获得文件夹写入权限，请点击“授权保存”或重新选择进度文件夹。';
    if(error?.name==='NotFoundError')return '保存失败：所选文件夹已断开，请重新连接 U 盘并重试。';
    if(error?.name==='QuotaExceededError'||code==='PROGRESS_TOO_LARGE')return '保存失败：磁盘空间不足或进度文件超过 80 MB，请检查后重试。';
    if(code.includes('READ_ONLY')||code==='EACCES'||code==='EPERM')return '保存失败：应用文件夹不可写，请检查 U 盘写保护或文件夹权限。';
    if(code.includes('SPACE')||code==='ENOSPC')return '保存失败：磁盘空间不足，请清理后再点击“保存进度”。';
    if(code.includes('CORRUPT')||code.includes('INVALID_PROGRESS')||code==='PROGRESS_INVALID')return '无法读取或保存进度文件，请保留 user-data 文件夹并检查文件是否损坏。';
    if(code==='NO_SESSION'&&!directory&&!service?.localAvailable)return '请先点击“选择进度文件夹”，选择 U 盘上的文件夹后即可自动保存。';
    if(code==='CONNECTION_FAILED'||code==='NO_SESSION'||code==='LOCAL_AUTH_REQUIRED')return '保存失败：本机服务未连接，请运行阅间便携启动器后重试。';
    if(code==='TIMEOUT')return '保存超时，请保持 U 盘连接并点击“保存进度”重试。';
    return '保存失败：当前进度仍保留在页面中，请检查 U 盘连接与文件夹权限后重试。';
  }
  function envelope(data){
    if(!data||typeof data.storeId!=='string'||!data.storeId||!Number.isSafeInteger(data.revision)||data.revision<0||data.document!==null&&typeof data.document!=='object')throw Object.assign(Error('Invalid progress response'),{code:'PROGRESS_INVALID'});
    return data;
  }
  function available(){return !stopped&&(directory?directoryGranted:!!service?.localAvailable&&!!service?.features?.progress);}
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
  function readProgress(){return directory?readFolder():window.GREVocabularyAI.request('/api/progress',undefined,20000);}
  function writeProgress(input){return directory?writeFolder(input):window.GREVocabularyAI.request('/api/progress',input,45000);}
  async function chooseDirectory(){
    if(initializing||running)throw folderProblem('PROGRESS_BUSY');
    if(typeof window.showDirectoryPicker!=='function'){state='error';message='此浏览器不支持直接保存文件夹，请使用 Chrome 或 Edge 打开网页后选择进度文件夹。';render();throw folderProblem('DIRECTORY_UNSUPPORTED');}
    try{
      const selected=await window.showDirectoryPicker({id:'gre-progress',mode:'readwrite'});
      directory=selected;directoryGranted=true;emptyStoreId=crypto.randomUUID();epoch++;needsRead=true;dirty=true;version++;storeId=null;revision=0;savedAt=null;fileLocation=`${directory.name}/progress.json`;conflict=null;stopped=false;message='';
      try{await handleStorage(directory);}catch{}
      return await synchronize();
    }catch(error){if(error.name==='AbortError'){if(!directory){state='pending';message='已取消选择，当前进度尚未保存到文件。';render();}throw error;}state='error';message=failure(error);render();throw error;}
  }
  async function grantDirectory(){
    if(!directory)return;
    try{directoryGranted=await directory.requestPermission({mode:'readwrite'})==='granted';if(!directoryGranted)throw folderProblem('FOLDER_PERMISSION');message='';await synchronize(true);}
    catch(error){state='error';message=failure(error);render();}
  }
  function schedule(){
    if(!adapter||!available()||conflict||stopping)return;
    clearTimeout(debounce);debounce=setTimeout(()=>{void synchronize().catch(()=>{});},800);
    if(!maxWait)maxWait=setTimeout(()=>{void synchronize().catch(()=>{});},3000);
  }
  function changed(){
    if(restoring)return;
    dirty=true;version++;message='';
    if(stopped){state='error';message='服务已停止，新进度尚未写入文件，请重新运行阅间便携启动器。';}
    else if(!running&&state!=='conflict')state='pending';
    render();schedule();
  }
  async function restoreDocument(data,turn){
    if(data.document!==null){restoring=true;state='restoring';render();try{await adapter.restore(data.document);}finally{restoring=false;}}
    if(turn!==epoch)return false;
    storeId=data.storeId;revision=data.revision;savedAt=data.savedAt||null;fileLocation=typeof data.location==='string'?data.location:fileLocation;
    dirty=true;version++;needsRead=false;conflict=null;message='';return true;
  }
  async function work(){
    cancelTimers();
    if(!adapter)throw Object.assign(Error('Progress is not initialized'),{code:'NO_SESSION'});
    if(!available())throw Object.assign(Error('Local progress service unavailable'),{code:'NO_SESSION'});
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
      if(!available())throw Object.assign(Error('Local progress service unavailable'),{code:'NO_SESSION'});
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
    cancelTimers();
    // Call the picker in this click's call stack, before any await consumes user activation.
    if(!directory&&(!service?.localAvailable||!service.features?.progress))return chooseDirectory();
    if(directory&&!directoryGranted){try{directoryGranted=await directory.requestPermission({mode:'readwrite'})==='granted';if(!directoryGranted)throw folderProblem('FOLDER_PERMISSION');}catch(error){state='error';message=failure(error);render();throw error;}}
    return synchronize(true);
  }
  async function saveAndExit(){
    if(stopping||stopped)return;
    stopping=true;render();
    try{
      await saveNow();
      if(dirty)throw Object.assign(Error('Unsaved changes remain'),{code:'UNSAVED_CHANGES'});
      await window.GREVocabularyAI.request('/api/shutdown',{},10000);
      stopped=true;state=dirty?'error':'stopped';message='';cancelTimers();
    }catch(error){state='error';message=dirty?failure(error):'进度已保存，但服务未能停止，请重试“保存并退出”。';}
    finally{stopping=false;render();}
  }
  function serviceChanged(){
    const next=window.GREVocabularyAI?.getServiceState();if(!next)return;
    const wasAvailable=!!service?.localAvailable;
    service=next;
    if(connectionId!==next.connectionId){connectionId=next.connectionId;if(!directory){epoch++;needsRead=true;dirty=true;version++;conflict=null;storeId=null;revision=0;savedAt=null;fileLocation='';stopped=false;}}
    else if(!directory&&!wasAvailable&&next.localAvailable){needsRead=true;stopped=false;}
    render();
    if(adapter&&!initializing&&available()&&!running&&(needsRead||dirty)&&!conflict)void synchronize().catch(()=>{});
  }
  function init(options){
    if(!options||typeof options.snapshot!=='function'||typeof options.restore!=='function')throw Error('GREPortable needs snapshot and restore adapters');
    adapter=options;render();initialization=(async()=>{await loadDirectory();initializing=false;serviceChanged();if(directory&&directoryGranted&&!running)void synchronize().catch(()=>{});render();return running?running.catch(()=>stateOf()):stateOf();})();return initialization;
  }
  function ready(){return initialization?initialization.then(()=>running?running.catch(()=>stateOf()):stateOf()):Promise.resolve(stateOf());}
  window.addEventListener('gre-local-service',serviceChanged);
  window.addEventListener('beforeunload',event=>{if(adapter&&dirty){event.preventDefault();event.returnValue='';}});
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-portable-action]');if(!button)return;
    if(button.dataset.portableAction==='save')void saveNow().catch(()=>{});
    if(button.dataset.portableAction==='exit')void saveAndExit();
    if(button.dataset.portableAction==='choose-folder')void chooseDirectory().catch(()=>{});
    if(button.dataset.portableAction==='grant')void grantDirectory();
  });
  window.GREPortable={init,changed,saveNow,saveAndExit,ready,getState:stateOf,chooseDirectory,grantDirectory};
})();
