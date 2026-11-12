"""Independent acceptance checks for the final, browser-consumed library.

Run: python tests/test_library.py
Checks provenance, lossless coverage, scoring safety, PDF mappings, and that the
existing vocabulary app was not changed. No application implementation is copied.
"""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import unicodedata
import unittest
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
MATERIALS = ROOT.parent
REQUIRED_DATASETS = ['gold40', 'gwc290', 'white', 'mcgraw', 'crown', 'reading170', 'reading300', 'guide']
sys.path.insert(0, str(MATERIALS/'gre800-cards/scripts/vendor'))
from pypdf import PdfReader


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def comparison_text(value):
    """A deliberately conservative, independent comparison of source wording."""
    value = re.sub('[❶-❿①-⑳]', '', value or '')
    value = unicodedata.normalize('NFKC', value)
    value = re.sub(r'\bQ\d+', '', value)
    value = value.translate(str.maketrans({'‘':"'",'’':"'",'“':'"','”':'"','―':'—','–':'-'}))
    return re.sub(r'\s+', ' ', value).strip().lower()


def has_conflict(question):
    return bool(question.get('alternateAnswer') or 'conflict' in question.get('answerStatus','') or
                any('答案不一致' in n or '答案冲突' in n for n in question.get('notes',[])))


class LibraryAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script = (ROOT/'dist/data.js').read_text(encoding='utf-8')
        match = re.fullmatch(r'\s*window\.GRE_READING_DATA\s*=\s*(.*);\s*', script, re.S)
        if not match:
            raise AssertionError('data.js must contain one GRE_READING_DATA JSON assignment')
        cls.data = json.loads(match.group(1))
        cls.datasets = {name:read_json(ROOT/'data'/f'{name}.json') for name in REQUIRED_DATASETS if (ROOT/'data'/f'{name}.json').exists()}
        cls.sources = {s['id']:s for s in cls.data['sources']}
        cls.original_passages = {}
        cls.original_questions = {}
        for dataset in cls.datasets.values():
            for p in dataset.get('passages',[]):
                cls.original_passages[(p['sourceId'],p['id'])] = p
                for q in p['questions']:
                    cls.original_questions[(p['sourceId'],q['id'])] = (p,q)
        cls.pdf_counts = {}

    def source_url(self, source):
        return source.get('url') or source.get('path') or source.get('pdfUrl') or source.get('reader',{}).get('url')

    def local_pdf(self, source):
        url = self.source_url(source)
        self.assertTrue(url, source['id'])
        parts = urlsplit(url)
        self.assertFalse(parts.scheme, f"Source should remain usable locally: {url}")
        path = (ROOT/'dist'/unquote(parts.path)).resolve()
        self.assertTrue(path.is_relative_to((ROOT/'dist').resolve()), url)
        self.assertTrue(path.is_file(), str(path))
        return path

    def pdf_count(self, source):
        path = self.local_pdf(source)
        if path not in self.pdf_counts:
            self.pdf_counts[path] = len(PdfReader(path).pages)
        return self.pdf_counts[path]

    def check_pages(self, sid, pages, context):
        self.assertIn(sid, self.sources, context)
        source = self.sources[sid]
        mapping = source.get('reader',{}).get('pageMap') or source.get('pageMap')
        maximum = self.pdf_count(source)
        for page in pages or []:
            self.assertIsInstance(page, int, context)
            self.assertGreater(page, 0, context)
            self.assertLessEqual(page, source['pages'], context)
            if mapping:
                self.assertIn(str(page), mapping, f'{context}: original page {page} missing from PDF subset')
                self.assertGreaterEqual(mapping[str(page)], 1, context)
                self.assertLessEqual(mapping[str(page)], maximum, context)
            else:
                self.assertLessEqual(page, maximum, context)

    def test_01_all_discovered_datasets_are_included(self):
        self.assertEqual(set(self.datasets), set(REQUIRED_DATASETS), 'Final build is missing a discovered reading source')
        for name,dataset in self.datasets.items():
            sid=dataset['source']['id']
            self.assertIn(sid,self.sources,name)
            self.assertEqual(self.sources[sid]['passageCount'],len(dataset.get('passages',[])),name)
            self.assertEqual(self.sources[sid]['questionCount'],sum(len(p['questions']) for p in dataset.get('passages',[])),name)
        self.assertEqual(self.data['stats']['originalPassages'],len(self.original_passages))
        self.assertEqual(self.data['stats']['originalQuestions'],len(self.original_questions))

    def test_02_every_original_passage_is_represented_once(self):
        refs=collections.Counter((r['sourceId'],r['passageId']) for p in self.data['passages'] for r in p['references'])
        self.assertEqual(set(refs),set(self.original_passages))
        self.assertTrue(all(n==1 for n in refs.values()),'One source passage appears in more than one merged record')

    def test_03_every_original_question_is_represented_once(self):
        refs=collections.Counter((r['sourceId'],r['questionId']) for p in self.data['passages'] for q in p['questions'] for r in q['references'])
        self.assertEqual(set(refs),set(self.original_questions))
        self.assertTrue(all(n==1 for n in refs.values()),'One source question appears in more than one merged record')

    def test_04_ids_and_statistics_are_consistent(self):
        passages=self.data['passages'];questions=[q for p in passages for q in p['questions']]
        for items in [passages,questions,self.data['sources'],self.data.get('sourceReading',[])]:
            self.assertEqual(len(items),len({i['id'] for i in items}))
        stats=self.data['stats']
        self.assertEqual(stats['passages'],len(passages))
        self.assertEqual(stats['questions'],len(questions))
        self.assertEqual(stats['gradable'],sum(q['gradable'] for q in questions))
        self.assertEqual(stats['ungraded'],sum(not q['gradable'] for q in questions))
        self.assertEqual(stats['conflicts'],sum(q['answerStatus']=='conflict' for q in questions))
        self.assertEqual(sum(stats['topics'].values()),len(passages))

    def test_05_scored_answers_match_real_options(self):
        for p in self.data['passages']:
            self.assertTrue(p['text'].strip(),p['id'])
            for q in p['questions']:
                self.assertTrue(q['stem'].strip(),q['id'])
                options=q.get('options',[]);ids=[o['id'] for o in options]
                self.assertEqual(len(ids),len(set(ids)),q['id'])
                self.assertTrue(all(o['text'].strip() for o in options),q['id'])
                self.assertEqual(bool(q.get('answer')),q['gradable'],q['id'])
                if q['gradable']:
                    self.assertEqual(q['answerStatus'],'source-key',q['id'])
                    self.assertTrue(set(q['answer'])<=set(ids),q['id'])
                    if q['kind'] in ['single','sentence']:self.assertEqual(len(q['answer']),1,q['id'])
                    keys=[set(r['answer']) for r in q['references'] if r.get('answer')]
                    self.assertTrue(keys,q['id'])
                    self.assertTrue(all(k==set(q['answer']) for k in keys),q['id'])

    def test_06_merged_passages_retain_wording_and_boundaries(self):
        for p in self.data['passages']:
            originals=[self.original_passages[(r['sourceId'],r['passageId'])] for r in p['references']]
            expected=comparison_text(originals[0]['text'])
            for original in originals[1:]:
                self.assertEqual(comparison_text(original['text']),expected,
                                 f"Meaning-changing text normalization merged {originals[0]['id']} with {original['id']}")

    def test_07_shared_keys_require_identical_question_and_choices(self):
        for p in self.data['passages']:
            for q in p['questions']:
                originals=[self.original_questions[(r['sourceId'],r['questionId'])] for r in q['references']]
                first=originals[0][1]
                expected=(comparison_text(first['stem']),[(o['id'],comparison_text(o['text'])) for o in first.get('options',[])])
                for _,original in originals[1:]:
                    actual=(comparison_text(original['stem']),[(o['id'],comparison_text(o['text'])) for o in original.get('options',[])])
                    self.assertEqual(actual,expected,q['id'])

    def test_08_highlight_questions_do_not_cross_unknown_targets(self):
        for p in self.data['passages']:
            for q in p['questions']:
                if len(q['references'])<2 or not re.search(r'highlight|boldface|bold face',q['stem'],re.I):continue
                signatures=[]
                for r in q['references']:
                    original,_=self.original_questions[(r['sourceId'],r['questionId'])]
                    marks=original.get('highlights') or original.get('highlightedText') or []
                    texts=[m if isinstance(m,str) else m.get('text','') for m in marks]
                    signature=tuple(comparison_text(t) for t in texts)
                    self.assertTrue(signature,f"{q['id']}: merged highlighted question without recoverable target in {original['id']}")
                    signatures.append(signature)
                self.assertTrue(all(s==signatures[0] for s in signatures),q['id'])

    def test_09_explicit_conflicts_never_regain_a_score(self):
        checked=0
        for p in self.data['passages']:
            for q in p['questions']:
                original_conflict=any(has_conflict(self.original_questions[(r['sourceId'],r['questionId'])][1]) for r in q['references'])
                source_keys={tuple(sorted(r['answer'])) for r in q['references'] if r.get('answer')}
                if original_conflict or len(source_keys)>1:
                    checked+=1
                    self.assertFalse(q['gradable'],q['id'])
                    self.assertIsNone(q['answer'],q['id'])
                    self.assertEqual(q['answerStatus'],'conflict',q['id'])
        self.assertGreaterEqual(checked,1,'The documented Gold R39 Q3 conflict must stay visible')

    def test_10_source_pdfs_and_subset_mappings_exist(self):
        for source in self.sources.values():
            count=self.pdf_count(source)
            reader=source.get('reader',{})
            if reader.get('pageMap'):
                mapping=reader['pageMap']
                self.assertEqual(len(mapping),count,source['id'])
                self.assertEqual(set(mapping.values()),set(range(1,count+1)),source['id'])
                self.assertEqual(set(map(int,mapping)),set(reader['originalPages']),source['id'])
            else:self.assertEqual(source['pages'],count,source['id'])

    def test_11_every_source_reference_resolves_to_a_page(self):
        for p in self.data['passages']:
            for r in p['references']:self.check_pages(r['sourceId'],r['pages'],p['id'])
            if p.get('translationPages'):self.check_pages(p.get('translationSourceId',p['sourceId']),p['translationPages'],p['id']+' translation')
            for q in p['questions']:
                for r in q['references']:
                    self.check_pages(r['sourceId'],r.get('pages',[]),q['id'])
                    self.check_pages(r['sourceId'],r.get('answerPages',[]),q['id']+' answer')
                    if r.get('explanationPages'):self.check_pages(r.get('explanationSourceId',r['sourceId']),r['explanationPages'],q['id']+' explanation')
        for doc in self.data.get('sourceReading',[]):self.check_pages(doc['sourceId'],doc['pages'],doc['id'])

    def test_12_raw_extraction_survives_for_each_original(self):
        for p in self.data['passages']:
            for r in p['references']:
                original=self.original_passages[(r['sourceId'],r['passageId'])]
                if original.get('rawText'):
                    # Root retains original extraction JSONs even when the
                    # display record deduplicates the same passage.
                    self.assertTrue(original['rawText'].strip(),original['id'])
                    if r.get('rawText') is not None:self.assertEqual(r['rawText'],original['rawText'],original['id'])
            self.assertTrue(p.get('rawText') or any(r.get('rawText') for r in p['references']),p['id'])

    def test_13_existing_vocabulary_project_is_unchanged(self):
        baseline=read_json(ROOT/'data/vocabulary-project-baseline.json')
        for relative,expected in baseline.items():
            path=MATERIALS/'gre800-cards/dist'/relative
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),expected,relative)

    def test_14_semantic_boundaries_are_not_normalized_away(self):
        spec=importlib.util.spec_from_file_location('reading_builder',ROOT/'scripts/build_data.py')
        builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
        for a,b in [('nowhere','now here'),('re-sign','resign'),('1.5','15'),('cannot','can not')]:
            self.assertNotEqual(builder.norm(a),builder.norm(b),(a,b))


if __name__=='__main__':
    unittest.main(verbosity=2)
