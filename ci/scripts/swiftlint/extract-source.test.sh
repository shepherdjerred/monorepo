#!/usr/bin/env bash
set -euo pipefail
swiftlint_extractor=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/extract-source.py
python3 - "$swiftlint_extractor" <<'PY'
import io
import pathlib
import subprocess
import sys
import tarfile
import tempfile

extractor = pathlib.Path(sys.argv[1])
prefix = 'source/Tests/IntegrationTests/Resources/_9_symlinked_paths/'
links = {'LinkToFile.swift': 'Real/Target.swift', 'LinkToFolder': 'Real/Folder'}
cases = {
    'valid': None,
    'absolute-link': 'unapproved symbolic link',
    'escape-link': 'unapproved symbolic link',
    'chained-link': 'unapproved symbolic link',
    'cycle': 'unapproved symbolic link',
    'link-ancestor': 'non-directory ancestor',
    'hardlink': 'duplicate or unsupported entry',
    'duplicate': 'duplicate or unsupported entry',
    'wrong-type': 'wrong declared type',
    'traversal': 'escapes its root',
}

def write_member(archive, name, data=b'', kind=tarfile.REGTYPE, link=''):
    member = tarfile.TarInfo(name)
    member.type = kind
    member.linkname = link
    member.size = len(data) if kind == tarfile.REGTYPE else 0
    archive.addfile(member, io.BytesIO(data))

with tempfile.TemporaryDirectory(prefix='swiftlint-source-test-') as temporary:
    root = pathlib.Path(temporary)
    for mode, expected in cases.items():
        archive_path = root / (mode + '.tar.gz')
        destination = root / mode
        with tarfile.open(archive_path, 'w:gz') as archive:
            write_member(archive, 'source', kind=tarfile.DIRTYPE)
            write_member(archive, prefix + 'Real/Folder', kind=tarfile.DIRTYPE)
            write_member(archive, prefix + 'Real/Folder/Nested.swift', b'folder target')
            write_member(archive, prefix + 'Real/Target.swift', b'file target', kind=tarfile.DIRTYPE if mode == 'wrong-type' else tarfile.REGTYPE)
            for name, target in links.items():
                if name == 'LinkToFile.swift':
                    target = {'absolute-link': '/outside', 'escape-link': '../../outside', 'chained-link': 'LinkToFolder', 'cycle': 'LinkToFile.swift'}.get(mode, target)
                write_member(archive, prefix + name, kind=tarfile.LNKTYPE if mode == 'hardlink' else tarfile.SYMTYPE, link=target)
            if mode == 'duplicate':
                write_member(archive, prefix + 'Real/Target.swift', b'duplicate')
            if mode == 'traversal':
                write_member(archive, 'source/../outside', b'escape')
            if mode == 'link-ancestor':
                write_member(archive, prefix + 'LinkToFolder/Injected.swift', b'write through link')
        result = subprocess.run([sys.executable, str(extractor), str(archive_path), str(destination)], capture_output=True, text=True, timeout=5, check=False)
        if expected is None:
            if result.returncode != 0:
                raise SystemExit(f'Valid pinned links rejected: {result.stderr}')
            base = destination / prefix.removeprefix('source/')
            if (base / 'LinkToFile.swift').read_bytes() != b'file target' or (base / 'LinkToFolder/Nested.swift').read_bytes() != b'folder target':
                raise SystemExit('Pinned upstream links do not resolve to their exact files')
            if any(not (base / name).is_symlink() for name in links):
                raise SystemExit('Pinned upstream link was replaced with a copy')
        elif result.returncode == 0 or expected not in result.stderr:
            raise SystemExit(f'Incorrect source rejection for {mode}: {result.stderr}')
        elif any(destination.iterdir()):
            raise SystemExit(f'Invalid source {mode} wrote files before validation')
    if (root / 'outside').exists():
        raise SystemExit('Source extraction escaped the owned fixture')
print('SwiftLint source extraction controls passed: ten cases')
PY
