/* Offline vocabulary helpers shared by practice and progress import. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GREVocabulary=api;})(typeof window!=='undefined'?window:globalThis,()=>{
  'use strict';
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const text=(value,limit)=>typeof value==='string'?value.trim().slice(0,limit):'';
  const timestamp=value=>Number.isFinite(value)&&value>=0?value:0;
  function normalize(raw){return typeof raw==='string'?raw.replace(/[\u2018\u2019\u02bc]/g,"'").trim().replace(/\s+/g,' ').toLowerCase():'';}
  function validWord(raw){const word=normalize(raw);return word.length>=1&&word.length<=80&&/^[a-z]+(?:['-][a-z]+)*(?: [a-z]+(?:['-][a-z]+)*)*$/.test(word);}
  function tokens(raw){return typeof raw==='string'?raw.match(/[A-Za-z]+(?:['\u2018\u2019\u02bc-][A-Za-z]+)*/g)||[]:[];}
  function eligible(q,material){
    if(!object(q)||q.category!=='Verbal')return false;
    if(!object(material)&&!/^RC/.test(q.question_type||''))return true;
    const items=[q,material].filter(object);
    if(items.some(item=>item.length==='长篇'||item.length==='long'||Array.isArray(item.tags)&&item.tags.includes('长篇')))return false;
    for(const item of items){
      const count=Number.isFinite(item.word_count)?item.word_count:item.wordCount;
      if(Number.isFinite(count)&&count>350)return false;
    }
    const passage=object(material)?(typeof material.text==='string'?material.text:Array.isArray(material.paragraphs)?material.paragraphs.filter(v=>typeof v==='string').join(' '):''):typeof q.text==='string'?q.text:'';
    return tokens(passage).length<=350;
  }
  function groups(q,material){
    if(!eligible(q,material))return [];
    const output=[];
    function append(label,parts){
      const seen=new Set(),words=[];
      for(const raw of parts){
        if(typeof raw!=='string')continue;
        const clean=raw.replace(/\bBlank\s*(?:\([ivx\d]+\)|[ivx]+\b|\d+)/gi,' ').replace(/\([ivx]+\)/gi,' ');
        for(const token of tokens(clean)){
          const word=normalize(token);
          if(word.length<2||!validWord(word)||seen.has(word))continue;
          seen.add(word);words.push({word,context:text(raw,1200)});
        }
      }
      if(words.length)output.push({label,words});
    }
    const options=Array.isArray(q.options)?q.options:[];
    const blanks=Array.isArray(q.blank_groups)?q.blank_groups.flatMap(group=>object(group)&&Array.isArray(group.options)?group.options:[]):[];
    append('选项',[...blanks,...options].filter(object).map(option=>option.text));
    append('题干',[q.question_content]);
    if(object(material)){
      const passage=typeof material.text==='string'?material.text:Array.isArray(material.paragraphs)?material.paragraphs.filter(v=>typeof v==='string').join('\n'):'';
      append('文章',passage.match(/[^.!?\n]+(?:[.!?]+|$)/g)||[]);
    }
    return output;
  }
  function cleanSource(raw){
    if(!object(raw))return null;
    const questionId=text(raw.questionId,300);
    if(!questionId)return null;
    return {questionId,questionType:text(raw.questionType,80),source:text(raw.source,500),section:text(raw.section,500),context:text(raw.context,1200),addedAt:timestamp(raw.addedAt)};
  }
  function normalizeAI(raw,word){
    if(!object(raw)||raw.version!==1||normalize(raw.word)!==normalize(word)||!validWord(word)||!['confusable','related'].includes(raw.relationMode)||!text(raw.meaning,1000)||!Array.isArray(raw.synonyms)||!Array.isArray(raw.similar)||!Number.isFinite(raw.generatedAt)||raw.generatedAt<=0||raw.generatedAt>8640000000000000)return null;
    const cleanList=items=>{
      const seen=new Set([normalize(word)]),result=[];
      for(const item of items.slice(0,12)){
        if(!object(item)||!validWord(item.word)||!text(item.meaning,500)||seen.has(normalize(item.word)))continue;
        seen.add(normalize(item.word));result.push({word:normalize(item.word),meaning:text(item.meaning,500),note:text(item.note,800)});
      }
      return result;
    };
    return {version:1,word:normalize(word),meaning:text(raw.meaning,1000),synonyms:cleanList(raw.synonyms),similar:cleanList(raw.similar),relationMode:raw.relationMode,model:text(raw.model,100),generatedAt:raw.generatedAt};
  }
  function normalizeEntries(raw){
    if(!Array.isArray(raw))return [];
    const entries=new Map();
    for(const item of raw){
      if(!object(item)||!validWord(item.word))continue;
      const word=normalize(item.word);
      let entry=entries.get(word);
      if(!entry){entry={word,addedAt:timestamp(item.addedAt),sources:[]};entries.set(word,entry);}
      const ai=normalizeAI(item.ai,word);if(ai&&(!entry.ai||ai.generatedAt>entry.ai.generatedAt))entry.ai=ai;
      const known=new Map(entry.sources.map(source=>[source.questionId,source]));
      for(const value of Array.isArray(item.sources)?item.sources:[]){
        const source=cleanSource(value);if(!source)continue;
        const existing=known.get(source.questionId);
        if(existing){
          for(const field of ['questionType','source','section','context'])if(!existing[field])existing[field]=source[field];
        }else{known.set(source.questionId,source);entry.sources.push(source);}
      }
    }
    return [...entries.values()];
  }
  function mergeEntries(...arrays){return normalizeEntries(arrays.flatMap(value=>Array.isArray(value)?value:[]));}
  function add(entries,word,source,at){
    if(!validWord(word))return normalizeEntries(entries);
    const addedAt=timestamp(at);
    return mergeEntries(entries,[{word:normalize(word),addedAt,sources:object(source)?[{...source,addedAt:Number.isFinite(source.addedAt)&&source.addedAt>=0?source.addedAt:addedAt}]:[]}]);
  }
  function remove(entries,word){const key=normalize(word);return normalizeEntries(entries).filter(entry=>entry.word!==key);}
  return {normalize,validWord,eligible,groups,normalizeEntries,mergeEntries,add,remove,normalizeAI};
});
