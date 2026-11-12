(function (root) {
  'use strict';

  // This module never reads or writes storage. The application commits a complete
  // migrated/imported snapshot only after localStorage accepts the write.
  const DAY = 86400000;
  const MINUTE = 60000;
  const INTERVALS = [1, 3, 7, 14, 30];
  const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
  const MAX_COUNT = 1000000000;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8640000000000000;
  const clone = value => JSON.parse(JSON.stringify(value));
  const nowValue = now => timestamp(now) ? now : Date.now();

  function dateKey(value) {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Date-only input must be interpreted in the browser's local timezone. Parsing
  // YYYY-MM-DD with Date.parse would shift the deadline in some timezones.
  function parseExamDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const d = new Date(0);
    d.setFullYear(year, month - 1, day);
    d.setHours(23, 59, 59, 999);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d.getTime();
  }

  function policyInfo(settings = {}, now = Date.now()) {
    now = nowValue(now);
    const examDate = typeof settings?.examDate === 'string' ? settings.examDate : '';
    const deadline = parseExamDate(examDate);
    const remaining = deadline === null ? 0 : deadline - now;
    const active = remaining > 0 && remaining <= 30 * DAY;
    const factor = !active ? 1 : remaining <= 3 * DAY ? 0.15 : remaining <= 7 * DAY ? 0.3 : remaining <= 14 * DAY ? 0.5 : 0.75;
    return {
      mode: active ? 'compressed' : 'standard', active, compressed: active, examDate, deadline,
      daysRemaining: remaining > 0 ? Math.ceil(remaining / DAY) : 0, factor,
      expired: deadline !== null && remaining <= 0,
      label: active ? `考前压缩周期 · 距考试约 ${Math.ceil(remaining / DAY)} 天` : '常规周期 · 1、3、7、14、30 天',
      description: active ? '认识且答对后缩短间隔，并在剩余时间内安排再次复习；模糊与答错仍优先巩固。' : '认识且答对后依次间隔 1、3、7、14、30 天；模糊答对 30 分钟，答错或不认识 10 分钟。'
    };
  }

  function intervalFor(base, settings, now, shortInterval) {
    const p = policyInfo(settings, now);
    if (p.deadline === null || p.deadline <= now) return base;
    const remaining = p.deadline - now;
    if (!p.active || shortInterval) return Math.min(base, remaining);
    return Math.min(base * p.factor, remaining / 3, remaining);
  }

  function migrateRecord(record, now = Date.now()) {
    now = nowValue(now);
    const old = object(record) ? record : {};
    const attempts = count(old.attempts);
    const correct = Math.min(attempts, count(old.correct));
    const updatedAt = timestamp(old.updatedAt) ? old.updatedAt : now;
    return {
      ...old, attempts, correct,
      status: ['mastered', 'review'].includes(old.status) ? old.status : 'review',
      confidence: ['known', 'unknown', 'unsure'].includes(old.confidence) ? old.confidence : 'unknown',
      lastCorrect: typeof old.lastCorrect === 'boolean' ? old.lastCorrect : false,
      updatedAt,
      // V1 has no timing or streak history: require a fresh verification, and
      // never turn an aggregate correct count into an invented success streak.
      nextReviewAt: timestamp(old.nextReviewAt) ? old.nextReviewAt : now,
      consecutiveCorrect: count(old.consecutiveCorrect),
      confirmedStreak: count(old.confirmedStreak),
      lastWrongAt: timestamp(old.lastWrongAt) ? old.lastWrongAt : attempts && old.lastCorrect === false ? updatedAt : null,
      reviewCount: own(old, 'reviewCount') ? count(old.reviewCount) : Math.max(0, attempts - 1),
      lapseCount: own(old, 'lapseCount') ? count(old.lapseCount) : attempts - correct
    };
  }

  function validSelfSession(session, words = []) {
    if (!object(session) || !Array.isArray(words)) return false;
    const ids = new Set(words.map(word => String(word.id)));
    if (!Array.isArray(session.queue) || !session.queue.length || session.queue.length > ids.size || Array.from(session.queue).some(id => typeof id !== 'string' || !ids.has(id)) || new Set(session.queue).size !== session.queue.length) return false;
    if (!Number.isInteger(session.index) || session.index < 0 || session.index > session.queue.length || !Array.isArray(session.answers) || session.answers.length > session.queue.length || !['prompt', 'answer', 'done'].includes(session.stage) || !timestamp(session.startedAt)) return false;
    if (Array.from(session.answers).some((answer, index) => !object(answer) || answer.id !== session.queue[index] || !['known', 'unknown'].includes(answer.confidence) || own(answer, 'correct') || own(answer, 'selected') || own(answer, 'autoSpecialAt') && (answer.confidence !== 'unknown' || !timestamp(answer.autoSpecialAt)))) return false;
    if (session.stage === 'done') return session.index === session.queue.length && session.answers.length === session.queue.length;
    if (session.index >= session.queue.length) return false;
    // Answers remain a complete prefix while the cursor can revisit earlier
    // reveals. A prompt is always the first word that has not been answered.
    return session.stage === 'answer' ? session.index < session.answers.length : session.index === session.answers.length;
  }

  function migrateState(saved, words = [], now = Date.now()) {
    now = nowValue(now);
    const old = object(saved) ? saved : {};
    const records = {};
    Object.entries(object(old.records) ? old.records : {}).forEach(([id, record]) => {
      // Preserve extension records rather than silently deleting existing data.
      // Analytics/training only look at IDs in the supplied 800-word database.
      if (!['__proto__', 'constructor', 'prototype'].includes(id)) records[id] = migrateRecord(record, now);
    });
    const ids = new Set(words.map(word => String(word.id)));
    const specialList = {};
    Object.entries(object(old.specialList) ? old.specialList : {}).forEach(([id, entry]) => {
      if (ids.has(id) && !['__proto__', 'constructor', 'prototype'].includes(id) && object(entry) && typeof entry.active === 'boolean' && timestamp(entry.updatedAt)) {
        specialList[id] = { active: entry.active, updatedAt: entry.updatedAt };
      }
    });
    return {
      version: 2, records: {}, history: [], basic: null, test: null, training: null,
      view: 'basic', reviewOnly: false, ...old, version: 2, records,
      history: Array.isArray(old.history) ? old.history : [],
      selfCheck: validSelfSession(old.selfCheck, words) ? clone(old.selfCheck) : null,
      specialReview: validSelfSession(old.specialReview, words) ? clone(old.specialReview) : null,
      specialList,
      settings: { examDate: '', ...(object(old.settings) ? old.settings : {}) },
      daily: object(old.daily) ? old.daily : {},
      dailyStartedAt: timestamp(old.dailyStartedAt) ? old.dailyStartedAt : now
    };
  }

  function recordAnswer(previous, confidence, correct, now = Date.now(), settings = {}) {
    if (!['known', 'unknown', 'unsure'].includes(confidence) || typeof correct !== 'boolean' || (confidence === 'unknown' && correct)) {
      throw new Error('作答记录无效：不认识的单词不能记为答对。');
    }
    now = nowValue(now);
    const p = migrateRecord(previous, now);
    const confirmed = confidence === 'known' && correct;
    const confirmedStreak = confirmed ? p.confirmedStreak + 1 : 0;
    const interval = !correct ? 10 * MINUTE : !confirmed ? 30 * MINUTE : INTERVALS[Math.min(confirmedStreak - 1, INTERVALS.length - 1)] * DAY;
    return {
      ...p, attempts: p.attempts + 1, correct: p.correct + Number(correct),
      status: confirmed ? 'mastered' : 'review', confidence, lastCorrect: correct, updatedAt: now,
      consecutiveCorrect: correct ? p.consecutiveCorrect + 1 : 0, confirmedStreak,
      lastWrongAt: correct ? p.lastWrongAt : now,
      reviewCount: p.reviewCount + Number(p.attempts > 0),
      lapseCount: p.lapseCount + Number(!correct),
      nextReviewAt: now + intervalFor(interval, settings, now, !confirmed)
    };
  }

  function reviewAt(record, settings = {}, now = Date.now()) {
    if (!record) return null;
    now = nowValue(now);
    const next = timestamp(record.nextReviewAt) ? record.nextReviewAt : now;
    const p = policyInfo(settings, now);
    if (!p.active || !timestamp(record.updatedAt) || next <= now) return next;
    // Anchor compression to the last answer, not the time this function runs,
    // so repeatedly opening the page cannot push a review farther into the future.
    const confirmed = record.confidence === 'known' && record.lastCorrect;
    const base = !record.lastCorrect ? 10 * MINUTE : !confirmed ? 30 * MINUTE : INTERVALS[Math.min(Math.max(1, count(record.confirmedStreak)) - 1, INTERVALS.length - 1)] * DAY;
    const shortened = confirmed ? Math.min(base * p.factor, Math.max(0, p.deadline - record.updatedAt) / 3) : base;
    return Math.min(next, record.updatedAt + shortened, p.deadline);
  }

  const isDue = (record, now = Date.now(), settings = {}) => Boolean(record && record.attempts > 0 && reviewAt(record, settings, now) <= now);
  const isStable = (record, now = Date.now(), settings = {}) => Boolean(record && record.attempts > 0 && record.confirmedStreak >= 3 && record.lastCorrect && record.confidence === 'known' && !isDue(record, now, settings));

  function prioritize(words, records = {}, now = Date.now(), settings = {}) {
    const weight = word => {
      const r = records[String(word.id)];
      if (!r || !r.attempts) return [2, 0, 0, 0];
      const errorRate = (r.attempts - r.correct) / r.attempts;
      const due = reviewAt(r, settings, now);
      if (isDue(r, now, settings)) return [0, due, -count(r.lapseCount), -errorRate];
      if (!isStable(r, now, settings)) return [1, -count(r.lapseCount), -errorRate, due];
      return [3, due, 0, 0];
    };
    return words.map((word, index) => ({ word, index, weight: weight(word) })).sort((a, b) => {
      for (let i = 0; i < a.weight.length; i++) {
        if (a.weight[i] !== b.weight[i]) return a.weight[i] - b.weight[i];
      }
      return a.index - b.index;
    }).map(item => item.word);
  }

  function getStats(records = {}, words = [], now = Date.now(), settings = {}) {
    const totals = { seen: 0, mastered: 0, stable: 0, review: 0, due: 0, unseen: 0, attempts: 0, correct: 0, lists: [], forgetful: [] };
    const lists = new Map();
    words.forEach(word => {
      const group = word.group ?? word.list ?? 1;
      if (!lists.has(String(group))) lists.set(String(group), { group, total: 0, seen: 0, mastered: 0, stable: 0, review: 0, due: 0, unseen: 0, rate: 0 });
      const list = lists.get(String(group));
      list.total++;
      const r = records[String(word.id)];
      if (!r || !r.attempts) { totals.unseen++; list.unseen++; return; }
      totals.seen++; list.seen++;
      totals.attempts += r.attempts; totals.correct += r.correct;
      if (r.status === 'mastered') { totals.mastered++; list.mastered++; }
      const stable = isStable(r, now, settings);
      if (stable) { totals.stable++; list.stable++; } else { totals.review++; list.review++; }
      if (isDue(r, now, settings)) { totals.due++; list.due++; }
      const errorRate = (r.attempts - r.correct) / r.attempts;
      if (count(r.lapseCount) || errorRate > 0 || r.confidence === 'unsure' || r.confidence === 'unknown') {
        totals.forgetful.push({
          id: String(word.id), word: word.word, group, meaning: word.meaning,
          lapseCount: count(r.lapseCount), errorRate, reviewCount: count(r.reviewCount),
          attempts: r.attempts, correct: r.correct, confidence: r.confidence,
          lastWrongAt: r.lastWrongAt ?? null, nextReviewAt: reviewAt(r, settings, now), stable
        });
      }
    });
    totals.lists = [...lists.values()].sort((a, b) => String(a.group).localeCompare(String(b.group), undefined, { numeric: true })).map(list => ({ ...list, rate: list.total ? Math.round(list.stable / list.total * 100) : 0, masteryRate: list.total ? Math.round(list.mastered / list.total * 100) : 0 }));
    totals.forgetful.sort((a, b) => b.lapseCount - a.lapseCount || b.errorRate - a.errorRate || (b.lastWrongAt || 0) - (a.lastWrongAt || 0));
    return totals;
  }

  function recordDaily(daily = {}, id, correct, now = Date.now()) {
    if (typeof correct !== 'boolean') throw new Error('每日统计需要明确的答题结果。');
    const key = dateKey(nowValue(now));
    const old = object(daily[key]) ? daily[key] : {};
    const ids = [...new Set([...(Array.isArray(old.ids) ? old.ids : []), String(id)])];
    return { ...daily, [key]: { ...old, attempts: count(old.attempts) + 1, correct: count(old.correct) + Number(correct), ids } };
  }

  function dailyTrend(daily = {}, days = 14, now = Date.now()) {
    if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('趋势天数须为 1–366 的整数。');
    const end = new Date(nowValue(now));
    end.setHours(12, 0, 0, 0);
    return Array.from({ length: days }, (_, index) => {
      const d = new Date(end);
      d.setDate(d.getDate() - (days - index - 1));
      const date = dateKey(d);
      const row = daily[date] || {};
      const attempts = count(row.attempts), correct = count(row.correct);
      return { date, attempts, correct, accuracy: attempts ? Math.round(correct / attempts * 100) : null, unique: new Set(row.ids || []).size };
    });
  }

  function exportProgress(state, now = Date.now()) {
    return { format: 'gre800-progress', version: 2, exportedAt: nowValue(now), state: clone(state) };
  }

  function validateImport(payload, words = [], now = Date.now()) {
    const fail = message => { throw new Error(`无法导入：${message}`); };
    let serialized;
    try { serialized = typeof payload === 'string' ? payload : JSON.stringify(payload); }
    catch (_) { fail('文件不是可读取的 JSON 数据。'); }
    if (typeof serialized !== 'string' || serialized.length > MAX_IMPORT_BYTES) fail('文件为空或大于 4 MB。');
    let data;
    try { data = JSON.parse(serialized); } catch (_) { fail('JSON 文件已损坏。'); }
    let nodes = 0;
    const scan = (value, depth = 0) => {
      if (++nodes > 150000 || depth > 24) fail('数据体量或嵌套深度超出范围。');
      if (typeof value === 'number' && !Number.isFinite(value)) fail('包含无效数字。');
      if (value && typeof value === 'object') Object.keys(value).forEach(key => {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('包含不安全的字段名。');
        scan(value[key], depth + 1);
      });
    };
    scan(data);
    if (!object(data)) fail('顶层必须是学习进度对象。');
    let saved = data;
    if (own(data, 'format')) {
      if (data.format !== 'gre800-progress' || data.version !== 2 || !timestamp(data.exportedAt) || !object(data.state) || data.state.version !== 2) fail('导出格式或版本不受支持。');
      saved = data.state;
    }
    if (![1, 2].includes(saved.version)) fail('只支持版本 1 或 2 的学习进度。');
    const ids = new Set(words.map(word => String(word.id)));
    const wordsById = new Map(words.map(word => [String(word.id), word]));
    const validId = id => (typeof id === 'string' || Number.isInteger(id)) && ids.has(String(id));
    const validCount = (value, maximum = MAX_COUNT) => Number.isInteger(value) && value >= 0 && value <= maximum;
    if (own(saved, 'specialList')) {
      if (!object(saved.specialList) || Object.keys(saved.specialList).length > words.length) fail('特殊待复习列表格式无效。');
      Object.entries(saved.specialList).forEach(([id, entry]) => {
        if (!validId(id) || !object(entry) || typeof entry.active !== 'boolean' || !timestamp(entry.updatedAt)) fail('特殊待复习列表包含无效单词或记录。');
      });
    }
    ['selfCheck', 'specialReview'].forEach(key => {
      if (own(saved, key) && saved[key] !== null && !validSelfSession(saved[key], words)) fail(`${key} 自查会话格式无效。`);
    });
    if (!object(saved.records)) fail('缺少单词学习记录。');
    if (Object.keys(saved.records).length > words.length) fail('学习记录数量超过当前词库。');
    Object.entries(saved.records).forEach(([id, r]) => {
      if (!validId(id)) fail(`单词 ID ${id} 不在当前 800 词库内。`);
      if (!object(r) || !validCount(r.attempts) || r.attempts < 1 || !validCount(r.correct, r.attempts) || !['mastered', 'review'].includes(r.status) || !['known', 'unknown', 'unsure'].includes(r.confidence) || typeof r.lastCorrect !== 'boolean' || !timestamp(r.updatedAt)) fail(`单词 ${id} 的记录已损坏。`);
      if (r.confidence === 'unknown' && r.lastCorrect) fail(`单词 ${id} 的熟悉程度与答题结果矛盾。`);
      ['consecutiveCorrect', 'confirmedStreak', 'reviewCount', 'lapseCount'].forEach(key => {
        if (own(r, key) && !validCount(r[key], r.attempts)) fail(`单词 ${id} 的 ${key} 无效。`);
      });
      if (own(r, 'nextReviewAt') && !timestamp(r.nextReviewAt)) fail(`单词 ${id} 的复习时间无效。`);
      if (own(r, 'lastWrongAt') && r.lastWrongAt !== null && !timestamp(r.lastWrongAt)) fail(`单词 ${id} 的答错时间无效。`);
      if (own(r, 'confirmedStreak') && own(r, 'consecutiveCorrect') && r.confirmedStreak > r.consecutiveCorrect) fail(`单词 ${id} 的连续答对记录矛盾。`);
    });
    if (own(saved, 'settings') && !object(saved.settings)) fail('学习设置已损坏。');
    if (saved.settings && own(saved.settings, 'examDate') && saved.settings.examDate !== '' && parseExamDate(saved.settings.examDate) === null) fail('考试日期无效。');
    if (own(saved, 'history')) {
      if (!Array.isArray(saved.history) || saved.history.length > 10000) fail('测试历史格式无效。');
      saved.history.forEach(h => {
        if (!object(h) || !validCount(h.total, words.length) || h.total < 1 || !validCount(h.correct, h.total) || !timestamp(h.finishedAt)) fail('测试历史包含损坏的记录。');
      });
    }
    if (own(saved, 'daily')) {
      if (!object(saved.daily) || Object.keys(saved.daily).length > 36600) fail('每日统计格式无效。');
      Object.entries(saved.daily).forEach(([date, row]) => {
        if (parseExamDate(date) === null || !object(row) || !validCount(row.attempts) || !validCount(row.correct, row.attempts) || !Array.isArray(row.ids) || row.ids.some(id => !validId(id)) || new Set(row.ids.map(String)).size !== row.ids.length || row.ids.length > row.attempts) fail(`日期 ${date} 的每日统计无效。`);
      });
    }
    if (own(saved, 'dailyStartedAt') && !timestamp(saved.dailyStartedAt)) fail('每日统计起始时间无效。');
    if (own(saved, 'view') && (typeof saved.view !== 'string' || saved.view.length > 64)) fail('当前页面设置无效。');
    if (own(saved, 'reviewOnly') && typeof saved.reviewOnly !== 'boolean') fail('复习筛选设置无效。');
    ['basic', 'test', 'training'].forEach(key => {
      const s = saved[key];
      if (s === null || s === undefined) return;
      if (!object(s) || !Array.isArray(s.queue) || s.queue.length < 1 || s.queue.length > words.length || s.queue.some(id => !validId(id)) || new Set(s.queue.map(String)).size !== s.queue.length || !validCount(s.index, s.queue.length) || !Array.isArray(s.answers) || s.answers.length > s.queue.length || !['prompt', 'choices', 'answer', 'done'].includes(s.stage) || !timestamp(s.startedAt)) fail(`${key} 学习会话格式无效。`);
      if (['prompt', 'choices'].includes(s.stage) && s.answers.length !== s.index || s.stage === 'answer' && s.answers.length !== s.index + 1 || s.stage === 'done' && (s.index !== s.queue.length || s.answers.length !== s.queue.length) || s.stage !== 'done' && s.index >= s.queue.length) fail(`${key} 学习会话进度不一致。`);
      if (key === 'basic' && s.stage === 'done') fail('基础学习会话不能标记为测试完成。');
      const synonymMode = key === 'training' && ['syn-word', 'syn-cn', 'syn-odd'].includes(s.mode);
      if (synonymMode && !Array.isArray(s.questions)) fail('同义词训练缺少来源题目。');
      const correctId = index => synonymMode ? s.questions[index]?.correctId : s.queue[index];
      s.answers.forEach((a, index) => {
        if (!object(a) || !validId(a.id) || String(a.id) !== String(s.queue[index]) || !['known', 'unknown', 'unsure'].includes(a.confidence) || typeof a.correct !== 'boolean' || !(a.selected === null || validId(a.selected)) || a.confidence === 'unknown' && (a.correct || a.selected !== null)) fail(`${key} 学习会话包含无效答案。`);
        if (a.confidence !== 'unknown' && (!validId(a.selected) || !validId(correctId(index)) || a.correct !== (String(a.selected) === String(correctId(index))))) fail(`${key} 学习会话的选项与正误记录不一致。`);
      });
      if (own(s, 'options') && (!Array.isArray(s.options) || s.options.length > 4 || s.options.some(o => !object(o) || !validId(o.id)) || new Set(s.options.map(o => String(o.id))).size !== s.options.length)) fail(`${key} 学习会话包含越界或重复选项。`);
      if (s.stage === 'choices' || s.stage === 'answer' && s.confidence !== 'unknown') {
        if (!['known', 'unsure'].includes(s.confidence) || !Array.isArray(s.options) || s.options.length !== 4 || !s.options.some(o => String(o.id) === String(correctId(s.index)))) fail(`${key} 学习会话缺少四选一答案。`);
        if (key !== 'training' && s.options.some(o => o.meaning !== wordsById.get(String(o.id)).meaning)) fail(`${key} 学习会话中的释义与原词库不一致。`);
      }
      if (s.stage === 'answer' && s.confidence !== s.answers[s.answers.length - 1].confidence) fail(`${key} 学习会话的熟悉程度记录不一致。`);
      if (own(s, 'questions')) {
        if (!Array.isArray(s.questions) || s.questions.length !== s.queue.length || s.questions.some(q => q !== null && !object(q))) fail(`${key} 训练题列表无效。`);
        s.questions.forEach((q, index) => {
          if (!q) { if (synonymMode) fail('同义词训练包含空题目。'); return; }
          ['id', 'wordId', 'correctId', 'correctWordId'].forEach(field => { if (own(q, field) && !validId(q[field])) fail('训练题包含越界单词。'); });
          if (own(q, 'wordId') && String(q.wordId) !== String(s.queue[index])) fail('训练题与词条队列不一致。');
          if (own(q, 'relatedIds') && (!Array.isArray(q.relatedIds) || q.relatedIds.some(id => !validId(id)))) fail('训练题包含越界关联词。');
          if (q.source && own(q.source, 'wordId') && !validId(q.source.wordId)) fail('训练题包含越界来源词。');
          if (own(q, 'options') && (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some(o => !object(o) || !validId(o.id)) || new Set(q.options.map(o => String(o.id))).size !== 4 || !q.options.some(o => String(o.id) === String(q.correctId)))) fail('训练题包含损坏的选项。');
          if (synonymMode && !validId(q.correctId)) fail('同义词训练缺少正确答案。');
        });
      }
    });
    const state = migrateState(saved, words, now);
    const stats = getStats(state.records, words, now, state.settings);
    return { state, summary: { records: stats.seen, seen: stats.seen, attempts: stats.attempts, correct: stats.correct, history: state.history.length, days: Object.keys(state.daily).length, sourceVersion: saved.version, version: 2 } };
  }

  function mergeProgress(current, incoming, words = [], now = Date.now()) {
    const a = migrateState(current, words, now), b = migrateState(incoming, words, now);
    const result = { ...b, ...a, version: 2, records: { ...b.records, ...a.records } };
    Object.keys(b.records).forEach(id => {
      if (!a.records[id]) return;
      const x = a.records[id], y = b.records[id];
      const latest = y.updatedAt > x.updatedAt ? y : x;
      result.records[id] = {
        ...y, ...x, ...latest,
        attempts: Math.max(x.attempts, y.attempts),
        correct: Math.max(x.correct, y.correct),
        reviewCount: Math.max(x.reviewCount, y.reviewCount),
        lapseCount: Math.max(x.lapseCount, y.lapseCount),
        lastWrongAt: x.lastWrongAt === null && y.lastWrongAt === null ? null : Math.max(x.lastWrongAt || 0, y.lastWrongAt || 0)
      };
      result.records[id].correct = Math.min(result.records[id].correct, result.records[id].attempts);
    });
    const seenHistory = new Set();
    result.history = [...a.history, ...b.history].filter(h => {
      const key = `${h.finishedAt}|${h.total}|${h.correct}`;
      if (seenHistory.has(key)) return false;
      seenHistory.add(key); return true;
    }).sort((x, y) => y.finishedAt - x.finishedAt);
    result.daily = { ...b.daily, ...a.daily };
    Object.keys(b.daily).forEach(date => {
      if (!a.daily[date]) return;
      const x = a.daily[date], y = b.daily[date];
      const ids = [...new Set([...(x.ids || []).map(String), ...(y.ids || []).map(String)])];
      result.daily[date] = { ...y, ...x, ids, attempts: Math.max(x.attempts, y.attempts, ids.length), correct: Math.max(x.correct, y.correct) };
    });
    result.settings = { ...b.settings, ...a.settings };
    if (!object(current?.settings) || !own(current.settings, 'examDate')) result.settings.examDate = b.settings.examDate;
    result.dailyStartedAt = Math.min(a.dailyStartedAt, b.dailyStartedAt);
    result.specialList = { ...b.specialList, ...a.specialList };
    Object.entries(b.specialList).forEach(([id, entry]) => {
      if (!a.specialList[id] || entry.updatedAt > a.specialList[id].updatedAt) result.specialList[id] = entry;
    });
    // Preserve every existing local session, including a completed test. When a
    // slot is empty, restore the imported session so its unfinished work remains
    // available after navigating to that mode. Importing never changes the page.
    ['basic', 'test', 'training', 'selfCheck', 'specialReview'].forEach(key => { result[key] = a[key] ?? b[key] ?? null; });
    ['view', 'reviewOnly'].forEach(key => { result[key] = a[key]; });
    return clone(result);
  }

  const api = { DAY, MINUTE, MAX_IMPORT_BYTES, dateKey, parseExamDate, policyInfo, migrateRecord, migrateState, validSelfSession, recordAnswer, reviewAt, isDue, isStable, prioritize, getStats, recordDaily, dailyTrend, exportProgress, validateImport, mergeProgress };
  root.GREProgress = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
