"""Resolve historical source names against the consolidated materials library.

Extraction/build scripts use this module instead of depending on the working
directory, unpacked archives, or duplicated PDFs beside the application.
"""
from functools import lru_cache
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit
import json
import os
import re
import shutil

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / 'gre-reading-studio' / 'dist'
MANIFEST = ROOT / 'materials' / 'manifest.json'


def _key(value):
    value = str(value).replace('\\', '/').removeprefix('./')
    return re.sub(r'(?i)(\.(?:zip|rar))\s*(?:!/?| / )\s*', r'\1 / ', value)


@lru_cache(maxsize=1)
def _index():
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    aliases, ids = {}, {}
    basenames = {}
    for document in manifest['documents']:
        canonical = document['path']
        for alias in [canonical, *document.get('aliases', [])]:
            aliases[_key(alias)] = canonical
            basenames.setdefault(Path(_key(alias)).name, set()).add(canonical)
        for archive in document.get('archives', []):
            aliases[_key(archive['archive'] + ' / ' + archive['member'])] = canonical
        for sid in document.get('source_ids', []):
            ids[sid] = canonical
    aliases.update({_key(k): v for k, v in manifest.get('path_aliases', {}).items()})
    return aliases, ids, basenames


@lru_cache(maxsize=4096)
def resolve_material(value=None, *, source_id=None):
    """Return an existing canonical file; ambiguous name-only matches fail."""
    aliases, ids, basenames = _index()
    canonical = ids.get(source_id) if source_id else None
    original = Path(value) if value is not None else None
    if canonical is None and value is not None:
        key = _key(value)
        if original.is_absolute():
            try:
                key = original.resolve().relative_to(ROOT).as_posix()
            except ValueError:
                if original.is_file():
                    return original.resolve()
        key = unquote(urlsplit(key).path)
        candidates = [key]
        if key.startswith('sources/'):
            candidates.insert(0, 'gre-reading-studio/dist/' + key)
        if key.startswith('../../materials/'):
            candidates.insert(0, key.removeprefix('../../'))
        canonical = next((aliases[c] for c in candidates if c in aliases), None)
        if canonical is None:
            matches = basenames.get(Path(key).name, set())
            if len(matches) == 1:
                canonical = next(iter(matches))
    if canonical is not None:
        target = (ROOT / canonical).resolve()
        if not target.is_relative_to(ROOT / 'materials'):
            raise ValueError('Material manifest path escapes materials/: ' + canonical)
        if target.is_file():
            return target
        raise FileNotFoundError('Material listed in manifest is missing: ' + canonical)
    if original is not None:
        target = original if original.is_absolute() else ROOT / original
        if target.is_file():
            return target.resolve()
    raise FileNotFoundError('Unknown material: ' + str(source_id or value))


def source_output(filename):
    """Use an existing canonical alias, or a new derived PDF in materials/."""
    try:
        return resolve_material('sources/' + filename)
    except FileNotFoundError:
        if Path(filename).name != filename:
            raise ValueError('Source output must be a filename')
        path = ROOT / 'materials' / 'sources' / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        return path


def source_url(value=None, *, source_id=None):
    """Return the URL relative to the reading app, preserving PDF anchors."""
    parts = urlsplit(str(value or '').replace('\\', '/'))
    target = resolve_material(value, source_id=source_id)
    relative = Path(os.path.relpath(target, DIST)).as_posix()
    return urlunsplit(('', '', relative, parts.query, parts.fragment))


def copy_source(source, filename):
    """Copy only when needed; original PDFs already in materials stay put."""
    source = Path(source).resolve()
    target = source_output(filename)
    if source != target.resolve():
        shutil.copy2(source, target)
    return target


def normalize_material_links(value, field=None):
    """Normalize known document URLs recursively, leaving question text intact."""
    if isinstance(value, dict):
        return {key: normalize_material_links(child, key) for key, child in value.items()}
    if isinstance(value, list):
        return [normalize_material_links(child, field) for child in value]
    if isinstance(value, str) and field in {'url', 'path', 'pdfUrl', 'source_url', 'sourceUrl'}:
        if urlsplit(value).scheme or value.startswith('//'):
            return value
        try:
            return source_url(value)
        except FileNotFoundError:
            pass
    if isinstance(value, str) and field in {'source_file', 'fileName'}:
        try:
            return resolve_material(value).relative_to(ROOT).as_posix()
        except (FileNotFoundError, ValueError):
            pass
    return value


def pdf_pages(source, cache):
    """Recreate ignored page-text caches on demand in a fresh checkout."""
    cache = Path(cache)
    if cache.is_file():
        return json.loads(cache.read_text(encoding='utf-8'))
    from pypdf import PdfReader
    pages = [page.extract_text() or '' for page in PdfReader(resolve_material(source)).pages]
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(pages, ensure_ascii=False, indent=2), encoding='utf-8')
    return pages
