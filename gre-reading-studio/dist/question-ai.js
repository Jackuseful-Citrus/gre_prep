/* On-demand question analysis. Original answer keys and grading stay unchanged. */
(()=>{
  'use strict';
  const C=window.GRECore,Q=window.GREOpenAIQuestion,E=C.escape;
  const records=new Map(),jobs=new Map(),runtime=new Map(),rendered=new WeakMap(),queue=[];
  let adapter=null,running=false,scheduled=false,lastRevision='';
  const absent=value=>!String(value??'').trim()||/^(?:未附|未知|暂无|未提供|无解析|无答案|待补充|N\/?A|none|null|原资料未(?:提供|附).*)[。.]?$/i.test(String(value).trim());
  function describe(q,material){
    if(!q||q.category==='AWA')return null;
    const knownAnswer=(Array.isArray(q.correct_answer)?q.correct_answer:[]).map(String).filter(v=>!absent(v));
    if(!knownAnswer.length&&!absent(q.answer_text||q.raw_answer))knownAnswer.push(String(q.answer_text||q.raw_answer));
    const missingAnswer=!knownAnswer.length,missingExplanation=absent(q.explanation)&&!q.explanation_images?.length;
    if(!missingAnswer&&!missingExplanation)return null;
    const options=(q.blank_groups?.length?q.blank_groups.flatMap(g=>g.options):q.options||[]).map(o=>({id:String(o.id),text:String(o.text||'')}));
    const assets=[...new Map([...(material?.images||[]),...(q.images||[]),...(!missingAnswer?[]:q.explanation_images||[])].filter(image=>C.localAsset(image?.src)).map(image=>[image.src,image])).values()];
    const mode=C.mode(q);
    const input={questionId:q.question_id,questionType:q.question_type,answerMode:mode==='open'?'free':mode,
      questionText:[q.question_content||'请根据题目图像作答。',q.instructions||'',q.question_type==='RCSentence'&&!options.length?'选句题：请完整引用所选原句。':'',q.quantities?`Quantity A: ${q.quantities.a}\nQuantity B: ${q.quantities.b}`:'',q.numeric_format?`数值作答要求：${JSON.stringify(q.numeric_format)}`:'',(q.highlights||material?.highlights)?.length?`题目标记：${JSON.stringify(q.highlights||material.highlights)}`:''].filter(Boolean).join('\n'),
      passage:String(material?.text||(material?.paragraphs||[]).join('\n\n')||''),options,
      blankGroups:(q.blank_groups||[]).map((g,i)=>({id:String(g.id||i+1),optionIds:g.options.map(o=>String(o.id))})),knownAnswer,knownExplanation:missingExplanation?'':String(q.explanation||''),missingAnswer,missingExplanation,hasImages:assets.length>0,images:[]};
    const text=JSON.stringify([input,assets.map(a=>a.src)]);
    let a=2166136261,b=5381;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
    return {q,input,assets,signature:`${(a>>>0).toString(16)}-${(b>>>0).toString(16)}-${text.length}`};
  }
  function normalize(raw,record){
    if(!raw||raw.version!==1||raw.questionId!==record.input.questionId||raw.inputSignature!==record.signature||!Number.isFinite(raw.generatedAt)||raw.generatedAt<0||typeof raw.model!=='string'||raw.model.length>100)return null;
    try{return {...Q.validateOutput({status:raw.status,answer:raw.answer,explanation:raw.explanation,reason:raw.reason},record.input),version:1,questionId:record.input.questionId,inputSignature:record.signature,generatedAt:raw.generatedAt,model:raw.model};}catch{return null;}
  }
  function normalizeCache(raw,questions,materials){
    const out={};if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;
    for(const [id,value]of Object.entries(raw)){const q=questions.get(id),record=describe(q,materials.get(q?.material_id));if(!record)continue;const result=normalize(value,record);if(result)out[id]=result;}
    return out;
  }
  const keyOf=record=>`${record.input.questionId}:${record.signature}`;
  const service=()=>window.GREVocabularyAI?.getQuestionServiceState?.()||{ready:false,auto:true,revision:'',message:'请先配置 API。'};
  const cached=record=>normalize(adapter?.getResults()?.[record.input.questionId],record)||runtime.get(keyOf(record));
  const visible=node=>node.getClientRects().length>0&&!node.closest('details:not([open])');
  const visibleRecord=record=>[...document.querySelectorAll('[data-question-ai]')].some(node=>node.dataset.questionAi===record.input.questionId&&node.dataset.questionSignature===record.signature&&visible(node));
  function inner(record){
    const result=cached(record),job=jobs.get(keyOf(record)),state=service();
    let content='';
    if(result?.status==='answered'){
      const labels=result.answer.map(id=>{const option=record.input.options.find(o=>o.id===id);return option?`${id} · ${option.text}`:id;});
      const conflict=record.input.knownAnswer.length&&record.input.knownAnswer.every(id=>record.input.options.some(o=>o.id===id))&&(!C.same(record.input.knownAnswer,result.answer));
      content=`<p class="question-ai-answer" data-question-ai-answer><strong>AI 参考答案：</strong>${E(labels.join('；'))}</p><div class="explanation-text" data-question-ai-explanation>${E(result.explanation)}</div>${conflict?'<p class="question-ai-warning">AI 判断与资料所列答案不同，请结合原题核对。</p>':''}<p class="tiny">AI 生成 · ${E(result.model)} · 供学习核对，不替代原资料答案或正式判分。</p>`;
    }else if(result)content=`<p class="question-ai-warning" data-question-ai-status>${E(result.reason||'题目信息不足，暂时无法可靠判断。')}</p>${result.explanation?`<div class="explanation-text" data-question-ai-explanation>${E(result.explanation)}</div>`:''}`;
    if(job?.status==='loading'||job?.status==='queued')content+=`<p data-question-ai-status role="status">${job.status==='loading'?'正在分析题目、答案和解题依据…':'等待分析…'}</p>`;
    else if(job?.status==='error')content+=`<p class="question-ai-warning" data-question-ai-status role="status">${E(job.message)}</p>`;
    else if(job?.status==='unsaved')content+='<p class="question-ai-warning" data-question-ai-status>分析完成，但浏览器保存失败；请点击底部「保存进度」。</p>';
    else if(!result)content+=`<p data-question-ai-status>${state.ready?(state.auto?'提交后的缺失内容将自动分析。':'自动分析已关闭，可点击下方按钮分析本题。'):E(state.message||'启用 API 后会自动补充这道题的答案与解析。')}</p>`;
    const busy=['loading','queued'].includes(job?.status);
    if(!result||result.status==='insufficient'||job?.status==='error')content+=`<div class="question-ai-actions"><button type="button" class="button secondary small" data-question-ai-action="retry" ${!state.ready||busy?'disabled':''}>${job?.status==='error'||result?'重试分析':'分析本题'}</button><button type="button" class="text-link" data-question-ai-action="settings">API 设置</button></div>`;
    else content+='<button type="button" class="text-link" data-question-ai-action="settings">API 设置</button>';
    return `<div class="row space-between"><h3>AI 补充解析</h3><span class="tag">${record.input.missingAnswer?'缺少原答案':'缺少原解析'}</span></div>${content}`;
  }
  function panelHTML(q,material){
    const record=describe(q,material);if(!record)return '';
    records.set(q.question_id,record);
    return `<section class="question-ai-panel" data-question-ai="${E(q.question_id)}" data-question-signature="${record.signature}" aria-label="AI 补充答案与解析">${inner(record)}</section>`;
  }
  function legacyPanelHTML(id){
    const bank=window.GREPlatform?.getBank(),q=bank?.questions.find(q=>q.legacy_rc_id===id);
    return q?panelHTML(q,bank.materials.find(m=>m.id===q.material_id)):'';
  }
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;refresh();});}
  function refresh(){
    for(const node of document.querySelectorAll('[data-question-ai]')){
      const record=records.get(node.dataset.questionAi);if(!record||record.signature!==node.dataset.questionSignature||!visible(node))continue;
      const html=inner(record);if(rendered.get(node)!==html){node.innerHTML=html;rendered.set(node,html);}
      if(adapter&&service().ready&&service().auto)enqueue(record);
    }
  }
  function enqueue(record,manual=false){
    const key=keyOf(record),job=jobs.get(key);
    if(!adapter||!service().ready||!visibleRecord(record)||['queued','loading'].includes(job?.status)||!manual&&(cached(record)||job?.status==='error'))return;
    jobs.set(key,{status:'queued'});queue.push({record,manual});schedule();void drain();
  }
  async function imageInput(asset){
    // Restrict image reads to the app's existing local question assets.
    if(!C.localAsset(asset.src))return null;
    try{
      if(location.protocol==='file:'){
        const image=await window.GREQuestionImages?.load(asset.src);
        return image?{url:image.url,label:asset.alt||'原题图像'}:null;
      }
      const response=await fetch(new URL(asset.src,location.href),{signal:AbortSignal.timeout(10000)});
      if(!response.ok)return null;
      const blob=await response.blob();if(blob.size>1800000||!/^image\/(png|jpeg|webp)$/.test(blob.type))return null;
      const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
      return {url,label:asset.alt||'原题图像'};
    }catch{return null;}
  }
  async function drain(){
    if(running)return;running=true;
    try{while(queue.length){
      const {record,manual}=queue.shift(),key=keyOf(record),state=service();
      if(!state.ready||!manual&&!state.auto||!visibleRecord(record)){jobs.delete(key);continue;}
      jobs.set(key,{status:'loading'});schedule();
      try{
        const images=(await Promise.all(record.assets.slice(0,4).map(imageInput))).filter(Boolean);
        const current=service();
        if(!current.ready||current.revision!==state.revision||!manual&&!current.auto||!visibleRecord(record)){jobs.delete(key);schedule();continue;}
        const input={...record.input,images,questionText:record.input.questionText+(record.assets.length?`\n图片完整性：原题关联 ${record.assets.length} 张不同图像，本次实际提供 ${images.length} 张。${images.length<record.assets.length?'部分图片未能读取；如缺少必要图示，请明确说明并返回信息不足，不猜测图中内容。':''}`:'')};
        const raw=await window.GREVocabularyAI.analyzeQuestion(input);
        if(service().revision!==state.revision){jobs.delete(key);schedule();continue;}
        const result=normalize({...raw,inputSignature:record.signature},record);
        if(!result)throw Error('API 返回的答案或解析格式不完整，请重试。');
        runtime.set(key,result);
        const saved=await adapter.saveResult(record.input.questionId,result);
        jobs.set(key,{status:saved===false?'unsaved':'done'});
      }catch(error){
        if(service().revision!==state.revision)jobs.delete(key);
        else jobs.set(key,{status:'error',message:error.message||'分析失败，请检查 API 配置后重试。'});
      }
      schedule();
    }}finally{running=false;schedule();}
  }
  function openSettings(){
    let dialog=document.getElementById('question-ai-settings-dialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='question-ai-settings-dialog';dialog.setAttribute('aria-label','API 设置');dialog.innerHTML='<div class="question-ai-dialog-heading"><h2>API 设置</h2><button class="button secondary small" data-question-ai-action="close-settings">关闭</button></div>'+window.GREVocabularyAI.settingsHTML();document.body.appendChild(dialog);}
    if(!dialog.open)dialog.showModal();window.GREVocabularyAI.openSettings?.();
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-question-ai-action]');if(!button||button.disabled)return;
    if(button.dataset.questionAiAction==='settings')openSettings();
    if(button.dataset.questionAiAction==='close-settings')document.getElementById('question-ai-settings-dialog')?.close();
    if(button.dataset.questionAiAction==='retry'){const record=records.get(button.closest('[data-question-ai]')?.dataset.questionAi);if(record)enqueue(record,true);}
  });
  document.addEventListener('toggle',schedule,true);
  window.addEventListener('gre-question-ai-change',()=>{
    const revision=service().revision;
    if(revision!==lastRevision){for(const [key,job]of jobs)if(job.status==='error')jobs.delete(key);lastRevision=revision;}
    schedule();
  });
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open']});
  window.GREQuestionAI={panelHTML,legacyPanelHTML,normalizeCache,describe,refresh,init:options=>{adapter=options;lastRevision=service().revision;schedule();}};
})();
