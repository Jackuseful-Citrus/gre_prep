const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../dist/progress.js');
const words = require('../dist/words.json').slice(0, 4);
const NOW = 1794369600000;
const copy = value => JSON.parse(JSON.stringify(value));
const session = (overrides = {}) => ({ queue: ['1', '2'], index: 0, answers: [], stage: 'prompt', startedAt: NOW, ...overrides });
const state = (overrides = {}) => P.migrateState({ version: 2, records: {}, ...overrides }, words, NOW);
const answer = (id, confidence = 'known') => ({ id, confidence });

test('old progress gains empty independent self-check state without altering recorded learning', () => {
  const original = { version: 1, records: { 1: { attempts: 2, correct: 1, status: 'review', confidence: 'unknown', lastCorrect: false, updatedAt: NOW } }, daily: {}, view: 'basic' };
  const before = copy(original);
  const migrated = P.migrateState(original, words, NOW);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.selfCheck, null);
  assert.equal(migrated.specialReview, null);
  assert.deepEqual(migrated.specialList, {});
  assert.equal(migrated.records[1].attempts, 2);
  assert.equal(migrated.records[1].correct, 1);
  assert.deepEqual(migrated.daily, {});
  assert.deepEqual(original, before);
  assert.deepEqual(P.migrateState(migrated, words, NOW + 1), migrated);
});

test('self-check session validation accepts all three stages and both self-assessments', () => {
  const fixtures = [
    session(),
    session({ stage: 'answer', answers: [answer('1')] }),
    session({ index: 1, answers: [answer('1', 'unknown')] }),
    session({ index: 1, stage: 'answer', answers: [answer('1'), answer('2', 'unknown')] }),
    session({ index: 2, stage: 'done', answers: [answer('1'), answer('2', 'unknown')] }),
  ];
  for (const fixture of fixtures) {
    const before = copy(fixture);
    assert.equal(P.validSelfSession(fixture, words), true);
    const migrated = state({ selfCheck: fixture, specialReview: fixture });
    assert.deepEqual(migrated.selfCheck, fixture);
    assert.deepEqual(migrated.specialReview, fixture);
    assert.deepEqual(fixture, before);
  }
});

test('backward navigation preserves every later answer through migration, export and import', () => {
  const answers = [answer('1'), { ...answer('2', 'unknown'), autoSpecialAt: NOW + 1 }, answer('3')];
  for (const index of [0, 1, 2]) {
    for (const queue of [['1', '2', '3'], ['1', '2', '3', '4']]) {
      const browsing = session({ queue, index, stage: 'answer', answers });
      assert.equal(P.validSelfSession(browsing, words), true);
      const original = state({ selfCheck: browsing, specialReview: browsing });
      const imported = P.validateImport(P.exportProgress(original, NOW + 2), words, NOW + 2).state;
      assert.deepEqual(imported.selfCheck, browsing);
      assert.deepEqual(imported.specialReview, browsing);
      assert.deepEqual(imported.selfCheck.answers, answers);
    }
  }
  const atFrontier = session({ queue: ['1', '2', '3', '4'], index: 3, answers });
  assert.equal(P.validSelfSession(atFrontier, words), true);
});

test('auto-add metadata survives later manual list changes and independent clock values', () => {
  for (const autoSpecialAt of [0, NOW - 1, NOW + 1]) {
    for (const specialList of [{}, { 1: { active: false, updatedAt: NOW + 2 } }, { 1: { active: true, updatedAt: NOW + 3 } }]) {
      const fixture = session({ stage: 'answer', answers: [{ ...answer('1', 'unknown'), autoSpecialAt }] });
      const original = state({ selfCheck: fixture, specialReview: fixture, specialList });
      assert.equal(P.validSelfSession(fixture, words), true);
      const imported = P.validateImport(P.exportProgress(original, NOW + 4), words, NOW + 4).state;
      assert.deepEqual(imported.selfCheck, fixture);
      assert.deepEqual(imported.specialReview, fixture);
      assert.deepEqual(imported.specialList, specialList);
    }
  }
});

