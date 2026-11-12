const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const P = require('../dist/progress.js');
const vocabulary = require('../dist/words.json');
const words = vocabulary.slice(0, 8).map((word, index) => ({ ...word, group: index < 4 ? 1 : 2 }));
const NOW = new Date(2026, 10, 6, 12).getTime();
const copy = value => JSON.parse(JSON.stringify(value));
const v1Record = (override = {}) => ({ attempts: 10, correct: 8, status: 'mastered', confidence: 'known', lastCorrect: true, updatedAt: NOW - P.DAY, ...override });
const oldState = () => ({ version: 1, records: { 1: v1Record() }, history: [{ finishedAt: NOW - P.DAY, total: 3, correct: 2 }], basic: null, test: null, view: 'progress', reviewOnly: true });
const session = () => ({ queue: ['1', '2'], index: 0, answers: [], stage: 'prompt', confidence: null, options: [], startedAt: NOW });

test('migration preserves v1 counts, familiarities, sessions and extensions without invented streaks', () => {
  const original = oldState();
  original.basic = session(); original.test = session(); original.training = session();
  original.custom = { note: 'keep me' }; original.records[1].custom = 'word note';
  const before = copy(original);
  const state = P.migrateState(original, words, NOW);
  assert.equal(state.version, 2);
  for (const key of ['basic', 'test', 'training', 'history', 'view', 'reviewOnly', 'custom']) assert.deepEqual(state[key], original[key]);
  for (const key of ['attempts', 'correct', 'status', 'confidence', 'lastCorrect', 'updatedAt', 'custom']) assert.equal(state.records[1][key], original.records[1][key]);
  assert.equal(state.records[1].consecutiveCorrect, 0);
  assert.equal(state.records[1].confirmedStreak, 0);
  assert.equal(state.records[1].nextReviewAt, NOW);
  assert.equal(state.records[1].reviewCount, 9);
  assert.equal(state.records[1].lapseCount, 2);
  assert.equal(state.records[1].lastWrongAt, null);
  assert.deepEqual(state.daily, {});
  assert.equal(state.dailyStartedAt, NOW);
  assert.deepEqual(original, before);
  assert.deepEqual(P.migrateState(state, words, NOW + P.DAY), state);
});

test('migration retains a known latest wrong time but does not infer older wrong dates', () => {
  assert.equal(P.migrateRecord(v1Record({ lastCorrect: false, confidence: 'unknown', status: 'review' }), NOW).lastWrongAt, NOW - P.DAY);
  assert.equal(P.migrateRecord(v1Record(), NOW).lastWrongAt, null);
  assert.equal(P.migrateRecord(v1Record({ lastWrongAt: 0 }), NOW).lastWrongAt, 0);
});

test('normal review intervals follow 1, 3, 7, 14, 30 days and cap at 30', () => {
  let record;
  [1, 3, 7, 14, 30, 30, 30].forEach((days, index) => {
    const now = NOW + index * P.DAY;
    record = P.recordAnswer(record, 'known', true, now);
    assert.equal(record.nextReviewAt, now + days * P.DAY);
    assert.equal(record.confirmedStreak, index + 1);
    assert.equal(record.consecutiveCorrect, index + 1);
    assert.equal(record.reviewCount, index);
    assert.equal(record.correct, index + 1);
    assert.equal(P.isStable(record, now), index >= 2);
    assert.equal(P.isStable(record, record.nextReviewAt), false);
    assert.equal(P.isDue(record, record.nextReviewAt), true);
  });
});

test('uncertain correct guesses stay in review and reset confirmed streak while preserving correctness', () => {
  let record = P.recordAnswer(undefined, 'known', true, NOW);
  record = P.recordAnswer(record, 'known', true, NOW + 1);
  const previous = copy(record);
  const uncertain = P.recordAnswer(record, 'unsure', true, NOW + 2);
  assert.deepEqual(record, previous);
  assert.equal(uncertain.correct, 3);
  assert.equal(uncertain.consecutiveCorrect, 3);
  assert.equal(uncertain.confirmedStreak, 0);
  assert.equal(uncertain.status, 'review');
  assert.equal(uncertain.nextReviewAt, NOW + 2 + 30 * P.MINUTE);
  assert.equal(P.isStable(uncertain, NOW + 2), false);
  const next = P.recordAnswer(uncertain, 'known', true, NOW + 3);
  assert.equal(next.nextReviewAt, NOW + 3 + P.DAY);
});

