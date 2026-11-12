from pathlib import Path
import sys, json, zipfile, hashlib
ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / 'gre-reading-studio'
sys.path.insert(0, str(PROJECT / 'scripts' / 'vendor'))
import rarfile

inventory = []
for path in list(ROOT.glob('*.zip')) + list(ROOT.rglob('*.rar')):
    if PROJECT in path.parents:
        continue
    try:
        if path.suffix.lower() == '.zip':
            with zipfile.ZipFile(path) as archive:
                entries = []
                for item in archive.infolist():
                    name = item.filename
                    if not (item.flag_bits & 0x800):
                        try: name = name.encode('cp437').decode('utf-8')
                        except (UnicodeError, ValueError): pass
                    entries.append({'name': name, 'size': item.file_size})
                    if '阅读' in name and name.lower().endswith('.pdf') and '__MACOSX' not in name:
                        target = PROJECT / 'data' / 'archive-reading.pdf'
                        target.write_bytes(archive.read(item))
                        entries[-1]['extractedTo'] = str(target.relative_to(PROJECT))
                inventory.append({'archive': str(path.relative_to(ROOT)), 'entries': entries})
        else:
            with rarfile.RarFile(path) as archive:
                inventory.append({'archive': str(path.relative_to(ROOT)), 'entries': [{'name': i.filename, 'size': i.file_size} for i in archive.infolist()]})
    except Exception as error:
        inventory.append({'archive': str(path.relative_to(ROOT)), 'error': str(error)})
(PROJECT / 'data' / 'archive-inventory.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding='utf-8')
for archive in inventory:
    print(json.dumps(archive, ensure_ascii=True))
baseline = {}
for name in ['index.html', 'app.js', 'styles.css', 'words.js', 'words.json', 'progress.js', 'lexicon.js', 'views.js']:
    path = ROOT / 'gre800-cards' / 'dist' / name
    baseline[name] = hashlib.sha256(path.read_bytes()).hexdigest()
(PROJECT / 'data' / 'vocabulary-project-baseline.json').write_text(json.dumps(baseline, indent=2), encoding='utf-8')
