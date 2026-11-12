/* Data validation and question-specific scoring; no network or dependencies. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.GRECore=value;})(typeof window!=='undefined'?window:globalThis,()=>{
  'use strict';
  const types={RC1:'RC · 单选',RCMultiple:'RC · 多选',RCSentence:'RC · 选句',TC1:'TC · 单空',TC2:'TC · 双空',TC3:'TC · 三空',TC_LEGACY:'旧版成对选项填空',SE:'SE · 六选二',QC:'数量比较',QuantSingle:'数学单选',QuantMultiple:'数学多选',NumericEntry:'数值填空',DI:'数据解释',QuantRecall:'数学回忆自答',QuantDrill:'数学知识练习',Issue:'Issue 写作',Argument:'Argument 写作',WritingExercise:'写作练习'};
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&new Set(a).size===a.length&&a.every(x=>b.includes(x));
  function rational(raw){
    const text=String(raw??'').trim().replace(/−/g,'-');if(text.length>120)return null;
    if(text.includes('/')){const parts=text.split('/');if(parts.length!==2)return null;const a=rational(parts[0]),b=rational(parts[1]);if(!a||!b||b[0]===0n)return null;return [a[0]*b[1],a[1]*b[0]];}
    const m=text.match(/^([+-]?)(\d*)(?:\.(\d*))?$/);if(!m||!(m[2]||m[3]))return null;
    return [(m[1]==='-'?-1n:1n)*BigInt((m[2]||'0')+(m[3]||'')),10n**BigInt((m[3]||'').length)];
  }
  const mode=q=>q.category==='AWA'?'writing':q.response_type==='numeric'||q.question_type==='NumericEntry'?'numeric':q.question_type==='SE'?'pair':q.blank_groups?.length>1?'blanks':q.response_type==='multiple'||['RCMultiple','QuantMultiple'].includes(q.question_type)?'multiple':q.response_type==='open'||['QuantRecall','QuantDrill'].includes(q.question_type)||!q.options?.length&&!q.blank_groups?.length?'open':'single';
  function grade(q,response){
    if(!q.gradable||q.answer_status!=='verified'||!q.correct_answer?.length||q.category==='AWA')return null;
    const m=mode(q);
    if(m==='numeric'){
      const entered=rational(response.text);if(!entered)return false;
      return q.correct_answer.some(value=>{const target=rational(value);if(!target)return false;const tol=q.numeric_format?.tolerance;if(Number.isFinite(tol)&&tol>0)return Math.abs(Number(entered[0])/Number(entered[1])-Number(target[0])/Number(target[1]))<=tol;return entered[0]*target[1]===target[0]*entered[1];});
    }
    if(m==='open'||m==='writing')return null;
    if(m==='pair'&&response.selected?.length!==2)return false;
    return same(response.selected||[],q.correct_answer);
  }
  function complete(q,r){const m=mode(q);if(m==='numeric')return q.gradable?!!rational(r.text):!!r.text?.trim();if(m==='writing'||m==='open')return !!r.text?.trim();if(m==='pair')return r.selected?.length===2;if(m==='blanks')return q.blank_groups.every(g=>g.options.filter(o=>r.selected?.includes(o.id)).length===1);return !!r.selected?.length;}
  function localAsset(value){return typeof value==='string'&&/^(?:sources|question-images)\/[A-Za-z0-9_./\-]+$/.test(value)&&!value.split('/').includes('..');}
  function validateBank(input){
    if(!input||input.schema_version!==2||!Array.isArray(input.questions)||!Array.isArray(input.sources)||!Array.isArray(input.materials))throw Error('需要 schema_version: 2，questions、sources 和 materials 数组。');
    if(input.questions.length>100000)throw Error('一次最多导入 100,000 道题。');
    const bank=JSON.parse(JSON.stringify(input)),ids=new Set(),sourceIds=new Set(bank.sources.map(s=>s.id)),materialIds=new Set(bank.materials.map(m=>m.id));
    for(const s of bank.sources)if(s.url&&!localAsset(s.url))throw Error('来源文件仅允许本地 sources/ 路径。');
    for(const m of bank.materials)for(const image of m.images||[])if(!localAsset(image.src))throw Error('共用材料图片路径不安全。');
    for(const q of bank.questions){
      if(typeof q.question_id!=='string'||!q.question_id||ids.has(q.question_id))throw Error('题目ID缺失或重复。');ids.add(q.question_id);
      if(!types[q.question_type]||!['Verbal','Quant','AWA'].includes(q.category))throw Error('未知科目或题型：'+q.question_type);
      if(!sourceIds.has(q.source_id)||q.material_id&&!materialIds.has(q.material_id))throw Error('题目缺少来源或关联材料。');
      if(typeof q.question_content!=='string'||!q.question_content.trim()&&!q.images?.length)throw Error('题目内容缺失。');
      for(const image of q.images||[])if(!localAsset(image.src))throw Error('题图只允许本地 question-images/ 或 sources/ 路径。');
      q.options ||= [];if(!Array.isArray(q.options))throw Error('options 必须是数组。');
      const opts=q.blank_groups?.length?q.blank_groups.flatMap(g=>g.options):q.options;
      if(!opts.every(o=>typeof o.id==='string'&&typeof o.text==='string')||new Set(opts.map(o=>o.id)).size!==opts.length)throw Error('选项ID重复或内容格式错误。');
      if(!['verified','extracted','needs_review','incomplete'].includes(q.answer_status))q.answer_status='extracted';
      if(q.answer_status==='verified'&&q.question_type==='SE'&&(opts.length!==6||q.correct_answer&&q.correct_answer.length!==2))throw Error('可评分 SE 必须有六个选项和两个原答案。');
      if(q.answer_status==='verified'&&['TC2','TC3'].includes(q.question_type)&&q.blank_groups?.length!==Number(q.question_type.slice(-1)))throw Error('可评分多空填空必须保留每一空的选项组。');
      q.gradable=q.category!=='AWA'&&q.answer_status==='verified'&&Array.isArray(q.correct_answer)&&q.correct_answer.length>0;
      if(q.gradable&&mode(q)!=='numeric'&&!q.correct_answer.every(id=>opts.some(o=>o.id===id)))throw Error('答案无法对应选项。');
      if(q.gradable&&mode(q)==='numeric'&&!q.correct_answer.every(v=>rational(v)))throw Error('数值答案不是可核验的数值或分数。');
      if(q.gradable&&new Set(q.correct_answer).size!==q.correct_answer.length)throw Error('答案集合含重复项。');
      if(q.gradable&&mode(q)==='single'&&q.correct_answer.length!==1)throw Error('单选题必须且只能有一个原答案。');
      if(q.gradable&&mode(q)==='blanks'&&(!q.blank_groups.every(g=>g.options.filter(o=>q.correct_answer.includes(o.id)).length===1)||q.correct_answer.length!==q.blank_groups.length))throw Error('每一空必须恰好有一个原答案。');
    }
    return bank;
  }
  function stats(attempts,bank){
    const questions=new Map(bank.questions.map(q=>[q.question_id,q]));const result={total:0,graded:0,correct:0,time:0,timed:0,byType:{},byCategory:{}};
    for(const a of attempts){const q=questions.get(a.questionId);if(!q)continue;const eligible=q.gradable&&q.answer_status==='verified'&&q.category!=='AWA'&&typeof a.correct==='boolean';result.total++;if(eligible){result.graded++;if(a.correct)result.correct++;}if(Number.isFinite(a.elapsedMs)){result.time+=a.elapsedMs;result.timed++;}const t=result.byType[q.question_type] ||= {total:0,graded:0,correct:0};t.total++;if(eligible){t.graded++;if(a.correct)t.correct++;}result.byCategory[q.category]=(result.byCategory[q.category]||0)+1;}
    return result;
  }
  return {types,escape,same,rational,mode,grade,complete,validateBank,localAsset,stats};
});