test('wrong and unknown answers schedule 10 minutes and count actual repetitions', () => {
  let record = P.recordAnswer(undefined, 'known', false, NOW);
  assert.equal(record.nextReviewAt, NOW + 10 * P.MINUTE);
  assert.equal(record.lapseCount, 1);
  assert.equal(record.reviewCount, 0);
  assert.equal(record.lastWrongAt, NOW);
  record = P.recordAnswer(record, 'unknown', false, NOW + 1);
  assert.equal(record.lapseCount, 2);
  assert.equal(record.reviewCount, 1);
  assert.equal(record.consecutiveCorrect, 0);
  assert.equal(record.confirmedStreak, 0);
  assert.equal(record.attempts, 2);
  assert.equal(record.correct, 0);
  assert.throws(() => P.recordAnswer(record, 'unknown', true, NOW));
  assert.throws(() => P.recordAnswer(record, 'other', false, NOW));
  assert.throws(() => P.recordAnswer(record, 'known', 'yes', NOW));
});

test('migrated correct totals do not jump into a long review interval', () => {
  const old = v1Record({ attempts: 100, correct: 99 });
  const next = P.recordAnswer(old, 'known', true, NOW);
  assert.equal(next.attempts, 101);
  assert.equal(next.correct, 100);
  assert.equal(next.confirmedStreak, 1);
  assert.equal(next.nextReviewAt, NOW + P.DAY);
  assert.equal(next.reviewCount, 100);
});

test('date validation rejects calendar overflow and supports leap years', () => {
  for (const invalid of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-1-1', 'garbage', '', null]) assert.equal(P.parseExamDate(invalid), null);
  assert.equal(P.dateKey(P.parseExamDate('2028-02-29')), '2028-02-29');
  assert.equal(new Date(P.parseExamDate('2026-11-06')).getHours(), 23);
});

test('exam deadlines parse as local day end in both positive and negative UTC offsets', () => {
  const modulePath = require.resolve('../dist/progress.js');
  for (const tz of ['Asia/Shanghai', 'America/Los_Angeles']) {
    const result = JSON.parse(execFileSync(process.execPath, ['-e', `const P=require(${JSON.stringify(modulePath)});const x=new Date(P.parseExamDate('2026-11-06'));process.stdout.write(JSON.stringify([x.getFullYear(),x.getMonth()+1,x.getDate(),x.getHours(),x.getMinutes(),x.getSeconds()]));`], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }));
    assert.deepEqual(result, [2026, 11, 6, 23, 59, 59]);
  }
});

test('exam strategy compresses near exams, caps at the deadline, and restores standard intervals after it', () => {
  const settings = { examDate: '2026-11-08' };
  const normal = P.recordAnswer(undefined, 'known', true, NOW);
  const short = P.recordAnswer(undefined, 'known', true, NOW, settings);
  assert.ok(short.nextReviewAt < normal.nextReviewAt);
  assert.ok(short.nextReviewAt > NOW);
  assert.ok(short.nextReviewAt <= P.parseExamDate(settings.examDate));
  assert.equal(P.policyInfo(settings, NOW).mode, 'compressed');
  const deadline = P.parseExamDate(settings.examDate);
  for (const confidence of ['known', 'unsure', 'unknown']) {
    const r = P.recordAnswer(undefined, confidence, confidence !== 'unknown', deadline - 100, settings);
    assert.ok(r.nextReviewAt <= deadline);
    assert.ok(r.nextReviewAt > deadline - 100);
  }
  const past = P.recordAnswer(undefined, 'known', true, deadline + 1, settings);
  assert.equal(past.nextReviewAt, deadline + 1 + P.DAY);
  assert.equal(P.policyInfo(settings, deadline + 1).expired, true);
  assert.equal(P.policyInfo({ examDate: '2026-12-25' }, NOW).active, false);
  assert.equal(P.policyInfo({ examDate: 'bad' }, NOW).active, false);
});

