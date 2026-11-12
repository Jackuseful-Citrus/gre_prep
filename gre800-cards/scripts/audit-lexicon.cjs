// Reproducible, read-only audit of the original lexicon; writes only the new report.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const lexicon = require('../dist/lexicon.js');
const root = path.resolve(__dirname, '..');
const words = JSON.parse(fs.readFileSync(path.join(root, 'dist/words.json'), 'utf8'));
const index = lexicon.buildIndex(words);
const files = ['dist/words.js', 'dist/words.json', 'scripts/raw-entries.json', 'scripts/pdf-extracted.txt'];
const hashes = Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
const report = {
  auditVersion: 1,
  source: '《GRE800词 》.pdf',
  scope: '仅审查现有800词、815考法；未联网替换释义。疑点为待核验提示，不代表已经查证错误。',
  policy: index.policy,
  originalHashes: hashes,
  stats: index.stats,
  questionCounts: Object.fromEntries(lexicon.modes.map(mode => [mode, lexicon.questions(index, mode, () => 0.5).length])),
  oddQuestionSources: index.senses.filter(s => s.relatedIds.length >= 3 && s.distractorIds.length).map(s => ({ wordId: s.wordId, senseIndex: s.senseIndex, word: s.word, relatedIds: s.relatedIds })),
  flags: index.flags,
  excludedRelations: index.relations.filter(r => r.status === 'excluded'),
  extractionHistory: JSON.parse(fs.readFileSync(path.join(root, 'scripts/extraction-report.json'), 'utf8'))
};
fs.writeFileSync(path.join(root, 'scripts/lexicon-quality-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ stats: report.stats, questionCounts: report.questionCounts, hashes }, null, 2));
