'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createProgressStore} = require('../scripts/progress-store.cjs');

const document = (word = 'opaque') => ({
  app: 'gre-training-studio',
  progress: {
    version: 2, attempts: [{questionId: 'q1', answer: 'A'}], favorites: ['q1'],
    vocabulary: [{word, addedAt: 1, sources: [{questionId: 'q1'}]}],
    notes: {q1: '笔记'}, drafts: {essay1: '草稿'}, essays: [], sessions: [], session: null
  },
  legacyRC: {version: 1, questions: {q2: {answer: 'B'}}, bookmarks: ['q2'], notes: {}, history: [], session: null},
  mock: {version: 1, active: {id: 'mock1'}, history: [], updatedAt: 1},
  importedBanks: [{schema_version: 2, questions: [{id: 'q3'}], sources: [], materials: []}]
});

async function setup(t) {
  const temporaryBase = path.resolve(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temporaryBase, 'gre-progress-store-test-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), temporaryBase);
    assert.ok(path.basename(resolved).startsWith('gre-progress-store-test-'));
    await fs.rm(resolved, {recursive: true, force: true});
  });
  return {directory, store: createProgressStore({directory})};
}

const readJson = async filename => JSON.parse(await fs.readFile(filename, 'utf8'));

test('first save survives restart and copying its folder, with stable identity and complete learning state', async t => {
  const {directory, store} = await setup(t);
  const empty = await store.read();
  assert.deepEqual(await store.read(), empty);
  assert.equal(empty.revision, 0);
  assert.equal(empty.savedAt, 0);
  assert.equal(empty.document, null);
  assert.deepEqual(await fs.readdir(directory), []);
  const first = await store.write({revision: 0, document: document()});
  assert.equal(first.storeId, empty.storeId);
  assert.equal(first.revision, 1);
  assert.ok(first.savedAt > 0);
  assert.deepEqual(first.document, document());
  assert.deepEqual(await createProgressStore({directory}).read(), first);
  const copied = path.join(directory, 'usb-copy');
  await fs.mkdir(copied);
  await fs.copyFile(path.join(directory, 'progress.json'), path.join(copied, 'progress.json'));
  assert.deepEqual(await createProgressStore({directory: copied}).read(), first);
  const disk = await readJson(path.join(directory, 'progress.json'));
  assert.equal(disk.format, 'gre-portable-progress');
  assert.equal(disk.version, 1);
});

test('each successful replacement retains the previous valid revision and leaves no temporary file', async t => {
  const {directory, store} = await setup(t);
  await store.write({revision: 0, document: document('opaque')});
  await store.write({revision: 1, document: document('lucid')});
  let previous = await readJson(path.join(directory, 'progress.previous.json'));
  assert.equal(previous.revision, 1);
  assert.equal(previous.document.progress.vocabulary[0].word, 'opaque');
  await store.write({revision: 2, document: document('arcane')});
  previous = await readJson(path.join(directory, 'progress.previous.json'));
  assert.equal(previous.revision, 2);
  assert.equal(previous.document.progress.vocabulary[0].word, 'lucid');
  assert.equal((await store.read()).revision, 3);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['progress.json', 'progress.previous.json']);
});

test('concurrent saves cannot overwrite a newer revision; losing edits get one recoverable file', async t => {
  const {directory, store} = await setup(t);
  const incoming = document('lucid');
  const pending = store.write({revision: 0, document: incoming});
  incoming.progress.vocabulary[0].word = 'mutation-after-save';
  const results = await Promise.allSettled([pending, store.write({revision: 0, document: document('arcane')})]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  const conflict = results[1].reason;
  assert.equal(conflict.code, 'PROGRESS_CONFLICT');
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.current, results[0].value);
  assert.equal((await store.read()).document.progress.vocabulary[0].word, 'lucid');
  const recoveries = (await fs.readdir(directory)).filter(name => name.startsWith('progress.recovery.'));
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0], conflict.recoveryFile);
  const recovery = await readJson(path.join(directory, recoveries[0]));
  assert.equal(recovery.expectedRevision, 0);
  assert.equal(recovery.currentRevision, 1);
  assert.equal(recovery.document.progress.vocabulary[0].word, 'arcane');
  assert.equal((await store.write({revision: 1, document: document('recovered')})).revision, 2);
});

