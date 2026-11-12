/* Independent subject practice, sampled from the full existing local question bank. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Mock = require('../dist/mock-core.js');
const bank = JSON.parse(fs.readFileSync(path.join(__dirname, '../gre_question_bank.json'), 'utf8'));
const byId = new Map(bank.questions.map(q => [q.question_id, q]));
const checks = [];
const test = (name, fn) => { fn(); checks.push(name); };
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
const make = (subject, count = 20, seed = 42) => Mock.createSubjectPractice(bank, { subject, count }, rng(seed));
const originalHash = hash(bank);
const allowed = { Verbal: new Set(['TC1', 'TC2', 'TC3', 'SE', 'RC1', 'RCMultiple', 'RCSentence']), Quant: new Set(['QC', 'QuantSingle', 'QuantMultiple', 'NumericEntry', 'DI']) };
const template = bank.questions.find(q => q.question_type === 'TC1' && q.gradable && q.answer_status === 'verified' && q.options.length === 5);
const rcTemplate = bank.questions.find(q => q.question_type === 'RC1' && q.gradable && q.answer_status === 'verified' && q.options.length === 5);
const fixtureQuestion = (id, override = {}) => ({ ...copy(template), question_id: id, question_content: 'Synthetic test fixture ' + id, material_id: null, images: [], ...override });
const fixtureBank = questions => ({ questions, sources: bank.sources, materials: [] });

test('full-bank Verbal practice has only modern verified Verbal questions and no writing', () => {
  const result = make('Verbal', 100);
  assert.equal(bank.questions.length, 10348);
  assert.equal(result.subject, 'Verbal'); assert.equal(result.requestedCount, 100); assert.equal(result.ids.length, 100);
  assert(result.availableCount >= 100);
  assert.equal(new Set(result.ids).size, result.ids.length);
  for (const id of result.ids) {
    const q = byId.get(id);
    assert.equal(q.category, 'Verbal'); assert(allowed.Verbal.has(q.question_type));
    assert.equal(q.gradable, true); assert.equal(q.answer_status, 'verified');
    assert(Mock.eligible(q, bank));
  }
});
test('full-bank Quant practice has only modern verified Quant questions and no recall/drill', () => {
  const result = make('Quant', 100);
  assert.equal(result.subject, 'Quant'); assert.equal(result.ids.length, 100);
  assert(result.availableCount >= 100);
  for (const id of result.ids) {
    const q = byId.get(id);
    assert.equal(q.category, 'Quant'); assert(allowed.Quant.has(q.question_type));
    assert.equal(q.gradable, true); assert.equal(q.answer_status, 'verified');
    assert(Mock.eligible(q, bank));
  }
});
test('default and custom count work independently of historical 12/15-question sections', () => {
  assert.equal(Mock.createSubjectPractice(bank, { subject: 'Verbal' }, rng(1)).ids.length, 20);
  for (const subject of ['Verbal', 'Quant']) for (const count of [1, 7, 12, 15, 20, 73, 100]) assert.equal(make(subject, count).ids.length, count);
});
test('invalid counts and subjects are rejected without coercion', () => {
  for (const count of [0, -1, 101, 2.5, NaN, Infinity, -Infinity, '20', '', null, true, {}, []]) assert.throws(() => make('Verbal', count), /1–100/);
  for (const subject of ['AWA', 'All', 'verbal', 'quant', '', undefined, null, {}, ['Verbal']]) assert.throws(() => Mock.createSubjectPractice(bank, { subject, count: 20 }), /Verbal.*Quant/);
  for (const options of [null, [], false]) assert.throws(() => Mock.createSubjectPractice(bank, options), /Verbal.*Quant/);
});
test('small pools return actual unique count and empty pools remain usable', () => {
  const small = fixtureBank([fixtureQuestion('a'), fixtureQuestion('b')]);
  const result = Mock.createSubjectPractice(small, { subject: 'Verbal', count: 20 }, rng(1));
  assert.equal(result.requestedCount, 20); assert.equal(result.availableCount, 2); assert.equal(result.ids.length, 2);
  assert.deepEqual(Mock.createSubjectPractice({ questions: [], materials: [], sources: [] }, { subject: 'Quant', count: 7 }), { subject: 'Quant', ids: [], requestedCount: 7, availableCount: 0 });
});
test('semantic duplicates are excluded even when source IDs or raw spacing differ', () => {
  const first = fixtureQuestion('a', { question_content: 'The same original content.' });
  const second = { ...copy(first), question_id: 'b', question_content: '  THE   SAME original content. ', source_id: bank.sources.find(s => s.id !== first.source_id).id };
  const small = fixtureBank([first, second, fixtureQuestion('c')]);
  const before = hash(small);
  const result = Mock.createSubjectPractice(small, { subject: 'Verbal', count: 20 }, rng(1));
  assert.equal(result.availableCount, 2); assert.equal(result.ids.length, 2);
  assert.equal(result.ids.filter(id => ['a', 'b'].includes(id)).length, 1);
  assert(result.ids.includes('c')); assert.equal(hash(small), before);
});
test('historical, incomplete, unknown-source, missing-material and invalid-format questions are not sampled', () => {
  const excluded = [
    fixtureQuestion('legacy', { question_type: 'TC_LEGACY' }),
    fixtureQuestion('unverified', { answer_status: 'extracted' }),
    fixtureQuestion('review', { answer_status: 'needs_review' }),
    fixtureQuestion('ungradable', { gradable: false }),
    fixtureQuestion('no-source', { source_id: 'missing' }),
    fixtureQuestion('no-material', { material_id: 'missing' }),
    fixtureQuestion('bad-tc', { options: copy(template.options).slice(0, 4) }),
    fixtureQuestion('issue', { category: 'AWA', question_type: 'Issue', instructions: 'Write a well-reasoned analytical essay in response to this prompt.' }),
    fixtureQuestion('recall', { category: 'Quant', question_type: 'QuantRecall' }),
    fixtureQuestion('drill', { category: 'Quant', question_type: 'QuantDrill' })
  ];
  const small = fixtureBank([fixtureQuestion('good'), ...excluded]);
  assert.deepEqual(Mock.createSubjectPractice(small, { subject: 'Verbal', count: 100 }, rng(1)).ids, ['good']);
  assert.deepEqual(Mock.createSubjectPractice(small, { subject: 'Quant', count: 100 }, rng(1)).ids, []);
});

const groupedBank = {
  sources: bank.sources,
  materials: ['a', 'b', 'c'].map(id => ({ id, text: 'This is a sufficiently long original reading material for independent fixture ' + id + '.' })),
  questions: ['a', 'b', 'c'].flatMap(material => [3, 1, 2].map(order => ({ ...copy(rcTemplate), question_id: material + order, question_content: 'Distinct reading question ' + material + order, material_id: material, question_order: order, images: [] })))
};
function assertMaterialOrder(result, source) {
  const lookup = new Map(source.questions.map(q => [q.question_id, q]));
  const positions = new Map();
  result.ids.forEach((id, index) => {
    const q = lookup.get(id); if (!q.material_id) return;
    if (!positions.has(q.material_id)) positions.set(q.material_id, []);
    positions.get(q.material_id).push([index, Number(q.question_order ?? q.source_number ?? 0)]);
  });
  for (const entries of positions.values()) for (let index = 1; index < entries.length; index++) {
    assert.equal(entries[index][0], entries[index - 1][0] + 1); assert(entries[index][1] >= entries[index - 1][1]);
  }
}
test('shared reading/chart questions remain contiguous in original question order', () => {
  for (let seed = 1; seed <= 20; seed++) {
    assertMaterialOrder(Mock.createSubjectPractice(groupedBank, { subject: 'Verbal', count: 100 }, rng(seed)), groupedBank);
    for (const subject of ['Verbal', 'Quant']) assertMaterialOrder(make(subject, 100, seed), bank);
  }
});
test('random question sampling happens before material grouping and never fills extra bundle questions', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const expected = groupedBank.questions.slice(), random = rng(seed);
    for (let i = expected.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [expected[i], expected[j]] = [expected[j], expected[i]]; }
    const result = Mock.createSubjectPractice(groupedBank, { subject: 'Verbal', count: 4 }, rng(seed));
    assert.equal(result.ids.length, 4);
    assert.deepEqual(new Set(result.ids), new Set(expected.slice(0, 4).map(q => q.question_id)));
    assertMaterialOrder(result, groupedBank);
  }
});
test('multiple seeds produce different selections, type distributions and material orders', () => {
  const selections = new Set(), distributions = new Set(), groupOrders = new Set(), types = { Verbal: new Set(), Quant: new Set() };
  for (let seed = 1; seed <= 20; seed++) {
    const result = make('Verbal', 20, seed);
    selections.add(result.ids.join('|'));
    const counts = {};
    for (const id of result.ids) { const type = byId.get(id).question_type; counts[type] = (counts[type] || 0) + 1; types.Verbal.add(type); }
    distributions.add(JSON.stringify([...allowed.Verbal].map(type => counts[type] || 0)));
    for (const id of make('Quant', 100, seed).ids) types.Quant.add(byId.get(id).question_type);
    const groups = Mock.createSubjectPractice(groupedBank, { subject: 'Verbal', count: 100 }, rng(seed));
    groupOrders.add(groups.ids.filter((_, index) => index % 3 === 0).join('|'));
  }
  assert(selections.size > 1); assert(distributions.size > 1); assert(groupOrders.size > 1);
  assert.deepEqual(types.Quant, allowed.Quant);
  for (const type of ['TC1', 'TC2', 'TC3', 'SE', 'RC1', 'RCMultiple']) assert(types.Verbal.has(type));
});
test('previously studied IDs do not bias the random sample', () => {
  const plainResult = make('Verbal', 20, 42);
  const withHistory = Mock.createSubjectPractice(bank, { subject: 'Verbal', count: 20, seenIds: plainResult.ids, preferUnseen: true }, rng(42));
  assert.deepEqual(withHistory, plainResult);
});
test('invalid random generators fail clearly', () => {
  const small = fixtureBank([fixtureQuestion('a'), fixtureQuestion('b')]);
  for (const value of [-1, 1, NaN, Infinity, '0.5']) assert.throws(() => Mock.createSubjectPractice(small, { subject: 'Verbal', count: 2 }, () => value), /随机数生成器/);
  assert.throws(() => Mock.createSubjectPractice(small, { subject: 'Verbal', count: 2 }, null), /随机数生成器/);
});
test('all original source contents, answers, materials and ordering remain unchanged', () => assert.equal(hash(bank), originalHash));
const report = { passed: checks.length, failed: 0, bankQuestions: bank.questions.length, available: { Verbal: make('Verbal', 1).availableCount, Quant: make('Quant', 1).availableCount }, checks };
fs.writeFileSync(path.join(__dirname, 'subject-core-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
