/* Standalone browser acceptance tests. No production server or browser is left running. */
const { chromium } = require(process.env.GRE_PLAYWRIGHT || 'C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../dist');
const outDir = process.env.GRE_QA_OUTPUT || 'C:/Temp/gre800-v2-qa';
const words = require('../dist/words.json').map(word => ({ ...word, id: String(word.id) }));
const byId = new Map(words.map(word => [word.id, word]));
const L = require('../dist/logic.js');
const KEY = 'gre800-word-studio-v1';
const results = [];
const errors = [];
const state = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }); res.end(data);
  });
});

function legacyFixture() {
  const now = Date.now() - 86400000;
  return {
    version: 1,
    records: {
      1: { attempts: 9, correct: 7, status: 'mastered', confidence: 'known', lastCorrect: true, updatedAt: now },
      2: { attempts: 3, correct: 1, status: 'review', confidence: 'unknown', lastCorrect: false, updatedAt: now },
      3: { attempts: 2, correct: 2, status: 'review', confidence: 'unsure', lastCorrect: true, updatedAt: now },
    },
    history: [{ total: 20, correct: 14, finishedAt: now - 120000 }],
    basic: { queue: ['4', '3', '1', '2'], index: 0, answers: [], stage: 'prompt', confidence: null, options: [], startedAt: now },
    test: {
      queue: ['1', '2', '4'], index: 1,
      answers: [{ id: '1', confidence: 'unknown', selected: null, correct: false }],
      stage: 'choices', confidence: 'unsure', options: L.makeOptions(byId.get('2'), words), startedAt: now,
    },
    view: 'test', reviewOnly: false,
  };
}

