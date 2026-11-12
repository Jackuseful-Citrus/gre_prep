from pathlib import Path
import sys, json, shutil, subprocess, tempfile
ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / 'gre-reading-studio'
sys.path.insert(0, str(PROJECT / 'scripts' / 'vendor'))
import rarfile

target_dir = PROJECT / 'data' / 'archive-sources'
target_dir.mkdir(parents=True, exist_ok=True)
reports = []
for archive_path in ROOT.rglob('*.rar'):
    if PROJECT in archive_path.parents or archive_path.stat().st_size > 100000000:
        continue
    with rarfile.RarFile(archive_path) as archive:
        selected = [i for i in archive.infolist() if ('阅读' in i.filename or '难度汇总' in i.filename) and i.filename.lower().endswith(('.pdf','.xlsx'))]
        if not selected: continue
        with tempfile.TemporaryDirectory(prefix='gre-reading-rar-') as tmp:
            tmpdir=Path(tmp)
            raw=tmpdir/'source.rar'; shutil.copyfile(archive_path,raw)
            # Validate every entry before native extraction. Nothing may escape tmpdir.
            for i in archive.infolist():
                normalized=i.filename.replace('\\','/')
                if normalized.startswith('/') or ':' in normalized or '..' in normalized.split('/'):
                    raise ValueError('Unsafe archive path: '+i.filename)
            out=tmpdir/'out';out.mkdir()
            result=subprocess.run(['C:/Windows/system32/tar.exe','-xf',str(raw),'-C',str(out)],capture_output=True)
            if result.returncode: raise RuntimeError(result.stderr.decode(errors='replace'))
            for i in selected:
                candidates=[p for p in out.rglob('*') if p.is_file() and p.stat().st_size==i.file_size]
                if len(candidates)!=1: raise ValueError('Cannot identify archive member '+i.filename)
                name = 'difficulty.xlsx' if i.filename.lower().endswith('.xlsx') else 'reading170-explained.pdf' if '170' in i.filename and '配套' not in i.filename else 'reading170-exercises.pdf' if '170' in i.filename else 'reading300.pdf'
                dest=target_dir/name;shutil.copyfile(candidates[0],dest)
                reports.append({'archive':str(archive_path.relative_to(ROOT)),'member':i.filename,'destination':str(dest.relative_to(PROJECT)),'size':i.file_size})
(PROJECT/'data'/'archive-extraction-report.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(reports,ensure_ascii=True))
