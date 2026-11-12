/* Local GRE format simulation. No official adaptive calibration or scaled-score claim. */
(function (root, factory) {
  const value = factory(typeof module === 'object' && module.exports ? require('./platform-core.js') : root.GRECore);
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.GREMockCore = value;
})(typeof window !== 'undefined' ? window : globalThis, function (Core) {
  'use strict';
  if (!Core) throw Error('GRECore 必须先加载。');
  const VERSION = 1;
  const SPECS = {
    AWA: { subject: 'AWA', title: 'Analytical Writing · Issue', minutes: 30, count: 1 },
    V1: { subject: 'Verbal', title: 'Verbal Reasoning · Section 1', minutes: 18, count: 12 },
    V2: { subject: 'Verbal', title: 'Verbal Reasoning · Section 2', minutes: 23, count: 15 },
    Q1: { subject: 'Quant', title: 'Quantitative Reasoning · Section 1', minutes: 21, count: 12 },
    Q2: { subject: 'Quant', title: 'Quantitative Reasoning · Section 2', minutes: 26, count: 15 }
  };
  const ORDERS = ['VVQQ', 'VQVQ', 'VQQV', 'QVVQ', 'QVQV', 'QQVV'];
  const VERBAL = new Set(['TC1', 'TC2', 'TC3', 'SE', 'RC1', 'RCMultiple', 'RCSentence']);
  const QUANT = new Set(['QC', 'QuantSingle', 'QuantMultiple', 'NumericEntry', 'DI']);
  const BLUEPRINT = '本地练习配比：V1 TC 3 / SE 3 / RC 6；V2 TC 4 / SE 4 / RC 7；Quant 覆盖数量比较、单选、多选、数值填空和数据解释。配比不是 ETS 固定配比；不模拟官方自适应难度或 130–170 分数。';
  const clean = text => String(text || '').normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
  const timestamp = n => Number.isSafeInteger(n) && n >= 0;
  const plain = o => !!o && typeof o === 'object' && !Array.isArray(o) && (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
  const fail = message => { throw Error('模考记录无效：' + message); };
  function context(bank) {
    if (!bank || !Array.isArray(bank.questions) || !Array.isArray(bank.sources) || !Array.isArray(bank.materials)) throw Error('无法读取本地题库。');
    return { questions: new Map(bank.questions.map(q => [q.question_id, q])), materials: new Map(bank.materials.map(m => [m.id, m])), sources: new Set(bank.sources.map(s => s.id)), materialKeys: new Map(), questionKeys: new Map(), positions: new Map(bank.questions.map((q, i) => [q.question_id, i])) };
  }
  function eligible(q, ctx) {
    if (!q || !ctx.sources.has(q.source_id) || typeof q.question_content !== 'string' || !q.question_content.trim()) return false;
    if (q.material_id && !ctx.materials.has(q.material_id)) return false;
    if (q.category === 'AWA') return q.question_type === 'Issue' && ['verified', 'extracted'].includes(q.answer_status) && typeof q.instructions === 'string' && q.instructions.trim().length > 20;
    if (!q.gradable || q.answer_status !== 'verified' || !Array.isArray(q.correct_answer) || !q.correct_answer.length) return false;
    if (!(q.category === 'Verbal' && VERBAL.has(q.question_type) || q.category === 'Quant' && QUANT.has(q.question_type))) return false;
    const options = q.blank_groups?.length ? q.blank_groups.flatMap(g => Array.isArray(g.options) ? g.options : []) : q.options || [];
    if (!options.every(o => o && typeof o.id === 'string' && typeof o.text === 'string') || new Set(options.map(o => o.id)).size !== options.length) return false;
    if (new Set(q.correct_answer).size !== q.correct_answer.length) return false;
    const mode = Core.mode(q);
    if (mode === 'numeric') return q.category === 'Quant' && ['NumericEntry', 'DI'].includes(q.question_type) && q.correct_answer.every(v => !!Core.rational(v));
    if (q.question_type === 'NumericEntry') return false;
    if (!q.correct_answer.every(id => options.some(o => o.id === id))) return false;
    if (q.question_type === 'TC1' && (options.length !== 5 || q.correct_answer.length !== 1)) return false;
    if (['TC2', 'TC3'].includes(q.question_type)) {
      const n = Number(q.question_type.slice(-1));
      if (q.blank_groups?.length !== n || q.correct_answer.length !== n || !q.blank_groups.every(g => g.options.length === 3 && g.options.filter(o => q.correct_answer.includes(o.id)).length === 1)) return false;
    }
    if (q.question_type === 'SE' && (options.length !== 6 || q.correct_answer.length !== 2)) return false;
    if (q.question_type.startsWith('RC')) {
      const m = ctx.materials.get(q.material_id);
      if (!m || !(m.text?.trim() || m.paragraphs?.some(p => typeof p === 'string' && p.trim()) || m.images?.length)) return false;
      if (q.question_type === 'RC1' && options.length !== 5 || q.question_type === 'RCMultiple' && options.length !== 3) return false;
    }
    if (q.question_type === 'QC' && options.length !== 4 || q.question_type === 'QuantSingle' && options.length !== 5 || q.question_type === 'DI' && mode === 'single' && options.length !== 5) return false;
    if (mode === 'single' && q.correct_answer.length !== 1) return false;
    return ['single', 'multiple', 'pair', 'blanks'].includes(mode) && options.length > 1;
  }
  function materialKey(q, ctx) {
    if (!q.material_id) return '';
    if (ctx.materialKeys.has(q.material_id)) return ctx.materialKeys.get(q.material_id);
    const m = ctx.materials.get(q.material_id);
    const text = clean(m?.text || m?.paragraphs?.join(' '));
    const key = text.length > 40 ? 'text:' + text : 'id:' + q.material_id;
    ctx.materialKeys.set(q.material_id, key);
    return key;
  }
  function questionKey(q, ctx) {
    if (ctx.questionKeys.has(q.question_id)) return ctx.questionKeys.get(q.question_id);
    const m = materialKey(q, ctx);
    const content = q.images?.length ? clean(q.raw_text || q.question_content) : clean(q.question_content);
    const options = (q.blank_groups?.length ? q.blank_groups.flatMap(g => g.options) : q.options || []).map(o => clean(o.text)).join('|');
    // Formula images can differ despite equal or absent extracted text; do not treat them as equivalent.
    const imageKey = q.images?.length ? q.images.map(i => i.src).join('|') : '';
    const key = [q.question_type, m, content, options, imageKey].join('\u241e');
    ctx.questionKeys.set(q.question_id, key);
    return key;
  }
  function shuffle(items, rng) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const value = rng();
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw Error('随机数生成器必须返回 [0, 1) 内的数值。');
      const j = Math.floor(value * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function createSubjectPractice(bank, options = {}, rng = Math.random) {
    if (!plain(options) || !['Verbal', 'Quant'].includes(options.subject)) throw Error('请选择 Verbal 或 Quant。');
    const subject = options.subject, count = options.count === undefined ? 20 : options.count;
    if (!Number.isInteger(count) || count < 1 || count > 100) throw Error('刷题数量必须是 1–100 之间的整数。');
    if (typeof rng !== 'function') throw Error('随机数生成器必须是函数。');
    const ctx = context(bank);
    // Sample questions first, without a type blueprint or a learned/unlearned preference.
    // Shared material is grouped only after selection so it does not bias which questions enter.
    const pool = shuffle(bank.questions.filter(q => q.category === subject && eligible(q, ctx)), rng);
    const seenIds = new Set(), seenKeys = new Set(), selected = [];
    let availableCount = 0;
    for (const q of pool) {
      const key = questionKey(q, ctx);
      if (seenIds.has(q.question_id) || seenKeys.has(key)) continue;
      seenIds.add(q.question_id); seenKeys.add(key); availableCount++;
      if (selected.length < count) selected.push(q);
    }
    const groups = new Map();
    for (const q of selected) {
      const key = materialKey(q, ctx) || q.question_id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(q);
    }
    const inOrder = (a, b) => Number(a.question_order ?? a.source_number ?? 0) - Number(b.question_order ?? b.source_number ?? 0) || ctx.positions.get(a.question_id) - ctx.positions.get(b.question_id);
    const ids = [...groups.values()].flatMap(group => group.sort(inOrder).map(q => q.question_id));
    return { subject, ids, requestedCount: count, availableCount };
  }
  function createExam(bank, options = {}, now = Date.now(), rng = Math.random) {
    if (!timestamp(now)) throw Error('模考开始时间无效。');
    if (!['random', 'VQVQ', 'QVQV'].includes(options.order || 'random')) throw Error('未知模考顺序。');
    const ctx = context(bank), seen = new Set(Array.isArray(options.seenIds) ? options.seenIds : []);
    const pool = bank.questions.filter(q => eligible(q, ctx));
    const used = new Set(), usedKeys = new Set(), usedMaterials = new Map(), assignments = {};
    const preferUnseen = options.preferUnseen !== false;
    const inOrder = (a, b) => Number(a.question_order ?? a.source_number ?? 0) - Number(b.question_order ?? b.source_number ?? 0) || ctx.positions.get(a.question_id) - ctx.positions.get(b.question_id);
    function pick(sectionId, predicate, count, label, grouped = false) {
      const available = pool.filter(q => predicate(q) && !used.has(q.question_id) && !usedKeys.has(questionKey(q, ctx)) && (!materialKey(q, ctx) || !usedMaterials.has(materialKey(q, ctx)) || usedMaterials.get(materialKey(q, ctx)) === sectionId));
      let bundles;
      if (grouped) {
        const groups = new Map();
        for (const q of available) { const key = materialKey(q, ctx) || q.question_id; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(q); }
        bundles = shuffle([...groups.values()].map(qs => qs.sort(inOrder)), rng);
      } else bundles = shuffle(available, rng).map(q => [q]);
      if (preferUnseen) bundles.sort((a, b) => a.filter(q => seen.has(q.question_id)).length / a.length - b.filter(q => seen.has(q.question_id)).length / b.length);
      const picked = [];
      for (const bundle of bundles) {
        if (picked.length === count) break;
        for (const q of bundle) {
          if (picked.length === count) break;
          const key = questionKey(q, ctx);
          if (usedKeys.has(key)) continue;
          picked.push(q.question_id); used.add(q.question_id); usedKeys.add(key);
          const mk = materialKey(q, ctx); if (mk) usedMaterials.set(mk, sectionId);
        }
      }
      if (picked.length !== count) throw Error('无法创建完整模考：' + sectionId + ' 的' + label + '需 ' + count + ' 题，仅找到 ' + picked.length + ' 道符合当前格式、答案核验与不重复要求的题。请恢复完整题库后重试。');
      return picked;
    }
    assignments.AWA = pick('AWA', q => q.category === 'AWA', 1, 'Issue 写作');
    for (const [sid, counts] of [['V1', [1, 1, 1, 3, 6]], ['V2', [1, 2, 1, 4, 7]]]) {
      assignments[sid] = ['TC1', 'TC2', 'TC3', 'SE'].flatMap((type, i) => pick(sid, q => q.question_type === type, counts[i], type));
      assignments[sid].push(...pick(sid, q => q.category === 'Verbal' && q.question_type.startsWith('RC'), counts[4], '阅读', true));
    }
    for (const [sid, counts] of [['Q1', [4, 3, 1, 2, 2]], ['Q2', [5, 4, 2, 2, 2]]]) {
      assignments[sid] = ['QC', 'QuantSingle', 'QuantMultiple', 'NumericEntry', 'DI'].flatMap((type, i) => pick(sid, q => q.question_type === type, counts[i], type, true));
      // Keep every shared chart adjacent, including a chart shared by different Quant response types.
      const firstIndex = new Map();
      assignments[sid].forEach((id, i) => { const key = materialKey(ctx.questions.get(id), ctx) || id; if (!firstIndex.has(key)) firstIndex.set(key, i); });
      assignments[sid].sort((a, b) => firstIndex.get(materialKey(ctx.questions.get(a), ctx) || a) - firstIndex.get(materialKey(ctx.questions.get(b), ctx) || b) || inOrder(ctx.questions.get(a), ctx.questions.get(b)));
    }
    const order = options.order && options.order !== 'random' ? options.order : shuffle(ORDERS, rng)[0];
    let v = 0, q = 0;
    const sectionIds = ['AWA', ...order.split('').map(letter => letter === 'V' ? 'V' + ++v : 'Q' + ++q)];
    const sections = sectionIds.map((id, i) => ({ id, subject: SPECS[id].subject, title: SPECS[id].title, minutes: SPECS[id].minutes, ids: assignments[id], startedAt: i === 0 ? now : null, deadline: i === 0 ? now + SPECS[id].minutes * 60000 : null, endedAt: null, endReason: null }));
    const responses = {};
    for (const id of used) responses[id] = { selected: [], text: '', marked: false, elapsedMs: 0 };
    return { version: VERSION, id: 'mock-' + now + '-' + Math.floor(rng() * 0x100000000).toString(36), startedAt: now, currentSection: 0, sections, responses, endedAt: null, aborted: false, index: 0, blueprint: BLUEPRINT, order, preferUnseen, repeatedCount: [...used].filter(id => seen.has(id)).length };
  }
  function close(exam, boundary, reason) {
    const section = exam.sections[exam.currentSection];
    section.endedAt = boundary;
    section.endReason = reason;
    if (exam.currentSection === exam.sections.length - 1) { exam.endedAt = boundary; return; }
    exam.currentSection++;
    exam.index = 0;
    const next = exam.sections[exam.currentSection];
    next.startedAt = boundary;
    next.deadline = boundary + next.minutes * 60000;
  }
  function tick(exam, bank, now = Date.now()) {
    if (!timestamp(now)) throw Error('当前时间无效。');
    while (exam.endedAt === null && now >= exam.sections[exam.currentSection].deadline) close(exam, exam.sections[exam.currentSection].deadline, 'timeout');
    return exam;
  }
  function advance(exam, bank, now = Date.now(), reason = 'manual') {
    if (!['manual', 'timeout'].includes(reason)) throw Error('未知交卷原因。');
    if (!timestamp(now)) throw Error('当前时间无效。');
    if (exam.endedAt !== null) return exam;
    const current = exam.sections[exam.currentSection];
    if (now >= current.deadline) return tick(exam, bank, now);
    if (reason === 'timeout') throw Error('本节计时尚未结束。');
    close(exam, Math.max(now, current.startedAt), reason);
    return exam;
  }
  function abort(exam, bank, now = Date.now()) {
    tick(exam, bank, now);
    if (exam.endedAt !== null) return exam;
    const section = exam.sections[exam.currentSection];
    section.endedAt = Math.max(now, section.startedAt);
    section.endReason = 'abort';
    exam.endedAt = section.endedAt;
    exam.aborted = true;
    return exam;
  }
  function summary(exam, bank) {
    const ctx = context(bank);
    const sections = exam.sections.map(section => {
      const visited = section.startedAt !== null, ended = section.endedAt !== null, writing = section.subject === 'AWA';
      const result = { id: section.id, subject: section.subject, title: section.title, minutes: section.minutes, status: !visited ? 'queued' : !ended ? 'active' : section.endReason === 'abort' ? 'aborted' : 'completed', correct: ended && !writing ? 0 : null, wrong: ended && !writing ? 0 : null, omitted: 0, answered: 0, total: section.ids.length, graded: 0, ungraded: 0, visited: visited ? section.ids.length : 0, unvisited: visited ? 0 : section.ids.length, elapsedMs: ended ? section.endedAt - section.startedAt : 0, responses: [] };
      if (!visited) return result;
      for (const id of section.ids) {
        const q = ctx.questions.get(id), r = exam.responses[id];
        const answered = !!(r?.selected?.length || r?.text?.trim());
        const complete = !!(q && r && Core.complete(q, r));
        if (answered) result.answered++;
        else if (ended) result.omitted++;
        const correct = ended && !writing && answered && q ? Core.grade(q, r) : null;
        if (ended && !writing && answered && typeof correct === 'boolean') { result.graded++; if (correct) result.correct++; else result.wrong++; }
        else if (ended && !writing && answered) result.ungraded++;
        result.responses.push({ questionId: id, answered, complete, correct, omitted: ended && !answered });
      }
      return result;
    });
    const empty = () => ({ correct: 0, wrong: 0, omitted: 0, answered: 0, total: 0, graded: 0, ungraded: 0, visited: 0, unvisited: 0, elapsedMs: 0 });
    const subjects = { Verbal: empty(), Quant: empty(), AWA: empty() }, total = empty();
    for (const section of sections) for (const key of Object.keys(total)) {
      subjects[section.subject][key] += section[key] || 0;
      if (section.subject !== 'AWA') total[key] += section[key] || 0;
    }
    subjects.AWA.correct = null; subjects.AWA.wrong = null;
    return { id: exam.id, startedAt: exam.startedAt, endedAt: exam.endedAt, aborted: exam.aborted, repeatedCount: exam.repeatedCount || 0, sections, subjects, total, elapsedMs: sections.reduce((sum, section) => sum + section.elapsedMs, 0), blueprint: exam.blueprint, scoring: '客观题只统计原始正误，不换算官方分数；写作不自动评分。' };
  }
  function restore(raw, bank, now = Date.now()) {
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { fail('不是有效 JSON。'); } }
    if (!plain(raw) || raw.version !== VERSION || typeof raw.id !== 'string' || !raw.id || !timestamp(raw.startedAt) || !Array.isArray(raw.sections) || raw.sections.length !== 5 || !plain(raw.responses)) fail('基本结构不完整。');
    const exam = JSON.parse(JSON.stringify(raw)), ctx = context(bank);
    if (!timestamp(now) || exam.startedAt > now + 60000) fail('开始时间晚于当前设备时间，请先核对系统时钟。');
    if (!Number.isInteger(exam.currentSection) || exam.currentSection < 0 || exam.currentSection > 4 || !Number.isInteger(exam.index) || typeof exam.aborted !== 'boolean' || exam.endedAt !== null && !timestamp(exam.endedAt)) fail('当前节或完成状态错误。');
    const ids = exam.sections.map(s => s?.id);
    if (ids[0] !== 'AWA' || new Set(ids).size !== 5 || ids.some(id => !SPECS[id]) || ids.indexOf('V1') > ids.indexOf('V2') || ids.indexOf('Q1') > ids.indexOf('Q2')) fail('考试节顺序错误。');
    const allIds = new Set(), semanticKeys = new Set(), materialSections = new Map();
    for (let i = 0; i < exam.sections.length; i++) {
      const s = exam.sections[i], spec = SPECS[s.id];
      if (!plain(s) || s.subject !== spec.subject || s.minutes !== spec.minutes || !Array.isArray(s.ids) || s.ids.length !== spec.count) fail('节题量、科目或时限已被修改。');
      if (s.startedAt === null) {
        if (i <= exam.currentSection || s.deadline !== null || s.endedAt !== null || s.endReason !== null) fail('未开始节有非法时间记录。');
      } else {
        if (i > exam.currentSection || !timestamp(s.startedAt) || s.startedAt > now + 60000 || s.deadline !== s.startedAt + spec.minutes * 60000) fail('计时截止时间不一致。');
        const priorEnd = i ? exam.sections[i - 1].endedAt : exam.startedAt;
        if (s.startedAt !== priorEnd) fail('节间时间不连续。');
        if (s.endedAt === null) {
          if (i !== exam.currentSection || exam.endedAt !== null || s.endReason !== null) fail('已锁定节不能重新作答。');
        } else if (!timestamp(s.endedAt) || s.endedAt > now + 60000 || s.endedAt < s.startedAt || s.endedAt > s.deadline || !['manual', 'timeout', 'abort'].includes(s.endReason) || s.endReason === 'timeout' && s.endedAt !== s.deadline || s.endReason === 'abort' && (!exam.aborted || i !== exam.currentSection) || i === exam.currentSection && exam.endedAt === null) fail('交卷时间或原因无效。');
      }
      let lastMaterial = '', closedMaterials = new Set(), previousOrder = -Infinity;
      for (const id of s.ids) {
        const q = ctx.questions.get(id);
        if (typeof id !== 'string' || allIds.has(id) || !eligible(q, ctx) || q.category !== s.subject) fail('题目缺失、重复、来源未核验或格式不适用。');
        allIds.add(id);
        const key = questionKey(q, ctx);
        if (semanticKeys.has(key)) fail('包含重复内容。');
        semanticKeys.add(key);
        const mk = materialKey(q, ctx), order = Number(q.question_order ?? q.source_number ?? 0);
        if (mk) {
          if (materialSections.has(mk) && materialSections.get(mk) !== s.id) fail('同一阅读或图表材料跨节重复。');
          materialSections.set(mk, s.id);
          if (mk !== lastMaterial) { if (closedMaterials.has(mk)) fail('同材料题目未连续排列。'); if (lastMaterial) closedMaterials.add(lastMaterial); previousOrder = -Infinity; }
          if (order < previousOrder) fail('同材料题目顺序改变。');
          previousOrder = order;
        } else if (lastMaterial) closedMaterials.add(lastMaterial);
        lastMaterial = mk;
        const r = exam.responses[id];
        if (!plain(r) || !Array.isArray(r.selected) || r.selected.some(x => typeof x !== 'string') || new Set(r.selected).size !== r.selected.length || typeof r.text !== 'string' || r.text.length > 1000000 || typeof r.marked !== 'boolean' || !Number.isFinite(r.elapsedMs) || r.elapsedMs < 0) fail('作答数据格式错误。');
        const mode = Core.mode(q), choices = new Set((q.blank_groups?.length ? q.blank_groups.flatMap(g => g.options) : q.options || []).map(o => o.id));
        if (r.selected.some(id => !choices.has(id)) || ['numeric', 'writing'].includes(mode) && r.selected.length || mode === 'single' && r.selected.length > 1 || mode === 'pair' && r.selected.length > 2 || mode === 'blanks' && q.blank_groups.some(g => g.options.filter(o => r.selected.includes(o.id)).length > 1)) fail('作答选项不属于题目结构。');
        if (!['numeric', 'writing'].includes(mode) && r.text) fail('选择题含异常文本作答。');
        if (i > exam.currentSection && (r.selected.length || r.text || r.marked || r.elapsedMs)) fail('未进入节不能含有作答。');
        exam.responses[id] = { selected: r.selected.slice(), text: r.text, marked: r.marked, elapsedMs: r.elapsedMs };
      }
      s.title = spec.title;
    }
    if (Object.keys(exam.responses).length !== allIds.size || Object.keys(exam.responses).some(id => !allIds.has(id))) fail('作答集合与试卷不一致。');
    if (exam.index < 0 || exam.index >= exam.sections[exam.currentSection].ids.length) fail('当前题号超出范围。');
    const current = exam.sections[exam.currentSection];
    if (exam.endedAt !== null && (exam.endedAt !== current.endedAt || !exam.aborted && exam.currentSection !== 4) || exam.aborted && (exam.endedAt === null || current.endReason !== 'abort')) fail('终止状态不一致。');
    if (!Number.isInteger(exam.repeatedCount ?? 0) || (exam.repeatedCount ?? 0) < 0 || (exam.repeatedCount ?? 0) > allIds.size) fail('重复题计数无效。');
    exam.blueprint = BLUEPRINT;
    exam.order = ids.slice(1).map(id => id[0]).join('');
    exam.repeatedCount ??= 0;
    return exam;
  }
  return { VERSION, SPECS, BLUEPRINT, createExam, createSubjectPractice, advance, tick, abort, summary, restore, eligible: (q, bank) => eligible(q, context(bank)) };
});