test('a corrupt or wrong-shaped file is never treated as an empty save or replaced', async t => {
  const {directory, store} = await setup(t);
  const filename = path.join(directory, 'progress.json');
  for (const contents of ['{broken', JSON.stringify({format: 'other', version: 1}), JSON.stringify({format: 'gre-portable-progress', version: 1, revision: 1})]) {
    await fs.writeFile(filename, contents);
    await assert.rejects(store.read(), {code: 'PROGRESS_CORRUPT'});
    await assert.rejects(store.write({revision: 0, document: document()}), {code: 'PROGRESS_CORRUPT'});
    assert.equal(await fs.readFile(filename, 'utf8'), contents);
    assert.deepEqual(await fs.readdir(directory), ['progress.json']);
  }
});

test('older progress without vocabulary is accepted and only approved document fields are persisted', async t => {
  const {directory, store} = await setup(t);
  const old = {app: 'gre-training-studio', progress: {version: 2, attempts: [], favorites: []}};
  const incoming = {...old, exportedAt: '2026-11-10', apiKey: 'secret-api-key', token: 'local-session-secret', settings: {apiKey: 'another-secret'}, path: '../outside.json'};
  const result = await store.write({revision: 0, document: incoming});
  assert.deepEqual(result.document, old);
  const contents = await fs.readFile(path.join(directory, 'progress.json'), 'utf8');
  assert.ok(!contents.includes('secret'));
  assert.ok(!contents.includes('outside'));
  result.document.progress.attempts.push({questionId: 'changed-after-save'});
  assert.deepEqual((await store.read()).document, old);
});

test('invalid revisions and malformed progress containers are rejected before creating files', async t => {
  const {directory, store} = await setup(t);
  for (const revision of [-1, 0.1, NaN, Infinity, '0', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(store.write({revision, document: document()}), {code: 'PROGRESS_INVALID', status: 400});
  }
  const invalidDocuments = [
    null, {}, {...document(), app: 'unrelated-app'},
    {...document(), progress: {version: 2, attempts: {}, favorites: []}},
    {...document(), progress: {version: 2, attempts: [], favorites: [], vocabulary: {}}},
    {...document(), mock: {version: 1, history: {}}},
    {...document(), legacyRC: {version: 1, questions: [], bookmarks: []}},
    {...document(), importedBanks: [{schema_version: 2, questions: {}}]}
  ];
  for (const invalidDocument of invalidDocuments) {
    await assert.rejects(store.write({revision: 0, document: invalidDocument}), {code: 'PROGRESS_INVALID'});
  }
  const circular = document();
  circular.progress.notes.cycle = circular;
  await assert.rejects(store.write({revision: 0, document: circular}), {code: 'PROGRESS_INVALID'});
  assert.deepEqual(await fs.readdir(directory), []);
});

test('an inaccessible replacement keeps current progress intact and reports a Chinese save error', async t => {
  const {directory, store} = await setup(t);
  await store.write({revision: 0, document: document()});
  const before = await fs.readFile(path.join(directory, 'progress.json'), 'utf8');
  // A directory at the backup filename creates a deterministic real filesystem failure on both OSes.
  await fs.mkdir(path.join(directory, 'progress.previous.json'));
  await assert.rejects(store.write({revision: 1, document: document('lucid')}), error => {
    assert.equal(error.code, 'PROGRESS_WRITE_FAILED');
    assert.match(error.message, /无法保存进度/);
    return true;
  });
  assert.equal(await fs.readFile(path.join(directory, 'progress.json'), 'utf8'), before);
  assert.equal((await store.read()).revision, 1);
  assert.equal((await fs.readdir(directory)).filter(name => name.endsWith('.tmp')).length, 0);
});

test('documents above 80 MB never replace an existing save', async t => {
  const {directory, store} = await setup(t);
  await store.write({revision: 0, document: document()});
  const incoming = document();
  incoming.progress.notes.large = 'a'.repeat(80 * 1024 * 1024);
  await assert.rejects(store.write({revision: 1, document: incoming}), {code: 'PROGRESS_TOO_LARGE', status: 413});
  assert.equal((await store.read()).revision, 1);
  assert.deepEqual(await fs.readdir(directory), ['progress.json']);
});
