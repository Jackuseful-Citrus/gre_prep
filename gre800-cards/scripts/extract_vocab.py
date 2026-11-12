"""Extract GRE vocabulary directly from the user's specified PDF.

Run: python scripts/extract_vocab.py
Dependency: pypdf (install with python -m pip install --target scripts/vendor pypdf)
The default input is resolved through the repository's materials/manifest.json.
All numbered entries and all numbered senses are preserved. No other source is used.
"""
from __future__ import annotations
from collections import Counter
from pathlib import Path
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'vendor'))
sys.path.insert(0, str(ROOT.parent / 'gre-reading-studio' / 'scripts'))
from pypdf import PdfReader
from library_paths import resolve_material

PDF = Path(sys.argv[1]) if len(sys.argv) > 1 else resolve_material('《GRE800词 》.pdf')
# Two deterministic character-map defects in the PDF's embedded text layer.
CHAR_CORRECTIONS = {'᧿': '描', 'ᨀ': '提'}
POS = re.compile(r'^((?:adj|adv|conj|vi|vt|n|v)\.(?:\s*/\s*(?:adj|adv|conj|vi|vt|n|v)\.)*)\s*')
ENTRY = re.compile(r'^(\d{3})\.\s*([A-Za-z][A-Za-z -]*)\s*$')
SENSE = re.compile(r'^【考法\s*(\d*)】\s*(.*)$')
LABEL = re.compile(r'^(例|近|派|进)\s*[：:]\s*(.*)$')


def clean(text: str) -> str:
    for before, after in CHAR_CORRECTIONS.items():
        text = text.replace(before, after)
    text = re.sub(r'\s+', ' ', text).strip()
    return re.sub(r'(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])', '', text)


def split_definition(text: str, default_pos: str = '') -> dict:
    text = clean(text)
    match = POS.match(text)
    pos = match.group(1) if match else default_pos
    rest = text[match.end():] if match else text
    english_start = re.search(r'[A-Za-z]', rest)
    if not english_start:
        raise ValueError(f'Missing English explanation: {text!r}')
    meaning = rest[:english_start.start()].strip()
    english = rest[english_start.start():].strip()
    # Remove spaces introduced inside Chinese text by PDF wrapping.
    meaning = re.sub(r'(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])', '', meaning)
    if not meaning or not re.search(r'[\u4e00-\u9fff]', meaning):
        raise ValueError(f'Missing Chinese meaning: {text!r}')
    return {'pos': pos, 'meaning': meaning, 'english': english}


def parse_entry(entry: dict) -> dict:
    senses = []
    current = None
    field = None
    for line in entry.pop('_lines'):
        sense_match = SENSE.match(line)
        if sense_match:
            current = {'_definition': sense_match.group(2)}
            senses.append(current)
            field = '_definition'
            continue
        label_match = LABEL.match(line)
        if label_match:
            if current is None:
                raise ValueError(f"Label before sense in entry {entry['id']}")
            label, content = label_match.groups()
            # Entry 264 prints 进： where the synonym label 近： is intended.
            field = {'例': 'example', '近': 'synonyms', '进': 'synonyms', '派': 'derivatives'}[label]
            if entry['id'] == 700 and field == 'synonyms':
                field = 'example'  # Source labels this bilingual phrase as a synonym.
            current[field] = content
            continue
        if current is not None and field:
            current[field] += ' ' + line
        else:
            raise ValueError(f"Unparsed content in entry {entry['id']}: {line!r}")
    if not senses:
        raise ValueError(f"Entry {entry['id']} has no senses")
    definitions = []
    previous_pos = ''
    for sense in senses:
        definition = split_definition(sense.pop('_definition'), previous_pos)
        previous_pos = definition['pos']
        for key, value in sense.items():
            definition[key] = clean(value)
        definitions.append(definition)
    positions = list(dict.fromkeys(d['pos'] for d in definitions if d['pos']))
    meanings = list(dict.fromkeys(d['meaning'] for d in definitions))
    return {
        'id': entry['id'],
        'word': entry['word'],
        'pos': ' / '.join(positions),
        'meaning': '；'.join(meanings),
        'page': entry['page'],
        'group': entry['group'],
        'definitions': definitions,
    }


def main() -> None:
    reader = PdfReader(PDF)
    entries = []
    group = None
    current = None
    correction_occurrences = Counter()
    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ''
        # The body is PDF pages 5–88. Cover, instructions, and advertisements
        # are intentionally not vocabulary entries.
        if page_number < 5 or page_number > 88:
            continue
        for raw_line in text.splitlines():
            for bad in CHAR_CORRECTIONS:
                correction_occurrences[bad] += raw_line.count(bad)
            line = clean(raw_line)
            if not line:
                continue
            list_match = re.fullmatch(r'List\s*(\d+)', line, re.I)
            if list_match:
                group = int(list_match.group(1))
                continue
            entry_match = ENTRY.match(line)
            if entry_match:
                current = {
                    'id': int(entry_match.group(1)),
                    'word': entry_match.group(2).strip(),
                    'page': page_number,
                    'group': group,
                    '_lines': [],
                }
                entries.append(current)
            elif current is not None:
                current['_lines'].append(line)
            else:
                raise ValueError(f'Unexpected body text on page {page_number}: {line}')
    words = [parse_entry(entry) for entry in entries]
    ids = [word['id'] for word in words]
    assert ids == list(range(1, 801)), 'IDs must be continuous from 001 to 800'
    counts = Counter(word['word'] for word in words)
    duplicates = [word for word, count in counts.items() if count > 1]
    assert not duplicates, f'Duplicate words: {duplicates}'
    assert words[0]['word'] == 'serendipity'
    assert words[-1]['word'] == 'commencement'
    assert all(word['pos'] and word['meaning'] for word in words)
    assert all(word['group'] == (word['id'] - 1) // 100 + 1 for word in words)
    assert sum(len(word['definitions']) for word in words) == 815
    assert not any(bad in json.dumps(words, ensure_ascii=False) for bad in CHAR_CORRECTIONS)

    serialized = json.dumps(words, ensure_ascii=False, indent=2) + '\n'
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    (dist / 'words.js').write_text(
        '// Extracted from 《GRE800词 》.pdf; 800 entries, 815 senses.\n'
        + 'window.GRE_WORDS = ' + serialized.rstrip() + ';\n', encoding='utf-8')
    (dist / 'words.json').write_text(serialized, encoding='utf-8')
    (ROOT / 'scripts' / 'words.json').write_text(serialized, encoding='utf-8')
    report = {
        'source': PDF.name,
        'source_sha256': hashlib.sha256(PDF.read_bytes()).hexdigest(),
        'pdf_pages': len(reader.pages),
        'vocabulary_pdf_pages': [5, 88],
        'entry_count': len(words),
        'sense_count': sum(len(word['definitions']) for word in words),
        'group_counts': dict(Counter(word['group'] for word in words)),
        'missing_ids': [],
        'duplicate_words': duplicates,
        'font_mapping_repairs': [
            {'from': bad, 'to': good, 'occurrences': correction_occurrences[bad]}
            for bad, good in CHAR_CORRECTIONS.items()
        ],
        'source_normalizations': [
            {'id': 113, 'detail': 'Second sense omits the part of speech; inherit adj. from first sense.'},
            {'id': 264, 'detail': 'Treat source synonym label 进： as 近：.'},
            {'id': 700, 'detail': 'Treat the bilingual phrase labeled 近： as an example.'},
        ],
        'multiple_sense_ids': [word['id'] for word in words if len(word['definitions']) > 1],
    }
    (ROOT / 'scripts' / 'extraction-report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()


