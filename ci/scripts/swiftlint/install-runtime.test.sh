#!/usr/bin/env bash
set -euo pipefail
swiftlint_installer=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install-runtime.py
python3 - "$swiftlint_installer" <<'PY'
import hashlib
import io
import json
import pathlib
import platform
import struct
import subprocess
import sys
import tarfile
import tempfile

installer = pathlib.Path(sys.argv[1])
pins = json.loads(installer.with_name('pins.json').read_text(encoding='utf-8'))
machine = 62 if platform.machine() == 'x86_64' else 183
header = bytearray(64)
header[:6] = b'\x7fELF\x02\x01'
struct.pack_into('<H', header, 18, machine)

def write_export(root, mode):
    export = root / 'export'
    export.mkdir()
    expected = root / 'pins.json'
    expected.write_text(json.dumps(pins), encoding='utf-8')
    files = {
        'opt/swiftlint/bin/swiftlint': bytes(header),
        'opt/swiftlint/lib/libsourcekitdInProc.so': bytes(header),
        'opt/swiftlint/swiftlint': b'owned test launcher',
        'opt/swiftlint/contract/pins.json': json.dumps(pins).encode(),
        'opt/swiftlint/licenses/SwiftLint-LICENSE': b'synthetic test license',
        'opt/swiftlint/licenses/Swift-LICENSE.txt': b'synthetic test license',
        'opt/swiftlint/licenses/LLVM-LICENSE.txt': b'synthetic test license',
        'opt/swiftlint/licenses/swift-packages/example/LICENSE': b'synthetic test license',
    }
    if mode == 'foreign-elf':
        foreign = bytearray(header)
        struct.pack_into('<H', foreign, 18, 183 if machine == 62 else 62)
        files['opt/swiftlint/bin/swiftlint'] = bytes(foreign)
    if mode == 'foreign-pins':
        files['opt/swiftlint/contract/pins.json'] = b'{"sourceRevision":"foreign"}'
    if mode == 'missing-license':
        del files['opt/swiftlint/licenses/LLVM-LICENSE.txt']
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    if mode == 'bad-file-pin':
        manifest['opt/swiftlint/swiftlint'] = '0' * 64
    (export / 'runtime.manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    with tarfile.open(export / 'runtime.tar.gz', 'w:gz') as archive:
        for name, data in files.items():
            if mode == 'missing-file' and name == 'opt/swiftlint/swiftlint':
                continue
            member = tarfile.TarInfo(name)
            member.size = len(data)
            member.mode = 0o755
            if mode == 'unsafe-mode' and name == 'opt/swiftlint/swiftlint':
                member.mode = 0o777
            if mode == 'not-executable' and name == 'opt/swiftlint/bin/swiftlint':
                member.mode = 0o644
            archive.addfile(member, io.BytesIO(data))
        if mode in ('extra-file', 'traversal', 'duplicate', 'symlink'):
            name = {'extra-file': 'opt/swiftlint/unpinned', 'traversal': '../../outside', 'duplicate': 'opt/swiftlint/swiftlint', 'symlink': 'opt/swiftlint/link'}[mode]
            member = tarfile.TarInfo(name)
            if mode == 'symlink':
                member.type = tarfile.SYMTYPE
                member.linkname = '../../outside'
            archive.addfile(member)
    checksum = hashlib.sha256((export / 'runtime.tar.gz').read_bytes()).hexdigest()
    if mode == 'bad-archive-pin':
        checksum = '0' * 64
    (export / 'runtime.tar.gz.sha256').write_text(checksum + '  runtime.tar.gz\n', encoding='utf-8')
    return export, expected

cases = {
    'valid': None,
    'bad-archive-pin': 'archive checksum mismatch',
    'bad-file-pin': 'file checksum mismatch',
    'missing-file': 'missing a pinned file',
    'extra-file': 'contains an unpinned file',
    'traversal': 'escapes its private runtime',
    'duplicate': 'duplicate or unsupported entry',
    'symlink': 'duplicate or unsupported entry',
    'foreign-pins': 'different producer input',
    'foreign-elf': 'incompatible ELF artifact',
    'missing-license': 'licensing inventory is incomplete',
    'unsafe-mode': 'archive has unsafe permissions',
    'not-executable': 'launcher or binary is not executable',
}
with tempfile.TemporaryDirectory(prefix='swiftlint-installer-test-') as temporary:
    base = pathlib.Path(temporary)
    for mode, expected_error in cases.items():
        root = base / mode
        root.mkdir()
        export, expected = write_export(root, mode)
        command = [sys.executable, str(installer), str(export), str(expected), str(root / 'installed')]
        result = subprocess.run(command, capture_output=True, text=True, timeout=5, check=False)
        if expected_error is None:
            if result.returncode != 0:
                raise SystemExit(f'Valid runtime rejected: {result.stderr}')
            installed = pathlib.Path(result.stdout.strip())
            if (installed / 'bin/swiftlint').read_bytes() != bytes(header):
                raise SystemExit('Installer changed the producer bytes')
            repeated = subprocess.run(command, capture_output=True, text=True, timeout=5, check=False)
            if repeated.returncode != 0 or repeated.stdout != result.stdout:
                raise SystemExit('Exact existing runtime was not verified and reused')
            (installed / 'swiftlint').write_bytes(b'corrupt fixture')
            corrupt = subprocess.run(command, capture_output=True, text=True, timeout=5, check=False)
            if corrupt.returncode == 0 or 'does not match its producer manifest' not in corrupt.stderr:
                raise SystemExit('Corrupt existing runtime was accepted or silently replaced')
        elif result.returncode == 0 or expected_error not in result.stderr:
            raise SystemExit(f'Wrong rejection for {mode}: {result.stderr}')
        if (base / 'outside').exists():
            raise SystemExit('Archive wrote outside the owned fixture')
print('SwiftLint installer boundary controls passed: fifteen cases')
PY
