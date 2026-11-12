const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const originalHashes = {
  'dist/words.json': '4794da1a3b5e64e1e92eb7c3fc9cc566b28ee1c2ac672eb0039c038e440c9469',
  'dist/words.js': 'ae85d473d72002db3c9ffcec8e1ac95869d859a81daf09002bf78b3c79c511a4',
  'scripts/words.json': '4794da1a3b5e64e1e92eb7c3fc9cc566b28ee1c2ac672eb0039c038e440c9469',
  'scripts/pdf-extracted.txt': 'eee4cc8d9b16891c917f1df696f5b323ed406ce201e906b67950696b2e8b068b',
  'scripts/raw-entries.json': 'c7e25dddb89fb7f6fc93e5e7d17015c2116d955f6b1216dce582c5aabf0ef433',
};

test('v2 preserves the original PDF extraction and vocabulary byte for byte', () => {
  for (const [file, expected] of Object.entries(originalHashes)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    assert.equal(actual, expected, file);
  }
});

test('the original 800 entries and all 815 definitions stay available in browser and JSON', () => {
  const words = JSON.parse(fs.readFileSync(path.join(root, 'dist/words.json'), 'utf8'));
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dist/words.js'), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.GRE_WORDS)), words);
  assert.equal(words.length, 800);
  assert.deepEqual(words.map(word => word.id), Array.from({ length: 800 }, (_, index) => index + 1));
  assert.equal(words.reduce((total, word) => total + word.definitions.length, 0), 815);
  assert.equal(words.filter(word => word.definitions.length > 1).length, 15);
  for (let group = 1; group <= 8; group++) assert.equal(words.filter(word => word.group === group).length, 100);
  for (const word of words) {
    assert.ok(word.word && word.meaning && word.definitions.length);
    for (const definition of word.definitions) assert.ok(definition.meaning && definition.english, word.word);
  }
});