test('changing exam date also shortens already-scheduled records, without moving their anchor', () => {
  let record;
  for (let i = 0; i < 5; i++) record = P.recordAnswer(record, 'known', true, NOW - 2 * P.DAY + i);
  assert.ok(record.nextReviewAt > NOW + 20 * P.DAY);
  const settings = { examDate: '2026-11-08' };
  assert.ok(P.reviewAt(record, settings, NOW) <= NOW);
  assert.equal(P.isDue(record, NOW, settings), true);
  assert.equal(P.isStable(record, NOW, settings), false);
  assert.ok(P.reviewAt(record, settings, NOW + P.MINUTE) <= P.reviewAt(record, settings, NOW));
});

test('priorities put due words first, weak future words next, then new words and stable words', () => {
  let stable;
  for (let i = 0; i < 3; i++) stable = P.recordAnswer(stable, 'known', true, NOW + i);
  const records = { 1: stable, 2: P.recordAnswer(undefined, 'unsure', true, NOW), 3: P.recordAnswer(undefined, 'unknown', false, NOW - P.DAY) };
  const input = words.slice(0, 4);
  const before = [...input];
  assert.deepEqual(P.prioritize(input, records, NOW + 3).map(w => w.id), [3, 2, 4, 1]);
  assert.deepEqual(input, before);
  assert.deepEqual(P.prioritize([words[7], words[6]], {}, NOW), [words[7], words[6]]);
});

test('analytics are restricted to the actual vocabulary and stable/review/unseen form a partition', () => {
  let stable;
  for (let i = 0; i < 3; i++) stable = P.recordAnswer(stable, 'known', true, NOW + i);
  const records = { 1: stable, 2: P.recordAnswer(undefined, 'unsure', true, NOW), 3: P.recordAnswer(undefined, 'known', false, NOW - P.DAY), 9999: stable };
  const stats = P.getStats(records, words, NOW + 3);
  assert.equal(stats.seen, 3);
  assert.equal(stats.stable, 1);
  assert.equal(stats.review, 2);
  assert.equal(stats.unseen, 5);
  assert.equal(stats.due, 1);
  assert.equal(stats.attempts, 5);
  assert.equal(stats.correct, 4);
  assert.equal(stats.stable + stats.review + stats.unseen, words.length);
  assert.equal(stats.lists.length, 2);
  assert.equal(stats.lists[0].rate, 25);
  assert.equal(stats.lists[1].unseen, 4);
  assert.equal(stats.forgetful[0].id, '3');
  assert.equal(stats.forgetful[0].errorRate, 1);
});

test('daily records track local days and unique words immutably without inventing v1 daily history', () => {
  const empty = {};
  const first = P.recordDaily(empty, '1', true, NOW);
  const second = P.recordDaily(first, '1', false, NOW);
  const third = P.recordDaily(second, '2', true, NOW);
  assert.deepEqual(empty, {});
  assert.equal(first[P.dateKey(NOW)].attempts, 1);
  assert.deepEqual(P.dailyTrend(third, 2, NOW), [
    { date: P.dateKey(NOW - P.DAY), attempts: 0, correct: 0, accuracy: null, unique: 0 },
    { date: P.dateKey(NOW), attempts: 3, correct: 2, accuracy: 67, unique: 2 }
  ]);
  assert.equal(P.dailyTrend(P.migrateState(oldState(), words, NOW).daily, 14, NOW).every(r => r.attempts === 0 && r.accuracy === null), true);
  assert.throws(() => P.dailyTrend({}, 0, NOW));
  assert.throws(() => P.dailyTrend({}, 367, NOW));
});

