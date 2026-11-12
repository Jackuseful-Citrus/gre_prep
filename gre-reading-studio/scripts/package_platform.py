"""Portable local-only distribution; no remote service or hosting workflow."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT.parent/'gre-training-platform-local.zip'
files=[p for p in (ROOT/'dist').rglob('*') if p.is_file()]
files += [p for p in (ROOT/'reports').rglob('*') if p.is_file()]
files += [p for p in (ROOT/'data/platform').rglob('*') if p.is_file()]
for name in ['build_platform.py','build_question_ai_images.cjs','package_platform.py','generate_delivery_report.py','report_mock.py','report_subject.py']:
 files.append(ROOT/'scripts'/name)
for name in ['platform-qa-report.json','app-qa-report.json','mock-qa-report.json','mock-core-report.json','subject-core-report.json','subject-qa-report.json']:
 p=ROOT/'tests'/name
 if p.exists():files.append(p)
for name in ['gre_question_bank.json','gre_library_inventory.xlsx','gre_library_inventory.json','gre_import_report.xlsx','使用说明.txt','使用说明-综合训练.txt','使用说明-模考.txt','题库格式说明.txt','升级交付报告.txt','打开GRE综合训练.cmd','打开阅读练习.cmd','打开GRE模考.cmd','打开随机刷题.cmd']:
 p=ROOT/name
 if p.exists():files.append(p)
with ZipFile(OUT,'w',ZIP_DEFLATED,compresslevel=6) as archive:
 for path in files:archive.write(path,Path('gre-reading-studio')/path.relative_to(ROOT))
with ZipFile(OUT) as archive:
 assert archive.testzip() is None
 assert len(archive.infolist())==len(files)
 assert 'gre-reading-studio/dist/platform.js' in archive.namelist()
print(json.dumps({'path':str(OUT),'files':len(files),'bytes':OUT.stat().st_size},ensure_ascii=False))
