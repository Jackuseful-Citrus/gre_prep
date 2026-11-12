"""Summarize actual local test artifacts for the mock-exam delivery."""
from pathlib import Path
from datetime import datetime, timezone
import json, hashlib

root=Path(__file__).resolve().parents[1]
def read(name):return json.loads((root/name).read_text(encoding='utf8'))
def qa(name):
    data=read('tests/'+name)
    if 'results' in data:
        results=data['results']
        return {'passed':sum(r['ok'] for r in results),'failed':sum(not r['ok'] for r in results),'report':'tests/'+name}
    return {'passed':data['passed'],'failed':data['failed'],'report':'tests/'+name}

data={
    'feature':'GRE 全真结构模考',
    'generated_at':datetime.now(timezone.utc).isoformat(),
    'rules_verified_on':'2026-11-07',
    'runtime':'本地静态网页；未上传本地资料，未在线发布',
    'sections':[
        {'id':'AWA','task':'Analyze an Issue','count':1,'minutes':30},
        {'id':'V1','count':12,'minutes':18},
        {'id':'V2','count':15,'minutes':23},
        {'id':'Q1','count':12,'minutes':21},
        {'id':'Q2','count':15,'minutes':26}],
    'total_minutes':118,'objective_questions':54,'essays':1,
    'features':['写作首先，随后科目顺序可选','当前节内跳题、改答、标记与总览','独立截止时间，提前交卷不累加剩余时间','超时自动转节、刷新及离线不暂停','数学练习计算器与原图放大','整场交卷后原始分数、漏题及逐题复盘','作文导出、完整历史、本地备份与综合记录同步'],
    'eligibility':'仅使用本地已核验且符合当前格式的客观题，以及题干和指令完整的 Issue；排除旧版 TC、回忆自答、知识练习、Argument 和不完整客观题。',
    'limits':['本地题库缺少ETS难度标定，不复刻官方分节自适应或等值换算','不生成130–170估分、不自动作文评分','题型细分搭配为练习配比，不声称ETS每卷固定配比','计算器标注练习版本，不承诺与ETS软件完全一致'],
    'sources':[
        'https://www.ets.org/gre/test-takers/general-test/prepare/test-structure.html',
        'https://www.ets.org/gre/test-takers/general-test/prepare/strategies-tips.html',
        'https://www.ets.org/gre/test-takers/general-test/scores/understand-scores.html',
        'https://www.ets.org/content/dam/ets-org/pdfs/gre/general-test-enhancement-faqs-for-score-users.pdf',
        'https://www.ets.org/pdfs/gre/on-screen-calculator-guidelines.pdf'],
    'tests':{k:qa(v) for k,v in {'mock_core':'mock-core-report.json','mock_browser':'mock-qa-report.json','platform_regression':'platform-qa-report.json','reading_regression':'app-qa-report.json'}.items()},
    'data_acceptance':{'failure_count':read('reports/platform-data-acceptance.json')['failure_count']},
    'question_bank_sha256':hashlib.sha256((root/'gre_question_bank.json').read_bytes()).hexdigest(),
    'question_bank_unchanged':hashlib.sha256((root/'gre_question_bank.json').read_bytes()).hexdigest()=='01073549a91dd314cd51ca6e9e2836798c625e84328b6a0ecfb823281f38df5c'
}
assert all(t['failed']==0 for t in data['tests'].values())
assert data['question_bank_unchanged'] and data['data_acceptance']['failure_count']==0
(root/'reports/gre_mock_report.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'tests':data['tests'],'bank_unchanged':data['question_bank_unchanged']},ensure_ascii=False))