test('v1 imports and v2 export roundtrips retain the complete migrated learning state', () => {
  const v1 = oldState(); v1.basic = session();
  const first = P.validateImport(JSON.stringify(v1), words, NOW);
  assert.equal(first.summary.sourceVersion, 1);
  assert.equal(first.summary.records, 1);
  assert.equal(first.state.records[1].attempts, 10);
  first.state.daily = P.recordDaily(first.state.daily, '1', true, NOW);
  const exported = P.exportProgress(first.state, NOW);
  const second = P.validateImport(JSON.stringify(exported), words, NOW + P.DAY);
  assert.deepEqual(second.state, first.state);
  assert.equal(second.summary.sourceVersion, 2);
  exported.state.records[1].attempts = 999;
  assert.equal(first.state.records[1].attempts, 10);
});

test('imports preserve new training modes and do not equate synonym correct IDs with prompt IDs', () => {
  const state = P.migrateState(oldState(), words, NOW);
  state.view = 'synonyms'; state.settings.detailsExpanded = true;
  state.training = { ...session(), mode: 'syn-odd', stage: 'answer', confidence: 'known', options: [{ id: '1', meaning: 'one' }, { id: '2', meaning: 'two' }, { id: '3', meaning: 'three' }, { id: '4', meaning: 'four' }], answers: [{ id: '1', selected: '3', correct: true, confidence: 'known' }], questions: [{ id: '1', correctId: '3' }, { id: '2', correctId: '2' }] };
  const imported = P.validateImport(state, words, NOW).state;
  assert.deepEqual(imported.training, state.training);
  assert.equal(imported.settings.detailsExpanded, true);
  assert.equal(imported.view, 'synonyms');
});

test('imports reject damaged records, bad dates, invalid sessions, prototype payloads and large files', () => {
  const rejects = [
    '{bad json', [], null, {}, { ...oldState(), version: 99 },
    { format: 'other', version: 2, state: oldState(), exportedAt: NOW },
    { ...oldState(), records: { 900: v1Record() } },
    { ...oldState(), records: { 1: v1Record({ correct: 11 }) } },
    { ...oldState(), records: { 1: v1Record({ attempts: -1 }) } },
    { ...oldState(), records: { 1: v1Record({ attempts: 1.5 }) } },
    { ...oldState(), records: { 1: v1Record({ confidence: 'unknown', lastCorrect: true }) } },
    { ...oldState(), records: { 1: v1Record({ nextReviewAt: 'tomorrow' }) } },
    { ...oldState(), records: { 1: v1Record({ confirmedStreak: 2, consecutiveCorrect: 1 }) } },
    { ...oldState(), settings: { examDate: '2026-02-31' } },
    { ...oldState(), daily: { '2026-11-06': { attempts: 1, correct: 2, ids: ['1'] } } },
    { ...oldState(), daily: { '2026-11-06': { attempts: 2, correct: 1, ids: ['1', '999'] } } },
    { ...oldState(), daily: { '2026-11-06': { attempts: 2, correct: 1, ids: ['1', '1'] } } },
    { ...oldState(), basic: { ...session(), queue: ['1', '999'] } },
    { ...oldState(), basic: { ...session(), queue: ['1', '1'] } },
    { ...oldState(), basic: { ...session(), stage: 'answer', answers: [] } },
    { ...oldState(), basic: { ...session(), index: 3 } },
    '{"version":1,"records":{},"__proto__":{"polluted":true}}',
    ' '.repeat(P.MAX_IMPORT_BYTES + 1)
  ];
  rejects.forEach((payload, index) => assert.throws(() => P.validateImport(payload, words, NOW), /无法导入/, `case ${index}`));
  assert.equal({}.polluted, undefined);
});

