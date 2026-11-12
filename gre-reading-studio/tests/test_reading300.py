"""Validate complete Reading 300 coverage without fabricating missing answers."""
from pathlib import Path
import json,re,unittest
d=json.loads((Path(__file__).resolve().parents[1]/'data/reading300.json').read_text(encoding='utf8'))
ps=d['passages'];qs=[q for p in ps for q in p['questions']]
class Reading300Tests(unittest.TestCase):
    def test_complete_source_numbers(self):
        self.assertEqual(284,d['source']['pages'])
        self.assertEqual(300,len(ps))
        self.assertEqual(set(range(1,301)),{p['number'] for p in ps})
        self.assertEqual(678,len(qs))
    def test_no_invented_answers(self):
        for q in qs:
            self.assertIsNone(q['answer'])
            self.assertEqual('unverified',q['answerStatus'])
            self.assertIsNone(q['explanation'])
    def test_question_boundaries(self):
        for p in ps:
            self.assertTrue(p['questions'],p['id'])
            self.assertEqual(list(range(1,len(p['questions'])+1)),[q['number'] for q in p['questions']],p['id'])
            self.assertGreater(len(p['text']),80,p['id'])
            self.assertFalse(re.search(r'Which of the following|Consider each of the choices|微信公众号',p['text']),p['id'])
            for q in p['questions']:
                self.assertGreater(len(q['stem']),15,q['id'])
                self.assertTrue(q['options'],q['id'])
                if q['kind']!='sentence':
                    self.assertTrue(all(not re.search(r'Which of the following|Consider each of the choices|微信公众号',o['text']) for o in q['options']),q['id'])
    def test_unique_ids_and_pages(self):
        self.assertEqual(len(ps),len({p['id'] for p in ps}))
        self.assertEqual(len(qs),len({q['id'] for q in qs}))
        for p in ps:
            self.assertTrue(p['rawText'])
            self.assertTrue(all(11<=pg<=284 for pg in p['pages']))
    def test_source_defects_disclosed(self):
        expected={'reading300-p036-q2','reading300-p141-q3','reading300-p195-q3'}
        found={q['id'] for q in qs if q['kind']!='sentence' and len(q['options']) not in (3,5)}
        self.assertEqual(expected,found)
        for q in qs:
            if q['id'] in expected:self.assertTrue(any('核验' in n for n in q['notes']))
        self.assertTrue(any(x['issue']=='source-option-truncation' for x in d['coverage']['issues']))
    def test_highlights_match_original(self):
        exceptions={x['id'] for x in d['coverage']['issues'] if x['issue']=='highlight-unrecovered'}
        self.assertEqual({'reading300-p035','reading300-p245'},exceptions)
        for p in ps:
            for h in p.get('highlights',[]):self.assertIn(h,p['text'])
            if any(re.search('highlighted|boldface|bold face|indicated',q['stem'],re.I) for q in p['questions']):
                self.assertTrue(p.get('highlights') or p['id'] in exceptions,p['id'])
if __name__=='__main__':unittest.main()
