'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../dist/platform-core.js');
const root=path.resolve(__dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'materials/manifest.json'),'utf8'));
for(const value of ['../../materials/sources/awa-01.pdf','question-images/quant/example.png','sources/old.pdf'])assert(core.localAsset(value),value);
for(const value of ['../../secret.txt','../../materials/sources/../secret.pdf','../../materials/sources/%2e%2e/secret.pdf','../../materials/sources/a\\b.pdf','sources/../../secret.pdf','https://example.org/a.pdf','javascript:alert(1)','//example.org/a.pdf','../../../materials/sources/a.pdf'])assert(!core.localAsset(value),value);
for(const [old,target] of Object.entries(manifest.path_aliases)){
  if(!old.startsWith('gre-reading-studio/dist/sources/'))continue;
  const oldURL=old.slice('gre-reading-studio/dist/'.length);
  const restored=core.validateBank({schema_version:2,questions:[],materials:[],sources:[{id:'restored',url:oldURL,reader:{url:oldURL}}]});
  assert.equal(restored.sources[0].url,'../../'+target);
  assert.equal(restored.sources[0].reader.url,'../../'+target);
  assert(fs.existsSync(path.join(root,target)),target);
}
console.log('Material paths: consolidated links, old backup migration, and traversal rejection passed.');