test('import validation rejects impossible confidence, answer and option combinations', () => {
  const choices = { ...session(), stage: 'choices', confidence: 'known', options: words.slice(0, 4).map(w => ({ id: String(w.id), meaning: w.meaning })) };
  assert.doesNotThrow(() => P.validateImport({ ...oldState(), basic: choices }, words, NOW));
  const answer = { ...copy(choices), stage: 'answer', answers: [{ id: '1', confidence: 'known', selected: '1', correct: true }] };
  assert.doesNotThrow(() => P.validateImport({ ...oldState(), test: answer }, words, NOW));
  const cases = [
    { ...copy(choices), options: choices.options.slice(0, 3) },
    { ...copy(choices), confidence: 'unknown' },
    { ...copy(choices), options: [choices.options[0], choices.options[0], ...choices.options.slice(2)] },
    { ...copy(choices), options: choices.options.map((o, i) => i === 0 ? { ...o, meaning: '篡改释义' } : o) },
    { ...copy(answer), answers: [{ id: '1', confidence: 'known', selected: null, correct: true }] },
    { ...copy(answer), answers: [{ id: '1', confidence: 'known', selected: '2', correct: true }] },
    { ...copy(answer), confidence: 'unsure' },
    { ...copy(answer), answers: [{ id: '1', confidence: 'known', selected: '1', correct: false }] }
  ];
  cases.forEach((s, index) => assert.throws(() => P.validateImport({ ...oldState(), test: s }, words, NOW), /无法导入/, `case ${index}`));
  const training = { ...copy(answer), mode: 'syn-odd', questions: [{ wordId: '1', correctId: '1', relatedIds: ['999'] }, { wordId: '2', correctId: '2' }] };
  assert.throws(() => P.validateImport({ ...oldState(), training }, words, NOW), /越界关联词/);
});

test('merging is non-destructive, latest scheduling wins, counts never regress and imports are idempotent', () => {
  const current = P.migrateState(oldState(), words, NOW);
  current.basic = session(); current.test = session(); current.training = session();
  current.settings = { examDate: '2026-11-08', detailsExpanded: true };
  current.daily = P.recordDaily({}, '1', true, NOW);
  const incoming = P.migrateState(oldState(), words, NOW);
  incoming.records[1] = P.recordAnswer(v1Record({ attempts: 5, correct: 4 }), 'unsure', true, NOW + 100);
  incoming.records[2] = P.recordAnswer(undefined, 'known', true, NOW);
  incoming.settings = { examDate: '2026-11-09', importedOption: true };
  incoming.history.push({ finishedAt: NOW, total: 2, correct: 2 });
  incoming.daily = P.recordDaily({}, '2', true, NOW);
  incoming.basic = { ...session(), startedAt: NOW + 1000 };
  incoming.view = 'synonyms'; incoming.reviewOnly = false;
  const a = copy(current), b = copy(incoming);
  const merged = P.mergeProgress(current, incoming, words, NOW);
  assert.equal(merged.records[1].attempts, 10);
  assert.equal(merged.records[1].correct, 8);
  assert.equal(merged.records[1].status, 'review');
  assert.equal(merged.records[1].nextReviewAt, incoming.records[1].nextReviewAt);
  assert.equal(merged.records[2].attempts, 1);
  assert.equal(merged.settings.examDate, '2026-11-08');
  assert.equal(merged.settings.importedOption, true);
  for (const key of ['basic', 'test', 'training', 'view', 'reviewOnly']) assert.deepEqual(merged[key], current[key]);
  assert.equal(merged.history.length, 2);
  assert.equal(merged.daily[P.dateKey(NOW)].attempts, 2);
  assert.deepEqual(merged.daily[P.dateKey(NOW)].ids, ['1', '2']);
  assert.deepEqual(P.mergeProgress(merged, incoming, words, NOW + 1), merged);
  assert.deepEqual(P.validateImport(P.exportProgress(merged, NOW), words, NOW).state, merged);
  assert.deepEqual(current, a);
  assert.deepEqual(incoming, b);
});

test('an explicitly empty current exam date remains empty while an absent setting can import', () => {
  const incoming = P.migrateState(oldState(), words, NOW);
  incoming.settings.examDate = '2026-11-08';
  assert.equal(P.mergeProgress(oldState(), incoming, words, NOW).settings.examDate, '2026-11-08');
  assert.equal(P.mergeProgress({ ...oldState(), settings: { examDate: '' } }, incoming, words, NOW).settings.examDate, '');
});

