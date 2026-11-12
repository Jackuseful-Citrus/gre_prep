(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GRELexicon = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // These annotations describe unresolved source issues. They never replace source text.
  // A token annotation blocks only that token; blockTraining blocks the affected sense.
  const ANNOTATIONS = [
    [29, 0, 'synonyms', 'artfice', '原文 artfice 的拼写疑似有遗漏；保留原文，待核验。'],
    [28, 0, 'synonyms', 'resolve', 'resolve 与本考法 adj. 的词性对应关系待核验。'],
    [40, 0, 'synonyms', 'excoriate', 'excoriate 与本考法“控告，起诉”的适用语境待核验。'],
    [64, 0, 'synonyms', 'daunting', 'daunting 与“耸人听闻的”的语义对应关系待核验。'],
    [87, 0, 'synonyms', 'false (adj.)', '原文明确标注 adj.，与本考法 v. 不同，不作为同词性匹配。'],
    [88, 0, 'synonyms', 'impromptu', 'impromptu 与本考法 v. 的词性对应关系待核验。'],
    [88, 0, 'synonyms', 'offhand', 'offhand 与本考法 v. 的词性对应关系待核验。'],
    [96, 0, 'synonyms', 'overdue', 'overdue 与本考法“过度的”的语义对应关系待核验。'],
    [177, 0, 'synonyms', 'enigma riddle', 'enigma riddle 疑似遗漏分隔符；不自动拆成两个关系。'],
    [203, 0, 'synonyms', 'profit-monger n. 唯利是图的人', '近义词栏混有名词词性和中文注释；不自动改写或抽取。'],
    [250, 0, 'synonyms', 'flattery', 'flattery 与本考法 adj. 的词性对应关系待核验。'],
    [285, 0, 'synonyms', 'ambient', 'ambient 与本考法 n. 的词性对应关系待核验。'],
    [381, 0, 'synonyms', 'wrap', 'wrap 的拼写或语义对应关系疑似有问题；不自动改成其他单词。'],
    [428, 0, 'synonyms', 'innovate', 'innovate 与本考法 adj. 的词性对应关系待核验。'],
    [474, 0, 'synonyms', 'fraught', 'fraught 与本考法 v. 的词性对应关系待核验。'],
    [565, 0, 'synonyms', 'compelled', 'compelled 与本考法“不情愿的”的语义对应关系待核验。'],
    [683, 0, 'synonyms', 'cronyism', 'cronyism 与本考法 adj. 的词性对应关系待核验。'],
    [771, 0, 'synonyms', 'predication', 'predication 与“喜欢，倾向”的对应关系或拼写待核验；不猜测替换。'],
    [82, 0, 'meaning', null, '“反人类的喷子”为原表口语化释义，语气和适用范围待核验。', true],
    [252, 0, 'source', null, '原文词性 n. 与释义、例句的用法疑似不一致；保留原文，待核验。', true],
    [275, 0, 'source', null, '原文词性 v. 与释义、例句的用法疑似不一致；保留原文，待核验。', true],
    [390, 0, 'source', null, '原文词性 adj. 与英文释义 to instruct 疑似不一致；待核验。', true],
    [493, 0, 'source', null, '原文词性 n. 与释义、例句的用法疑似不一致；待核验。', true],
    [635, 0, 'source', null, '原文词性 n. 与释义、例句的用法疑似不一致；待核验。', true],
    [691, 0, 'source', null, '原文词性 adj. 与例句被动用法疑似不一致；待核验。', true],
    [113, 1, 'source', null, '提取记录：PDF 考法 2 未写词性，现有词库沿用考法 1 的 adj.；未重新修改数据。'],
    [264, 0, 'source', null, '提取记录：PDF 将近义词标签写作“进：”，现有词库归入 synonyms；原始文本保留。'],
    [700, 0, 'source', null, '提取记录：PDF 将双语短语标为“近：”，现有词库归入 example；原始文本保留。'],
    [458, 0, 'example', null, '原始提取中未收录例句；保留缺失状态，不生成替代例句。'],
    [500, 0, 'example', null, '例句中文止于“矛盾修饰”，疑似截断；保留原文，待核验。'],
    [272, 0, 'example', null, '例句中的 hagiographic portray 疑似词形或排版问题；保留原文，待核验。']
  ];
  // The source lists these tokens, but the target entry teaches a different sense.
  // This is an annotation about this database, not a declaration about all English usage.
  const SENSE_MISMATCHES = [
    [62, 'somnolent'], [66, 'noxious'], [118, 'abound'], [238, 'grandiose'],
    [321, 'commencement'], [379, 'exacting'], [385, 'capricious'], [474, 'proliferate'],
    [511, 'impenetrable'], [512, 'vulgar'], [516, 'errant'], [576, 'phlegmatic'],
    [644, 'tenuous'], [711, 'countenance'], [738, 'alacrity']
  ];
  const FONT_NOTES = [
    [86, '例： soft-pedal bad news 对坏消息轻᧿淡写'],
    [272, '例： hagiographic portray received from the press 媒体谄媚的᧿述'],
    [297, '例： a violin virtuoso 资深小ᨀ琴艺术家'],
    [378, '例： a nebulous description of the topic 对于主题的模糊᧿述'],
    [630, '例： veto the bill 否决ᨀ案'],
    [631, '例： demur at the suggestion 反对ᨀ议'],
    [653, '【考法】v. ᧿写，᧿绘；例：他精心᧿述了该国规划']
  ];
  const MODES = ['syn-word', 'syn-cn', 'syn-odd'];
  const norm = value => String(value || '').trim().toLowerCase();
  const pos = value => (String(value || '').toLowerCase().match(/adj|adv|conj|vi|vt|n|v/g) || []).map(p => p === 'vi' || p === 'vt' ? 'v' : p);
  const samePos = (a, b) => pos(a).some(p => pos(b).includes(p));
  const tokens = value => String(value || '').split(/[,，;；]/).map(value => value.trim()).filter(Boolean);
  const unique = values => [...new Set(values)];
  const clone = value => JSON.parse(JSON.stringify(value));
  function shuffle(values, random) {
    const result = values.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const value = Number(random());
      const j = Math.floor(Math.max(0, Math.min(0.999999999, Number.isFinite(value) ? value : 0)) * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function meaningTokens(value) {
    const phrases = String(value || '').replace(/[（(][^）)]*[）)]/g, '').match(/[\u3400-\u9fff]+/g) || [];
    return unique(phrases.flatMap(phrase => {
      const clean = phrase.replace(/[的地得]/g, '');
      return Array.from({ length: Math.max(0, clean.length - 1) }, (_, i) => clean.slice(i, i + 2));
    }));
  }
  function buildIndex(words) {
    if (!Array.isArray(words)) throw new TypeError('Expected the existing vocabulary array');
    const wordsById = {}, wordsByName = {}, senses = [], flags = [], relations = [];
    words.forEach(original => {
      const word = clone(original), id = String(word.id);
      if (wordsById[id] || wordsByName[norm(word.word)]) throw new Error('Duplicate vocabulary entry');
      wordsById[id] = word;
      wordsByName[norm(word.word)] = id;
      (word.definitions || []).forEach((definition, senseIndex) => {
        senses.push({ key: id + ':' + senseIndex, wordId: id, senseIndex, page: word.page,
          word: word.word, pos: definition.pos || word.pos, meaning: definition.meaning || '',
          english: definition.english || '', rawSynonyms: definition.synonyms || '',
          synonymTokens: tokens(definition.synonyms), relatedIds: [], relationKeys: [], distractorIds: [] });
      });
    });
    function addFlag(wordId, senseIndex, field, message, raw, extra) {
      if (!wordsById[String(wordId)] || !wordsById[String(wordId)].definitions[senseIndex]) return;
      const flag = Object.assign({ wordId: String(wordId), senseIndex, field, message, raw: String(raw || '') }, extra || {});
      flags.push(flag);
    }
    ANNOTATIONS.forEach(([id, si, field, token, message, blockTraining]) => {
      const word = wordsById[String(id)], def = word && word.definitions[si];
      if (!def) return;
      addFlag(id, si, field, message, token || def[field] || def.pos || '', { token: token || null, blockTraining: !!blockTraining });
    });
    FONT_NOTES.forEach(([id, raw]) => addFlag(id, 0, 'source', '字体映射记录：现有提取将 ᧿/ᨀ 归一为 描/提（全表 9 处）；原始文本仍保留。', raw));
    SENSE_MISMATCHES.forEach(([id, token]) => {
      const source = wordsById[String(id)], target = wordsById[wordsByName[token]];
      if (source && target) addFlag(id, 0, 'synonyms', '原表列有 ' + token + '，但库内该词考法“' + target.meaning + '”与本考法对应范围待核验；暂不用于关联训练。', token, { token });
    });
    const senseFlags = sense => flags.filter(f => f.wordId === sense.wordId && f.senseIndex === sense.senseIndex);
    senses.forEach(sense => {
      const source = wordsById[sense.wordId], def = source.definitions[sense.senseIndex];
      if (!def.meaning) addFlag(sense.wordId, sense.senseIndex, 'meaning', '原始词库缺少中文释义，待核验。', '', { blockTraining: true });
      if (!def.english) addFlag(sense.wordId, sense.senseIndex, 'english', '原始词库缺少英文释义，待核验。', '', { blockTraining: true });
      if (def.synonyms && /[,，;；]\s*$/.test(def.synonyms)) addFlag(sense.wordId, sense.senseIndex, 'synonyms', '近义词栏以分隔符结尾，疑似遗漏内容；不补造词项。', def.synonyms);
      const seen = new Set();
      sense.synonymTokens.forEach((token, tokenIndex) => {
        const targetId = wordsByName[norm(token)] || null, target = wordsById[targetId];
        const targetSenseIndices = target ? target.definitions.map((d, i) => samePos(sense.pos, d.pos) ? i : -1).filter(i => i >= 0) : [];
        const sourceBlocked = senseFlags(sense).some(f => f.blockTraining || f.token && norm(f.token) === norm(token));
        const targetBlocked = target && targetSenseIndices.length && targetSenseIndices.every(i => flags.some(f => f.wordId === targetId && f.senseIndex === i && f.blockTraining));
        let status = targetId ? 'usable' : 'external', reason = '';
        if (sourceBlocked || targetBlocked) { status = 'excluded'; reason = 'source-annotation'; }
        if (targetId && !targetSenseIndices.length) {
          status = 'excluded'; reason = 'part-of-speech';
          addFlag(sense.wordId, sense.senseIndex, 'synonyms', '原表列有 ' + token + '，但库内其考法词性与 ' + sense.pos + ' 不匹配；暂不用于关联训练，待核验。', token, { token });
        }
        if (targetId === sense.wordId) { status = 'excluded'; reason = 'self-reference'; }
        if (seen.has(norm(token))) {
          status = 'excluded'; reason = 'duplicate';
          addFlag(sense.wordId, sense.senseIndex, 'synonyms', '近义词 ' + token + ' 在本考法重复出现；原文照录，训练不重复计入。', def.synonyms, { token });
        }
        seen.add(norm(token));
        const relation = { key: sense.key + ':' + tokenIndex, wordId: sense.wordId, senseIndex: sense.senseIndex,
          token, targetId, targetSenseIndices, status, reason,
          source: { wordId: sense.wordId, senseIndex: sense.senseIndex, page: sense.page, field: 'synonyms', raw: def.synonyms } };
        relations.push(relation);
        sense.relationKeys.push(relation.key);
        if (status === 'usable') sense.relatedIds.push(targetId);
      });
      sense.relatedIds = unique(sense.relatedIds);
    });
    // Adjacency is used ONLY to reject ambiguous distractors. No inverse or transitive
    // edge is added to relations, and all positive choices must have direct source evidence.
    const exclusionNeighbors = {}, meaningById = {}, positionsById = {};
    Object.keys(wordsById).forEach(id => { exclusionNeighbors[id] = new Set(); meaningById[id] = meaningTokens(wordsById[id].meaning); positionsById[id] = wordsById[id].definitions.map(d => d.pos).join('/'); });
    relations.filter(r => r.targetId).forEach(r => {
      exclusionNeighbors[r.wordId].add(r.targetId);
      exclusionNeighbors[r.targetId].add(r.wordId);
    });
    senses.filter(sense => sense.relatedIds.length).forEach(sense => {
      const blocked = new Set([sense.wordId, ...exclusionNeighbors[sense.wordId]]);
      sense.relatedIds.forEach(id => exclusionNeighbors[id].forEach(other => blocked.add(other)));
      const overlap = new Set(meaningTokens(sense.meaning).concat(...sense.relatedIds.map(id => meaningById[id])));
      sense.distractorIds = Object.keys(wordsById).filter(id => !blocked.has(id)
        && samePos(sense.pos, positionsById[id])
        && !meaningById[id].some(token => overlap.has(token))
        && !flags.some(f => f.wordId === id && f.blockTraining));
    });
    const usable = relations.filter(r => r.status === 'usable');
    return { version: 1, wordsById, senses, relations, flags,
      policy: '仅采用 definitions.synonyms 中有来源考法的直接关系；不推断对称、传递或绝对等价。库外词只展示原文。',
      stats: { words: words.length, senses: senses.length, synonymSenses: senses.filter(s => s.synonymTokens.length).length,
        rawTokens: relations.length, internalRelations: relations.filter(r => r.targetId).length,
        usableRelations: usable.length, externalRelations: relations.filter(r => r.status === 'external').length,
        excludedRelations: relations.filter(r => r.status === 'excluded').length,
        usableSenses: senses.filter(s => s.relatedIds.length && s.distractorIds.length >= 3).length,
        oddSenses: senses.filter(s => s.relatedIds.length >= 3 && s.distractorIds.length).length, flags: flags.length } };
  }
  function questions(index, type, random) {
    if (!MODES.includes(type)) return [];
    random = typeof random === 'function' ? random : Math.random;
    const result = [];
    index.senses.forEach(sense => {
      const relatedIds = sense.relatedIds, candidates = sense.distractorIds;
      if (type === 'syn-odd' ? relatedIds.length < 3 || !candidates.length : !relatedIds.length || candidates.length < 3) return;
      const targets = type === 'syn-odd' ? [shuffle(candidates, random)[0]] : relatedIds;
      targets.forEach(targetId => {
        const selected = type === 'syn-odd' ? shuffle(relatedIds, random).slice(0, 3) : shuffle(candidates, random).slice(0, 3);
        const options = shuffle([targetId, ...selected], random).map(id => ({ id, label: index.wordsById[id].word }));
        const instruction = type === 'syn-odd' ? '以下哪个未被原词表列入这个考法的近义词？' : '按本考法，原词表列出的关联近义词是哪个？';
        const wording = type === 'syn-odd'
          ? index.wordsById[targetId].word + ' 未列入此考法的近义词栏；这不表示它在所有语境下都与其他选项语义不同。'
          : index.wordsById[targetId].word + ' 是原词表在此考法列出的关联词；近义关系有语境和词义范围限制，不能视为绝对等价。';
        result.push({ key: type + ':' + sense.key + (type === 'syn-odd' ? '' : ':' + targetId), mode: type,
          wordId: sense.wordId, senseIndex: sense.senseIndex,
          prompt: type === 'syn-cn' ? sense.meaning : sense.word,
          context: instruction + ' · 考法 ' + (sense.senseIndex + 1) + ' · ' + sense.pos + (type === 'syn-cn' ? '' : ' · ' + sense.meaning),
          options, correctId: targetId, relatedIds: relatedIds.slice(),
          explanation: sense.word + ' · ' + sense.meaning + '。原表近义词：' + sense.rawSynonyms + '。' + wording,
          source: { wordId: sense.wordId, senseIndex: sense.senseIndex, page: sense.page },
          sourceWord: sense.word, correctWordId: targetId, sourceSynonyms: sense.rawSynonyms });
      });
    });
    return result;
  }
  function makeQuestion(index, type, random) {
    random = typeof random === 'function' ? random : Math.random;
    const pool = questions(index, type, random);
    if (!pool.length) return null;
    return shuffle(pool, random)[0];
  }
  function flagsFor(index, wordId, senseIndex) {
    return index.flags.filter(flag => flag.wordId === String(wordId) && (senseIndex == null || flag.senseIndex === Number(senseIndex)));
  }
  return { buildIndex, questions, makeQuestion, flagsFor, modes: MODES.slice() };
}));
