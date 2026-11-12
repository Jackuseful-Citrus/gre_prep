"""Create a portable, offline distribution without contacting remote services."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parents[1]
target = root.parent/'gre-reading-studio-local.zip'
files = [p for p in (root/'dist').rglob('*') if p.is_file()]
files += [root/'使用说明.txt', root/'打开阅读练习.cmd']
with ZipFile(target,'w',compression=ZIP_DEFLATED,compresslevel=6) as archive:
    for path in files:
        archive.write(path,Path('gre-reading-studio')/path.relative_to(root))
with ZipFile(target) as archive:
    assert archive.testzip() is None
    assert len(archive.infolist()) == len(files)
print(json.dumps({'archive':str(target),'files':len(files),'bytes':target.stat().st_size},ensure_ascii=False))
