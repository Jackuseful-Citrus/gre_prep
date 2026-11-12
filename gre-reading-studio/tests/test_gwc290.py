"""Checks meaningful source coverage and fully answerable GWC items."""
from pathlib import Path
import json,re,unittest,collections
DATA=Path(__file__).resolve().parents[1]/'data/gwc290.json'
d=json.loads(DATA.read_text(encoding='utf8'))
ps=d['passages'];qs=[q for p in ps for q in p['questions']]
class GwcExtractionTests(unittest.TestCase):
    def test_source_coverage(self):
        self.assertEqual(292,d['source']['pages'])
        self.assertEqual(289,len(ps))
        self.assertEqual(597,len(qs))
        self.assertEqual(set(range(1,140)),{p['number'] for p in ps if re.fullmatch(r'gwc290-p\d+',p['id'])})
        self.assertEqual(set(range(1,41)),{p['number'] for p in ps if re.fullmatch(r'gwc290-r\d+',p['id'])})
    def test_unique_identifiers(self):
        self.assertEqual(len(ps),len({p['id'] for p in ps}))
        self.assertEqual(len(qs),len({q['id'] for q in qs}))
    def test_answers_and_option_structure(self):
        for q in qs:
            self.assertEqual('source-key',q['answerStatus'],q['id'])
            self.assertTrue(q['answer'],q['id'])
            self.assertTrue(set(q['answer']).issubset({o['id'] for o in q['options']}),q['id'])
            self.assertTrue(q['answerPages'],q['id'])
            if q['kind']!='sentence':self.assertIn(len(q['options']),(3,5),q['id'])
            if q['kind']=='single':self.assertEqual(len(q['answer']),1,q['id'])
    def test_content_and_provenance(self):
        for p in ps:
            self.assertGreater(len(p['text']),70,p['id'])
            self.assertTrue(p['rawText'])
            self.assertTrue(p['pages'])
            self.assertTrue(all(10<=pn<=290 for pn in p['pages']))
            for q in p['questions']:
                self.assertGreater(len(q['stem']),15,q['id'])
                self.assertFalse(re.search(r'微信公众号|附录 1|KEYS',q['stem']))
                self.assertTrue(all(o['text'] for o in q['options']))
    def test_highlights_and_sentence_mapping(self):
        for p in ps:
            if any(re.search('highlighted|boldface|bold face|indicated',q['stem'],re.I) for q in p['questions']):
                self.assertTrue(p.get('highlights'),p['id'])
            for h in p.get('highlights',[]):self.assertIn(h,p['text'])
        self.assertEqual(10,sum(q['kind']=='sentence' for q in qs))
    def test_source_discrepancy_disclosed(self):
        self.assertTrue(any(x['issue']=='source-count-discrepancy' for x in d['coverage']['issues']))
if __name__=='__main__':unittest.main()
