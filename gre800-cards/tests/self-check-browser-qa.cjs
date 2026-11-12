/* Self-check, correction and review acceptance tests; isolated browser data, offline file URL. */
const { chromium } = require(process.env.GRE_PLAYWRIGHT || 'C:/Temp/gre800-browser-qa/node_modules/playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

const url = pathToFileURL(path.resolve(__dirname, '../dist/index.html')).href;
const outDir = process.env.GRE_SELF_QA_OUTPUT || 'C:/Temp/gre800-self-check-qa';
const words = require('../dist/words.json').map(word => ({ ...word, id: String(word.id) }));
const byId = new Map(words.map(word => [word.id, word]));
const KEY = 'gre800-word-studio-v1';
const results = [], errors = [], requests = [];
const read = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
const scores = state => ({ records: state.records, daily: state.daily, history: state.history });
const activeIds = state => Object.entries(state.specialList).filter(([, row]) => row.active).map(([id]) => id).sort();
const selfSession = queue => ({ queue, index: 0, answers: [], stage: 'prompt', startedAt: Date.now() });
const fixture = values => ({ version: 2, records: {}, daily: {}, history: [], view: 'self-check', ...values });

async function noOverflow(page, label) {
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.width, `${label}: ${JSON.stringify(size)}`);
}

