'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

const MAX_BYTES = 80 * 1024 * 1024;
const FORMAT = 'gre-portable-progress';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isRevision = value => Number.isSafeInteger(value) && value >= 0;

function problem(code, message, status = 500, extra = {}) {
  return Object.assign(new Error(message), {code, status}, extra);
}

function invalid() {
  return problem('PROGRESS_INVALID', '学习进度格式不正确，请保留当前页面后重试。', 400);
}

function tooLarge() {
  return problem('PROGRESS_TOO_LARGE', '学习进度超过 80 MB，未写入文件。', 413);
}

function jsonText(value) {
  let text;
  try { text = JSON.stringify(value); } catch { throw invalid(); }
  if (typeof text !== 'string') throw invalid();
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw tooLarge();
  return text;
}

function optionalContainers(value, arrays, objects, nullableObjects = []) {
  for (const key of arrays) {
    if (value[key] !== undefined && !Array.isArray(value[key])) throw invalid();
  }
  for (const key of objects) {
    if (value[key] !== undefined && !isObject(value[key])) throw invalid();
  }
  for (const key of nullableObjects) {
    if (value[key] !== undefined && value[key] !== null && !isObject(value[key])) throw invalid();
  }
}

// Connection settings deliberately have no place in a portable progress document.
function cleanDocument(raw) {
  if (!isObject(raw) || raw.app !== 'gre-training-studio' || !isObject(raw.progress)) throw invalid();
  const selected = {app: 'gre-training-studio', progress: raw.progress};
  for (const key of ['legacyRC', 'mock', 'importedBanks']) {
    if (raw[key] !== undefined && raw[key] !== null) selected[key] = raw[key];
  }
  const result = JSON.parse(jsonText(selected));
  const progress = result.progress;
  if (!isObject(progress) || progress.version !== 2 || !Array.isArray(progress.attempts) || !Array.isArray(progress.favorites)) throw invalid();
  optionalContainers(progress, ['vocabulary', 'essays', 'sessions', 'migratedBookmarks'], ['notes', 'drafts'], ['session']);
  if (result.legacyRC !== undefined) {
    const legacy = result.legacyRC;
    if (!isObject(legacy) || legacy.version !== 1 || !isObject(legacy.questions) || !Array.isArray(legacy.bookmarks)) throw invalid();
    optionalContainers(legacy, ['history'], ['notes'], ['session']);
  }
  if (result.mock !== undefined) {
    const mock = result.mock;
    if (!isObject(mock) || mock.version !== 1 || !Array.isArray(mock.history)) throw invalid();
    optionalContainers(mock, [], [], ['active']);
  }
  if (result.importedBanks !== undefined) {
    if (!Array.isArray(result.importedBanks)) throw invalid();
    for (const bank of result.importedBanks) {
      if (!isObject(bank) || bank.schema_version !== 2 || !Array.isArray(bank.questions)) throw invalid();
      optionalContainers(bank, ['sources', 'materials'], []);
    }
  }
  return result;
}

function snapshot(envelope) {
  return {
    storeId: envelope.storeId,
    revision: envelope.revision,
    savedAt: envelope.savedAt,
    document: envelope.document
  };
}

function createProgressStore({directory} = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('必须指定学习进度目录。');
  const root = path.resolve(directory);
  const filename = path.join(root, 'progress.json');
  const previousFilename = path.join(root, 'progress.previous.json');
  let storeId = randomUUID();
  let queue = Promise.resolve();

  function enqueue(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  async function readEnvelope() {
    let text;
    try {
      const stat = await fs.stat(filename);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw problem('PROGRESS_CORRUPT', '已有进度文件不完整或格式不正确，已停止写入；请保留文件以便恢复。');
      text = await fs.readFile(filename, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return {format: FORMAT, version: 1, storeId, revision: 0, savedAt: 0, document: null};
      if (error.code === 'PROGRESS_CORRUPT') throw error;
      throw problem('PROGRESS_READ_FAILED', '无法读取进度文件，请检查文件夹是否可访问。');
    }
    try {
      if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw invalid();
      const envelope = JSON.parse(text);
      if (!isObject(envelope) || envelope.format !== FORMAT || envelope.version !== 1 ||
          typeof envelope.storeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(envelope.storeId) ||
          !isRevision(envelope.revision) || envelope.revision < 1 ||
          !Number.isSafeInteger(envelope.savedAt) || envelope.savedAt < 0) throw invalid();
      const document = cleanDocument(envelope.document);
      storeId = envelope.storeId;
      return {format: FORMAT, version: 1, storeId, revision: envelope.revision, savedAt: envelope.savedAt, document};
    } catch {
      throw problem('PROGRESS_CORRUPT', '已有进度文件不完整或格式不正确，已停止写入；请保留文件以便恢复。');
    }
  }

  async function atomicWrite(target, text) {
    const temporary = path.join(root, `.progress-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(text, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temporary, target);
      // Directory syncing makes renames durable on Unix. Windows cannot open directories this way.
      if (process.platform !== 'win32') {
        let directoryHandle;
        try {
          directoryHandle = await fs.open(root, 'r');
          await directoryHandle.sync();
        } catch (error) {
          // Some removable-drive filesystems do not implement directory fsync; the file was synced above.
          if (!['EINVAL', 'ENOTSUP', 'ENOSYS', 'EISDIR'].includes(error.code)) throw error;
        } finally {
          if (directoryHandle) await directoryHandle.close();
        }
      }
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  }

  return {
    read() {
      return enqueue(async () => snapshot(await readEnvelope()));
    },
    async write(input) {
      if (!isObject(input) || !isRevision(input.revision)) throw invalid();
      // Capture before joining the queue, so edits in the caller cannot change a pending save.
      const revision = input.revision;
      const document = cleanDocument(input.document);
      return enqueue(async () => {
        const current = await readEnvelope();
        if (current.revision >= Number.MAX_SAFE_INTEGER) throw problem('PROGRESS_WRITE_FAILED', '进度版本号已达到上限，无法继续写入。');
        const savedAt = Date.now();
        if (revision !== current.revision) {
          const recoveryFile = `progress.recovery.${new Date(savedAt).toISOString().replace(/[:.]/g, '-')}.${randomUUID()}.json`;
          const recovery = {
            format: 'gre-portable-progress-recovery', version: 1, storeId: current.storeId,
            expectedRevision: revision, currentRevision: current.revision, savedAt, document
          };
          const recoveryText = jsonText(recovery);
          try {
            await fs.mkdir(root, {recursive: true});
            await atomicWrite(path.join(root, recoveryFile), recoveryText);
          } catch {
            throw problem('PROGRESS_WRITE_FAILED', '另一个页面已保存更新，且无法保存本页恢复副本；请勿关闭当前页面，并检查文件夹权限或磁盘空间。', 500, {current: snapshot(current)});
          }
          throw problem('PROGRESS_CONFLICT', '另一个页面已保存更新。本页进度已另存为恢复副本，未覆盖已有进度。', 409, {current: snapshot(current), recoveryFile});
        }
        const next = {format: FORMAT, version: 1, storeId: current.storeId, revision: current.revision + 1, savedAt, document};
        const nextText = jsonText(next);
        try {
          await fs.mkdir(root, {recursive: true});
          if (current.document !== null) await atomicWrite(previousFilename, jsonText(current));
          await atomicWrite(filename, nextText);
        } catch {
          throw problem('PROGRESS_WRITE_FAILED', '无法保存进度，请检查文件夹写入权限、U 盘连接和剩余空间；请勿关闭当前页面。');
        }
        return snapshot(next);
      });
    }
  };
}

module.exports = {createProgressStore};
