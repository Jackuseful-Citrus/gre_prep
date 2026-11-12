const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const lexicon = require('../dist/lexicon.js');
const root = path.resolve(__dirname, '..');
const words = JSON.parse(fs.readFileSync(path.join(root, 'dist/words.json'), 'utf8'));
const original = JSON.stringify(words);
const index = lexicon.buildIndex(words);
function seeded(seed = 20261106) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }

test('the original 800-word database remains byte-for-byte unchanged', () => {
  const hashes = {
    'words.js': 'ae85d473d72002db3c9ffcec8e1ac95869d859a81daf09002bf78b3c79c511a4',
    'words.json': '4794da1a3b5e64e1e92eb7c3fc9cc566b28ee1c2ac672eb0039c038e440c9469'
  };
  for (const [file, expected] of Object.entries(hashes)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'dist', file))).digest('hex'), expected);
  assert.equal(words.length, 800);
  assert.equal(index.senses.length, 815);
  assert.equal(index.stats.synonymSenses, 684);
  assert.equal(JSON.stringify(words), original);
});

test('index and questions survive JSON persistence and the browser UMD entry works', () => {
  const roundTrip = JSON.parse(JSON.stringify(index));
  assert.deepEqual(lexicon.questions(roundTrip, 'syn-cn', seeded()), lexicon.questions(index, 'syn-cn', seeded()));
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dist/lexicon.js'), 'utf8'), context);
  assert.equal(typeof context.window.GRELexicon.buildIndex, 'function');
  assert.equal(context.window.GRELexicon.buildIndex(words).stats.words, 800);
});

test('every positive edge has exact source evidence; no reverse or transitive edges are invented', () => {
  for (const relation of index.relations) {
    const source = index.wordsById[relation.wordId];
    assert.equal(relation.source.raw, source.definitions[relation.senseIndex].synonyms);
    assert.ok(relation.source.raw.split(/[,，;；]/).map(s => s.trim()).includes(relation.token));
    if (relation.targetId) assert.equal(index.wordsById[relation.targetId].word.toLowerCase(), relation.token.toLowerCase());
  }
  assert.ok(index.relations.some(r => r.wordId === '725' && r.targetId === '690' && r.status === 'usable'));
  assert.ok(!index.relations.some(r => r.wordId === '690' && r.targetId === '725'));
  assert.ok(!index.relations.some(r => r.wordId === '60' && r.targetId === '559'));
  assert.ok(index.relations.some(r => r.token === 'superb' && !r.targetId && r.status === 'external'));
});

for (const mode of lexicon.modes) {
  test(mode + ' has four unique original-vocabulary choices and exactly one answer by source evidence', () => {
    const pool = lexicon.questions(index, mode, seeded());
    assert.ok(pool.length > 0);
    assert.equal(new Set(pool.map(q => q.key)).size, pool.length);
    for (const q of pool) {
      const sense = index.senses.find(s => s.wordId === q.wordId && s.senseIndex === q.senseIndex);
      const direct = index.relations.filter(r => r.wordId === q.wordId && r.senseIndex === q.senseIndex && r.targetId).map(r => r.targetId);
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options.map(o => o.id)).size, 4);
      assert.equal(q.options.filter(o => o.id === q.correctId).length, 1);
      assert.ok(q.options.every(o => index.wordsById[o.id] && index.wordsById[o.id].word === o.label));
      assert.ok(!q.options.some(o => o.id === q.wordId));
      assert.equal(q.source.page, index.wordsById[q.wordId].page);
      if (mode === 'syn-odd') {
        assert.ok(!direct.includes(q.correctId));
        assert.equal(q.options.filter(o => sense.relatedIds.includes(o.id)).length, 3);
        assert.match(q.explanation, /不表示.*语义不同/);
      } else {
        assert.ok(sense.relatedIds.includes(q.correctId));
        assert.equal(q.options.filter(o => direct.includes(o.id)).length, 1);
        assert.match(q.explanation, /不能视为绝对等价/);
        if (mode === 'syn-cn') {
          assert.equal(q.prompt, sense.meaning);
          assert.ok(!q.context.includes(sense.word));
        }
      }
    }
  });
}

test('suspicious relations are retained with annotations and never selected as correct associations', () => {
  for (const [id, token] of [['66', 'noxious'], ['385', 'capricious'], ['511', 'impenetrable'], ['516', 'errant'], ['543', 'apocryphal'], ['738', 'alacrity']]) {
    const relation = index.relations.find(r => r.wordId === id && r.token === token);
    assert.equal(relation.status, 'excluded');
    assert.ok(lexicon.flagsFor(index, id).some(f => f.field === 'synonyms' && f.raw.includes(token)));
    assert.ok(!lexicon.questions(index, 'syn-word', seeded()).some(q => q.wordId === id && q.correctId === relation.targetId));
  }
  for (const id of [29, 113, 177, 203, 264, 458, 500, 700, 715, 771]) assert.ok(lexicon.flagsFor(index, id).length > 0);
  assert.equal(index.wordsById['29'].definitions[0].synonyms, 'chicanery, artfice');
  assert.equal(index.wordsById['177'].definitions[0].synonyms, 'enigma riddle');
  assert.equal(index.wordsById['715'].definitions[0].synonyms, 'dreary, jejune, monotonous, tedious, tedious');
});

test('sense identity and source evidence distinguish multiple meanings without merging them', () => {
  const first = index.senses.find(s => s.wordId === '121' && s.senseIndex === 0);
  const second = index.senses.find(s => s.wordId === '121' && s.senseIndex === 1);
  assert.deepEqual(first.relatedIds, ['643']);
  assert.deepEqual(second.relatedIds, ['697']);
  const sap = index.relations.find(r => r.wordId === '570' && r.targetId === '589');
  assert.deepEqual(sap.targetSenseIndices, [1]);
});

test('missing choices return no question, invalid modes are harmless, and input is never mutated', () => {
  const tiny = [
    { id: 9001, word: 'alpha', pos: 'adj.', meaning: '甲义', page: 1, definitions: [{ pos: 'adj.', meaning: '甲义', english: 'alpha definition', synonyms: 'beta' }] },
    { id: 9002, word: 'beta', pos: 'adj.', meaning: '乙义', page: 1, definitions: [{ pos: 'adj.', meaning: '乙义', english: 'beta definition' }] }
  ];
  const before = JSON.stringify(tiny), small = lexicon.buildIndex(tiny);
  assert.equal(lexicon.makeQuestion(small, 'syn-word', seeded()), null);
  assert.equal(lexicon.makeQuestion(index, 'invalid', seeded()), null);
  assert.equal(JSON.stringify(tiny), before);
  assert.equal(JSON.stringify(words), original);
});