test('invalid auto-add metadata and cursor positions fail validation and import', () => {
  const fixtures = [
    ...[null, '1', -1, Infinity, 8640000000000001, {}, []].map(autoSpecialAt => session({ stage: 'answer', answers: [{ ...answer('1', 'unknown'), autoSpecialAt }] })),
    session({ stage: 'answer', answers: [{ ...answer('1'), autoSpecialAt: NOW }] }),
    session({ stage: 'prompt', answers: [answer('1'), answer('2')] }),
    session({ index: 1, stage: 'prompt', answers: [answer('1'), answer('2')] }),
    session({ index: 1, stage: 'answer', answers: [answer('1')] }),
    session({ stage: 'answer', answers: [answer('1'), answer('2'), answer('3')] }),
    session({ index: 1, stage: 'done', answers: [answer('1'), answer('2')] }),
  ];
  for (const fixture of fixtures) {
    assert.equal(P.validSelfSession(fixture, words), false, JSON.stringify(fixture));
    for (const key of ['selfCheck', 'specialReview']) {
      assert.equal(state({ [key]: fixture })[key], null);
      const incoming = state();
      incoming[key] = fixture;
      assert.throws(() => P.validateImport(P.exportProgress(incoming, NOW), words, NOW), /自查会话格式无效/);
    }
  }
});

test('self-check validation rejects contradictory, scored or out-of-range sessions', () => {
  const fixtures = [
    null, [], session({ queue: [] }), session({ queue: ['1', '1'] }),
    session({ queue: [1, '2'] }), session({ queue: ['1', '999'] }),
    session({ index: -1 }), session({ index: 0.5 }), session({ index: 2 }),
    session({ answers: [answer('1')] }), session({ stage: 'choices' }),
    session({ stage: 'answer' }), session({ stage: 'done' }),
    session({ startedAt: -1 }), session({ startedAt: Infinity }), session({ startedAt: 'today' }),
    session({ stage: 'answer', answers: [answer('2')] }),
    session({ stage: 'answer', answers: [answer('1', 'unsure')] }),
    session({ stage: 'answer', answers: [{ ...answer('1'), correct: true }] }),
    session({ stage: 'answer', answers: [{ ...answer('1'), selected: null }] }),
    session({ index: 2, stage: 'done', answers: [answer('1')] }),
  ];
  for (const fixture of fixtures) {
    assert.equal(P.validSelfSession(fixture, words), false, JSON.stringify(fixture));
    const migrated = state({ selfCheck: fixture, specialReview: fixture });
    assert.equal(migrated.selfCheck, null);
    assert.equal(migrated.specialReview, null);
  }
});

test('special-list migration keeps valid additions and removals while dropping malformed entries', () => {
  const original = {
    1: { active: true, updatedAt: NOW },
    2: { active: false, updatedAt: NOW + 1 },
    3: { active: 'yes', updatedAt: NOW },
    4: { active: true, updatedAt: -1 },
    999: { active: true, updatedAt: NOW },
  };
  assert.deepEqual(state({ specialList: original }).specialList, { 1: original[1], 2: original[2] });
  assert.deepEqual(state({ specialList: [] }).specialList, {});
  assert.deepEqual(state({ specialList: null }).specialList, {});
});

test('export and import preserve self-check sessions, list tombstones and their separate navigation', () => {
  for (const view of ['self-check', 'special-review', 'special-study']) {
    const original = state({
      view,
      selfCheck: session({ stage: 'answer', answers: [answer('1')] }),
      specialReview: session({ queue: ['2'], index: 1, stage: 'done', answers: [answer('2', 'unknown')] }),
      specialList: { 1: { active: false, updatedAt: NOW }, 2: { active: true, updatedAt: NOW + 1 } },
    });
    const imported = P.validateImport(JSON.stringify(P.exportProgress(original, NOW)), words, NOW).state;
    assert.deepEqual(imported, original);
    assert.deepEqual(imported.records, {});
    assert.deepEqual(imported.daily, {});
    assert.deepEqual(imported.history, []);
  }
});