async function noOverflow(page, label) {
  const dims = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(element => element.className) }));
  assert.ok(dims.scroll <= dims.width, `${label}: ${JSON.stringify(dims)}`);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.GRE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const fresh = async ({ fixture, viewport = { width: 1440, height: 1000 } } = {}) => {
      const context = await browser.newContext({ viewport, acceptDownloads: true });
      if (fixture) await context.addInitScript(({ key, saved }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
      }, { key: KEY, saved: fixture });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url);
      await page.locator('#app .page-title').waitFor();
      return page;
    };
    const run = async (label, task) => {
      try { await task(); results.push(`PASS ${label}`); }
      catch (error) { results.push(`FAIL ${label}\n${error.stack}`); process.exitCode = 1; }
    };
    const correctChoice = async page => {
      const saved = await state(page), session = ['recall', 'synonyms'].includes(saved.view) ? saved.training : saved[saved.view];
      const id = session.mode?.startsWith('syn-') ? session.questions[session.index].correctId : session.queue[session.index];
      await page.locator(`[data-option="${id}"]`).click();
      return id;
    };
    const expandEntry = async page => {
      const details = page.locator('.entry-details details');
      for (let i = 0; i < await details.count(); i++) {
        const detail = details.nth(i);
        if (!await detail.evaluate(element => element.open)) await detail.locator('summary').first().click();
      }
    };

    await run('v1 migration preserves counts, history and both unfinished sessions at the original storage key', async () => {
      const fixture = legacyFixture();
      const page = await fresh({ fixture });
      let saved = await state(page);
      assert.equal(saved.version, 2);
      assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(`${key}-backup-v1`)), KEY), fixture);
      for (const [id, record] of Object.entries(fixture.records)) {
        for (const [key, value] of Object.entries(record)) assert.equal(saved.records[id][key], value, `${id}.${key}`);
      }
      assert.deepEqual(saved.history, fixture.history);
      assert.deepEqual(saved.basic.queue, fixture.basic.queue);
      assert.equal(saved.basic.stage, 'prompt');
      assert.deepEqual(saved.test.queue, fixture.test.queue);
      assert.equal(saved.test.index, fixture.test.index);
      assert.equal(saved.test.stage, 'choices');
      assert.deepEqual(saved.test.answers, fixture.test.answers);
      assert.equal(await page.locator('[data-option]').count(), 4);
      await page.reload();
      assert.equal((await state(page)).records['2'].attempts, 3);
      await correctChoice(page);
      saved = await state(page);
      assert.equal(saved.records['2'].attempts, 4);
      assert.equal(saved.records['2'].correct, 2);
      assert.equal(saved.records['2'].status, 'review');
      assert.ok(Number.isFinite(saved.records['2'].nextReviewAt));
      await page.reload();
      assert.equal((await state(page)).records['2'].attempts, 4);
      await page.locator('[data-action="next"]').click();
      await page.locator('[data-confidence="unknown"]').click();
      await page.locator('[data-action="next"]').click();
      saved = await state(page);
      assert.equal(saved.test.stage, 'done');
      assert.equal(saved.test.answers.filter(answer => answer.correct).length, 1);
      assert.ok(saved.history.some(history => history.finishedAt === fixture.history[0].finishedAt));
      await page.locator('[data-nav="basic"]').click();
      assert.equal((await state(page)).basic.queue[0], '4');
      await page.context().close();
    });

    await run('all meanings, English definitions, examples, synonyms and derivatives remain visible on answer', async () => {
      const fixture = legacyFixture(); fixture.view = 'basic';
      const page = await fresh({ fixture });
      assert.equal(await page.locator('.answer-panel').count(), 0);
      await page.locator('[data-confidence="unknown"]').click();
      await expandEntry(page);
      let text = await page.locator('#app').innerText();
      for (const definition of byId.get('4').definitions) {
        for (const field of ['meaning', 'english', 'example', 'synonyms']) {
          if (definition[field]) assert.ok(text.includes(definition[field]), `discursive ${field}: ${definition[field]}`);
        }
      }
      const details = page.locator('.entry-details details').first();
      assert.ok(await details.count(), 'entry has an interactive expansion control');
      await details.locator('summary').first().click();
      assert.equal(await details.evaluate(element => element.open), false);
      await details.locator('summary').first().click();
      assert.equal(await details.evaluate(element => element.open), true);
      await page.screenshot({ path: path.join(outDir, 'desktop-full-entry.png'), fullPage: true });
      // Due-word prioritization may reorder the rest of a basic round. Use an
      // independent fixture for the derivative field instead of assuming next.
      const derivativeFixture = legacyFixture(); derivativeFixture.view = 'basic';
      derivativeFixture.basic.queue = ['3', '4', '1', '2'];
      const derivativePage = await fresh({ fixture: derivativeFixture });
      await derivativePage.locator('[data-confidence="unknown"]').click();
      await expandEntry(derivativePage);
      text = await derivativePage.locator('#app').innerText();
      assert.ok(text.includes(byId.get('3').definitions[0].derivatives));
      await derivativePage.context().close();
      await page.context().close();
    });

    await run('baseline known/unsure/unknown flow and uncertainty review status survive refresh', async () => {
      const page = await fresh();
      assert.equal(await page.locator('[data-confidence]').count(), 3);
      const initial = await state(page);
      assert.equal(initial.basic.queue.length, 800);
      assert.equal(new Set(initial.basic.queue).size, 800);
      await page.locator('[data-confidence="known"]').click();
      assert.equal(await page.locator('[data-option]').count(), 4);
      const id = await correctChoice(page);
      let saved = await state(page);
      assert.equal(saved.records[id].attempts, 1);
      assert.equal(saved.records[id].correct, 1);
      const answer = saved.basic;
      await page.reload(); assert.deepEqual((await state(page)).basic, answer);
      await page.locator('[data-action="next"]').click();
      await page.locator('[data-confidence="unsure"]').click();
      const uncertain = await correctChoice(page);
      assert.equal((await state(page)).records[uncertain].status, 'review');
      await page.locator('[data-action="next"]').click();
      await page.locator('[data-confidence="unknown"]').click();
      assert.equal(await page.locator('[data-option]').count(), 0);
      assert.ok(await page.locator('.entry-details').count());
      saved = await state(page);
      assert.equal(saved.basic.answers.at(-1).correct, false);
      await page.context().close();
    });

    for (const mode of ['cn-en', 'def-en', 'syn-word', 'syn-cn', 'syn-odd']) {
      await run(`${mode} has playable known/unsure/unknown flow, original-vocabulary options and persistence`, async () => {
        const page = await fresh();
        await page.locator(`[data-nav="${mode.startsWith('syn-') ? 'synonyms' : 'recall'}"]`).click();
        await page.locator('#training-mode').selectOption(mode);
        await page.locator('#training-count').fill('3');
        await page.locator('#training-form [type="submit"]').click();
        let saved = await state(page), session = saved.training;
        assert.equal(session.mode, mode);
        assert.equal(session.queue.length, 3);
        assert.equal(new Set(session.queue).size, 3);
        assert.equal(await page.locator('.entry-details,.answer-panel').count(), 0);
        if (['cn-en', 'def-en', 'syn-cn'].includes(mode)) {
          const prompt = await page.locator('.study-card').innerText();
          assert.ok(!new RegExp(`\\b${byId.get(session.queue[0]).word}\\b`, 'i').test(prompt), 'prompt does not expose the source word');
          assert.equal(await page.locator('[data-action="pronounce"]').count(), 0);
        }
        const sourceId = session.queue[0];
        await page.locator('[data-confidence="known"]').click();
        assert.equal(await page.locator('[data-option]').count(), 4);
        saved = await state(page); session = saved.training;
        assert.ok(session.options.every(option => byId.has(option.id) && option.meaning === byId.get(option.id).word));
        await page.reload(); assert.deepEqual((await state(page)).training, session);
        await correctChoice(page);
        assert.equal((await state(page)).records[sourceId].correct, 1);
        assert.ok(await page.locator('.entry-details').count());
        if (mode.startsWith('syn-')) assert.match(await page.locator('#app').innerText(), /原表近义词|原词表/);
        await page.locator('[data-action="next"]').click();
        const uncertainId = (await state(page)).training.queue[1];
        await page.locator('[data-confidence="unsure"]').click();
        await correctChoice(page);
        saved = await state(page);
        assert.equal(saved.records[uncertainId].status, 'review');
        assert.equal(saved.records[uncertainId].confirmedStreak, 0);
        assert.ok(saved.records[uncertainId].nextReviewAt <= Date.now() + 31 * 60000);
        await page.locator('[data-action="next"]').click();
        await page.locator('[data-confidence="unknown"]').click();
        assert.equal(await page.locator('[data-option]').count(), 0);
        await page.locator('[data-action="next"]').click();
        saved = await state(page);
        assert.equal(saved.training.stage, 'done');
        assert.equal(saved.training.answers.filter(answer => answer.correct).length, 2);
        assert.equal(Object.values(saved.daily).reduce((sum, day) => sum + day.attempts, 0), 3);
        await page.reload(); assert.equal((await state(page)).training.stage, 'done');
        await page.context().close();
      });
    }

    await run('analytics show eight Lists, stable/review/unseen counts, forgetful words and real daily trends', async () => {
      const P = require('../dist/progress.js'), now = Date.now();
      const fixture = P.migrateState(legacyFixture(), words, now);
      fixture.basic = null; fixture.test = null; fixture.view = 'basic';
      fixture.records['1'].nextReviewAt = now - 60000;
      fixture.records['2'].nextReviewAt = now - 120000;
      let stable;
      for (let i = 0; i < 3; i++) stable = P.recordAnswer(stable, 'known', true, now - 10000 + i);
      fixture.records['3'] = stable;
      fixture.daily = P.recordDaily(P.recordDaily({}, '1', true, now), '2', false, now);
      const page = await fresh({ fixture });
      assert.deepEqual((await state(page)).basic.queue.slice(0, 2), ['2', '1']);
      await page.locator('[data-nav="progress"]').click();
      assert.equal(await page.locator('.list-card').count(), 8);
      const overview = await page.locator('.overview-card').first().innerText();
      assert.match(overview, /稳定掌握\s*1/);
      assert.match(overview, /待复习\s*2/);
      assert.match(overview, /未学习\s*797/);
      assert.equal(await page.locator('.trend-panel').count(), 2);
      await page.locator('.data-table-details summary').click();
      assert.equal(await page.locator('.data-table-details tbody tr').count(), 14);
      assert.match(await page.locator('.data-table-details tbody tr').last().innerText(), /2\s+2\s+1\s+50%/);
      assert.ok(await page.locator('[data-study-word="2"]').count());
      const date = new Date(now + 2 * 86400000);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      await page.locator('#exam-date').fill(value);
      await page.locator('#exam-date-form [type="submit"]').click();
      assert.equal((await state(page)).settings.examDate, value);
      const compressed = await page.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem('gre800-word-studio-v1'));
        return GREProgress.reviewAt(saved.records['3'], saved.settings, Date.now());
      });
      assert.ok(compressed < stable.nextReviewAt);
      await page.locator('[data-action="review-due"]').click();
      assert.deepEqual((await state(page)).basic.queue, ['2', '1']);
      await page.context().close();
    });

    await run('export/import roundtrip is previewed, idempotent and safe on malformed files or storage failure', async () => {
      const fixture = legacyFixture(); fixture.view = 'progress';
      const source = await fresh({ fixture });
      await source.locator('[data-nav="recall"]').click();
      await source.locator('#training-mode').selectOption('def-en');
      await source.locator('#training-count').fill('3');
      await source.locator('#training-form [type="submit"]').click();
      await source.locator('[data-confidence="unsure"]').click();
      const unfinishedTraining = (await state(source)).training;
      await source.locator('[data-nav="progress"]').click();
      const exported = source.waitForEvent('download');
      await source.locator('[data-action="export-progress"]').click();
      const download = await exported;
      const exportPath = path.join(outDir, 'export-progress.json'); await download.saveAs(exportPath);
      const payload = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
      assert.equal(payload.format, 'gre800-progress');
      assert.equal(payload.state.records['1'].attempts, 9);
      const page = await fresh(); await page.locator('[data-nav="progress"]').click();
      const originalSession = (await state(page)).basic;
      const importFile = async file => {
        await page.locator('#progress-file').setInputFiles(file);
        await page.locator('[data-action="confirm-import"]').waitFor();
      };
      await importFile(exportPath);
      assert.equal(Object.keys((await state(page)).records).length, 0, 'preview does not mutate progress');
      await page.locator('[data-action="confirm-import"]').click();
      let saved = await state(page);
      assert.equal(saved.records['1'].attempts, 9); assert.equal(saved.records['1'].correct, 7);
      assert.equal(saved.history.length, 1); assert.deepEqual(saved.basic, originalSession);
      assert.deepEqual(saved.test, payload.state.test, 'an imported test fills an empty local test slot');
      assert.deepEqual(saved.training, unfinishedTraining, 'an imported practice fills an empty local training slot');
      await page.locator('[data-nav="recall"]').click();
      assert.equal(await page.locator('[data-option]').count(), 4);
      assert.deepEqual((await state(page)).training, unfinishedTraining);
      await page.locator('[data-nav="progress"]').click();
      const recordsBefore = JSON.stringify(saved.records), historyBefore = JSON.stringify(saved.history);
      await importFile(exportPath); await page.locator('[data-action="confirm-import"]').click();
      saved = await state(page); assert.equal(JSON.stringify(saved.records), recordsBefore); assert.equal(JSON.stringify(saved.history), historyBefore);
      const beforeInvalid = await page.evaluate(key => localStorage.getItem(key), KEY);
      await page.locator('#progress-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), beforeInvalid);
      assert.equal(await page.locator('[data-action="confirm-import"]').count(), 0);
      const changed = structuredClone(payload); changed.state.records['1'].attempts += 50;
      await importFile({ name: 'newer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed)) });
      await page.evaluate(key => {
        const original = Storage.prototype.setItem;
        window.qaRestoreStorage = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException('Quota', 'QuotaExceededError'); return original.call(this, name, value); };
      }, KEY);
      await page.locator('[data-action="confirm-import"]').click();
      assert.equal((await state(page)).records['1'].attempts, 9);
      await page.evaluate(() => window.qaRestoreStorage());
      if (await page.locator('[data-action="cancel-import"]').count()) await page.locator('[data-action="cancel-import"]').click();
      await page.locator('[data-nav="basic"]').click(); await page.locator('[data-nav="progress"]').click();
      assert.equal((await state(page)).records['1'].attempts, 9, 'in-memory state was not replaced on failed write');
      await source.context().close(); await page.context().close();
    });

    await run('quality annotations and separate TC/SE/RC placeholders are available without fabricated questions', async () => {
      const page = await fresh(); await page.locator('[data-nav="quality"]').click();
      assert.ok(await page.locator('.quality-item').count());
      assert.match(await page.locator('#app').innerText(), /释义疑点/);
      assert.match(await page.locator('#app').innerText(), /近义词疑点/);
      await page.locator('[data-nav="exam"]').click();
      for (const module of ['TC', 'SE', 'RC']) {
        await page.locator(`[data-exam-module="${module}"]`).click();
        assert.match(await page.locator('.exam-placeholder').innerText(), /当前题库为空/);
        assert.equal(await page.locator('[data-option]').count(), 0);
        assert.equal(await page.locator(`[data-exam-module="${module}"]`).getAttribute('aria-pressed'), 'true');
      }
      await page.context().close();
    });

    await run('375px phone layout fits complete entry, analytics, training, quality and GRE modules', async () => {
      const fixture = legacyFixture(); fixture.view = 'basic';
      const page = await fresh({ fixture, viewport: { width: 375, height: 812 } });
      await noOverflow(page, 'mobile prompt');
      await page.locator('[data-confidence="unknown"]').click(); await expandEntry(page);
      await noOverflow(page, 'mobile complete entry');
      await page.screenshot({ path: path.join(outDir, 'mobile-full-entry.png'), fullPage: true });
      for (const nav of ['progress', 'recall', 'synonyms', 'quality', 'exam']) {
        await page.locator(`[data-nav="${nav}"]`).click(); await noOverflow(page, `mobile ${nav}`);
        if (nav === 'progress') await page.screenshot({ path: path.join(outDir, 'mobile-progress.png'), fullPage: true });
      }
      await page.context().close();
    });

    await run('browser runtime has no uncaught errors', async () => assert.deepEqual(errors, []));
  } catch (error) {
    results.push(`FAIL test harness\n${error.stack}`); process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(outDir, 'results.txt'), results.join('\n') + '\n');
    console.log(results.join('\n'));
  }
})();
