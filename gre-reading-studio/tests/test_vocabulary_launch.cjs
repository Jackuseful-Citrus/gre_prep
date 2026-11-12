'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {fileURLToPath}=require('node:url');
const {writeLaunchPage,browserURL}=require('../scripts/vocabulary-api.cjs');
function removeTemp(directory){
  const target=path.resolve(directory),relative=path.relative(path.resolve(os.tmpdir()),target);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(target).startsWith('GRE launch '),'cleanup must stay inside the test temporary directory');
  fs.rmSync(target,{recursive:true,force:true});
}

test('the launcher uses an ASCII HTML bridge and redirects to the original file with the complete connection fragment',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'GRE launch 中文 '));
  try{
    const token='b'.repeat(64),port=43218,file=writeLaunchPage(port,token,{directory});
    assert.equal(file,path.join(directory,'ai-launch.html'));
    assert.equal(file.includes('#'),false);
    const content=fs.readFileSync(file,'utf8');
    assert.match(content,/^[\x00-\x7f]*$/);
    assert.match(content,/<meta charset="UTF-8">/);
    const script=content.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    let redirected;
    vm.runInNewContext(script,{window:{location:{replace:url=>{redirected=url;}}}});
    assert.equal(redirected,browserURL(port,token));
    const target=new URL(redirected);
    assert.equal(fileURLToPath(target),path.resolve(__dirname,'../dist/index.html'));
    assert.deepEqual(JSON.parse(decodeURIComponent(target.hash.slice(8))),{url:'http://127.0.0.1:'+port,token});
    const fallback=content.match(/<a id="open-reading" href="([^"]*)"/)?.[1];
    assert.equal(fallback,redirected.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
  }finally{removeTemp(directory);}
});

test('bridge creation never serializes the API key and a newer launch replaces only its runtime page',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'GRE launch key ')),previous=process.env.OPENAI_API_KEY;
  try{
    process.env.OPENAI_API_KEY='test-secret-must-not-enter-launch-page';
    const retained=path.join(directory,'retained.txt');fs.writeFileSync(retained,'retain');
    const file=writeLaunchPage(43218,'a'.repeat(64),{directory});
    let content=fs.readFileSync(file,'utf8');
    assert.equal(content.includes(process.env.OPENAI_API_KEY),false);
    writeLaunchPage(43219,'c'.repeat(64),{directory});content=fs.readFileSync(file,'utf8');
    assert.equal(content.includes('a'.repeat(64)),false);
    assert.ok(content.includes('c'.repeat(64)));
    assert.equal(content.includes(process.env.OPENAI_API_KEY),false);
    assert.equal(fs.readFileSync(retained,'utf8'),'retain');
  }finally{
    if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;
    removeTemp(directory);
  }
});

test('bridge script and fallback escape potentially dangerous connection text',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'GRE launch escaping '));
  try{
    const unusual='\"</script><img src=x onerror=alert(1)>&\u2028',file=writeLaunchPage(43218,unusual,{directory}),content=fs.readFileSync(file,'utf8');
    assert.equal((content.match(/<script>/g)||[]).length,1);
    assert.equal((content.match(/<\/script>/g)||[]).length,1);
    assert.equal(content.includes('<img'),false);
    let redirected;vm.runInNewContext(content.match(/<script>([\s\S]*?)<\/script>/)[1],{window:{location:{replace:url=>{redirected=url;}}}});
    assert.equal(JSON.parse(decodeURIComponent(new URL(redirected).hash.slice(8))).token,unusual);
  }finally{removeTemp(directory);}
});
