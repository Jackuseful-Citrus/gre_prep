(function (root) {
  'use strict';
  const shuffle = (items, random = Math.random) => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const normalize = text => String(text || '').replace(/[\s，,；;。.!！?？、（）()]/g, '').toLowerCase();
  function makeOptions(word, words, random = Math.random) {
    const seen = new Set([normalize(word.meaning)]);
    const candidates = shuffle(words.filter(w => w.id !== word.id), random);
    const picked = [];
    const tokens = String(word.meaning).split(/[，,；;、：:（）()\s]+/).filter(x => x.length >= 2);
    const similar = w => tokens.some(t => w.meaning.includes(t)) || String(w.meaning).split(/[，,；;、：:（）()\s]+/).filter(x => x.length >= 2).some(t => word.meaning.includes(t));
    const add = w => {
      const key = normalize(w.meaning);
      if (picked.length < 3 && key && !seen.has(key)) { picked.push(w); seen.add(key); }
    };
    candidates.filter(w => !similar(w)).forEach(add);
    if (picked.length < 3) candidates.forEach(add);
    if (picked.length < 3) throw new Error('至少需要四个不同释义才能生成选择题');
    return shuffle([word, ...picked], random).map(w => ({ id: w.id, meaning: w.meaning }));
  }
  function validCount(value, maximum) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= maximum ? n : null;
  }
  const statusFor = (confidence, correct) => confidence === 'known' && correct ? 'mastered' : 'review';
  function updateRecord(previous, confidence, correct, now = Date.now()) {
    return {
      attempts: (previous?.attempts || 0) + 1,
      correct: (previous?.correct || 0) + Number(correct),
      status: statusFor(confidence, correct), confidence,
      lastCorrect: Boolean(correct), updatedAt: now
    };
  }
  function summarize(records, words) {
    const all = words.map(w => records[String(w.id)]).filter(Boolean);
    return { seen: all.length, mastered: all.filter(r => r.status === 'mastered').length,
      review: all.filter(r => r.status === 'review').length,
      attempts: all.reduce((a, r) => a + r.attempts, 0),
      correct: all.reduce((a, r) => a + r.correct, 0) };
  }
  const api = { shuffle, makeOptions, validCount, statusFor, updateRecord, summarize };
  root.GRELogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