test('import rejects malformed self-check sessions instead of silently discarding them', () => {
  for (const key of ['selfCheck', 'specialReview']) {
    for (const invalid of [[], {}, session({ stage: 'choices' }), session({ stage: 'answer' }), session({ stage: 'answer', answers: [{ ...answer('1'), correct: true }] })]) {
      const incoming = state();
      incoming[key] = invalid;
      assert.throws(() => P.validateImport(P.exportProgress(incoming, NOW), words, NOW), /自查会话格式无效/);
    }
    const nullable = state();
    nullable[key] = null;
    assert.equal(P.validateImport(P.exportProgress(nullable, NOW), words, NOW).state[key], null);
  }
});

test('import rejects malformed or unknown special-list entries including inactive tombstones', () => {
  for (const specialList of [null, [], { 1: null }, { 1: { active: true } }, { 1: { active: 'yes', updatedAt: NOW } }, { 1: { active: false, updatedAt: -1 } }, { 999: { active: false, updatedAt: NOW } }]) {
    const incoming = state();
    incoming.specialList = specialList;
    assert.throws(() => P.validateImport(P.exportProgress(incoming, NOW), words, NOW), /特殊待复习列表/);
  }
});

test('special-list merge uses newest per-word choice, current wins ties and removals survive old backups', () => {
  const current = state({ specialList: { 1: { active: false, updatedAt: NOW + 2 }, 2: { active: true, updatedAt: NOW }, 3: { active: false, updatedAt: NOW } } });
  const incoming = state({ specialList: { 1: { active: true, updatedAt: NOW }, 2: { active: false, updatedAt: NOW + 1 }, 3: { active: true, updatedAt: NOW }, 4: { active: true, updatedAt: NOW } } });
  const beforeA = copy(current), beforeB = copy(incoming);
  const merged = P.mergeProgress(current, incoming, words, NOW);
  assert.deepEqual(merged.specialList, { 1: current.specialList[1], 2: incoming.specialList[2], 3: current.specialList[3], 4: incoming.specialList[4] });
  assert.deepEqual(P.mergeProgress(merged, incoming, words, NOW + 1), merged);
  assert.deepEqual(P.validateImport(P.exportProgress(merged, NOW), words, NOW).state, merged);
  assert.deepEqual(current, beforeA);
  assert.deepEqual(incoming, beforeB);
  assert.deepEqual(merged.records, {});
  assert.deepEqual(merged.daily, {});
});

test('merging into old or empty progress restores a special list and empty self-check slots', () => {
  const incoming = state({
    selfCheck: session({ stage: 'answer', answers: [answer('1', 'unknown')] }),
    specialReview: session(),
    specialList: { 1: { active: true, updatedAt: NOW } },
  });
  for (const current of [{ version: 1, records: {} }, state()]) {
    const merged = P.mergeProgress(current, incoming, words, NOW);
    assert.deepEqual(merged.specialList, incoming.specialList);
    assert.deepEqual(merged.selfCheck, incoming.selfCheck);
    assert.deepEqual(merged.specialReview, incoming.specialReview);
  }
});

test('merge preserves each existing self-check session independently, including completed sessions', () => {
  const finished = session({ index: 2, stage: 'done', answers: [answer('1'), answer('2')] });
  const incoming = state({ selfCheck: session(), specialReview: session({ queue: ['3'] }) });
  for (const key of ['selfCheck', 'specialReview']) {
    const current = state({ [key]: finished, view: 'special-review' });
    const otherKey = key === 'selfCheck' ? 'specialReview' : 'selfCheck';
    const merged = P.mergeProgress(current, incoming, words, NOW);
    assert.deepEqual(merged[key], finished);
    assert.deepEqual(merged[otherKey], incoming[otherKey]);
    assert.equal(merged.view, current.view);
  }
});
