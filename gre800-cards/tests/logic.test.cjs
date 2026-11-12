const test = require('node:test');
const assert = require('node:assert/strict');
const { shuffle, makeOptions, validCount, statusFor, updateRecord, summarize } = require('../dist/logic.js');

function random(seed) {
  return () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
}
const words = [
  { id: 1, word: 'abate', meaning: '减轻；缓和' },
  { id: 2, word: 'aberrant', meaning: '异常的；反常的' },
  { id: 3, word: 'abjure', meaning: '发誓放弃' },
  { id: 4, word: 'abscond', meaning: '潜逃' },
  { id: 5, word: 'acumen', meaning: '敏锐；洞察力' },
  { id: 6, word: 'alleviate', meaning: '减轻；缓和' },
  { id: 7, word: 'anomaly', meaning: '异常的；反常的' },
  { id: 8, word: 'arduous', meaning: '艰难的；费力的' },
];

test('shuffle returns a permutation without changing its input', () => {
  const original = [1, 2, 3, 4, 5, 6];
  const input = [...original];
  const shuffled = shuffle(input, random(1));
  assert.deepEqual(input, original);
  assert.notEqual(shuffled, input);
  assert.deepEqual([...shuffled].sort(), original);
  assert.notDeepEqual(shuffled, original);
  assert.deepEqual(shuffle([], random(1)), []);
  assert.deepEqual(shuffle([1], random(1)), [1]);
});

test('makeOptions has four different meanings and exactly one correct word', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const options = makeOptions(words[0], words, random(seed));
    assert.equal(options.length, 4);
    assert.equal(new Set(options.map(w => w.meaning)).size, 4);
    assert.equal(options.filter(w => w.id === words[0].id).length, 1);
    assert.equal(options.filter(w => w.meaning === words[0].meaning).length, 1);
  }
});

test('correct option appears in each answer position across random seeds', () => {
  const positions = new Set();
  for (let seed = 1; seed <= 100; seed++) {
    positions.add(makeOptions(words[0], words, random(seed)).findIndex(w => w.id === words[0].id));
  }
  assert.deepEqual([...positions].sort(), [0, 1, 2, 3]);
});

test('makeOptions rejects a pool with fewer than four different meanings', () => {
  assert.throws(() => makeOptions(words[0], [words[0], words[1], words[5]], random(1)));
});

test('validCount accepts integers between 1 and 800 and rejects boundary violations', () => {
  for (const n of [1, 2, 20, 799, 800, '1', '800']) assert.equal(validCount(n, 800), Number(n));
  for (const n of [-1, 0, 801, 1.5, NaN, Infinity, '', 'abc', '20x', '1.5', null, undefined]) {
    assert.equal(validCount(n, 800), null, `should reject ${String(n)}`);
  }
});

test('only a correct known response is marked mastered', () => {
  assert.equal(statusFor('known', true), 'mastered');
  for (const [confidence, correct] of [['known', false], ['unsure', true], ['unsure', false], ['unknown', false]]) {
    assert.equal(statusFor(confidence, correct), 'review');
  }
});

test('updateRecord counts attempts, correctness and most recent status without mutation', () => {
  const first = updateRecord(undefined, 'known', true, 100);
  assert.deepEqual(first, { attempts: 1, correct: 1, status: 'mastered', confidence: 'known', lastCorrect: true, updatedAt: 100 });
  const second = updateRecord(first, 'unsure', true, 200);
  assert.equal(second.attempts, 2);
  assert.equal(second.correct, 2);
  assert.equal(second.status, 'review');
  assert.equal(first.attempts, 1);
  const third = updateRecord(second, 'unknown', false, 300);
  assert.equal(third.attempts, 3);
  assert.equal(third.correct, 2);
  assert.equal(third.lastCorrect, false);
  assert.equal(third.updatedAt, 300);
});

test('summarize includes only words in the current vocabulary and counts each record once', () => {
  const records = {
    1: updateRecord(undefined, 'known', true, 100),
    2: updateRecord(updateRecord(undefined, 'unknown', false, 100), 'unsure', true, 200),
    9999: updateRecord(undefined, 'known', true, 100),
  };
  assert.deepEqual(summarize(records, words), { seen: 2, mastered: 1, review: 1, attempts: 3, correct: 2 });
  assert.deepEqual(summarize({}, words), { seen: 0, mastered: 0, review: 0, attempts: 0, correct: 0 });
});

test('the extracted PDF vocabulary has 800 complete entries and every word yields a valid question', () => {
  const vocabulary = require('../dist/words.json');
  assert.equal(vocabulary.length, 800);
  assert.equal(new Set(vocabulary.map(w => w.id)).size, 800);
  assert.equal(new Set(vocabulary.map(w => w.word.toLowerCase())).size, 800);
  for (const word of vocabulary) {
    assert.ok(word.word.trim());
    assert.ok(word.meaning.trim());
    assert.ok(Number.isInteger(word.page) && word.page > 0);
    const options = makeOptions(word, vocabulary, random(word.id));
    assert.equal(options.length, 4, word.word);
    assert.equal(new Set(options.map(w => w.meaning)).size, 4, word.word);
    assert.equal(options.filter(w => w.id === word.id).length, 1, word.word);
  }
});