async function screenshot(page, name) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: path.join(outDir, name), fullPage: true, animations: 'disabled' });
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.GRE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const fresh = async ({ saved, viewport = { width: 1440, height: 1000 } } = {}) => {
      const context = await browser.newContext({ viewport, acceptDownloads: true, offline: true, reducedMotion: 'reduce' });
      if (saved) await context.addInitScript(({ key, value }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
      }, { key: KEY, value: saved });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
      await page.goto(url);
      await page.locator('#app .page-title').waitFor();
      return page;
    };
    const run = async (label, task) => {
      try { await task(); results.push(`PASS ${label}`); }
      catch (error) { results.push(`FAIL ${label}\n${error.stack}`); process.exitCode = 1; }
    };

    await run('known reveals without adding; unknown reveals and automatically adds once, with manual removal retained', async () => {
      const page = await fresh();
      const before = scores(await read(page));
      await page.locator('[data-nav="self-check"]').click();
      let saved = await read(page);
      assert.equal(saved.selfCheck.queue.length, 800);
      assert.equal(new Set(saved.selfCheck.queue).size, 800);
      assert.equal(await page.locator('[data-action="self-back"]').isDisabled(), true);
      const firstId = saved.selfCheck.queue[0];
      assert.equal(await page.locator('.entry-details').count(), 0);
      assert.equal(await page.locator('[data-self-confidence]').count(), 2);
      assert.ok(!(await page.locator('#app').innerText()).includes(byId.get(firstId).meaning));
      await page.locator('[data-self-confidence="known"]').click();
      await page.locator('.entry-details').waitFor();
      assert.equal(await page.locator('[data-option]').count(), 0);
      saved = await read(page);
      assert.deepEqual(saved.selfCheck.answers, [{ id: firstId, confidence: 'known' }]);
      assert.deepEqual(activeIds(saved), []);
      assert.deepEqual(scores(saved), before);
      assert.ok((await page.locator('.entry-details').innerText()).includes(byId.get(firstId).definitions[0].meaning));
      await page.locator('[data-action="toggle-special"]').click();
      assert.deepEqual(activeIds(await read(page)), [firstId]);
      await screenshot(page, 'desktop-answer.png');
      const answer = (await read(page)).selfCheck;
      await page.reload();
      assert.deepEqual((await read(page)).selfCheck, answer);
      assert.deepEqual(activeIds(await read(page)), [firstId]);
      await page.locator('[data-nav="basic"]').click();
      await page.locator('[data-nav="self-check"]').click();
      assert.deepEqual((await read(page)).selfCheck, answer);
      await page.locator('[data-action="toggle-special"]').click();
      saved = await read(page);
      assert.deepEqual(activeIds(saved), []);
      assert.equal(saved.specialList[firstId].active, false);
      await page.locator('[data-action="self-next"]').click();
      saved = await read(page);
      const secondId = saved.selfCheck.queue[saved.selfCheck.index];
      assert.notEqual(secondId, firstId);
      assert.equal(saved.selfCheck.stage, 'prompt');
      assert.equal(await page.locator('.entry-details').count(), 0);
      await page.locator('[data-self-confidence="unknown"]').click();
      await page.locator('.entry-details').waitFor();
      saved = await read(page);
      assert.equal(saved.selfCheck.answers.at(-1).confidence, 'unknown');
      assert.equal(await page.locator('[data-option]').count(), 0);
      assert.deepEqual(activeIds(saved), [secondId]);
      assert.equal(saved.selfCheck.answers.at(-1).autoSpecialAt, saved.specialList[secondId].updatedAt);
      assert.equal(await page.locator('[data-self-confidence="unknown"]').isDisabled(), true);
      assert.equal(await page.locator('[data-self-confidence="unknown"]').getAttribute('aria-pressed'), 'true');
      const originalEntry = saved.specialList[secondId];
      await page.keyboard.press('2');
      assert.deepEqual((await read(page)).specialList[secondId], originalEntry);
      assert.deepEqual(scores(saved), before);
      await page.locator('[data-action="toggle-special"]').click();
      assert.deepEqual(activeIds(await read(page)), []);
      await page.keyboard.press('2');
      assert.deepEqual(activeIds(await read(page)), []);
      await page.reload();
      assert.equal((await read(page)).selfCheck.answers.at(-1).confidence, 'unknown');
      assert.deepEqual(activeIds(await read(page)), []);
      await page.locator('[data-action="self-back"]').click();
      await page.locator('[data-action="self-next"]').click();
      assert.deepEqual(activeIds(await read(page)), []);
      await page.context().close();
    });

    await run('keyboard reveal, correction, S toggle, ArrowLeft and Space preserve list choices and answers', async () => {
      const page = await fresh({ saved: fixture({ selfCheck: selfSession(['1', '2', '3']) }) });
      await page.keyboard.press('ArrowLeft');
      assert.equal((await read(page)).selfCheck.index, 0);
      assert.equal((await read(page)).selfCheck.stage, 'prompt');
      await page.keyboard.press('1');
      assert.equal((await read(page)).selfCheck.stage, 'answer');
      assert.equal((await read(page)).selfCheck.answers[0].confidence, 'known');
      await page.keyboard.press('s');
      assert.deepEqual(activeIds(await read(page)), ['1']);
      await page.keyboard.press('Space');
      let saved = await read(page);
      assert.equal(saved.selfCheck.index, 1);
      assert.equal(saved.selfCheck.stage, 'prompt');
      assert.deepEqual(activeIds(saved), ['1']);
      await page.keyboard.press('2');
      assert.equal((await read(page)).selfCheck.answers[1].confidence, 'unknown');
      assert.deepEqual(activeIds(await read(page)), ['1', '2']);
      await page.keyboard.press('s');
      assert.deepEqual(activeIds(await read(page)), ['1']);
      await page.keyboard.press('s');
      assert.deepEqual(activeIds(await read(page)), ['1', '2']);
      await page.keyboard.press('1');
      assert.equal((await read(page)).selfCheck.answers[1].confidence, 'known');
      assert.deepEqual(activeIds(await read(page)), ['1', '2'], 'correcting preserves a later manual re-add');
      await page.keyboard.press('s');
      await page.keyboard.press('Space');
      saved = await read(page);
      assert.equal(saved.selfCheck.index, 2);
      assert.equal(saved.selfCheck.stage, 'prompt');
      assert.deepEqual(activeIds(saved), ['1']);
      assert.equal(saved.specialList['2'].active, false);
      await page.keyboard.press('ArrowLeft');
      assert.equal((await read(page)).selfCheck.index, 1);
      assert.equal((await read(page)).selfCheck.stage, 'answer');
      await page.keyboard.press('ArrowLeft');
      assert.equal((await read(page)).selfCheck.index, 0);
      assert.equal((await read(page)).selfCheck.answers.length, 2);
      assert.equal(await page.locator('[data-action="self-back"]').isDisabled(), true);
      await page.context().close();
    });

    await run('correcting an accidental unknown removes only its own automatic addition', async () => {
      const page = await fresh({ saved: fixture({ selfCheck: selfSession(['1', '2']) }) });
      await page.locator('[data-self-confidence="unknown"]').click();
      assert.deepEqual(activeIds(await read(page)), ['1']);
      await page.locator('[data-self-confidence="known"]').click();
      let saved = await read(page);
      assert.equal(saved.selfCheck.answers[0].confidence, 'known');
      assert.equal(saved.selfCheck.answers[0].autoSpecialAt, undefined);
      assert.deepEqual(activeIds(saved), []);
      assert.equal(saved.specialList['1'].active, false);
      await page.locator('[data-action="toggle-special"]').click();
      const manuallyAdded = (await read(page)).specialList['1'];
      await page.locator('[data-self-confidence="unknown"]').click();
      saved = await read(page);
      assert.equal(saved.selfCheck.answers[0].autoSpecialAt, undefined);
      assert.equal(saved.specialList['1'].active, true);
      assert.ok(saved.specialList['1'].updatedAt > manuallyAdded.updatedAt);
      const reconfirmed = saved.specialList['1'];
      await page.locator('[data-self-confidence="known"]').click();
      assert.deepEqual((await read(page)).specialList['1'], reconfirmed);
      await page.context().close();

      const existing = { active: true, updatedAt: Date.now() - 1000 };
      const preselected = await fresh({ saved: fixture({ selfCheck: selfSession(['1']), specialList: { 1: existing } }) });
      await preselected.locator('[data-self-confidence="unknown"]').click();
      assert.equal((await read(preselected)).selfCheck.answers[0].autoSpecialAt, undefined);
      const existingReconfirmed = (await read(preselected)).specialList['1'];
      assert.equal(existingReconfirmed.active, true);
      assert.ok(existingReconfirmed.updatedAt > existing.updatedAt);
      await preselected.locator('[data-self-confidence="known"]').click();
      assert.deepEqual((await read(preselected)).specialList['1'], existingReconfirmed);
      await preselected.context().close();
    });

    await run('a later unknown in special review protects membership when correcting an older automatic addition', async () => {
      const page = await fresh({ saved: fixture({ selfCheck: selfSession(['1']) }) });
      await page.locator('[data-self-confidence="unknown"]').click();
      const autoSpecialAt = (await read(page)).selfCheck.answers[0].autoSpecialAt;
      await page.locator('[data-nav="special-review"]').click();
      await page.locator('[data-action="start-special-review"]').click();
      await page.locator('[data-self-confidence="unknown"]').click();
      let saved = await read(page);
      assert.equal(saved.specialReview.answers[0].autoSpecialAt, undefined);
      const laterEntry = saved.specialList['1'];
      assert.ok(laterEntry.updatedAt > autoSpecialAt);
      await page.locator('[data-nav="self-check"]').click();
      await page.locator('[data-self-confidence="known"]').click();
      saved = await read(page);
      assert.deepEqual(saved.specialList['1'], laterEntry);
      assert.equal(saved.selfCheck.answers[0].autoSpecialAt, undefined);
      await page.context().close();
    });

    await run('multiple Back and Next steps retain future answers and allow correcting an earlier word after refresh', async () => {
      const page = await fresh({ saved: fixture({ selfCheck: selfSession(['1', '2', '3', '4']) }) });
      for (const confidence of ['known', 'unknown', 'known']) {
        await page.locator(`[data-self-confidence="${confidence}"]`).click();
        await page.locator('[data-action="self-next"]').click();
      }
      let saved = await read(page);
      assert.equal(saved.selfCheck.index, 3);
      assert.equal(saved.selfCheck.stage, 'prompt');
      assert.equal(saved.selfCheck.answers.length, 3);
      const thirdAnswer = saved.selfCheck.answers[2];
      await page.locator('[data-action="self-back"]').click();
      assert.equal((await read(page)).selfCheck.index, 2);
      await page.locator('[data-action="self-back"]').click();
      const beforeRefresh = (await read(page)).selfCheck;
      await page.reload();
      assert.deepEqual((await read(page)).selfCheck, beforeRefresh);
      assert.equal(await page.locator('[data-self-confidence="unknown"]').isDisabled(), true);
      await page.locator('[data-self-confidence="known"]').click();
      saved = await read(page);
      assert.equal(saved.selfCheck.index, 1);
      assert.equal(saved.selfCheck.answers.length, 3);
      assert.deepEqual(saved.selfCheck.answers[2], thirdAnswer);
      assert.deepEqual(activeIds(saved), []);
      await page.locator('[data-action="self-back"]').click();
      assert.equal((await read(page)).selfCheck.index, 0);
      for (const index of [1, 2]) {
        await page.locator('[data-action="self-next"]').click();
        saved = await read(page);
        assert.equal(saved.selfCheck.index, index);
        assert.equal(saved.selfCheck.stage, 'answer');
        assert.equal(saved.selfCheck.answers.length, 3);
      }
      await page.locator('[data-action="self-next"]').click();
      saved = await read(page);
      assert.equal(saved.selfCheck.index, 3);
      assert.equal(saved.selfCheck.stage, 'prompt');
      assert.equal(await page.locator('.entry-details').count(), 0);
      assert.deepEqual(scores(saved), { records: {}, daily: {}, history: [] });
      await page.context().close();
    });

    await run('special list reviews only selected words, can resume, completes, and keeps words until manual removal', async () => {
      const now = Date.now();
      const page = await fresh({ saved: fixture({ view: 'special-review', specialList: { 1: { active: true, updatedAt: now }, 2: { active: true, updatedAt: now }, 3: { active: false, updatedAt: now } } }) });
      assert.equal(await page.locator('.special-review-row').count(), 2);
      assert.match(await page.locator('[data-special-count]').first().innerText(), /2/);
      await page.locator('[data-action="start-special-review"]').click();
      let saved = await read(page);
      assert.equal(saved.view, 'special-study');
      assert.deepEqual([...saved.specialReview.queue].sort(), ['1', '2']);
      const firstId = saved.specialReview.queue[0];
      await page.locator('[data-self-confidence="known"]').click();
      const answer = (await read(page)).specialReview;
      await page.locator('[data-action="special-list"]').click();
      await page.locator('[data-action="resume-special-review"]').click();
      assert.deepEqual((await read(page)).specialReview, answer);
      await page.reload();
      assert.deepEqual((await read(page)).specialReview, answer);
      await page.locator('[data-action="self-next"]').click();
      const secondId = (await read(page)).specialReview.queue[1];
      assert.notEqual(firstId, secondId);
      await page.locator('[data-self-confidence="unknown"]').click();
      await page.locator('[data-action="self-next"]').click();
      saved = await read(page);
      assert.equal(saved.specialReview.stage, 'done');
      assert.equal(saved.specialReview.answers.length, 2);
      assert.deepEqual(activeIds(saved), ['1', '2']);
      assert.deepEqual(scores(saved), { records: {}, daily: {}, history: [] });
      await page.locator('[data-nav="special-review"]').click();
      await page.locator('[data-remove-special="1"]').click();
      saved = await read(page);
      assert.deepEqual(activeIds(saved), ['2']);
      assert.equal(saved.specialList['1'].active, false);
      await page.reload();
      assert.equal(await page.locator('.special-review-row').count(), 1);
      await page.locator('[data-action="start-special-review"]').click();
      assert.deepEqual((await read(page)).specialReview.queue, ['2']);
      await page.locator('[data-self-confidence="known"]').click();
      await page.locator('[data-action="toggle-special"]').click();
      assert.deepEqual(activeIds(await read(page)), []);
      await page.locator('[data-action="self-next"]').click();
      assert.equal((await read(page)).specialReview.stage, 'done');
      await page.locator('[data-nav="special-review"]').click();
      assert.equal(await page.locator('.special-review-row').count(), 0);
      assert.equal(await page.locator('[data-action="start-special-review"]:not([disabled])').count(), 0);
      await page.context().close();
    });

    await run('completed rounds can return to the last answer, correct it, and finish again without duplicate answers', async () => {
      const page = await fresh({ saved: fixture({ selfCheck: selfSession(['1', '2']) }) });
      await page.locator('[data-self-confidence="known"]').click();
      await page.locator('[data-action="self-next"]').click();
      await page.locator('[data-self-confidence="unknown"]').click();
      await page.locator('[data-action="self-next"]').click();
      let saved = await read(page);
      assert.equal(saved.selfCheck.stage, 'done');
      assert.equal(saved.selfCheck.index, 2);
      assert.deepEqual(saved.selfCheck.answers.map(({ id, confidence }) => ({ id, confidence })), [{ id: '1', confidence: 'known' }, { id: '2', confidence: 'unknown' }]);
      assert.deepEqual(activeIds(saved), ['2']);
      assert.deepEqual(scores(saved), { records: {}, daily: {}, history: [] });
      await page.reload();
      saved = await read(page);
      assert.equal(saved.selfCheck.stage, 'done');
      await page.locator('[data-action="self-back"]').click();
      saved = await read(page);
      assert.equal(saved.selfCheck.index, 1);
      assert.equal(saved.selfCheck.stage, 'answer');
      await page.locator('[data-self-confidence="known"]').click();
      assert.deepEqual(activeIds(await read(page)), []);
      await page.locator('[data-action="self-next"]').click();
      saved = await read(page);
      assert.equal(saved.selfCheck.stage, 'done');
      assert.deepEqual(saved.selfCheck.answers, [{ id: '1', confidence: 'known' }, { id: '2', confidence: 'known' }]);
      await page.context().close();
    });

    await run('special review can revisit removed answered words while skipping removed pending words', async () => {
      const now = Date.now();
      const page = await fresh({ saved: fixture({ view: 'special-study', specialReview: selfSession(['1', '2', '3']), specialList: { 1: { active: true, updatedAt: now }, 2: { active: true, updatedAt: now }, 3: { active: true, updatedAt: now } } }) });
      await page.locator('[data-self-confidence="known"]').click();
      await page.locator('[data-action="toggle-special"]').click();
      await page.locator('[data-action="self-next"]').click();
      await page.locator('[data-self-confidence="unknown"]').click();
      await page.locator('[data-action="self-next"]').click();
      await page.locator('[data-action="self-back"]').click();
      await page.locator('[data-action="self-back"]').click();
      let saved = await read(page);
      assert.equal(saved.specialReview.index, 0);
      assert.equal(saved.specialReview.stage, 'answer');
      assert.equal(saved.specialReview.answers.length, 2);
      assert.deepEqual(activeIds(saved), ['2', '3']);
      await page.reload();
      assert.equal((await read(page)).specialReview.index, 0);
      await page.locator('[data-action="special-list"]').click();
      await page.locator('[data-remove-special="3"]').click();
      await page.locator('[data-action="resume-special-review"]').click();
      saved = await read(page);
      assert.deepEqual(saved.specialReview.queue, ['1', '2']);
      assert.equal(saved.specialReview.index, 0);
      await page.locator('[data-action="self-next"]').click();
      assert.equal((await read(page)).specialReview.stage, 'answer');
      await page.locator('[data-action="self-next"]').click();
      assert.equal((await read(page)).specialReview.stage, 'done');
      await page.locator('[data-action="self-back"]').click();
      assert.equal((await read(page)).specialReview.index, 1);
      await page.locator('[data-self-confidence="known"]').click();
      assert.deepEqual(activeIds(await read(page)), ['2'], 'pre-existing list entry survives correcting a review answer');
      await page.context().close();
    });

    await run('JSON backup restores a backward cursor, retained future answers, auto-add metadata, and later removals', async () => {
      const now = Date.now();
      const source = await fresh({ saved: fixture({ selfCheck: selfSession(['1', '2', '3', '4']), specialReview: selfSession(['2']), specialList: { 2: { active: true, updatedAt: now }, 3: { active: false, updatedAt: now } } }) });
      await source.locator('[data-self-confidence="unknown"]').click();
      await source.locator('[data-action="self-next"]').click();
      await source.locator('[data-self-confidence="known"]').click();
      await source.locator('[data-action="self-next"]').click();
      await source.locator('[data-self-confidence="unknown"]').click();
      await source.locator('[data-action="self-back"]').click();
      assert.equal((await read(source)).selfCheck.index, 1);
      assert.equal((await read(source)).selfCheck.answers.length, 3);
      await source.locator('[data-nav="progress"]').click();
      const downloadEvent = source.waitForEvent('download');
      await source.locator('[data-action="export-progress"]').click();
      const download = await downloadEvent;
      const exportPath = path.join(outDir, 'self-check-progress.json');
      await download.saveAs(exportPath);
      const payload = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
      assert.deepEqual(activeIds(payload.state), ['1', '2', '3']);
      const page = await fresh();
      await page.locator('[data-nav="progress"]').click();
      const importBackup = async () => {
        await page.locator('#progress-file').setInputFiles(exportPath);
        await page.locator('[data-action="confirm-import"]').waitFor();
        await page.locator('[data-action="confirm-import"]').click();
      };
      await importBackup();
      let saved = await read(page);
      assert.deepEqual(saved.specialList, payload.state.specialList);
      assert.deepEqual(saved.selfCheck, payload.state.selfCheck);
      assert.deepEqual(saved.specialReview, payload.state.specialReview);
      await page.locator('[data-nav="self-check"]').click();
      await page.locator('.entry-details').waitFor();
      assert.equal((await read(page)).selfCheck.index, 1);
      assert.equal((await read(page)).selfCheck.answers.length, 3);
      await page.locator('[data-nav="special-review"]').click();
      await page.locator('[data-remove-special="2"]').click();
      const removal = (await read(page)).specialList['2'];
      await page.locator('[data-nav="progress"]').click();
      await importBackup();
      saved = await read(page);
      assert.deepEqual(saved.specialList['2'], removal);
      assert.deepEqual(activeIds(saved), ['1', '3']);
      await source.context().close();
      await page.context().close();
    });

    await run('320px mobile prompt, answer, special list, and selected-word practice fit the viewport', async () => {
      const page = await fresh({ viewport: { width: 320, height: 740 } });
      await page.locator('[data-nav="self-check"]').click();
      await noOverflow(page, 'self-check prompt');
      await page.locator('[data-self-confidence="unknown"]').click();
      await noOverflow(page, 'self-check answer');
      await screenshot(page, 'mobile-answer.png');
      await page.locator('[data-action="self-next"]').click();
      await page.locator('[data-action="self-back"]').click();
      await noOverflow(page, 'self-check back with correction controls');
      await page.locator('[data-nav="special-review"]').click();
      await noOverflow(page, 'special review list');
      await screenshot(page, 'mobile-special-list.png');
      await page.locator('[data-action="start-special-review"]').click();
      await noOverflow(page, 'special review prompt');
      await page.locator('[data-self-confidence="known"]').click();
      await noOverflow(page, 'special review answer');
      await page.locator('[data-action="self-next"]').click();
      await noOverflow(page, 'special review complete');
      await page.locator('[data-action="self-back"]').click();
      await noOverflow(page, 'special review back from complete');
      await page.context().close();
    });

    await run('basic mode keeps its multiple-choice verification and independent progress', async () => {
      const page = await fresh();
      assert.equal(await page.locator('[data-confidence]').count(), 3);
      const id = (await read(page)).basic.queue[0];
      await page.locator('[data-confidence="known"]').click();
      assert.equal(await page.locator('[data-option]').count(), 4);
      await page.locator(`[data-option="${id}"]`).click();
      let saved = await read(page);
      assert.equal(saved.records[id].correct, 1);
      const before = scores(saved);
      await page.locator('[data-nav="self-check"]').click();
      await page.locator('[data-self-confidence="unknown"]').click();
      saved = await read(page);
      assert.deepEqual(scores(saved), before);
      assert.deepEqual(activeIds(saved), [saved.selfCheck.queue[0]]);
      await page.context().close();
    });

    await run('offline browser has no uncaught runtime errors or remote requests', async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
    });
  } catch (error) {
    results.push(`FAIL harness\n${error.stack}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    fs.writeFileSync(path.join(outDir, 'results.txt'), results.join('\n') + '\n');
    console.log(results.join('\n'));
  }
})();
