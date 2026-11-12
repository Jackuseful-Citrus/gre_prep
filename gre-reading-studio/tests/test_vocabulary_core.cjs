const test=require('node:test');
const assert=require('node:assert/strict');
const V=require('../dist/vocabulary.js');

test('AI matches survive word merging and old backup import without retaining secrets',()=>{
  const ai={version:1,word:'opaque',meaning:'不透明的；晦涩的',synonyms:[{word:'obscure',meaning:'晦涩的',note:'用于不易理解的表达'}],similar:[{word:'opulent',meaning:'奢华的',note:'形近但含义不同'}],relationMode:'confusable',model:'gpt-4.1-mini',generatedAt:12345,apiKey:'DO-NOT-PERSIST',token:'DO-NOT-PERSIST'};
  const original=[{word:'opaque',addedAt:10,sources:[{questionId:'q1'}],ai}];
  const result=V.add(original,'OPAQUE',{questionId:'q2'},20);
  assert.equal(result[0].ai.synonyms[0].word,'obscure');
  assert.equal(result[0].sources.length,2);
  assert.equal(JSON.stringify(result).includes('DO-NOT-PERSIST'),false);
  assert.deepEqual(V.mergeEntries(result,[{word:'opaque',sources:[]}])[0].ai,result[0].ai);
  assert.equal(V.normalizeAI({...ai,word:'different'},'opaque'),null);
  assert.equal(V.normalizeAI({...ai,similar:{}},'opaque'),null);
  assert.equal(V.normalizeAI({...ai,generatedAt:Infinity},'opaque'),null);
  const newer={...ai,meaning:'新的释义',generatedAt:12346};
  assert.equal(V.mergeEntries(result,[{word:'opaque',ai:newer}])[0].ai.meaning,'新的释义');
});

test('normalizes words and phrases without admitting markup or nonwords',()=>{
  assert.equal(V.normalize('  It’s   time-consuming  '),"it's time-consuming");
  for(const word of ['a',"one's",'self-effacing','in light of'])assert.equal(V.validWord(word),true,word);
  for(const word of ['',null,{},['word'],'<script>','alpha123','---','a'.repeat(81),'a--b','中文'])assert.equal(V.validWord(word),false,String(word));
});

test('includes non-long Verbal, including short RC, and excludes other subjects and long passages',()=>{
  const rc={category:'Verbal',question_type:'RC1'};
  assert.equal(V.eligible({category:'Verbal',question_type:'TC3'}),true);
  assert.equal(V.eligible({category:'Verbal',question_type:'TC1',text:'word '.repeat(400)}),true);
  assert.equal(V.eligible({category:'Verbal',question_type:'SE'}),true);
  for(const category of ['Quant','AWA',null])assert.equal(V.eligible({category}),false);
  assert.equal(V.eligible(rc,{length:'短篇',word_count:180}),true);
  assert.equal(V.eligible(rc,{length:'中篇',word_count:350}),true);
  for(const material of [{length:'长篇'},{word_count:351},{wordCount:351},{text:'word '.repeat(351)},{paragraphs:['word '.repeat(180),'word '.repeat(180)]}])assert.equal(V.eligible(rc,material),false);
  assert.equal(V.eligible({...rc,tags:['长篇']}),false);
  assert.equal(V.eligible(null),false);
});

test('offers every blank option before prompt and passage words, deduping within groups',()=>{
  const q={category:'Verbal',question_type:'TC2',question_content:'Blank (i) was opaque; (ii) was OPAQUE.',blank_groups:[{options:[{id:'A',text:'Opaque'},{id:'B',text:'lucid'}]},{options:[{id:'C',text:'opaque'},{id:'D',text:'self-effacing'}]}],options:[{id:'A',text:'Opaque'}]};
  const groups=V.groups(q,{text:'Opaque prose grows. Lucid prose shines.'});
  assert.deepEqual(groups.map(g=>g.label),['选项','题干','文章']);
  assert.deepEqual(groups[0].words.map(w=>w.word),['opaque','lucid','self-effacing']);
  assert.deepEqual(groups[1].words.map(w=>w.word),['was','opaque']);
  assert.ok(groups[2].words.some(w=>w.word==='opaque'&&w.context==='Opaque prose grows.'));
  assert.deepEqual(V.groups({...q,category:'Quant'}),[]);
  assert.doesNotThrow(()=>V.groups({...q,options:{},blank_groups:[null,{},'bad']},{paragraphs:{}}));
});

test('merges words and unique question sources while preserving existing context and timestamps',()=>{
  const original=[{word:' Opaque ',addedAt:10,sources:[{questionId:'q1',questionType:'TC1',source:'Book A',section:'1',context:'Opaque prose',addedAt:11}]}];
  const originalSnapshot=JSON.stringify(original);
  const added=V.add(original,'OPAQUE',{questionId:'q2',questionType:'SE',source:'Book B',context:'Another opaque example'},20);
  const merged=V.add(added,'opaque',{questionId:'q1',context:'Replacement context'},30);
  assert.equal(merged.length,1);assert.equal(merged[0].addedAt,10);assert.equal(merged[0].sources.length,2);
  assert.equal(merged[0].sources[0].context,'Opaque prose');assert.equal(merged[0].sources[0].addedAt,11);
  assert.equal(merged[0].sources[1].addedAt,20);
  assert.equal(JSON.stringify(original),originalSnapshot);
  assert.equal(V.remove(merged,' OPAQUE ').length,0);
});

test('old backups and malformed import fields are safe; missing bank questions retain sources',()=>{
  for(const raw of [undefined,null,{},'bad'])assert.deepEqual(V.normalizeEntries(raw),[]);
  const entries=V.mergeEntries(null,[null,{}, {word:'<img src=x>',sources:[]},{word:'opaque',addedAt:Infinity,sources:[null,{},'bad',{questionId:'not-in-current-bank',source:'x'.repeat(800),context:'y'.repeat(2000),addedAt:NaN}]},{word:'lucid',addedAt:-1,sources:{}}]);
  assert.equal(entries.length,2);assert.equal(entries[0].addedAt,0);assert.equal(entries[0].sources[0].questionId,'not-in-current-bank');
  assert.equal(entries[0].sources[0].source.length,500);assert.equal(entries[0].sources[0].context.length,1200);assert.equal(entries[0].sources[0].addedAt,0);
  assert.deepEqual(entries[1].sources,[]);
  assert.equal(V.add(entries,'<script>',{},5).length,2);
});
