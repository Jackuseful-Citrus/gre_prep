(() => {
  'use strict';
  const app = document.getElementById('app');
  const words = (window.GRE_WORDS || []).map(w => ({ ...w, id: String(w.id) }));
  const L = window.GRELogic;
  const P = window.GREProgress, X = window.GRELexicon, V = window.GREViews;
  if (words.length < 4 || !L || !P || !X || !V) {
    app.innerHTML = '<div class="empty-state"><h1>词库暂时没有加载成功</h1><p>请刷新页面，或确认 words.js 与网页放在同一文件夹。</p></div>';
    return;
  }
  const byId = new Map(words.map(w => [w.id, w]));
  const KEY = 'gre800-word-studio-v1';
  const lexicon = X.buildIndex(words);
  const MODE_NAMES = { 'en-cn': '英文 → 中文', 'cn-en': '中文 → 英文', 'def-en': '英文释义 → 单词', 'syn-word': '单词关联匹配', 'syn-cn': '中文反向关联', 'syn-odd': '异类词识别' };
  const banks = {};
  const bankFor = mode => banks[mode] || (banks[mode] = X.questions(lexicon, mode));
  const modeOf = session => session?.mode || 'en-cn';
  const isSynonym = session => modeOf(session).startsWith('syn-');
  const questionOf = session => isSynonym(session) ? session.questions[session.index] : null;
  const correctId = session => questionOf(session)?.correctId || session.queue[session.index];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const icon = (name, size = 20) => {
    const paths = { arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', check: '<path d="m5 12 4 4L19 6"/>', cross: '<path d="m6 6 12 12M6 18 18 6"/>', unsure: '<path d="M8 8a4 4 0 0 1 8 0c0 3-4 3-4 6m0 4h.01"/>', sound: '<path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>', book: '<path d="M12 6C9 4 5 4 2 5v15c3-1 7-1 10 1 3-2 7-2 10-1V5c-3-1-7-1-10 1Zm0 0v15"/>', leaf: '<path d="M20 4c-11-1-16 3-16 9a7 7 0 0 0 7 7c6 0 9-6 9-16ZM4 20 15 9"/>' };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.book}</svg>`;
  };
  let storageOK = true;
  let maySave = true, pendingImport = null, importName = '';
  let state = { version: 2, records: {}, history: [], basic: null, test: null, training: null, selfCheck: null, specialReview: null, specialList: {}, view: 'basic', reviewOnly: false, daily: {}, dailyStartedAt: Date.now(), settings: { examDate: '', detailsExpanded: true } };
  function validSession(s, test) {
    if (!s || !Array.isArray(s.queue) || !s.queue.length || !s.queue.every(id => byId.has(id)) || new Set(s.queue).size !== s.queue.length || !Number.isInteger(s.index) || s.index < 0 || s.index > s.queue.length) return false;
    if (!Array.isArray(s.answers) || s.answers.length > s.queue.length || !['prompt', 'choices', 'answer', 'done'].includes(s.stage) || !Number.isFinite(s.startedAt)) return false;
    if (!MODE_NAMES[modeOf(s)]) return false;
    if (isSynonym(s) && (!Array.isArray(s.questions) || s.questions.length !== s.queue.length || !s.questions.every((q, i) => q && String(q.wordId) === s.queue[i] && q.mode === s.mode && typeof q.prompt === 'string' && typeof q.explanation === 'string' && Array.isArray(q.options) && q.options.length === 4 && q.options.every(o => o && byId.has(String(o.id)) && typeof o.label === 'string') && new Set(q.options.map(o => String(o.id))).size === 4 && q.options.some(o => String(o.id) === String(q.correctId))))) return false;
    if (!s.answers.every((a, i) => a && a.id === s.queue[i] && ['known', 'unknown', 'unsure'].includes(a.confidence) && typeof a.correct === 'boolean' && (a.confidence === 'unknown' ? a.selected === null && !a.correct : byId.has(a.selected) && a.correct === (a.selected === (isSynonym(s) ? String(s.questions[i].correctId) : a.id))))) return false;
    if (['prompt', 'choices'].includes(s.stage) && s.answers.length !== s.index) return false;
    if (s.stage === 'choices' || (s.stage === 'answer' && s.confidence !== 'unknown')) {
      if (!['known', 'unsure'].includes(s.confidence) || !Array.isArray(s.options) || s.options.length !== 4 || !s.options.every(o => o && byId.has(o.id) && o.meaning === (modeOf(s) === 'en-cn' ? byId.get(o.id).meaning : byId.get(o.id).word)) || new Set(s.options.map(o => o.id)).size !== 4 || !s.options.some(o => o.id === String(correctId(s)))) return false;
    }
    if (s.stage === 'answer' && (s.answers.length !== s.index + 1 || s.confidence !== s.answers.at(-1).confidence)) return false;
    if (s.stage === 'done' && (!test || s.index !== s.queue.length || s.answers.length !== s.queue.length)) return false;
    if (s.stage !== 'done' && s.index >= s.queue.length) return false;
    return true;
  }
  try {
    const raw = localStorage.getItem(KEY);
    let saved = null;
    try { saved = JSON.parse(raw || 'null'); }
    catch (_) { if (raw) localStorage.setItem(`${KEY}-recovery`, raw); }
    if (saved && ![1, 2].includes(saved.version)) { maySave = false; storageOK = false; }
    if (saved && [1, 2].includes(saved.version)) {
      if (saved.version === 1 && !localStorage.getItem(`${KEY}-backup-v1`)) {
        try { localStorage.setItem(`${KEY}-backup-v1`, raw); } catch (_) { maySave = false; storageOK = false; }
      }
      state = { ...state, ...P.migrateState(saved, words, Date.now()) };
      state.settings = { examDate: '', detailsExpanded: true, ...state.settings };
      state.basic = validSession(state.basic, false) ? state.basic : null;
      state.test = validSession(state.test, true) ? state.test : null;
      state.training = validSession(state.training, true) ? state.training : null;
      if (!['basic', 'test', 'progress', 'recall', 'synonyms', 'quality', 'exam', 'self-check', 'special-review', 'special-study'].includes(state.view)) state.view = 'basic';
    }
  } catch (_) { storageOK = false; maySave = false; }
  function save() {
    try { if (!maySave) throw new Error('保护原有记录'); localStorage.setItem(KEY, JSON.stringify(state)); storageOK = true; } catch (_) { storageOK = false; }
    const status = document.getElementById('storage-status');
    if (status) status.textContent = storageOK ? '进度已保存在此浏览器' : '当前无法保存进度，请勿关闭页面';
  }
  const summary = () => L.summarize(state.records, words);
  const reviewWords = () => P.prioritize(words.filter(w => state.records[w.id] && !P.isStable(state.records[w.id], Date.now(), state.settings)), state.records, Date.now(), state.settings);
  function newSession(pool, mode = 'en-cn', prioritized = false) {
    return { queue: (prioritized ? pool : L.shuffle(pool)).map(w => w.id), index: 0, answers: [], stage: 'prompt', confidence: null, options: [], startedAt: Date.now(), mode };
  }
  function ensureBasic() {
    if (state.basic && state.basic.index < state.basic.queue.length) return;
    const pool = state.reviewOnly ? reviewWords() : words;
    if (!pool.length) { state.basic = null; return; }
    const previous = state.basic?.queue.at(-1);
    state.basic = newSession(P.prioritize(L.shuffle(pool), state.records, Date.now(), state.settings), 'en-cn', true);
    if (state.basic.queue.length > 1 && state.basic.queue[0] === previous) [state.basic.queue[0], state.basic.queue[1]] = [state.basic.queue[1], state.basic.queue[0]];
  }
  const header = (eyebrow, title, description, action = '') => `<header class="page-header"><div><div class="eyebrow">${eyebrow}</div><h1 class="page-title" tabindex="-1">${title}</h1><p class="page-description">${description}</p></div>${action ? `<div class="header-actions">${action}</div>` : ''}</header>`;
  function updateSidebar() {
    document.querySelectorAll('[data-nav]').forEach(btn => {
      const active = btn.dataset.nav === (state.view === 'special-study' ? 'special-review' : state.view);
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    });
    const stats = summary();
    const progress = document.getElementById('side-progress');
    if (progress) progress.textContent = `${stats.seen} / ${words.length}`;
    const bar = document.getElementById('side-progress-bar');
    if (bar) bar.style.width = `${stats.seen / words.length * 100}%`;
    const mastered = document.getElementById('side-mastered');
    if (mastered) mastered.textContent = String(stats.mastered);
  }
  function sidePanel(session, testing) {
    const s = P.getStats(state.records, words, Date.now(), state.settings);
    const count = session?.answers.length || 0;
    return `<aside class="side-panel"><div class="panel-heading">${icon('leaf')}<span>${testing ? '本次测试' : '一点一点，积累起来'}</span></div>
      <div class="stat-number">${testing ? count : s.seen}<span class="count-note"> / ${testing ? session.queue.length : words.length}</span></div><p class="muted">${testing ? '已完成题目' : '已经学习的单词'}</p>
      <div class="mini-progress"><span style="width:${testing ? count / session.queue.length * 100 : s.seen / words.length * 100}%"></span></div>
      <div class="stat-row"><span>${testing ? '本次题量' : '稳定掌握'}</span><strong>${testing ? session.queue.length : s.stable}<small> ${testing ? '题' : '词'}</small></strong></div>
      <div class="stat-row"><span>${testing ? '尚未完成' : '待复习'}</span><strong>${testing ? session.queue.length - count : s.review}<small> ${testing ? '题' : '词'}</small></strong></div>
      <div class="card-divider"></div><div class="section-kicker">${testing ? '计分规则' : '今天的学习方法'}</div>
      <p class="panel-copy">${testing ? '选对得 1 分，选错或“不认识”得 0 分。每个单词只出现一次，最后一起回顾。' : '先在脑海里回忆词义，再选择熟悉程度。诚实的“模糊”，比碰巧选对更有用。'}</p>
      <div class="note-card"><span class="section-kicker">你的词库</span><p>《GRE800词 》</p><span class="muted">800 个单词 · 8 个 List<br>释义摘自你的 PDF</span></div></aside>`;
  }
  function confidenceButtons() {
    return `<div class="confidence-grid">
      <button class="confidence-button known" data-confidence="known"><span class="confidence-icon">${icon('check')}</span><span class="confidence-copy"><span class="confidence-title">认识</span><span class="confidence-desc">选一选，确认一下</span></span><kbd class="keycap">1</kbd></button>
      <button class="confidence-button unknown" data-confidence="unknown"><span class="confidence-icon">${icon('cross')}</span><span class="confidence-copy"><span class="confidence-title">不认识</span><span class="confidence-desc">直接学习释义</span></span><kbd class="keycap">2</kbd></button>
      <button class="confidence-button unsure" data-confidence="unsure"><span class="confidence-icon">${icon('unsure')}</span><span class="confidence-copy"><span class="confidence-title">模糊</span><span class="confidence-desc">用选项找找感觉</span></span><kbd class="keycap">3</kbd></button>
    </div>`;
  }
  function renderStudy(testing, training = false) {
    if (!testing) ensureBasic();
    const session = training ? state.training : testing ? state.test : state.basic;
    if (testing && !session) return renderSetup();
    if (testing && session.stage === 'done') return renderResults(training);
    const toggle = !testing ? `<label class="review-toggle switch-label"><input id="review-toggle" type="checkbox" ${state.reviewOnly ? 'checked' : ''}>只看待复习</label>` : training ? '<button class="button secondary small" data-action="training-settings">调整训练</button>' : `<span class="pill">${icon('book', 15)} 随机抽题 · 不重复</span>`;
    const top = header(training ? 'RECALL & CONNECT' : testing ? 'A LITTLE CHALLENGE' : 'ONE WORD AT A TIME', training ? MODE_NAMES[modeOf(session)] : testing ? '测试一下，记住了多少。' : '每一个词，都算数。', training ? '先回忆，再验证；不确定但猜对，也会留在复习队列。' : testing ? '先判断熟悉程度，再验证你的记忆。' : '不急着翻答案。给自己几秒，想想这个词的意思。', toggle);
    if (!session) {
      app.innerHTML = top + `<section class="empty-state">${icon('check', 36)}<h2>暂时没有待复习的词</h2><p>尚未稳定掌握、模糊、答错或已经到期的词会出现在这里。</p><button class="button primary" data-action="all-words">开始学习全部单词 ${icon('arrow')}</button></section>`;
      return;
    }
    const word = byId.get(session.queue[session.index]);
    const question = questionOf(session);
    const correct = String(correctId(session));
    const reverse = modeOf(session) !== 'en-cn';
    const reveal = session.stage === 'answer';
    const answer = reveal ? session.answers.at(-1) : null;
    let interaction = '';
    if (session.stage === 'prompt') interaction = `<p class="word-instruction">${reverse ? '能回忆出对应的英文词吗？先判断把握程度。' : '你认识这个单词吗？'}</p>${confidenceButtons()}`;
    if (session.stage === 'choices') interaction = `<p class="word-instruction">${question ? esc(question.context || '按原词表的本考法关联选择。') : reverse ? '选出与提示对应的英文单词。' : session.confidence === 'known' ? '来确认一下：哪个是它的中文释义？' : '有一点印象？选出你认为正确的释义。'}</p><div class="option-grid ${reverse ? 'english-options' : ''}">${session.options.map((o, i) => `<button class="option-button" data-option="${esc(o.id)}"><span class="option-letter">${'ABCD'[i]}</span><span>${esc(o.meaning)}</span><kbd class="keycap">${i + 1}</kbd></button>`).join('')}</div>`;
    if (reveal) {
      const type = answer.confidence === 'unknown' ? 'neutral' : answer.correct ? 'success' : 'error';
      const feedback = answer.confidence === 'unknown' ? '没关系，从这次开始记住它。' : answer.correct ? answer.confidence === 'unsure' ? '选对了！这个词仍会留在待加强里。' : '选对了，下一次复习已经安排好。' : '还差一点，把这个词再记一遍。';
      interaction = `<div class="feedback ${type}" role="status">${icon(answer.correct ? 'check' : answer.confidence === 'unknown' ? 'book' : 'cross', 18)} ${feedback}</div>`;
      if (answer.confidence !== 'unknown') interaction += `<div class="option-grid ${reverse ? 'english-options' : ''}">${session.options.map((o, i) => `<button disabled class="option-button ${o.id === correct ? 'correct' : o.id === answer.selected ? 'wrong' : ''}"><span class="option-letter">${'ABCD'[i]}</span><span>${esc(o.meaning)}</span>${o.id === correct ? '<span class="result-status">正确答案</span>' : o.id === answer.selected ? '<span class="result-status">你的选择</span>' : ''}</button>`).join('')}</div>`;
      if (question) interaction += `<div class="answer-panel relation-answer"><div class="section-kicker">本题答案</div><strong class="relation-target" lang="en">${esc(byId.get(correct).word)}</strong><p>${esc(question.explanation)}</p><p class="relation-note">关联只对应原词表的这个考法，不代表所有语境等价；“未列入”不等于“语义绝不相近”。</p></div>`;
      interaction += V.wordDetails(word, lexicon.flags, state.settings.detailsExpanded !== false);
      interaction += `<div class="review-schedule"><span>下次复习：${V.date(P.reviewAt(state.records[word.id], state.settings, Date.now()))}</span><span>连续答对 ${state.records[word.id].consecutiveCorrect} 次 · 已复习 ${state.records[word.id].reviewCount} 次</span></div><div class="next-row"><span class="muted">${answer.confidence === 'known' && answer.correct ? '已记录本次掌握情况' : '已加入「待加强」'}</span><button id="next-button" class="button primary" data-action="next">${testing && session.index === session.queue.length - 1 ? '查看本轮结果' : '下一个单词'} ${icon('arrow')}</button></div>`;
    }
    const percent = session.answers.length / session.queue.length * 100;
    let prompt = word.word;
    if (!reveal && modeOf(session) === 'cn-en') prompt = word.meaning;
    if (!reveal && modeOf(session) === 'def-en') prompt = word.definitions.map(d => d.english).filter(Boolean).join(' / ').replace(new RegExp(word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '____');
    if (!reveal && question) prompt = question.prompt;
    app.innerHTML = `${top}${testing ? `<div class="test-progress"><div class="progress-value"><span>本轮进度</span><strong>${session.answers.length} / ${session.queue.length}</strong></div><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div></div>` : ''}<div class="study-layout"><div class="study-main"><section class="study-card"><div class="card-topline"><span class="mode-label"><span class="status-dot"></span>${training ? MODE_NAMES[modeOf(session)] : testing ? '测试模式' : state.reviewOnly ? '优先复习' : '基础模式'}</span><span class="muted">${String(session.index + 1).padStart(2, '0')} / ${session.queue.length}</span></div><div class="word-display"><h2 class="${reverse && !reveal ? 'recall-prompt' : 'word'}" ${modeOf(session) !== 'cn-en' && modeOf(session) !== 'syn-cn' ? 'lang="en"' : ''}>${esc(prompt)}</h2>${reveal ? `<button class="button ghost small pronounce-button" data-action="pronounce" aria-label="朗读 ${esc(word.word)}">${icon('sound', 18)} 听发音</button>` : `<span class="word-hint">${question ? esc(question.context) : '先回忆，再揭晓'}</span>`}</div>${interaction}</section><div class="study-footer"><span>${testing ? '这一轮，每个词条都只出现一次' : '到期与易忘词优先 · 一轮内不重复'}</span><span class="keyboard-tip">${session.stage === 'prompt' ? '按 1 / 2 / 3 快速选择' : session.stage === 'choices' ? '按 1 / 2 / 3 / 4 选择答案' : '按空格键继续'}</span></div></div>${sidePanel(session, testing)}</div>`;
  }
  function renderSetup() {
    app.innerHTML = header('PUT YOUR MEMORY TO THE TEST', '给记忆，一点小挑战。', '选一个适合现在的题量，看看哪些词已经真正记住。') + `<div class="study-layout"><section class="test-setup"><div class="section-kicker">测试设置</div><h2 class="section-heading">这次想挑战多少词？</h2><p class="muted">从全部 ${words.length} 个词中随机抽取，不重复出题。</p><form id="test-form"><label class="field-label" for="question-count">题目数量</label><div class="preset-row">${[10, 20, 50, 100].map(n => `<button class="preset-button ${n === 20 ? 'active' : ''}" type="button" data-count="${n}">${n} 词</button>`).join('')}</div><div class="number-field"><input class="number-input" id="question-count" name="count" type="number" min="1" max="${words.length}" step="1" value="20" required aria-describedby="count-help count-error"><span class="muted">词</span></div><p class="muted" id="count-help">也可以自由输入 1–${words.length} 之间的整数。</p><p class="form-error" id="count-error" role="alert"></p><div class="card-divider"></div><div class="test-rules"><p>${icon('check', 17)} 认识 / 模糊 → 四选一验证词义</p><p>${icon('book', 17)} 不认识 → 直接学习答案，本题记 0 分</p><p>${icon('leaf', 17)} 完成后查看得分，集中复习待加强的词</p></div><button type="submit" class="button primary start-test">开始测试 ${icon('arrow')}</button></form></section><aside class="side-panel"><span class="section-kicker">给专注留一点空间</span><h2 class="section-heading">不必一次完成<br>全部 800 个词。</h2><p class="panel-copy">10 个词也很好。让每一次小练习，都成为下一次更确定的记忆。</p><div class="note-card"><p>进度会自动保存</p><span class="muted">切换模式或刷新页面后，仍可以继续这轮测试。</span></div></aside></div>`;
  }
  function trainingPool(mode) {
    if (!mode.startsWith('syn-')) return words.filter(w => mode !== 'def-en' || w.definitions.some(d => d.english));
    const seen = new Set();
    return L.shuffle(bankFor(mode)).filter(q => { if (seen.has(String(q.wordId))) return false; seen.add(String(q.wordId)); return true; });
  }
  function renderTraining() {
    const synonym = state.view === 'synonyms';
    if (state.training && isSynonym(state.training) === synonym && !state.trainingSettings) return renderStudy(true, true);
    const modes = synonym ? ['syn-word', 'syn-cn', 'syn-odd'] : ['cn-en', 'def-en'];
    const selected = modes.includes(state.settings[synonym ? 'synonymMode' : 'recallMode']) ? state.settings[synonym ? 'synonymMode' : 'recallMode'] : modes[0];
    const max = trainingPool(selected).length;
    app.innerHTML = header(synonym ? 'WORDS IN RELATION' : 'RECALL IN REVERSE', synonym ? '联想有依据，词义有边界。' : '换个方向，再记住一次。', synonym ? '围绕原词表的具体考法练习关联，不把近义词当成所有语境下的等价词。' : '从中文或英文释义回忆单词，沿用同一份熟悉程度和复习计划。') + `<div class="study-layout"><section class="test-setup"><h2 class="section-heading">${synonym ? '选择一种关联训练' : '选择回忆方向'}</h2><form id="training-form"><label class="field-label" for="training-mode">训练方式</label><select id="training-mode" class="text-input">${modes.map(mode => `<option value="${mode}" ${mode === selected ? 'selected' : ''}>${MODE_NAMES[mode]}</option>`).join('')}</select><p class="mode-description muted" id="training-help">${trainingDescription(selected, max)}</p><label class="field-label" for="training-count">本轮题数</label><input id="training-count" class="number-input" type="number" min="1" max="${max}" step="1" value="${Math.min(10, max)}" required aria-describedby="training-help"><p class="muted">每轮按词条去重，最多 <span id="training-max">${max}</span> 题。</p><button class="button primary start-test" type="submit" ${max ? '' : 'disabled'}>开始练习 ${icon('arrow')}</button></form>${state.training && state.training.stage !== 'done' ? `<div class="resume-panel"><p>已有未完成练习：${MODE_NAMES[modeOf(state.training)]} · ${state.training.answers.length}/${state.training.queue.length}</p><button class="button secondary" data-action="resume-training">继续这轮练习</button></div>` : ''}</section><aside class="side-panel"><h2 class="section-heading">先判断把握，<br>再用选项验证。</h2><p class="panel-copy">“认识”和“模糊”都会进入四选一。“不认识”直接学习完整词条。猜对但不确定，仍会留在待加强队列。</p>${synonym ? '<div class="note-card"><p>原文关联 ≠ 绝对等价</p><span class="muted">只使用 800 词库内、可定位到考法的直接关系。异类题识别的是“未列入本考法的近义词”，不据此断言语义无关。</span></div>' : '<div class="note-card"><p>熟悉程度保持一致</p><span class="muted">反向练习与基础模式共用学习记录。连续确认后，复习间隔逐步拉长。</span></div>'}</aside></div>`;
  }
  function trainingDescription(mode, maximum) {
    if (mode === 'syn-odd') return `选出原词表未列入本考法近义词的选项。符合数据条件的词条只有 ${maximum} 个，不额外生成关系凑题。`;
    if (mode === 'syn-cn') return '根据中文考法，匹配原词表明确列出的关联英文词。';
    if (mode === 'syn-word') return '根据英文词及本考法，找到原词表列出的关联近义词。';
    return mode === 'cn-en' ? '只看中文释义，先回忆英文，再从四个词中选择。' : '只看原词表的英文释义，回忆对应单词；多个考法一并保留。';
  }
  function resultRows(answers) {
    return answers.map(a => {
      const word = byId.get(a.id);
      if (!word) return '';
      const label = a.confidence === 'unknown' ? '不认识' : !a.correct ? '答错' : a.confidence === 'unsure' ? '模糊 · 答对' : '已掌握';
      return `<div class="result-row"><div><div class="result-word" lang="en">${esc(word.word)}</div><div class="result-meaning">${esc(word.pos)} ${esc(word.meaning)}</div></div><span class="result-status ${a.confidence === 'known' && a.correct ? 'status-mastered' : 'status-review'}">${label}</span></div>`;
    }).join('');
  }
  function renderResults(training = false) {
    const s = training ? state.training : state.test;
    const correct = s.answers.filter(a => a.correct).length;
    const weak = s.answers.filter(a => !a.correct || a.confidence !== 'known');
    const duration = Math.max(1, Math.round(((s.finishedAt || Date.now()) - s.startedAt) / 1000));
    app.innerHTML = header('A SMALL STEP, WELL TAKEN', '这一轮，完成了。', `${training ? MODE_NAMES[modeOf(s)] + ' · ' : ''}每一次确认和遗忘，都会帮你找到下一次练习的方向。`) + `<section class="overview-card"><div class="summary-grid"><div class="summary-stat"><span class="muted">本次得分</span><strong>${Math.round(correct / s.queue.length * 100)}<small> 分</small></strong></div><div class="summary-stat"><span class="muted">回答正确</span><strong>${correct}<small> / ${s.queue.length}</small></strong></div><div class="summary-stat"><span class="muted">待加强</span><strong>${weak.length}<small> 词</small></strong></div><div class="summary-stat"><span class="muted">本轮用时</span><strong>${Math.floor(duration / 60)}<small> 分 ${duration % 60} 秒</small></strong></div></div><div class="result-actions"><button class="button primary" data-action="${training ? 'new-training' : 'new-test'}">再来一轮 ${icon('arrow')}</button>${weak.length ? `<button class="button secondary" data-action="${training ? 'review-training' : 'review-test'}">复习本轮待加强</button>` : '<button class="button secondary" data-action="basic">回到基础模式</button>'}</div></section><section class="results-section"><div class="overview-heading"><h2 class="section-heading">${weak.length ? '这些词，值得再见一面' : '记得很扎实，继续保持'}</h2><span class="muted">${weak.length ? `答错、不认识，以及模糊但答对的 ${weak.length} 个词` : '本轮全部答对且有把握'}</span></div><div class="results-list">${resultRows(weak.length ? weak : s.answers)}</div></section>`;
  }
  function renderProgress() {
    app.innerHTML = header('YOUR WORDS, YOUR PROGRESS', '记忆在这里，慢慢生长。', '保留每一次积累，也给容易遗忘的词多一点时间。') + V.analytics(state, words, P);
    const history = state.history.filter(h => h && Number.isFinite(h.finishedAt) && h.total > 0 && Number.isFinite(h.correct));
    if (history.length) app.innerHTML += '<section class="results-section"><h2 class="section-heading">最近的测试与练习</h2><div class="results-list">' + history.slice(0, 20).map(h => '<div class="result-row"><div><strong>' + esc(MODE_NAMES[h.mode] || '词汇测试') + ' · ' + h.total + ' 词</strong><div class="muted">' + V.date(h.finishedAt) + '</div></div><strong>' + Math.round(h.correct / h.total * 100) + ' 分 <span class="muted">· ' + h.correct + '/' + h.total + '</span></strong></div>').join('') + '</div></section>';
    app.innerHTML += '<p class="local-note muted">学习记录仅保存在当前浏览器。建议定期导出；清除浏览器数据会移除本地记录。</p>';
    app.querySelectorAll('.trend-chart').forEach(chart => { chart.scrollLeft = chart.scrollWidth; });
  }
  const specialWords = () => words.filter(w => state.specialList[w.id]?.active);
  const selfSession = () => state.view === 'self-check' ? state.selfCheck : state.view === 'special-study' ? state.specialReview : null;
  function newSelfSession(pool) {
    return { queue: L.shuffle(pool).map(w => w.id), index: 0, answers: [], stage: 'prompt', startedAt: Date.now() };
  }
  function reconcileSpecialSession() {
    const s = state.specialReview;
    if (!s || s.stage === 'done') return;
    // Keep completed answers, but never present a removed word later in this round.
    const answered = s.answers.length;
    s.queue = [...s.queue.slice(0, answered), ...s.queue.slice(answered).filter(id => state.specialList[id]?.active)];
    if (!s.queue.length) { state.specialReview = null; return; }
    if (s.stage === 'prompt' && s.index === s.queue.length) s.stage = 'done';
  }
  function renderSelfCheck(special = false) {
    if (special) reconcileSpecialSession();
    else if (!state.selfCheck) state.selfCheck = newSelfSession(words);
    const s = special ? state.specialReview : state.selfCheck;
    const top = header('RECALL, REVEAL, REMEMBER', special ? '再见一面，加深一点印象。' : '先想词义，再揭晓。', '选择后揭晓答案；不认识的词自动加入特殊待复习，点错可以返回修改。', '<button class="button secondary small" data-action="special-list">特殊待复习 <span data-special-count>' + specialWords().length + '</span></button>');
    if (!s) {
      app.innerHTML = top + '<section class="empty-state"><h2>本轮没有待复习的词了</h2><p>可以返回列表，或继续认识新的单词。</p><div class="result-actions"><button class="button primary" data-action="self-check">进入自认模式</button><button class="button secondary" data-action="special-list">返回列表</button></div></section>';
      return;
    }
    if (s.stage === 'done') {
      const known = s.answers.filter(a => a.confidence === 'known').length;
      app.innerHTML = top + `<section class="overview-card"><h2 class="section-heading">这一轮，回忆完了。</h2><p class="self-round-summary">已回忆 ${s.answers.length} 个词 · 自认认识 ${known} 个 · 不认识 ${s.answers.length - known} 个</p><p class="muted">特殊待复习里有 <span data-special-count>${specialWords().length}</span> 个词，是否保留由你决定。</p><div class="result-actions"><button class="button secondary" data-action="self-back">← 上一个单词</button><button class="button primary" data-action="${special ? 'start-special-review' : 'restart-self-check'}" ${special && !specialWords().length ? 'disabled' : ''}>再来一轮 ${icon('arrow')}</button><button class="button secondary" data-action="special-list">查看特殊待复习</button></div></section>`;
      return;
    }
    const word = byId.get(s.queue[s.index]);
    const reveal = s.stage === 'answer', included = Boolean(state.specialList[word.id]?.active);
    const interaction = reveal ? `<div class="feedback neutral" role="status">${icon('book', 18)} 你的选择是「${s.answers[s.index].confidence === 'known' ? '认识' : '不认识'}」，对照释义确认一下。</div><div class="self-correction"><span class="muted">点错了？重新选择：</span><div role="group" aria-label="修改认识程度"><button class="button secondary small" data-self-confidence="known" aria-pressed="${s.answers[s.index].confidence === 'known'}" ${s.answers[s.index].confidence === 'known' ? 'disabled' : ''}>认识 <kbd>1</kbd></button><button class="button secondary small" data-self-confidence="unknown" aria-pressed="${s.answers[s.index].confidence === 'unknown'}" ${s.answers[s.index].confidence === 'unknown' ? 'disabled' : ''}>不认识 <kbd>2</kbd></button></div></div><div class="answer-panel self-answer"><div class="section-kicker">正确释义</div><p>${esc(word.pos)} ${esc(word.meaning)}</p></div><div class="self-review-actions"><button class="button ${included ? 'secondary' : 'primary'}" data-action="toggle-special" aria-pressed="${included}">${included ? '已加入特殊待复习 · 移除' : '加入特殊待复习'}</button><button id="self-next-button" class="button ${included ? 'primary' : 'secondary'}" data-action="self-next">${s.index === s.queue.length - 1 ? '完成本轮' : '下一个单词'} ${icon('arrow')}</button></div><p class="self-review-note muted">${included ? s.answers[s.index].autoSpecialAt === state.specialList[word.id].updatedAt ? '已自动加入特殊待复习；误点的话，改为「认识」可撤销这次加入。' : '已在特殊待复习列表中，可以随时手动移除。' : '当前未加入特殊待复习，也可以手动加入。'}</p>${V.wordDetails(word, lexicon.flags, state.settings.detailsExpanded !== false)}` : `<p class="word-instruction">先在脑海里回忆：你认识这个词吗？</p><div class="confidence-grid self-confidence-grid"><button class="confidence-button known" data-self-confidence="known"><span class="confidence-icon">${icon('check')}</span><span class="confidence-copy"><span class="confidence-title">认识</span><span class="confidence-desc">揭晓释义，核对一下</span></span><kbd class="keycap">1</kbd></button><button class="confidence-button unknown" data-self-confidence="unknown"><span class="confidence-icon">${icon('cross')}</span><span class="confidence-copy"><span class="confidence-title">不认识</span><span class="confidence-desc">揭晓释义，加入复习</span></span><kbd class="keycap">2</kbd></button></div>`;
    app.innerHTML = `${top}<div class="study-layout"><div class="study-main"><section class="study-card"><div class="card-topline"><span class="mode-label"><span class="status-dot"></span>${special ? '特殊待复习 · 自认模式' : '自认模式'}</span><span class="muted">${s.index + 1} / ${s.queue.length}</span></div><div class="self-navigation"><button class="button secondary small" data-action="self-back" ${s.index === 0 ? 'disabled' : ''}>← 上一个单词</button><span class="muted">${s.index < s.answers.length - 1 ? '回看中 · 后续进度已保留' : '按 ← 返回上一词'}</span></div><div class="word-display"><h2 class="word" lang="en">${esc(word.word)}</h2>${reveal ? `<button class="button ghost small pronounce-button" data-action="pronounce" aria-label="朗读 ${esc(word.word)}">${icon('sound', 18)} 听发音</button>` : '<span class="word-hint">给自己几秒，再揭晓答案</span>'}</div>${interaction}</section><div class="study-footer"><span>随机出词 · 一轮内不重复</span><span class="keyboard-tip">${reveal ? '1 / 2 改选 · 空格继续 · S 加入或移除' : '按 1 认识 / 2 不认识'}</span></div></div><aside class="side-panel"><div class="panel-heading">${icon('leaf')}<span>按自己的节奏记住它</span></div><div class="stat-number">${s.answers.length}<span class="count-note"> / ${s.queue.length}</span></div><p class="muted">本轮已回忆的单词</p><div class="mini-progress"><span style="width:${s.answers.length / s.queue.length * 100}%"></span></div><div class="stat-row"><span>特殊待复习</span><strong data-special-count>${specialWords().length}</strong></div><div class="card-divider"></div><p class="panel-copy">不认识的词会自动加入特殊待复习。点错时可直接改选，或返回上一词修改；后续进度仍会保留。</p><div class="note-card"><span class="section-kicker">自己判断，自己选择</span><p>本模式只记录自认结果。</p><span class="muted">自认结果不计入测试正确率或掌握率。收藏的词可以随时移除。</span></div></aside></div>`;
  }
  function renderSpecialList() {
    const pool = specialWords();
    reconcileSpecialSession();
    const resumable = state.specialReview && state.specialReview.stage !== 'done';
    app.innerHTML = header('YOUR PERSONAL REVIEW LIST', '特殊待复习', '不认识的词自动收进这里，也支持手动加入和移除。', '<button class="button secondary small" data-action="self-check">进入自认模式</button>') + (pool.length ? `<section class="overview-card"><h2 class="section-heading">给这 <span data-special-count>${pool.length}</span> 个词，多一点时间。</h2><p class="muted">用自认模式逐个复习；点击认识或不认识后揭晓答案。复习时可随时手动移除。</p><div class="result-actions">${resumable ? '<button class="button primary" data-action="resume-special-review">继续上次复习</button>' : ''}<button class="button ${resumable ? 'secondary' : 'primary'}" data-action="start-special-review">${resumable ? '重新开始一轮' : '开始复习列表'} ${icon('arrow')}</button></div></section><section class="results-section"><div class="results-list">${pool.map(w => `<div class="result-row special-review-row"><div><div class="result-word" lang="en">${esc(w.word)}</div><div class="result-meaning">${esc(w.pos)} ${esc(w.meaning)}</div></div><button class="button secondary small" data-remove-special="${esc(w.id)}" aria-label="将 ${esc(w.word)} 移出特殊待复习">移除</button></div>`).join('')}</div></section>` : `<section class="empty-state">${icon('book', 36)}<h2>还没有特别收藏的词</h2><p>在自认模式中选择「不认识」会自动加入，也可以在答案页手动加入。</p><span class="sr-only" data-special-count>0</span><button class="button primary" data-action="self-check">开始自认单词 ${icon('arrow')}</button></section>`);
  }
  function chooseSelfConfidence(confidence) {
    const s = selfSession();
    if (!s || !['prompt', 'answer'].includes(s.stage) || !['known', 'unknown'].includes(confidence)) return;
    const previous = s.answers[s.index];
    if (previous?.confidence === confidence) return;
    const id = s.queue[s.index], answer = { id, confidence };
    // Only undo an automatic addition still owned by this answer. A manual
    // change or a later answer in the other session must keep its own choice.
    if (previous?.autoSpecialAt !== undefined && state.specialList[id]?.active && state.specialList[id].updatedAt === previous.autoSpecialAt) writeSpecial(id, false);
    if (confidence === 'unknown') {
      const wasActive = Boolean(state.specialList[id]?.active);
      const updatedAt = writeSpecial(id, true);
      if (!wasActive) answer.autoSpecialAt = updatedAt;
    }
    s.answers[s.index] = answer;
    s.stage = 'answer'; render();
    app.querySelector('#self-next-button')?.focus({ preventScroll: true });
  }
  function nextSelf() {
    const s = selfSession();
    if (!s || s.stage !== 'answer') return;
    s.index++;
    s.stage = s.index === s.queue.length ? 'done' : s.index < s.answers.length ? 'answer' : 'prompt';
    render();
    app.querySelector('.word-display, .page-title')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  function backSelf() {
    const s = selfSession();
    if (!s || s.index === 0) return;
    s.index--;
    s.stage = 'answer';
    render();
    app.querySelector('.self-navigation')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  function writeSpecial(id, active) {
    const updatedAt = Math.max(Date.now(), (state.specialList[id]?.updatedAt || 0) + 1);
    state.specialList[id] = { active, updatedAt };
    return updatedAt;
  }
  function setSpecial(id, active) {
    if (!byId.has(id)) return;
    writeSpecial(id, active);
    render();
    app.querySelector('#self-next-button')?.focus({ preventScroll: true });
    toast(active ? '已加入特殊待复习' : '已移出特殊待复习');
  }
  function render() {
    if (state.view === 'self-check' || state.view === 'special-study') renderSelfCheck(state.view === 'special-study');
    else if (state.view === 'special-review') renderSpecialList();
    else if (state.view === 'progress') renderProgress();
    else if (['recall', 'synonyms'].includes(state.view)) renderTraining();
    else if (state.view === 'quality') app.innerHTML = header('SOURCE & NOTES', '留住原文，看清疑点。', '疑似错误单独标记；所有训练仍来自你的 800 词数据库。') + V.quality(lexicon, words);
    else if (state.view === 'exam') app.innerHTML = header('GRE PRACTICE MODULES', '为下一步训练，留好位置。', 'TC、SE、RC 各自独立，等待已核验的材料。') + V.exam(state.examModule || 'TC');
    else renderStudy(state.view === 'test');
    updateSidebar(); save();
  }
  function activeSession() { return state.view === 'test' ? state.test : state.view === 'basic' ? state.basic : ['recall', 'synonyms'].includes(state.view) && !state.trainingSettings && state.training && isSynonym(state.training) === (state.view === 'synonyms') ? state.training : null; }
  function finishAnswer(session, selected) {
    if (!session || !['prompt', 'choices'].includes(session.stage)) return;
    const id = session.queue[session.index];
    const correct = selected === String(correctId(session));
    session.answers.push({ id, confidence: session.confidence, selected, correct });
    state.records[id] = P.recordAnswer(state.records[id], session.confidence, correct, Date.now(), state.settings);
    state.daily = P.recordDaily(state.daily, id, correct, Date.now());
    session.stage = 'answer';
    render();
  }
  function chooseConfidence(value) {
    const s = activeSession();
    if (!s || s.stage !== 'prompt' || !['known', 'unknown', 'unsure'].includes(value)) return;
    s.confidence = value;
    if (value === 'unknown') finishAnswer(s, null);
    else {
      s.options = isSynonym(s) ? questionOf(s).options.map(o => ({ id: String(o.id), meaning: o.label })) : L.makeOptions(byId.get(s.queue[s.index]), words).map(o => ({ ...o, meaning: modeOf(s) === 'en-cn' ? o.meaning : byId.get(o.id).word }));
      s.stage = 'choices'; render();
    }
  }
  function chooseOption(id) {
    const s = activeSession();
    if (s?.stage === 'choices' && s.options.some(o => o.id === id)) finishAnswer(s, id);
  }
  function next() {
    const s = activeSession();
    if (!s || s.stage !== 'answer') return;
    s.index++; s.confidence = null; s.options = [];
    if (state.view !== 'basic' && s.index === s.queue.length) {
      s.stage = 'done'; s.finishedAt = Date.now();
      state.history.unshift({ finishedAt: s.finishedAt, total: s.queue.length, correct: s.answers.filter(a => a.correct).length, mode: modeOf(s) });
    } else {
      s.stage = 'prompt';
      if (state.view === 'basic') {
        const remaining = P.prioritize(s.queue.slice(s.index).map(id => byId.get(id)), state.records, Date.now(), state.settings);
        s.queue = [...s.queue.slice(0, s.index), ...remaining.map(w => w.id)];
      }
    }
    render();
    app.querySelector('.word-display, .page-title')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  function toast(message) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = message;
    document.body.appendChild(el); setTimeout(() => el.remove(), 3500);
  }
  function exportProgress() {
    const payload = JSON.stringify(P.exportProgress(state), null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url;
    const day = new Date().toLocaleDateString('sv-SE');
    link.download = `gre800-progress-${day}.json`; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('已导出当前进度，请保留这份备份。');
  }
  function closeImport() {
    const dialog = document.getElementById('import-dialog');
    if (dialog) { dialog.close(); dialog.remove(); }
    pendingImport = null;
    document.querySelector('[data-action="import-progress"]')?.focus();
  }
  async function previewImport(file) {
    if (!file) return;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('文件不能超过 4 MB。');
      const result = P.validateImport(await file.text(), words, Date.now());
      for (const name of ['basic', 'test', 'training']) if (result.state[name] && !validSession(result.state[name], name !== 'basic')) throw new Error('文件中的未完成练习不完整，原有进度未改动。');
      pendingImport = result.state; importName = file.name;
      document.getElementById('import-dialog')?.remove();
      const dialog = document.createElement('dialog'); dialog.id = 'import-dialog';
      dialog.setAttribute('aria-labelledby', 'import-title');
      dialog.innerHTML = `<div class="import-preview"><span class="eyebrow">PROGRESS BACKUP</span><h2 id="import-title">确认合并这份学习进度</h2><p class="muted">${esc(importName)}</p><div class="summary-grid"><div class="summary-stat"><span class="muted">已学单词</span><strong>${result.summary.records}</strong></div><div class="summary-stat"><span class="muted">累计作答</span><strong>${result.summary.attempts}</strong></div></div><p>保留当前未完成练习；已有单词计数取较大值，复习计划采用较新记录。相同备份不会重复累加。</p><p class="muted">原进度会先在此浏览器另存备份；若无法保存，导入不会生效。</p><p id="import-error" class="form-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" data-action="cancel-import">取消</button><button class="button primary" data-action="confirm-import">确认合并</button></div></div>`;
      dialog.addEventListener('cancel', () => { pendingImport = null; });
      document.body.appendChild(dialog); dialog.showModal();
    } catch (error) { pendingImport = null; toast(error.message || '无法读取文件，原有进度未改动。'); }
    finally { const input = document.getElementById('progress-file'); if (input) input.value = ''; }
  }
  function confirmImport() {
    if (!pendingImport) return;
    try {
      if (!maySave) throw new Error('当前存储不可写，原有进度未改动。');
      const merged = P.mergeProgress(state, pendingImport, words, Date.now());
      for (const name of ['basic', 'test', 'training']) if (merged[name] && !validSession(merged[name], name !== 'basic')) throw new Error('练习记录校验未通过，原有进度未改动。');
      localStorage.setItem(`${KEY}-backup-before-import`, JSON.stringify(state));
      localStorage.setItem(KEY, JSON.stringify(merged));
      state = merged; closeImport(); render(); toast('进度已合并，原有练习和记录已保留。');
    } catch (error) {
      const el = document.getElementById('import-error'); if (el) el.textContent = `合并未生效：${error.message || '无法写入本地存储'}。原有进度仍然保留。`;
    }
  }
  function action(name) {
    if (name === 'self-next') return nextSelf();
    if (name === 'self-back') return backSelf();
    if (name === 'toggle-special') {
      const s = selfSession();
      if (!s || s.stage !== 'answer') return;
      const id = s.queue[s.index];
      return setSpecial(id, !state.specialList[id]?.active);
    }
    if (name === 'self-check') state.view = 'self-check';
    if (name === 'restart-self-check') { state.selfCheck = newSelfSession(words); state.view = 'self-check'; }
    if (name === 'special-list') state.view = 'special-review';
    if (name === 'start-special-review') {
      const pool = specialWords();
      if (!pool.length) { toast('先在自认模式中加入想复习的单词。'); return; }
      state.specialReview = newSelfSession(pool); state.view = 'special-study';
    }
    if (name === 'resume-special-review' && state.specialReview) state.view = 'special-study';
    if (name === 'next') return next();
    if (name === 'new-test') { state.test = null; state.view = 'test'; }
    if (name === 'new-training') { state.training = null; state.trainingSettings = false; }
    if (name === 'resume-training') { state.trainingSettings = false; state.view = isSynonym(state.training) ? 'synonyms' : 'recall'; }
    if (name === 'training-settings') { state.trainingSettings = true; }
    if (name === 'toggle-definitions') {
      state.settings.detailsExpanded = ![...app.querySelectorAll('.definition')].some(el => el.open);
      app.querySelectorAll('.definition').forEach(el => { el.open = state.settings.detailsExpanded; });
      app.querySelector('[data-action="toggle-definitions"]').textContent = state.settings.detailsExpanded ? '收起全部释义' : '展开全部释义';
      save(); return;
    }
    if (name === 'export-progress') return exportProgress();
    if (name === 'import-progress') { document.getElementById('progress-file').click(); return; }
    if (name === 'cancel-import') { closeImport(); return; }
    if (name === 'confirm-import') return confirmImport();
    if (name === 'clear-exam-date') { state.settings.examDate = ''; toast('已恢复普通复习节奏'); }
    if (name === 'basic') state.view = 'basic';
    if (name === 'all-words') { state.reviewOnly = false; state.basic = null; state.view = 'basic'; }
    if (['review-all', 'review-test', 'review-training', 'review-due'].includes(name)) {
      const source = name === 'review-training' ? state.training : state.test;
      const pool = name === 'review-due' ? P.prioritize(words.filter(w => P.isDue(state.records[w.id], Date.now(), state.settings)), state.records, Date.now(), state.settings) : ['review-test', 'review-training'].includes(name) ? source.answers.filter(a => !a.correct || a.confidence !== 'known').map(a => byId.get(a.id)) : reviewWords();
      if (!pool.length) { toast(name === 'review-due' ? '暂时没有到期的单词，可以继续学习新词。' : '暂时没有需要复习的单词。'); return; }
      state.reviewOnly = true; state.basic = newSession(pool, 'en-cn', true); state.view = 'basic';
    }
    if (name === 'pronounce') {
      if (!('speechSynthesis' in window)) { toast('这个浏览器暂不支持朗读。'); return; }
      const s = selfSession() || activeSession(); if (!s || s.stage === 'done') return;
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(byId.get(s.queue[s.index]).word);
      utterance.lang = 'en-US'; utterance.rate = 0.85;
      utterance.onerror = () => toast('暂时无法朗读，请检查浏览器语音设置。');
      speechSynthesis.speak(utterance); return;
    }
    render();
  }
  document.addEventListener('click', e => {
    if (e.target.closest('.brand')) { e.preventDefault(); state.view = 'basic'; render(); return; }
    const btn = e.target.closest('button'); if (!btn || btn.disabled) return;
    if (btn.dataset.nav) { state.view = btn.dataset.nav; render(); return; }
    if (btn.dataset.selfConfidence) return chooseSelfConfidence(btn.dataset.selfConfidence);
    if (btn.dataset.removeSpecial) return setSpecial(btn.dataset.removeSpecial, false);
    if (btn.dataset.confidence) return chooseConfidence(btn.dataset.confidence);
    if (btn.dataset.option) return chooseOption(btn.dataset.option);
    if (btn.dataset.action) return action(btn.dataset.action);
    if (btn.dataset.studyWord && byId.has(btn.dataset.studyWord)) { state.basic = newSession([byId.get(btn.dataset.studyWord)]); state.reviewOnly = false; state.view = 'basic'; render(); return; }
    if (['TC', 'SE', 'RC'].includes(btn.dataset.examModule)) { state.examModule = btn.dataset.examModule; render(); return; }
    if (btn.dataset.count) {
      document.getElementById('question-count').value = btn.dataset.count;
      document.querySelectorAll('[data-count]').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('count-error').textContent = '';
    }
  });
  app.addEventListener('change', e => {
    if (e.target.id === 'review-toggle') { state.reviewOnly = e.target.checked; state.basic = null; render(); }
    if (e.target.id === 'progress-file') previewImport(e.target.files[0]);
    if (e.target.id === 'training-mode') {
      const mode = e.target.value, maximum = trainingPool(mode).length;
      const input = document.getElementById('training-count'); input.max = maximum; input.value = Math.max(1, Math.min(Number(input.value) || 10, maximum));
      document.getElementById('training-max').textContent = maximum;
      document.getElementById('training-help').textContent = trainingDescription(mode, maximum);
      state.settings[state.view === 'synonyms' ? 'synonymMode' : 'recallMode'] = mode; save();
    }
  });
  app.addEventListener('input', e => {
    if (e.target.id === 'question-count') {
      document.querySelectorAll('[data-count]').forEach(b => b.classList.toggle('active', b.dataset.count === e.target.value));
      document.getElementById('count-error').textContent = '';
    }
  });
  app.addEventListener('submit', e => {
    if (e.target.id === 'exam-date-form') {
      e.preventDefault(); state.settings.examDate = document.getElementById('exam-date').value;
      const policy = P.policyInfo(state.settings, Date.now());
      render(); toast(policy.label); return;
    }
    if (e.target.id === 'training-form') {
      e.preventDefault();
      const mode = document.getElementById('training-mode').value, pool = trainingPool(mode);
      const n = L.validCount(document.getElementById('training-count').value, pool.length);
      if (n === null) { toast(`请输入 1–${pool.length} 之间的整数。`); return; }
      if (state.training && state.training.stage !== 'done' && !window.confirm('开始新练习会替换当前未完成的训练。已经完成的作答记录会保留，继续吗？')) return;
      if (mode.startsWith('syn-')) {
        const questions = L.shuffle(pool).slice(0, n).map(q => ({ ...q, options: L.shuffle(q.options) }));
        state.training = newSession(questions.map(q => byId.get(String(q.wordId))), mode, true);
        state.training.questions = questions;
      } else state.training = newSession(P.prioritize(L.shuffle(pool), state.records, Date.now(), state.settings).slice(0, n), mode, true);
      state.trainingSettings = false; render(); return;
    }
    if (e.target.id !== 'test-form') return;
    e.preventDefault();
    const n = L.validCount(document.getElementById('question-count').value, words.length);
    if (n === null) { document.getElementById('count-error').textContent = `请输入 1–${words.length} 之间的整数。`; return; }
    state.test = newSession(L.shuffle(words).slice(0, n)); render();
  });
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]')) return;
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.target.matches('input, textarea, select, [contenteditable="true"]')) return;
    const self = selfSession();
    if (self) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); backSelf(); }
      else if (['prompt', 'answer'].includes(self.stage) && ['1', '2'].includes(e.key)) { e.preventDefault(); chooseSelfConfidence(e.key === '1' ? 'known' : 'unknown'); }
      else if (self.stage === 'answer' && e.key.toLowerCase() === 's') { e.preventDefault(); action('toggle-special'); }
      else if (self.stage === 'answer' && e.code === 'Space' && !e.target.closest('button, a, summary')) { e.preventDefault(); nextSelf(); }
      return;
    }
    const s = activeSession(); if (!s) return;
    if (s.stage === 'prompt' && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); chooseConfidence(['known', 'unknown', 'unsure'][Number(e.key) - 1]); }
    else if (s.stage === 'choices' && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); chooseOption(s.options[Number(e.key) - 1].id); }
    else if (s.stage === 'answer' && e.code === 'Space' && !e.target.closest('button, a, summary')) { e.preventDefault(); next(); }
  });
  render();
})();
