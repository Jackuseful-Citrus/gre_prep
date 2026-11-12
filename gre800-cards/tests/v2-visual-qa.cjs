/* Capture deterministic desktop/mobile acceptance artifacts after animations settle. */
const { chromium } = require(process.env.GRE_PLAYWRIGHT || 'C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const trendOnly = process.argv.includes('--trend-only');
const root = path.resolve(__dirname, '../dist');
const out = process.env.GRE_QA_OUTPUT || 'C:/Temp/gre800-v2-qa';
const key = 'gre800-word-studio-v1';
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[path.extname(target)] || 'application/octet-stream');
    res.end(data);
  });
});
(async () => {
  let browser;
  try {
    fs.mkdirSync(out, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, executablePath: process.env.GRE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 375, height: 812 }]]) {
      const context = await browser.newContext({ viewport, timezoneId: 'Asia/Shanghai' });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      if (trendOnly) {
        await page.locator('[data-confidence="unknown"]').click();
        await page.locator('[data-action="next"]').click();
        await page.locator('[data-confidence="known"]').click();
        const correct = await page.evaluate(key => {
          const state = JSON.parse(localStorage.getItem(key));
          return state.basic.queue[state.basic.index];
        }, key);
        await page.locator(`[data-option="${correct}"]`).click();
        await page.locator('[data-nav="progress"]').click();
        const checks = await page.evaluate(() => [...document.querySelectorAll('.trend-chart')].map(chart => {
          const bounds = chart.getBoundingClientRect();
          const last = chart.lastElementChild;
          const day = last.getBoundingClientRect();
          return { today: GREProgress.dateKey(Date.now()), date: last.title.split('：')[0], scroll: chart.scrollLeft,
            maximum: chart.scrollWidth - chart.clientWidth, chartLeft: bounds.left, chartRight: bounds.right,
            dayLeft: day.left, dayRight: day.right, value: last.querySelector('.bar-value').textContent };
        }));
        assert.equal(checks.length, 2);
        for (const check of checks) {
          assert.equal(check.date, check.today, `${name}: last column is today`);
          assert.ok(Math.abs(check.scroll - check.maximum) <= 1, `${name}: chart opens at newest edge`);
          assert.ok(check.dayLeft >= check.chartLeft - 1 && check.dayRight <= check.chartRight + 1, `${name}: today is entirely visible`);
        }
        assert.equal(checks[0].value, '2');
        assert.equal(checks[1].value, '50');
        await page.screenshot({ path: path.join(out, `${name}-progress.png`), fullPage: true, animations: 'disabled' });
        console.log(`PASS ${name} ${viewport.width}px: both charts open at newest edge, today is fully visible with 2 attempts / 50% accuracy`);
        await context.close();
        continue;
      }
      await page.evaluate(key => {
        const state = JSON.parse(localStorage.getItem(key));
        const index = state.basic.queue.indexOf('4');
        [state.basic.queue[0], state.basic.queue[index]] = [state.basic.queue[index], state.basic.queue[0]];
        localStorage.setItem(key, JSON.stringify(state));
      }, key);
      await page.reload();
      if (name === 'mobile') await page.screenshot({ path: path.join(out, 'mobile-navigation.png'), animations: 'disabled' });
      await page.locator('[data-confidence="unknown"]').click();
      await page.screenshot({ path: path.join(out, `${name}-full-entry.png`), fullPage: true, animations: 'disabled' });
      await page.locator('[data-nav="synonyms"]').click();
      await page.locator('#training-mode').selectOption('syn-odd');
      await page.locator('#training-count').fill('3');
      await page.locator('#training-form [type="submit"]').click();
      await page.locator('[data-confidence="known"]').click();
      await page.screenshot({ path: path.join(out, `${name}-synonym-choices.png`), fullPage: true, animations: 'disabled' });
      const correct = await page.evaluate(key => {
        const state = JSON.parse(localStorage.getItem(key));
        return state.training.questions[state.training.index].correctId;
      }, key);
      await page.locator(`[data-option="${correct}"]`).click();
      await page.screenshot({ path: path.join(out, `${name}-synonym-answer.png`), fullPage: true, animations: 'disabled' });
      await page.locator('[data-nav="progress"]').click();
      await page.screenshot({ path: path.join(out, `${name}-progress.png`), fullPage: true, animations: 'disabled' });
      await context.close();
    }
    console.log(`Visual artifacts saved to ${out}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
