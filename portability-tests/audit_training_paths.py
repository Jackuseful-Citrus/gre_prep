"""Read-only checks for relative, case-correct, readable training app assets."""
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'gre-reading-studio' / 'dist'
refs = []
issues = []

class Links(HTMLParser):
    def __init__(self, filename):
        super().__init__()
        self.filename = filename
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ('src', 'href') and value:
                refs.append((self.filename + ':' + tag + '.' + key, value))

for path in DIST.glob('*.html'):
    Links(path.name).feed(path.read_text(encoding='utf8'))
for path in DIST.glob('*.css'):
    content = path.read_text(encoding='utf8')
    for match in re.finditer(r'url\(\s*[\"\']?([^\)\"\']+)', content):
        refs.append((path.name + ':url', match.group(1).strip()))

def walk(value, at):
    if isinstance(value, dict):
        for key, entry in value.items():
            if key in ('src', 'url', 'path', 'href') and isinstance(entry, str):
                refs.append((at + '.' + key, entry))
            walk(entry, at + '.' + key)
    elif isinstance(value, list):
        for i, entry in enumerate(value):
            walk(entry, at + '[' + str(i) + ']')

banks = {}
for filename in ('data.js', 'platform-data.js'):
    text = (DIST / filename).read_text(encoding='utf8')
    bank = json.loads(text.split('=', 1)[1].strip().removesuffix(';'))
    banks[filename] = bank
    walk(bank, filename)

directory_cache = {}
unique = {}
external = []
for at, value in refs:
    if value.startswith(('#', 'data:', 'blob:')):
        continue
    parts = urlsplit(value)
    if parts.scheme or parts.netloc or value.startswith('/') or '\\' in value:
        issues.append({'kind': 'nonrelative_reference', 'at': at, 'value': value})
        continue
    relative = unquote(parts.path)
    if not relative:
        continue
    path = DIST
    for component in relative.split('/'):
        if component in ('', '.'):
            continue
        if component == '..':
            issues.append({'kind': 'parent_reference', 'at': at, 'value': value})
            break
        if path not in directory_cache:
            directory_cache[path] = {p.name for p in path.iterdir()} if path.is_dir() else set()
        if component not in directory_cache[path]:
            issues.append({'kind': 'missing_or_case_mismatch', 'at': at, 'value': value,
                           'component': component})
            break
        path = path / component
    else:
        if not path.is_file():
            issues.append({'kind': 'not_file', 'at': at, 'value': value})
        else:
            unique[relative] = path

manifest = []
for relative, path in sorted(unique.items()):
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open('rb') as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b''):
                digest.update(chunk)
                size += len(chunk)
        manifest.append({'path': relative, 'bytes': size, 'sha256': digest.hexdigest()})
    except OSError as exc:
        issues.append({'kind': 'unreadable_file', 'path': relative, 'message': str(exc)})

code = {p.name: p.read_text(encoding='utf8') for p in DIST.glob('*.js')
        if p.name not in ('data.js', 'platform-data.js')}
network_calls = []
windows_path_literals = []
for filename, text in code.items():
    for lineno, line in enumerate(text.splitlines(), 1):
        if re.search(r'\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(', line):
            network_calls.append({'file': filename, 'line': lineno})
        if re.search(r'[A-Za-z]:\\\\|file:///', line):
            windows_path_literals.append({'file': filename, 'line': lineno})

report = {
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'scope': 'GRE training app HTML/CSS plus every src/url/path/href in both bundled runtime datasets',
    'host': 'Windows; Linux path case-sensitivity is checked explicitly; no Linux desktop runtime claimed',
    'reference_count': len(refs),
    'unique_asset_count': len(unique),
    'asset_types': dict(Counter(p.suffix.lower() for p in unique.values())),
    'total_read_bytes': sum(item['bytes'] for item in manifest),
    'bank_questions': len(banks['platform-data.js']['questions']),
    'legacy_reading_questions': sum(len(p['questions']) for p in banks['data.js']['passages']),
    'network_api_call_sites': network_calls,
    'windows_path_literal_sites': windows_path_literals,
    'issues': issues,
    'passed': not issues and not network_calls and not windows_path_literals,
    'storage': {'progress': 'gre-training-progress-v2', 'reading': 'gre-reading-studio-progress-v1',
                'mock': 'gre-mock-exams-v1', 'database': 'gre-training-local-v2'},
    'transfer_note': 'Progress lives in each browser profile. Export complete progress, copy JSON to USB, import on the other computer. Browser-imported custom question banks need separate bank export/import; copied built-in bank assets are self-contained.',
    'manifest': manifest,
}
out = Path(__file__).with_name('training-path-report.json')
out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps({k: v for k, v in report.items() if k != 'manifest'}, ensure_ascii=False))
raise SystemExit(0 if report['passed'] else 1)
