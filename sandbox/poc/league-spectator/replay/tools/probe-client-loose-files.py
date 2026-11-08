"""Verify physical presentation-file reads and absence without a game bootstrap."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from client_loose_files_native import NativeClientLooseFiles
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha

entry = Path(__file__).with_name('probe-recorded-hero-creation.py')
spec = importlib.util.spec_from_file_location('native_loose_file_dependencies', entry)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)


class Control(runtime.Control):
    pass


def fopen(n, path, mode='rb'):
    n.call(0x1fee86a, {r.UC_X86_REG_RDI: n.allocate_text(path), r.UC_X86_REG_RSI: n.allocate_text(mode)})
    return n.u.reg_read(r.UC_X86_REG_RAX)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'installation']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client, Control)
    n = fixture.native
    paths = runtime.producer_paths(n) | {Path(__file__)}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    policy = n.configure_client_loose_files(args.installation / 'Game')
    absent = []
    for path in ['DATA/CFG/Game.cfg', 'ASSETS/Maps/Particles/Deprecated/Map12/Particles.ini',
                 'DATA/Particles/ParticlesDefault.ini']:
        if fopen(n, path) != 0 or n.u32(n.file_errno) != 2:
            raise ValueError('Expected physical absence control differs')
        absent.append(path)
    rejections = 0
    for path, mode in [('DATA/CFG/../../escape.ini', 'rb'), ('DATA/CFG/Game.cfg', 'wb')]:
        try:
            fopen(n, path, mode)
        except ValueError:
            rejections += 1
    if rejections != 2:
        raise ValueError('Physical client file boundary did not reject escape/write')
    fixture_root = fixture.cache / 'research/loose-file-control-root'
    physical = fixture_root / 'DATA/CFG/control.cfg'
    physical.parent.mkdir(parents=True, exist_ok=True)
    content = b'control\0bytes'
    physical.write_bytes(content)
    second = NativeAIUnitFixture(args.cache, args.client, Control)
    m = second.native
    m.configure_client_loose_files(fixture_root)
    handle = fopen(m, 'DATA/CFG/control.cfg')
    destination = m.allocate(len(content))
    fread = next(at for at, symbol in m.source.imports.items() if symbol == '_fread')
    fclose = next(at for at, symbol in m.source.imports.items() if symbol == '_fclose')
    m.call(fread, {r.UC_X86_REG_RDI: destination, r.UC_X86_REG_RSI: 1,
                   r.UC_X86_REG_RDX: len(content), r.UC_X86_REG_RCX: handle})
    if m.u.reg_read(r.UC_X86_REG_RAX) != len(content) or bytes(m.u.mem_read(destination, len(content))) != content:
        raise ValueError('Approved physical file read differs')
    m.call(fclose, {r.UC_X86_REG_RDI: handle})
    observed = n.validate_client_loose_files()
    present = m.validate_client_loose_files()
    n.close_files()
    m.close_files()
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Physical client file source changed during control: ' + path)
    output = fixture.cache / 'research/client-loose-files-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'policy': policy, 'verifiedPhysicalAbsence': observed, 'suppliedPresentFile': present,
        'boundaryRejections': rejections, 'absentControls': absent, 'presentBytesVerified': len(content),
        'sources': sources, 'inputs': {**fixture.inputs, **second.inputs},
        'scope': {'platformBoundaryOnly': True, 'actualGameFilesWritten': False,
                  'originalArchiveFallbackExecuted': False, 'gameFieldsSupplied': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'absentControls': len(absent), 'presentBytesVerified': len(content),
                      'boundaryRejections': rejections}))


if __name__ == '__main__':
    main()
