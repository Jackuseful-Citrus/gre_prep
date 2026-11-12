/* GRE mock invariants against the full local bank, without browser dependencies. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../dist/platform-core.js');
const Mock = require('../dist/mock-core.js');
const bank = JSON.parse(fs.readFileSync(path.join(__dirname, '../gre_question_bank.json'), 'utf8'));
const byId = new Map(bank.questions.map(q => [q.question_id, q]));
const start = 1794000000000;
const copy = x => JSON.parse(JSON.stringify(x));
const rng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
const test = (name, fn) => { fn(); checks.push(name); };
const checks = [];
const make = (seed = 5, options = {}) => Mock.createExam(bank, { order: 'VQVQ', ...options }, start, rng(seed));
test('55 original questions, exact current five sections and 118 minutes', () => {
  const e = make();
  assert.deepEqual(e.sections.map(s => [s.id, s.ids.length, s.minutes]), [['AWA', 1, 30], ['V1', 12, 18], ['Q1', 12, 21], ['V2', 15, 23], ['Q2', 15, 26]]);
  assert.equal(new Set(e.sections.flatMap(s => s.ids)).size, 55);
  assert.equal(e.sections.reduce((sum, s) => sum + s.minutes, 0), 118);
  assert.equal(e.sections[0].deadline, start + 30 * 60000);
  assert(e.sections.slice(1).every(s => s.startedAt === null && s.deadline === null));
  assert(e.sections.flatMap(s => s.ids).every(id => byId.has(id)));
  assert.deepEqual(Mock.restore(e, bank), e);
});
test('every objective is verified, gradable, modern structure; AWA only complete Issue', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const e = make(seed, { order: 'random' });
    for (const s of e.sections) for (const id of s.ids) {
      const q = byId.get(id);
      assert(Mock.eligible(q, bank));
      if (s.id === 'AWA') { assert.equal(q.question_type, 'Issue'); assert(q.instructions.length > 20); }
      else { assert.equal(q.answer_status, 'verified'); assert.equal(q.gradable, true); assert(!['TC_LEGACY', 'Argument', 'QuantRecall', 'QuantDrill'].includes(q.question_type)); }
      if (q.blank_groups?.length) assert(q.blank_groups.every(g => g.options.length === 3));
    }
    assert.equal(e.sections[0].id, 'AWA');
    const ids = e.sections.map(s => s.id);
    assert(ids.indexOf('V1') < ids.indexOf('V2'));
    assert(ids.indexOf('Q1') < ids.indexOf('Q2'));
    Mock.restore(e, bank);
  }
});
test('random order reaches all six legal interleavings', () => {
  const orders = new Set();
  for (let seed = 1; seed <= 100 && orders.size < 6; seed++) orders.add(make(seed, { order: 'random' }).order);
  assert.equal(orders.size, 6);
});
test('practice blueprint exact, not an official fixed mix', () => {
  const e = make();
  for (const [sid, counts] of [['V1', [3, 3, 6]], ['V2', [4, 4, 7]]]) {
    const qs = e.sections.find(s => s.id === sid).ids.map(id => byId.get(id));
    assert.deepEqual([qs.filter(q => q.question_type.startsWith('TC')).length, qs.filter(q => q.question_type === 'SE').length, qs.filter(q => q.question_type.startsWith('RC')).length], counts);
  }
  for (const s of e.sections.filter(s => s.subject === 'Quant')) assert.equal(new Set(s.ids.map(id => byId.get(id).question_type)).size, 5);
  assert(!Object.hasOwn(Mock.summary(e, bank), 'scaledScore'));
});
test('shared material stays in one section, contiguous and original order', () => {
  const e = make(); const materials = new Map();
  for (const s of e.sections) {
    const positions = new Map();
    s.ids.forEach((id, index) => {
      const q = byId.get(id); if (!q.material_id) return;
      if (materials.has(q.material_id)) assert.equal(materials.get(q.material_id), s.id);
      materials.set(q.material_id, s.id);
      if (!positions.has(q.material_id)) positions.set(q.material_id, []);
      positions.get(q.material_id).push([index, Number(q.question_order ?? q.source_number ?? 0)]);
    });
    for (const ps of positions.values()) for (let i = 1; i < ps.length; i++) { assert.equal(ps[i][0], ps[i - 1][0] + 1); assert(ps[i][1] >= ps[i - 1][1]); }
  }
});
test('seen preference is soft and counted; no bank mutation on pool failure', () => {
  const original = make(); const seenIds = original.sections.flatMap(s => s.ids);
  const fresh = make(5, { seenIds }); assert.equal(fresh.repeatedCount, 0);
  const everySeen = make(5, { seenIds: bank.questions.map(q => q.question_id) }); assert.equal(everySeen.repeatedCount, 55);
  const small = { ...bank, questions: bank.questions.filter(q => q.question_type !== 'TC3') };
  const before = JSON.stringify(small);
  assert.throws(() => Mock.createExam(small, {}, start, rng(5)), /TC3.*需 1 题/);
  assert.equal(JSON.stringify(small), before);
});
test('manual next section gets full time, unused minutes never carry', () => {
  const e = make(); Mock.advance(e, bank, start + 1000);
  assert.equal(e.sections[0].endedAt, start + 1000);
  assert.equal(e.sections[0].endReason, 'manual');
  assert.equal(e.currentSection, 1);
  assert.equal(e.sections[1].startedAt, start + 1000);
  assert.equal(e.sections[1].deadline, start + 1000 + 18 * 60000);
  Mock.restore(e, bank);
});
test('timeout boundary and offline catchup consume elapsed wall clock', () => {
  const e = make(); Mock.tick(e, bank, start + 31 * 60000);
  assert.equal(e.sections[0].endedAt, start + 30 * 60000);
  assert.equal(e.sections[1].startedAt, start + 30 * 60000);
  assert.equal(e.sections[1].deadline, start + 48 * 60000);
  const reloaded = Mock.restore(JSON.stringify(e), bank);
  Mock.tick(reloaded, bank, start + 120 * 60000);
  assert.equal(reloaded.endedAt, start + 118 * 60000);
  assert(reloaded.sections.every(s => s.endReason === 'timeout'));
  const r = Mock.summary(reloaded, bank);
  assert.equal(r.total.total, 54); assert.equal(r.total.omitted, 54); assert.equal(r.total.correct, 0); assert.equal(r.total.wrong, 0);
  assert.equal(r.elapsedMs, 118 * 60000); assert.equal(r.subjects.Verbal.total, 27); assert.equal(r.subjects.Quant.total, 27);
  Mock.restore(reloaded, bank);
});
test('expired manual advance catches up once without double advancing', () => {
  const e = make(); Mock.advance(e, bank, start + 31 * 60000);
  assert.equal(e.currentSection, 1); assert.equal(e.sections[1].endedAt, null);
  assert.throws(() => Mock.advance(e, bank, start + 32 * 60000, 'timeout'), /尚未结束/);
});
test('no scoring before section ends and no correctness in editable responses', () => {
  const e = make(); Mock.advance(e, bank, start + 1);
  const s = e.sections[1], q = byId.get(s.ids[0]); e.responses[q.question_id].selected = [...q.correct_answer];
  const r = Mock.summary(e, bank);
  assert.equal(r.sections[1].correct, null); assert.equal(r.sections[1].responses[0].correct, null);
  assert.equal(r.sections[1].answered, 1); assert.equal(r.total.graded, 0);
  assert(!Object.hasOwn(e.responses[q.question_id], 'correct'));
});
test('all exact answers grade, writing does not auto-score, finalized calls are idempotent', () => {
  const e = make();
  while (e.endedAt === null) {
    const s = e.sections[e.currentSection];
    for (const id of s.ids) {
      const q = byId.get(id), r = e.responses[id];
      if (q.category === 'AWA') r.text = 'A saved original essay.';
      else if (Core.mode(q) === 'numeric') r.text = String(q.correct_answer[0]);
      else r.selected = [...q.correct_answer];
    }
    Mock.advance(e, bank, s.startedAt + 1000);
  }
  const r = Mock.summary(e, bank);
  assert.equal(r.total.correct, 54); assert.equal(r.total.graded, 54); assert.equal(r.total.omitted, 0); assert.equal(r.total.wrong, 0);
  assert.equal(r.subjects.AWA.correct, null); assert.equal(r.subjects.AWA.answered, 1);
  const frozen = JSON.stringify(e); Mock.advance(e, bank, start + 9999999); Mock.tick(e, bank, start + 9999999); Mock.abort(e, bank, start + 9999999); assert.equal(JSON.stringify(e), frozen);
  Mock.restore(e, bank);
});
test('partial blanks and partial SE are wrong, truly blank questions omitted', () => {
  const e = make(); Mock.advance(e, bank, start + 1);
  const s = e.sections[1], qs = s.ids.map(id => byId.get(id));
  const tc = qs.find(q => q.question_type === 'TC2'), se = qs.find(q => q.question_type === 'SE');
  e.responses[tc.question_id].selected = [tc.correct_answer[0]]; e.responses[se.question_id].selected = [se.correct_answer[0]];
  Mock.advance(e, bank, start + 1000);
  const r = Mock.summary(e, bank).sections[1];
  assert.equal(r.answered, 2); assert.equal(r.correct, 0); assert.equal(r.wrong, 2); assert.equal(r.omitted, 10);
  assert.equal(r.responses.filter(a => a.complete).length, 0);
});
test('abort locks current and does not score unvisited sections', () => {
  const e = make(); Mock.advance(e, bank, start + 1);
  const q = byId.get(e.sections[1].ids[0]); e.responses[q.question_id].selected = [...q.correct_answer];
  Mock.abort(e, bank, start + 1000);
  const r = Mock.summary(e, bank);
  assert.equal(r.aborted, true); assert.equal(r.total.correct, 1); assert.equal(r.total.omitted, 11); assert.equal(r.total.unvisited, 42);
  assert(r.sections.slice(2).every(s => s.omitted === 0 && s.correct === null));
  assert.equal(e.sections[2].startedAt, null);
  Mock.restore(e, bank);
});
test('restore rejects changed time/order/count/answer state without mutating input', () => {
  const cases = [
    e => { e.sections[0].deadline++; },
    e => { e.sections[0].minutes = 31; },
    e => { e.sections[1].ids.pop(); },
    e => { [e.sections[1], e.sections[3]] = [e.sections[3], e.sections[1]]; },
    e => { e.sections[1].ids[0] = e.sections[1].ids[1]; },
    e => { e.responses[e.sections[1].ids[0]].selected = ['NOT-AN-OPTION']; },
    e => { e.responses[e.sections[1].ids[0]].selected = [...byId.get(e.sections[1].ids[0]).correct_answer]; },
    e => { e.index = 1000; },
    e => { e.sections[0].endedAt = start + 100; e.sections[0].endReason = 'manual'; },
    e => { e.endedAt = start + 100; },
    e => { e.aborted = true; },
    e => { e.responses[e.sections[0].ids[0]].elapsedMs = -1; },
    e => { e.responses.extra = { selected: [], text: '', marked: false, elapsedMs: 0 }; }
  ];
  for (const alter of cases) { const e = make(); alter(e); const before = JSON.stringify(e); assert.throws(() => Mock.restore(e, bank), /模考记录无效/); assert.equal(JSON.stringify(e), before); }
  const e = make(); Mock.advance(e, bank, start + 1000); e.sections[0].endedAt = null; assert.throws(() => Mock.restore(e, bank), /模考记录无效/);
});
test('restoration returns a detached copy and strips correctness injected into responses', () => {
  const e = make(); const id = e.sections[0].ids[0]; e.responses[id].correct = true;
  const restored = Mock.restore(e, bank); restored.responses[id].text = 'Different';
  assert.equal(e.responses[id].text, ''); assert(!Object.hasOwn(restored.responses[id], 'correct'));
});
test('bank downgrade refuses unsafe resume without deleting source record', () => {
  const e = make(), id = e.sections[1].ids[0];
  const changed = { ...bank, questions: bank.questions.map(q => q.question_id === id ? { ...q, answer_status: 'needs_review', gradable: false } : q) };
  const saved = JSON.stringify(e); assert.throws(() => Mock.restore(e, changed), /未核验/); assert.equal(JSON.stringify(e), saved);
});
test('future clock records are rejected and explicit restore clock supports deterministic catchup', () => {
  const future = Mock.createExam(bank, {}, Date.now() + 3600000, rng(5));
  assert.throws(() => Mock.restore(future, bank), /开始时间晚于/);
  assert.equal(Mock.restore(future, bank, future.startedAt).startedAt, future.startedAt);
  const e = make(); Mock.tick(e, bank, start + 120 * 60000);
  assert.throws(() => Mock.restore(e, bank, start), /无效/);
  assert.equal(Mock.restore(e, bank, start + 120 * 60000).endedAt, start + 118 * 60000);
});
test('historical answer downgrade is ungraded in report rather than silently wrong', () => {
  const e = make(); Mock.advance(e, bank, start + 1);
  const id = e.sections[1].ids[0]; e.responses[id].selected = [...byId.get(id).correct_answer];
  Mock.abort(e, bank, start + 1000);
  const changed = { ...bank, questions: bank.questions.map(q => q.question_id === id ? { ...q, gradable: false, answer_status: 'needs_review' } : q) };
  const r = Mock.summary(e, changed); assert.equal(r.total.correct, 0); assert.equal(r.total.wrong, 0); assert.equal(r.total.ungraded, 1);
  const missing = { ...bank, questions: bank.questions.filter(q => q.question_id !== id) };
  assert.equal(Mock.summary(e, missing).total.ungraded, 1);
});
fs.writeFileSync(path.join(__dirname, 'mock-core-report.json'), JSON.stringify({ passed: checks.length, failed: 0, bankQuestions: bank.questions.length, checks }, null, 2));
console.log(JSON.stringify({ passed: checks.length, failed: 0, bankQuestions: bank.questions.length, checks }, null, 2));
