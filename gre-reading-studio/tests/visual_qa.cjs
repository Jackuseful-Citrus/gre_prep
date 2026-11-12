/* Browser visual, local-file and PDF-link acceptance. Separate from interaction QA. */
const { chromium } = require(process.env.GRE_PLAYWRIGHT || 'C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../dist');
const out = path.resolve(__dirname, '../.local/qa');
const key = 'gre-reading-studio-progress-v1';
const report = { checks: [], browserErrors: [], screenshots: [] };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404).end(); return; }
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Content-Length': stat.size });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(target).pipe(res);
  });
});
async function checkWidth(page, label) {
  const value = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')].filter(e => {
      const r=e.getBoundingClientRect(); return r.width>0 && (r.right>innerWidth+1 || r.left < -1);
    }).slice(0,10).map(e=>({tag:e.tagName,classes:e.className,text:e.textContent.slice(0,50)}))
  }));
  assert.ok(value.document <= value.viewport+1, `${label}: ${JSON.stringify(value)}`);
  report.checks.push({check:label+' horizontal layout',passed:true,...value});
}
async function capture(page, label, fullPage=true) {
  await checkWidth(page,label);
  const file=path.join(out,label+'.png');
  await page.screenshot({path:file,fullPage,animations:'disabled'});
  report.screenshots.push(file);
}
async function openTarget(page, predicate) {
  const picked=await page.evaluate(({key,predicate})=>{
    const match=new Function('p','q',`return ${predicate}`);
    for(const p of GRE_READING_DATA.passages){
      const qi=p.questions.findIndex(q=>match(p,q));
      if(qi<0)continue;
      const state={version:1,questions:{},bookmarks:[],notes:{},history:[],session:{ids:[p.id],index:0,questionIndex:qi,startedAt:Date.now(),endedAt:null,limitMinutes:0,answers:{},drafts:{}}};
      localStorage.setItem(key,JSON.stringify(state));return {pid:p.id,qid:p.questions[qi].id,answer:p.questions[qi].answer};
    }
    return null;
  },{key,predicate});
  assert.ok(picked,'Target fixture exists: '+predicate);
  await page.reload();
  await page.locator('#resume').click();
  await page.locator('.question-stem').waitFor();
  return picked;
}
(async()=>{
  let browser;
  fs.mkdirSync(out,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/`;
  try {
    browser=await chromium.launch({headless:true,executablePath:process.env.GRE_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    for(const [name,viewport] of [['desktop',{width:1440,height:960}],['mobile',{width:390,height:844}]]){
      const context=await browser.newContext({viewport,timezoneId:'Asia/Shanghai'});
      const page=await context.newPage();page.on('pageerror',e=>report.browserErrors.push(e.message));
      await page.goto(url);await page.locator('.reading-card').first().waitFor();
      await capture(page,name+'-library');
      const picked=await openTarget(page,"p.sourceIds.includes('gold40') && q.gradable && q.kind==='single' && q.references.some(r=>r.questionId==='gold40-p003-q01')");
      await capture(page,name+'-study');
      await page.locator(`[data-option="${picked.answer[0]}"]`).click();
      await page.locator('[data-action="submit"]').click();
      await page.locator('.feedback').waitFor();
      await capture(page,name+'-answer');
      await page.locator('[data-view="sources"]').first().click();
      await capture(page,name+'-sources',false);
      const links=await page.locator('.source-list a[href], .doc-list a[href]').evaluateAll(anchors=>anchors.map(a=>({href:a.getAttribute('href'),text:a.textContent.trim()})));
      assert.ok(links.length>=8);
      for(const link of links){
        assert.match(link.href,/^sources\/[a-zA-Z0-9._/-]+\.pdf#page=[1-9]\d*$/);
        const response=await context.request.head(new URL(link.href,url).href);
        assert.equal(response.status(),200,link.text);
        assert.match(response.headers()['content-type'],/application\/pdf/);
        assert.ok(Number(response.headers()['content-length'])>1000,link.text);
      }
      report.checks.push({check:name+' source PDF browser URLs',passed:true,links:links.length});
      await page.locator('[data-view="progress"]').first().click();
      await capture(page,name+'-progress');
      await context.close();
    }
    const context=await browser.newContext({viewport:{width:1440,height:960},timezoneId:'Asia/Shanghai'});
    const page=await context.newPage();page.on('pageerror',e=>report.browserErrors.push(e.message));
    await page.goto(pathToFileURL(path.join(root,'index.html')).href);
    await page.locator('.reading-card').first().waitFor();
    await page.locator('[data-open]').first().click();
    await page.locator('[data-option]').first().click();
    await page.locator('[data-action="submit"]').click();
    const before=await page.evaluate(key=>localStorage.getItem(key),key);
    assert.ok(before&&JSON.parse(before).history.length===1);
    await page.reload();await page.locator('#resume').click();
    assert.equal(await page.locator('.feedback').count(),1);
    const after=await page.evaluate(key=>localStorage.getItem(key),key);
    assert.equal(after,before,'file:// reload must not duplicate submitted answer');
    const href=await page.locator('.original-links a').first().getAttribute('href');
    assert.ok(fs.existsSync(path.resolve(root,href.split('#')[0])));
    report.checks.push({check:'file:// opening, scoring, persistence, resume and relative PDF link',passed:true});
    await capture(page,'local-file-study',false);await context.close();
    assert.deepEqual(report.browserErrors,[]);
    report.checks.push({check:'No browser page errors',passed:true});
  } catch(error){
    report.failure=error.stack;process.exitCode=1;
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
    fs.writeFileSync(path.join(out,'visual-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({checks:report.checks.map(c=>c.check),screenshots:report.screenshots.length,browserErrors:report.browserErrors,failure:report.failure},null,2));
  }
})();