test('export/import restores unfinished tests and every training mode into empty session slots', () => {
  const X = require('../dist/lexicon.js');
  const index = X.buildIndex(vocabulary);
  const current = P.migrateState(oldState(), vocabulary, NOW);
  current.basic = session(); // The first render already created this fresh session.
  current.view = 'progress'; current.reviewOnly = true;
  for (const mode of ['cn-en', 'def-en', 'syn-word', 'syn-cn', 'syn-odd']) {
    const incoming = P.migrateState(oldState(), vocabulary, NOW);
    incoming.view = 'test'; incoming.reviewOnly = false;
    incoming.test = { ...session(), mode: 'en-cn', index: 1, stage: 'choices', confidence: 'unsure',
      answers: [{ id: '1', confidence: 'known', selected: '1', correct: true }],
      options: vocabulary.slice(0, 4).map(w => ({ id: String(w.id), meaning: w.meaning })) };
    if (mode.startsWith('syn-')) {
      const q = X.questions(index, mode, () => 0.5)[0];
      assert.ok(q, `real vocabulary supplies ${mode} questions`);
      incoming.training = { ...session(), mode, queue: [String(q.wordId)], questions: [q], stage: 'choices', confidence: 'known',
        options: q.options.map(o => ({ id: String(o.id), meaning: o.label })) };
    } else {
      incoming.training = { ...session(), mode, stage: 'choices', confidence: 'unsure',
        options: vocabulary.slice(0, 4).map(w => ({ id: String(w.id), meaning: w.word })) };
    }
    const imported = P.validateImport(JSON.stringify(P.exportProgress(incoming, NOW)), vocabulary, NOW).state;
    const merged = P.mergeProgress(current, imported, vocabulary, NOW);
    assert.deepEqual(merged.basic, current.basic, 'the browser\'s fresh practice remains intact');
    assert.deepEqual(merged.test, incoming.test, 'resume at the exported test question');
    assert.deepEqual(merged.training, incoming.training, `resume the exported ${mode} question`);
    assert.equal(merged.view, current.view);
    assert.equal(merged.reviewOnly, current.reviewOnly);
    assert.deepEqual(P.mergeProgress(merged, imported, vocabulary, NOW + 1), merged);
    assert.deepEqual(P.validateImport(P.exportProgress(merged, NOW), vocabulary, NOW).state, merged);
    assert.equal(current.test, null);
    assert.equal(current.training, null);
  }
});

test('an existing completed session is preserved instead of replaced by an imported unfinished one', () => {
  const current = P.migrateState(oldState(), words, NOW);
  current.test = { ...session(), mode: 'en-cn', index: 2, stage: 'done', finishedAt: NOW + 2,
    answers: [{ id: '1', confidence: 'known', selected: '1', correct: true }, { id: '2', confidence: 'unknown', selected: null, correct: false }] };
  const incoming = P.migrateState(oldState(), words, NOW);
  incoming.test = session(); incoming.basic = session();
  const merged = P.mergeProgress(current, incoming, words, NOW);
  assert.deepEqual(merged.test, current.test);
  assert.deepEqual(merged.basic, incoming.basic);
});

test('the entire real 800-word database survives migration, export/import and duplicate merge', () => {
  const records = Object.fromEntries(vocabulary.map(word => [word.id, v1Record({ attempts: word.id + 1, correct: word.id })]));
  const migrated = P.migrateState({ ...oldState(), records }, vocabulary, NOW);
  const imported = P.validateImport(P.exportProgress(migrated, NOW), vocabulary, NOW).state;
  const merged = P.mergeProgress(imported, imported, vocabulary, NOW);
  assert.deepEqual(merged.records, migrated.records);
  const totals = P.getStats(merged.records, vocabulary, NOW);
  assert.equal(totals.seen, 800);
  assert.equal(totals.lists.length, 8);
  assert.equal(totals.stable, 0);
  assert.equal(totals.review, 800);
  assert.equal(totals.attempts, vocabulary.reduce((sum, word) => sum + word.id + 1, 0));
});
