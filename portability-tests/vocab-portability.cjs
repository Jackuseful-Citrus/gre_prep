/* Copy-path and offline acceptance; does not access the user's browser profile. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.GRE_PLAYWRIGHT||'C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const workspace=path.resolve(__dirname,'..'),source=path.join(workspace,'gre800-cards','dist');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gre-vocab-portable-'));
const moved=path.join(temp,'U盘 GRE #资料'),second=path.join(temp,'另一台 电脑');
fs.cpSync(source,moved,{recursive:true,errorOnExist:true,force:false});
fs.cpSync(source,second,{recursive:true,errorOnExist:true,force:false});
const KEY='gre800-word-studio-v1',results=[],errors=[],remote=[];
const read=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
function check(name,fn){fn();results.push({name,ok:true});}
let browser;
(async()=>{
  try{
    const html=fs.readFileSync(path.join(source,'index.html'),'utf8');
    const references=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1]).filter(s=>!s.startsWith('#'));
    check('all HTML dependencies resolve with exact Linux-compatible filename casing',()=>{
      for(const ref of references){assert.ok(!ref.includes('\\')&&!/^(?:[a-z]+:|\/)/i.test(ref));let directory=source;for(const segment of ref.split('/')){assert.ok(fs.readdirSync(directory).includes(segment),ref);directory=path.join(directory,segment);}assert.ok(fs.statSync(directory).isFile());}
    });
    browser=await chromium.launch({headless:true,executablePath:process.env.GRE_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const open=async target=>{const context=await browser.newContext({acceptDownloads:true,offline:true});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});await page.goto(pathToFileURL(path.join(target,'index.html')).href);await page.locator('[data-confidence="unknown"]').waitFor();return page;};
    const first=await open(moved);
    check('copied file URL with spaces, Chinese characters and # loads all 800 words offline',()=>assert.equal(fs.readFileSync(path.join(moved,'words.json'),'utf8')&&JSON.parse(fs.readFileSync(path.join(moved,'words.json'),'utf8')).length,800));
    assert.equal(await first.evaluate(()=>window.GRE_WORDS.length),800);
    await first.locator('[data-confidence="unknown"]').click();
    const initial=await read(first),wordId=initial.basic.queue[0];
    check('learning on moved copy records the answer in browser storage',()=>{assert.equal(initial.records[wordId].attempts,1);assert.equal(initial.records[wordId].status,'review');});
    await first.locator('[data-nav="progress"]').click();
    const downloading=first.waitForEvent('download');await first.locator('[data-action="export-progress"]').click();const download=await downloading;
    const backup=path.join(temp,'progress.json');await download.saveAs(backup);
    const exported=JSON.parse(fs.readFileSync(backup,'utf8'));
    check('exported backup includes learning records and unfinished practice',()=>{assert.equal(exported.format,'gre800-progress');assert.equal(exported.state.records[wordId].attempts,1);assert.equal(exported.state.basic.queue[0],wordId);});
    const fresh=await open(second);await fresh.locator('[data-nav="progress"]').click();
    await fresh.locator('#progress-file').setInputFiles(backup);await fresh.locator('[data-action="confirm-import"]').click();await fresh.waitForFunction(k=>Object.keys(JSON.parse(localStorage.getItem(k)).records).length===1,KEY);
    const imported=await read(fresh);
    check('fresh browser and new copied location can restore exported records',()=>{assert.equal(imported.records[wordId].attempts,1);assert.equal(imported.records[wordId].status,'review');assert.equal(imported.records[wordId].nextReviewAt,exported.state.records[wordId].nextReviewAt);});
    check('offline copy and progress migration make no remote requests and have no runtime errors',()=>{assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);});
    console.log(JSON.stringify({passed:results.length,failed:0,temp},null,2));
  }catch(e){results.push({name:'portability acceptance',ok:false,error:e.stack});process.exitCode=1;console.error(e);}
  finally{if(browser)await browser.close();fs.writeFileSync(path.join(__dirname,'vocab-portability-report.json'),JSON.stringify({testedAt:new Date().toISOString(),host:process.platform,linuxRuntimeTested:false,temp,results,errors,remote,limits:['Speech synthesis depends on the target browser and installed system voices.','Browser-local progress must be exported and imported; copying application files does not transfer it.']},null,2));}
})();
