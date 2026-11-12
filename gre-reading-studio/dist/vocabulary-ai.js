/* Personal webpage AI client. API keys live only in this page or the optional local service. */
(()=>{
  'use strict';
  const V=window.GREVocabulary,E=window.GRECore.escape;
  const SESSION_KEY='gre-vocabulary-ai-session-v1',CONNECTION_KEY='gre-vocabulary-ai-connection-v1',PREFS_KEY='gre-vocabulary-ai-preferences-v1';
  const modes=new Set(['confusable','related']);
  let adapter=null,session=null,status='offline',connectionMessage='',model='',working=false,checking=null,sessionRevision=0,localAvailable=false,configured=false,features={},configuring=false,configMessage='',preferences={auto:true,relationMode:'confusable',autoQuestion:true,collapsed:false};
  const queue=[],jobs=new Map(),runtime=new Map(),awaitingConnection=new Map();
  let directKey='',directModel='gpt-4.1-mini',generationRevision=0,settingsInstance=0,questionStateSignature='';
  const keyNote=()=>directKey?'密钥仅在当前页面内存中使用，刷新或关闭页面后需重新输入；不会写入进度或备份文件。':localAvailable&&features.config?'密钥仅在本机服务运行期间使用，不写入进度或备份文件。':'在这里输入密钥即可直接连接 OpenAI。密钥仅在当前页面内存中使用，不写入进度或备份文件。';
  function validSession(raw){
    if(!raw||typeof raw.url!=='string'||typeof raw.token!=='string'||!/^[a-f0-9]{64}$/i.test(raw.token))return null;
    try{const url=new URL(raw.url);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||Number(url.port)<1||Number(url.port)>65535||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null;return {url:url.origin,token:raw.token};}catch{return null;}
  }
  try{preferences={...preferences,...JSON.parse(localStorage.getItem(PREFS_KEY)||'{}')};}catch{}
  preferences={auto:preferences.auto!==false,relationMode:modes.has(preferences.relationMode)?preferences.relationMode:'confusable',autoQuestion:preferences.autoQuestion!==false,collapsed:preferences.collapsed===true};
  function readConnection(storage,key){try{return validSession(JSON.parse(window[storage].getItem(key)||'null'));}catch{return null;}}
  function acceptConnection(raw,share=false){
    const next=validSession(raw);if(!next)return false;
    const changed=!session||session.url!==next.url||session.token!==next.token;
    if(changed){session=next;sessionRevision++;if(!directKey){status='offline';connectionMessage='';}localAvailable=false;configured=false;features={};emitService();}
    try{sessionStorage.setItem(SESSION_KEY,JSON.stringify(next));}catch{}
    if(share)try{localStorage.setItem(CONNECTION_KEY,JSON.stringify(next));}catch{}
    if(changed&&adapter)void connect();
    return true;
  }
  function receiveLaunch(){
    if(!location.hash.startsWith('#gre-ai='))return false;
    let accepted=false;try{accepted=acceptConnection(JSON.parse(decodeURIComponent(location.hash.slice(8))),true);}catch{}
    try{history.replaceState(null,'',location.href.split('#')[0]+'#vocabulary');}catch{location.hash='vocabulary';}
    if(accepted&&adapter)window.GREPlatform?.go('vocabulary');
    return accepted;
  }
  if(!receiveLaunch())acceptConnection(readConnection('localStorage',CONNECTION_KEY)||readConnection('sessionStorage',SESSION_KEY));
  function discoverConnection(){return acceptConnection(readConnection('localStorage',CONNECTION_KEY)||readConnection('sessionStorage',SESSION_KEY));}
  function savePreferences(){try{localStorage.setItem(PREFS_KEY,JSON.stringify(preferences));}catch{}}
  function entries(){return adapter?.getEntries()||[];}
  function entryFor(word){return entries().find(entry=>entry.word===word);}
  const jobKey=(word,mode)=>JSON.stringify([word,mode]);
  function cleanAI(raw,word){
    if(typeof V.normalizeAI==='function')return V.normalizeAI(raw,word);
    if(!raw||raw.version!==1||V.normalize(raw.word)!==word||!modes.has(raw.relationMode)||typeof raw.meaning!=='string'||!Number.isFinite(raw.generatedAt)||!Array.isArray(raw.synonyms)||!Array.isArray(raw.similar))return null;
    const cleanItems=items=>items.slice(0,6).filter(item=>item&&V.validWord(item.word)&&typeof item.meaning==='string'&&typeof item.note==='string').map(item=>({word:V.normalize(item.word),meaning:item.meaning.slice(0,300),note:item.note.slice(0,600)}));
    return {version:1,word,meaning:raw.meaning.slice(0,600),synonyms:cleanItems(raw.synonyms),similar:cleanItems(raw.similar),relationMode:raw.relationMode,model:typeof raw.model==='string'?raw.model.slice(0,100):'',generatedAt:raw.generatedAt};
  }
  function cached(entry,mode=preferences.relationMode){const stored=cleanAI(entry?.ai,entry?.word);return stored?.relationMode===mode?stored:runtime.get(jobKey(entry?.word,mode))||null;}
  function messageFor(code,httpStatus){
    code=String(code||'').toLowerCase();
    if(code==='local_auth_required')return '本机连接已过期，请重新运行阅间便携启动器打开页面。';
    if(['invalid_api_key','auth_failed'].includes(code)||httpStatus===401)return 'API Key 无效，请在下方重新输入密钥并启用。';
    if(['missing_api_key','key_not_configured'].includes(code)||httpStatus===503)return '尚未配置 API Key，请在下方输入密钥并启用。';
    if(['invalid_config','invalid_model'].includes(code))return '密钥或模型格式不正确，请检查后重新输入。';
    if(code==='local_busy')return '本机服务正在匹配其他词汇，请稍后重试。';
    if(['rate_limit','rate_limited'].includes(code)||httpStatus===429)return '请求过于频繁或 API 额度不足，请稍后重试并检查账户额度。';
    if(['timeout','upstream_timeout'].includes(code)||httpStatus===504)return '匹配超时，请稍后点击重试。';
    if(['refusal','refused'].includes(code))return '这次未能生成词汇建议，可以稍后重试。';
    if(['invalid_output','invalid_response','incomplete_response'].includes(code))return '返回内容不完整，请重试。';
    if(code==='network_error')return '本机服务暂时无法连接 OpenAI，请检查网络后重试。';
    if(code==='model_error')return '当前模型或请求配置不可用，请检查下方模型设置后重新启用。';
    if(code==='access_denied'||httpStatus===403)return '当前 OpenAI 项目无权访问该模型，请检查项目权限或模型设置。';
    return '暂时无法获取匹配结果，请检查本机服务和网络后重试。';
  }
  async function request(path,body,timeout=55000){
    if(!session)throw Object.assign(Error('请先从应用文件夹运行阅间便携启动器。'),{code:'no_session'});
    const target=session;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await fetch(target.url+path,{method:body?'POST':'GET',mode:'cors',credentials:'omit',cache:'no-store',headers:{'X-GRE-Token':target.token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal});
      let data;try{data=await response.json();}catch{throw Object.assign(Error('当前连接返回了无法识别的内容，请在 API 设置中重新启用网页直连。'),{code:'invalid_output'});}
      if(!response.ok)throw Object.assign(Error(messageFor(data?.code,response.status)),{code:data?.code||'service_error',httpStatus:response.status,...(path==='/api/progress'&&data?.code==='PROGRESS_CONFLICT'?{current:data.current}:{})});
      return data;
    }catch(error){if(error.name==='AbortError')throw Object.assign(Error('请求超时，请稍后重试。'),{code:'timeout'});if(error instanceof TypeError)throw Object.assign(Error('当前连接不可用，请在 API 设置中输入密钥以使用网页直连。'),{code:'connection_failed'});throw error;}finally{clearTimeout(timer);}
  }
  function getServiceState(){return {localAvailable,configured,model,features:{...features},connectionId:sessionRevision,status};}
  function getQuestionServiceState(){
    const ready=status==='ready'&&!!(directKey||localAvailable&&configured&&features.question);
    const message=ready?'':!directKey&&localAvailable&&configured&&!features.question?'当前连接不支持题目分析，请在 API 设置中启用网页直连。':connectionMessage||'请展开 API 设置，输入密钥并启用 API。';
    return {ready,auto:preferences.autoQuestion,model:directKey?directModel:model,revision:`${sessionRevision}:${generationRevision}`,message};
  }
  function emitQuestionState(){
    const detail=getQuestionServiceState(),signature=JSON.stringify(detail);
    if(signature===questionStateSignature)return;
    questionStateSignature=signature;window.dispatchEvent(new CustomEvent('gre-question-ai-change',{detail}));
  }
  function emitService(){window.dispatchEvent(new CustomEvent('gre-local-service',{detail:getServiceState()}));emitQuestionState();}
  function acceptStatus(data){localAvailable=true;configured=data.configured===true;features=data.features&&typeof data.features==='object'?{config:data.features.config===true,progress:data.features.progress===true,shutdown:data.features.shutdown===true,question:data.features.question===true}:{};model=typeof data.model==='string'?data.model:'';status=directKey||configured?'ready':'missing-key';connectionMessage='';emitService();}
  async function analyzeQuestion(raw){
    const client=window.GREOpenAIQuestion,service=getQuestionServiceState();
    if(!service.ready)throw Object.assign(Error(service.message),{code:!directKey&&localAvailable&&configured&&!features.question?'QUESTION_UNSUPPORTED':'QUESTION_NOT_READY'});
    if(!client)throw Object.assign(Error('题目分析模块尚未加载，请刷新页面后重试。'),{code:'QUESTION_MODULE_MISSING'});
    const input=client.validateInput(raw),revision=service.revision;
    try{
      const result=directKey?await client.generate(input,{apiKey:directKey,model:directModel,fetchImpl:window.fetch.bind(window),timeoutMs:60000}):await request('/api/question',input,70000);
      if(getQuestionServiceState().revision!==revision)throw Object.assign(Error('API 配置已改变，请重新分析此题。'),{code:'QUESTION_STALE'});
      if(!result||result.version!==1||result.questionId!==input.questionId||typeof result.model!=='string'||!result.model.trim()||result.model.length>100||!Number.isFinite(result.generatedAt)||result.generatedAt<0)throw Object.assign(Error('题目分析结果不完整，请重试。'),{code:'INVALID_RESPONSE'});
      const checked=client.validateOutput({status:result.status,answer:result.answer,explanation:result.explanation,reason:result.reason},input);
      return {...checked,version:1,questionId:input.questionId,model:result.model,generatedAt:result.generatedAt};
    }catch(error){
      if(getQuestionServiceState().revision===revision&&(['AUTH_FAILED','KEY_NOT_CONFIGURED','missing_api_key','key_not_configured','no_session','connection_failed','LOCAL_AUTH_REQUIRED','local_auth_required'].includes(error.code)||error.status===401||error.httpStatus===401||error.httpStatus===503)){
        status='error';connectionMessage=error.message;
        if(['no_session','connection_failed','LOCAL_AUTH_REQUIRED','local_auth_required'].includes(error.code))localAvailable=false;
        emitService();updateDOM();
      }
      throw error;
    }
  }
  function connectionHTML(){
    if(directKey)return status==='ready'?`网页直连已配置 · ${E(directModel)}`:E(connectionMessage||'请检查密钥和网络后重试。');
    if(status==='checking')return '正在连接本机 AI 生词服务…';
    if(status==='ready')return `已连接 · ${E(model||'OpenAI')}`;
    if(status==='missing-key')return '展开设置并输入 API Key，即可启用题目分析与词汇匹配；进度保存无需密钥。';
    return E(connectionMessage||'输入 OpenAI API Key，启用题目分析与词汇匹配。已生成的内容可离线查看。');
  }
  function settingsHTML(){
    const bodyId=`vocabulary-ai-details-${++settingsInstance}`;
    return `<section class="panel vocabulary-ai-settings ${preferences.collapsed?'is-collapsed':''}" data-ai-settings aria-label="API 设置"><div class="row space-between vocabulary-ai-settings-heading"><h2>API 设置</h2><div class="row"><span class="tag">OpenAI</span><button type="button" class="button secondary small" data-ai-action="toggle-settings" aria-expanded="${!preferences.collapsed}" aria-controls="${bodyId}">${preferences.collapsed?'展开设置':'最小化'}</button></div></div><p class="vocabulary-ai-status" data-ai-status role="status">${connectionHTML()}</p><div id="${bodyId}" data-ai-settings-body ${preferences.collapsed?'hidden':''}>
      <form class="vocabulary-ai-config" data-ai-config autocomplete="off"><label class="field vocabulary-ai-key-label">OpenAI API Key<input type="password" data-ai-key autocomplete="new-password" spellcheck="false" placeholder="粘贴 API Key，提交后自动清空" aria-label="OpenAI API Key"></label><label class="field vocabulary-ai-model-label">模型<input type="text" data-ai-model value="${E(directKey?directModel:model||'gpt-4.1-mini')}" autocomplete="off" spellcheck="false" maxlength="100"></label><button type="submit" class="button small" data-ai-action="configure" ${configuring?'disabled':''}>${configuring?'正在启用…':'启用 API'}</button><button type="button" class="button secondary small" data-ai-action="clear-key" ${(!directKey&&(!localAvailable||!features.config||!configured))||configuring?'disabled':''}>清除密钥</button><p class="tiny vocabulary-ai-config-note" data-ai-config-status role="status">${E(configMessage||keyNote())}</p></form>
      <div class="vocabulary-ai-question-controls"><label class="vocabulary-ai-toggle"><input type="checkbox" data-ai-auto-question ${preferences.autoQuestion?'checked':''}>缺少答案或解析时自动分析（提交后）</label></div>
      <div class="vocabulary-ai-controls"><label class="vocabulary-ai-toggle"><input type="checkbox" data-ai-auto ${preferences.auto?'checked':''}>自动匹配新收藏及本页生词</label><label class="field">相近词类型<select data-ai-mode><option value="confusable" ${preferences.relationMode==='confusable'?'selected':''}>形近易混词</option><option value="related" ${preferences.relationMode==='related'?'selected':''}>语义相关词</option></select></label><button type="button" class="button secondary small" data-ai-action="connect" ${status==='checking'?'disabled':''}>检查连接</button><button type="button" class="button secondary small" data-ai-action="match-page" ${status!=='ready'?'disabled':''}>匹配本页生词</button></div><p class="tiny vocabulary-ai-privacy">分析时会将当前题目、原文或单词语境发送到 OpenAI，按 API 用量计费。已有结果随学习进度保存并优先复用；AI 分析单独标注。</p>
    </div></section>`;
  }
  function setCollapsed(collapsed){
    preferences.collapsed=collapsed===true;savePreferences();
    document.querySelectorAll('[data-ai-settings]').forEach(section=>{
      section.classList.toggle('is-collapsed',preferences.collapsed);
      const body=section.querySelector('[data-ai-settings-body]'),button=section.querySelector('[data-ai-action="toggle-settings"]');
      if(body)body.hidden=preferences.collapsed;
      if(button){button.setAttribute('aria-expanded',String(!preferences.collapsed));button.textContent=preferences.collapsed?'展开设置':'最小化';}
    });
  }
  function openSettings(){setCollapsed(false);const input=[...document.querySelectorAll('[data-ai-key]')].find(node=>node.getClientRects().length);input?.focus({preventScroll:true});input?.scrollIntoView({block:'nearest',behavior:'smooth'});}
  function resultHTML(ai){
    const list=(items,empty)=>items.length?`<ul>${items.map(item=>`<li><strong lang="en">${E(item.word)}</strong><span>${E(item.meaning)}</span>${item.note?`<p>${E(item.note)}</p>`:''}</li>`).join('')}</ul>`:`<p class="vocabulary-ai-empty">${empty}</p>`;
    return `<div class="vocabulary-ai-result"><p class="vocabulary-ai-meaning">${E(ai.meaning)}</p><div class="vocabulary-ai-relation"><h3>GRE 近义词</h3>${list(ai.synonyms,'暂无可靠的近义词建议。')}</div><div class="vocabulary-ai-relation"><h3>${ai.relationMode==='confusable'?'形近易混词':'语义相关词'} <small>不等于近义词</small></h3>${list(ai.similar,'暂无合适的相近词建议。')}</div><p class="tiny vocabulary-ai-disclaimer">AI 生成，注意词义和语境差别，近义词不一定能直接替换。</p></div>`;
  }
  function entryInner(entry){
    const key=jobKey(entry.word,preferences.relationMode),job=jobs.get(key),ai=cached(entry),isBusy=job?.status==='queued'||job?.status==='loading';
    let note='';
    if(job?.status==='queued')note='等待匹配…';
    else if(job?.status==='loading')note='正在匹配 GRE 近义词和相近词…';
    else if(job?.status==='error')note=job.error;
    else if(job?.status==='unsaved')note='匹配已完成，但浏览器保存失败；请点击“保存进度”写入应用文件夹。';
    else if(!ai)note=status==='ready'?'尚未匹配。':status==='checking'?'正在检查词汇匹配连接…':'在本页上方输入 API Key 并启用，即可自动匹配。';
    return `${ai?resultHTML(ai):''}${note?`<p class="vocabulary-ai-entry-status ${job?.status==='error'||job?.status==='unsaved'?'has-error':''}" data-ai-entry-status role="status">${E(note)}</p>`:''}${!ai||job?.status==='error'?`<button type="button" class="text-link" data-ai-retry="${E(entry.word)}" ${status!=='ready'||isBusy?'disabled':''}>${job?.status==='error'?'重试匹配':'匹配此词'}</button>`:''}`;
  }
  function entryHTML(entry){return `<section class="vocabulary-ai-entry" data-ai-word="${E(entry.word)}" aria-label="${E(entry.word)} 的 GRE 词汇联想">${entryInner(entry)}</section>`;}
  function updateDOM(){
    document.querySelectorAll('[data-ai-settings]').forEach(section=>{
      section.querySelector('[data-ai-status]').innerHTML=connectionHTML();
      const reconnect=section.querySelector('[data-ai-action="connect"]'),match=section.querySelector('[data-ai-action="match-page"]');
      if(reconnect)reconnect.disabled=status==='checking';if(match)match.disabled=status!=='ready';
      const enable=section.querySelector('[data-ai-action="configure"]'),clear=section.querySelector('[data-ai-action="clear-key"]'),note=section.querySelector('[data-ai-config-status]');
      if(enable){enable.disabled=configuring;enable.textContent=configuring?'正在启用…':'启用 API';}if(clear)clear.disabled=(!directKey&&(!localAvailable||!features.config||!configured))||configuring;
      if(note)note.textContent=configMessage||keyNote();
      const auto=section.querySelector('[data-ai-auto]'),autoQuestion=section.querySelector('[data-ai-auto-question]'),mode=section.querySelector('[data-ai-mode]');if(auto)auto.checked=preferences.auto;if(autoQuestion)autoQuestion.checked=preferences.autoQuestion;if(mode)mode.value=preferences.relationMode;
    });
    document.querySelectorAll('[data-ai-word]').forEach(node=>{const entry=entryFor(node.dataset.aiWord);if(entry){const html=entryInner(entry);if(node.innerHTML!==html)node.innerHTML=html;}});
    emitQuestionState();
  }
  function visibleEntries(){return [...new Set([...document.querySelectorAll('[data-ai-word]')].map(node=>node.dataset.aiWord))].map(entryFor).filter(Boolean);}
  function refresh(){updateDOM();if(preferences.auto&&status==='ready')visibleEntries().forEach(entry=>enqueue(entry));}
  async function connect(){
    if(directKey){refresh();return;}
    if(!adapter||!session)return;
    if(checking)return checking;
    const revision=sessionRevision;
    status='checking';connectionMessage='';updateDOM();
    checking=(async()=>{try{const data=await request('/api/status',undefined,7000);if(revision===sessionRevision)acceptStatus(data);}catch(error){if(revision===sessionRevision){if(!directKey){status='error';connectionMessage='本机服务未连接。可以直接在下方输入密钥启用网页匹配。';}localAvailable=false;emitService();}}finally{checking=null;if(revision!==sessionRevision){void connect();return;}const waiting=[...awaitingConnection.entries()];awaitingConnection.clear();if(status==='ready')for(const [word,options]of waiting){const entry=entryFor(word);if(entry)enqueue(entry,options);}refresh();}})();
    return checking;
  }
  async function configure(form,clear=false){
    if(configuring)return;
    const input=form?.querySelector('[data-ai-key]'),apiKey=clear?'':String(input?.value||'').trim(),nextModel=String(form?.querySelector('[data-ai-model]')?.value||model||'gpt-4.1-mini').trim();
    if(input)input.value='';
    if(!clear&&!apiKey){configMessage='请先输入 OpenAI API Key。';updateDOM();return;}
    if(!clear&&(/[\s\x00-\x1f]/.test(apiKey)||apiKey.length>4096||!/^[A-Za-z0-9._:-]{1,100}$/.test(nextModel))){configMessage='请检查密钥和模型格式。';updateDOM();return;}
    if(directKey||!localAvailable||!features.config){
      generationRevision++;directKey=clear?'':apiKey;directModel=nextModel;status=directKey?'ready':configured?'ready':'offline';connectionMessage='';
      configMessage=clear?'已清除当前页面的密钥。':'网页直连已启用。密钥仅保留在当前页面，首次匹配时验证；刷新后需重新输入。';
      if(!clear)for(const [key,job]of jobs)if(job.status==='error')jobs.delete(key);
      refresh();return;
    }
    const revision=sessionRevision;configuring=true;configMessage='';updateDOM();
    try{const data=await request('/api/config',clear?{clear:true}:{apiKey,model:nextModel},10000);if(revision!==sessionRevision)return;generationRevision++;acceptStatus(data);configMessage=clear?'已清除本机服务中的密钥。':'密钥已启用，将自动匹配生词。';if(!clear)for(const [key,job]of jobs)if(job.status==='error')jobs.delete(key);}
    catch(error){if(revision===sessionRevision)configMessage=error.message||'配置失败，请重新输入。';}
    finally{configuring=false;refresh();}
  }
  function enqueue(entry,{manual=false,retry=false}={}){
    if(!adapter||!entry||!V.validWord(entry.word)||!manual&&!preferences.auto)return;
    if(status==='checking'&&session){awaitingConnection.set(V.normalize(entry.word),{manual,retry});return;}
    if(status!=='ready')return;
    const word=V.normalize(entry.word),mode=preferences.relationMode,key=jobKey(word,mode),job=jobs.get(key);
    if(cached(entry,mode)||job?.status==='queued'||job?.status==='loading'||job?.status==='error'&&!retry)return;
    if(!entryFor(word))return;
    const context=typeof entry.sources?.[0]?.context==='string'?entry.sources[0].context.slice(0,1200):'';
    const task={word,mode,key,context,manual};jobs.set(key,{status:'queued'});queue.push(task);updateDOM();void drain();
  }
  async function drain(){
    if(working)return;working=true;
    try{
      while(queue.length){
        const task=queue.shift();
        if(!entryFor(task.word)||!task.manual&&!preferences.auto||task.mode!==preferences.relationMode){jobs.delete(task.key);continue;}
        if(status!=='ready'){jobs.set(task.key,{status:'error',error:'词汇匹配尚未启用，请在上方检查密钥配置后重试。'});continue;}
        jobs.set(task.key,{status:'loading'});updateDOM();
        const revision=sessionRevision,generation=generationRevision;
        try{
          const input={word:task.word,context:task.context,relationMode:task.mode};
          const raw=directKey?await window.GREOpenAIVocabulary.generate(input,{apiKey:directKey,model:directModel,fetchImpl:window.fetch.bind(window),timeoutMs:45000}):await request('/api/vocabulary',input),ai=cleanAI(raw,task.word);
          if(revision!==sessionRevision||generation!==generationRevision){jobs.delete(task.key);const entry=entryFor(task.word);if(entry)enqueue(entry,{manual:task.manual,retry:true});continue;}
          if(!ai||ai.relationMode!==task.mode)throw Error('返回的词汇内容不完整，请重试。');
          if(!entryFor(task.word)){jobs.delete(task.key);continue;}
          runtime.set(task.key,ai);
          const persisted=await adapter.saveEntry(task.word,ai);
          jobs.set(task.key,{status:persisted===false?'unsaved':'done'});
        }catch(error){
          if(revision!==sessionRevision||generation!==generationRevision){jobs.delete(task.key);const entry=entryFor(task.word);if(entry)enqueue(entry,{manual:task.manual,retry:true});continue;}
          jobs.set(task.key,{status:'error',error:error.message||'匹配失败，请稍后重试。'});
          if(['connection_failed','missing_api_key','no_session','AUTH_FAILED'].includes(error.code)||error.httpStatus===401||error.httpStatus===503){status='error';connectionMessage=error.message;if(['connection_failed','local_auth_required','no_session'].includes(error.code)){localAvailable=false;emitService();}}
        }
        updateDOM();
      }
    }finally{working=false;updateDOM();}
  }
  function init(options){adapter=options;if(session)void connect();else refresh();}
  window.addEventListener('storage',event=>{if(event.key===CONNECTION_KEY&&event.newValue){try{acceptConnection(JSON.parse(event.newValue));}catch{}}});
  window.addEventListener('focus',discoverConnection);
  window.addEventListener('hashchange',receiveLaunch);
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.aiAction==='toggle-settings'){setCollapsed(!preferences.collapsed);return;}
    if(button.dataset.aiAction==='connect'){if(directKey){refresh();return;}discoverConnection();if(session)void connect();else{connectionMessage='请在上方输入 API Key 并启用；首次匹配时会验证密钥和网络。';updateDOM();}return;}
    if(button.dataset.aiAction==='clear-key'){void configure(button.closest('[data-ai-config]'),true);return;}
    if(button.dataset.aiAction==='match-page'){visibleEntries().forEach(entry=>enqueue(entry,{manual:true,retry:true}));return;}
    if(button.dataset.aiRetry){const entry=entryFor(button.dataset.aiRetry);if(entry)enqueue(entry,{manual:true,retry:true});}
  });
  document.addEventListener('submit',event=>{if(event.target.matches('[data-ai-config]')){event.preventDefault();void configure(event.target);}});
  document.addEventListener('change',event=>{
    if(event.target.matches('[data-ai-auto]')){preferences.auto=event.target.checked;savePreferences();refresh();}
    if(event.target.matches('[data-ai-auto-question]')){preferences.autoQuestion=event.target.checked;savePreferences();updateDOM();}
    if(event.target.matches('[data-ai-mode]')&&modes.has(event.target.value)){preferences.relationMode=event.target.value;savePreferences();refresh();}
  });
  window.GREVocabularyAI={init,entryHTML,settingsHTML,refresh,enqueue,request,getServiceState,connect,analyzeQuestion,getQuestionServiceState,openSettings};
})();
