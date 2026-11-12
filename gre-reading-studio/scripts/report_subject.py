"""Current random-practice acceptance, separate from historical full-mock reports."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf8'))

def qa(name):
    data = read('tests/' + name)
    if 'results' in data:
        return {'passed': sum(bool(r['ok']) for r in data['results']),
                'failed': sum(not r['ok'] for r in data['results']),
                'report': 'tests/' + name}
    return {'passed': data['passed'], 'failed': data['failed'], 'report': 'tests/' + name}

expected = {
    'gre_question_bank.json': '01073549a91dd314cd51ca6e9e2836798c625e84328b6a0ecfb823281f38df5c',
    'dist/data.js': '451197d143d2edbbfdd6ad9e7add050c54309d4faba6b1e3bb5806c8e49a6ee8',
    'dist/styles.css': 'b6926e10ac72205bfd5b78cb0e03c465225f9f6b4c05ef9d110b1d804f2c5949',
}
integrity = {name: {'sha256': hashlib.sha256((ROOT / name).read_bytes()).hexdigest()}
             for name in expected}
for name, item in integrity.items():
    item['unchanged'] = item['sha256'] == expected[name]

report = {
    'feature': 'Verbal / Quant 独立随机刷题',
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'runtime': '本地静态网页；无新增后端或外部服务，未在线发布',
    'default': {'subject': 'Verbal', 'count': 20, 'mode': 'free', 'instant_answers': True},
    'count_range': [1, 100],
    'available_questions': read('tests/subject-core-report.json')['available'],
    'selection': '从对应科目合格池随机抽取，不沿用旧筛选；组内去重，抽题后按共享材料归组。',
    'compatibility': '沿用综合进度、错题、笔记、收藏和备份；保留旧模考续考、历史、复盘和导入导出。',
    'tests': {key: qa(value) for key, value in {
        'subject_core': 'subject-core-report.json',
        'subject_browser': 'subject-qa-report.json',
        'legacy_mock_core': 'mock-core-report.json',
        'platform_regression': 'platform-qa-report.json',
        'reading_regression': 'app-qa-report.json',
    }.items()},
    'integrity': integrity,
    'historical_report_note': 'gre_mock_report.json / mock-qa-report.json 属于此前五节模考验收；本次入口以本报告为准。',
}
assert all(test['failed'] == 0 for test in report['tests'].values())
assert all(item['unchanged'] for item in integrity.values())
(ROOT / 'reports/gre_subject_practice_report.json').write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps({'tests': report['tests'], 'integrity_passed': True}, ensure_ascii=False))
