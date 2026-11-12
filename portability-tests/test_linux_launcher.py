"""Check POSIX launcher control flow under Git for Windows sh, not native Linux."""
from pathlib import Path
from datetime import datetime, timezone
import json
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SH = Path(r'C:\Program Files\Git\usr\bin\sh.exe')
TEMP = Path(tempfile.mkdtemp(prefix='gre-launcher-sh-'))
results = []

def posix(path):
    value = str(path.resolve()).replace('\\', '/')
    return '/' + value[0].lower() + value[2:]

def check(name, fn):
    try:
        fn()
        results.append({'name': name, 'ok': True})
        print('PASS', name)
    except Exception as exc:
        results.append({'name': name, 'ok': False, 'error': str(exc)})
        print('FAIL', name, str(exc))

def syntax():
    data = (ROOT/'打开GRE-Linux.sh').read_bytes()
    assert not data.startswith(b'\xef\xbb\xbf') and b'\r' not in data
    result = subprocess.run([str(SH), '-n', posix(ROOT/'打开GRE-Linux.sh')], capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr.decode(errors='replace')

def run_case(name, xdg=None, gio=None, page=True):
    work = TEMP/name
    folder = work/'U 盘资料 空格'
    folder.mkdir(parents=True)
    script = folder/'打开GRE-Linux.sh'
    shutil.copyfile(ROOT/'打开GRE-Linux.sh', script)
    if page:
        (folder/'GRE-start.html').write_text('<html>test</html>', encoding='utf8')
    commands = work/'bin'
    commands.mkdir()
    for command, code in [('xdg-open', xdg), ('gio', gio)]:
        if code is not None:
            (commands/command).write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$GRE_TEST_LOG-'+command+'"\nexit '+str(code)+'\n', encoding='utf8', newline='\n')
    env = dict(os.environ, GRE_TEST_LOG=posix(work/'arguments'))
    result = subprocess.run([str(SH), '-c', 'PATH="$1:/usr/bin:/bin"; export PATH; sh "$2"', 'test', posix(commands), posix(script)], cwd=TEMP, env=env, capture_output=True, timeout=10)
    expected_page = posix(folder/'GRE-start.html')
    if not page:
        assert result.returncode != 0
        assert b'was not found' in result.stderr
    elif xdg == 0:
        assert result.returncode == 0, result.stderr.decode(errors='replace')
        assert (work/'arguments-xdg-open').read_text(encoding='utf8').splitlines() == [expected_page]
        assert not (work/'arguments-gio').exists()
    elif gio == 0:
        assert result.returncode == 0, result.stderr.decode(errors='replace')
        assert (work/'arguments-gio').read_text(encoding='utf8').splitlines() == ['open', expected_page]
    else:
        assert result.returncode != 0
        assert expected_page in result.stderr.decode('utf8')

check('LF/no-BOM script passes POSIX sh syntax validation', syntax)
check('xdg-open receives one intact absolute path from unrelated working directory', lambda: run_case('xdg', xdg=0, gio=0))
check('failed xdg-open falls back to gio open with intact path', lambda: run_case('gio', xdg=1, gio=0))
check('missing desktop opener reports the exact file to open manually', lambda: run_case('manual'))
check('missing launcher page reports an actionable failure', lambda: run_case('missing', xdg=0, page=False))
(ROOT/'portability-tests/linux-launcher-report.json').write_text(json.dumps({
    'testedAt': datetime.now(timezone.utc).isoformat(),
    'runtime': 'Git for Windows POSIX sh; stub desktop openers; not native Linux desktop',
    'native_linux': 'No running distribution; only a stopped docker-desktop distribution was installed. No environment was started or installed.',
    'results': results,
}, ensure_ascii=False, indent=2), encoding='utf8')
raise SystemExit(1 if any(not test['ok'] for test in results) else 0)
