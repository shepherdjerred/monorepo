"""Compare owned native stdio-overlay outcomes with actual host C stdio."""
import argparse
import ctypes as C
import importlib.util
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unicorn import x86_const as r
from configuration_file_overlay_native import configure_original_configuration_overlay, original_configuration_overlay_summary, MAXIMUM
from vfx_spawn_native import sha


driver = Path(__file__).with_name('probe-original-vfx-manager-startup.py')
spec = importlib.util.spec_from_file_location('configuration_overlay_original_control', driver)
runtime = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runtime
spec.loader.exec_module(runtime)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['assets', 'client', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    tools = Path(__file__).resolve().parent
    sources = {str(Path(module.__file__).resolve()): sha(Path(module.__file__).read_bytes())
               for module in list(sys.modules.values()) if getattr(module, '__file__', None) and
               Path(module.__file__).resolve().is_relative_to(tools) and Path(module.__file__).suffix == '.py'}
    inputs = {str(path.resolve()): sha(path.read_bytes()) for path in
              [args.client, args.assets/'profile.json', args.assets/'image.bin']}
    n = runtime.Control(args.assets, args.client)
    imports = {name: at for at, name in n.source.imports.items()}
    def invoke(name, *values):
        registers = [r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX, r.UC_X86_REG_RCX]
        n.call(imports[name], dict(zip(registers, values)))
        return n.u.reg_read(r.UC_X86_REG_RAX)
    def opened(path, mode):
        n.call(0x1479358, {r.UC_X86_REG_RDI: n.allocate_text(path),
                          r.UC_X86_REG_RSI: n.allocate_text(mode)}, end=0x147935d)
        return n.u.reg_read(r.UC_X86_REG_RAX)
    crt = C.CDLL('ucrtbase.dll')
    for name, arguments, result in [
        ('fopen', [C.c_char_p, C.c_char_p], C.c_void_p),
        ('fwrite', [C.c_void_p, C.c_size_t, C.c_size_t, C.c_void_p], C.c_size_t),
        ('fread', [C.c_void_p, C.c_size_t, C.c_size_t, C.c_void_p], C.c_size_t),
        ('fseek', [C.c_void_p, C.c_long, C.c_int], C.c_int),
        ('ftell', [C.c_void_p], C.c_long), ('feof', [C.c_void_p], C.c_int),
        ('fclose', [C.c_void_p], C.c_int)]:
        getattr(crt, name).argtypes, getattr(crt, name).restype = arguments, result
    controls = []
    with tempfile.TemporaryDirectory(prefix='native-configuration-stdio-', dir=output.parent) as temporary:
        target = Path(temporary).resolve()
        if not target.is_relative_to(output.parent) or target == output.parent:
            raise ValueError('Owned stdio control directory escaped its explicit output parent')
        game = target/'Game'
        game.mkdir()
        n.configure_client_loose_files(game)
        configure_original_configuration_overlay(n, SimpleNamespace(raw=lambda path: path.read_bytes()))
        reference = str(target/'reference.bin').encode()
        missing_native, missing_host = opened('data/cfg/game.cfg', 'rb+'), crt.fopen(reference, b'rb+')
        if missing_native or missing_host or n.u32(n.file_errno) != 2:
            raise ValueError('Native/host initial ENOENT outcomes differ')
        controls.append({'kind': 'initial-missing', 'native': 0, 'host': 0, 'darwinErrno': 2})
        handle, host = opened('data/cfg/game.cfg', 'wb+'), crt.fopen(reference, b'wb+')
        if not handle or not host:
            raise ValueError('Owned original native/host creation failed')
        try:
            data = b'a\0bcdef'
            source = n.allocate(len(data))
            n.u.mem_write(source, data)
            native = invoke('_fwrite', source, 1, len(data), handle)
            actual = crt.fwrite(C.c_char_p(data), 1, len(data), host)
            if native != actual or native != len(data):
                raise ValueError('Native/host binary write counts differ')
            invoke('_fseek', handle, 0, 0)
            crt.fseek(host, 0, 0)
            destination = n.allocate(16)
            n.u.mem_write(destination, b'\xa5'*16)
            raw = C.create_string_buffer(b'\xa5'*16, 16)
            native, actual = invoke('_fread', destination, 3, 3, handle), crt.fread(raw, 3, 3, host)
            if native != actual or native != 2 or bytes(n.u.mem_read(destination, 16)) != raw.raw:
                raise ValueError('Native/host partial-element byte contents or counts differ')
            if invoke('_ftell', handle) != crt.ftell(host) or bool(invoke('_feof', handle)) != bool(crt.feof(host)):
                raise ValueError('Native/host position or EOF state differs')
            controls.append({'kind': 'binary-and-partial-element-read', 'elements': native,
                             'bytesHex': raw.raw.hex(), 'position': crt.ftell(host), 'eof': bool(crt.feof(host))})
            invoke('_fseek', handle, 10, 0)
            crt.fseek(host, 10, 0)
            z = n.allocate_text('Z')
            invoke('_fwrite', z, 1, 1, handle)
            crt.fwrite(C.c_char_p(b'Z'), 1, 1, host)
            before = bytes(n.configuration_overlay['content'])
            try:
                invoke('_fwrite', z, 1, MAXIMUM+1, handle)
            except ValueError as error:
                if 'quota' not in str(error):
                    raise
            else:
                raise ValueError('Oversized native overlay write was silently accepted')
            if bytes(n.configuration_overlay['content']) != before:
                raise ValueError('Rejected oversized write changed owned output')
        finally:
            invoke('_fclose', handle)
            crt.fclose(host)
        expected = (target/'reference.bin').read_bytes()
        if bytes(n.configuration_overlay['content']) != expected:
            raise ValueError('Native/host final sparse file bytes differ')
        sparse_sha = sha(expected)
        handle, host = opened('data/cfg/game.cfg', 'wb'), crt.fopen(reference, b'wb')
        if not handle or not host:
            raise ValueError('Native/host observed write-only creation failed')
        written = b'original-owned-output'
        source = n.allocate(len(written))
        n.u.mem_write(source, written)
        try:
            if (invoke('_fwrite', source, 1, len(written), handle) !=
                    crt.fwrite(C.c_char_p(written), 1, len(written), host)):
                raise ValueError('Native/host observed write-only byte count differs')
        finally:
            invoke('_fclose', handle)
            crt.fclose(host)
        expected = (target/'reference.bin').read_bytes()
        if bytes(n.configuration_overlay['content']) != expected:
            raise ValueError('Native/host observed write-only final bytes differ')
        for path, mode in [('data/cfg/game.cfg', 'w'), ('data/cfg/other.cfg', 'wb+')]:
            try:
                opened(path, mode)
            except ValueError:
                pass
            else:
                raise ValueError('Unknown overlay path/mode was silently accepted')
        summary = original_configuration_overlay_summary(n)
        if summary['openHandles'] or (game/'data/cfg/game.cfg').exists() or (game/'data/cfg/other.cfg').exists():
            raise ValueError('Overlay leaked a handle or mutated its immutable source tree')
        controls.append({'kind': 'final-native-host-bytes', 'sha256': sha(expected), 'bytes': len(expected),
                         'sparseFileSha256': sparse_sha, 'writeOnlyCompared': True,
                         'oversizedRejectedUnchanged': True, 'unknownPathAndModeRejected': True})
    for file, expected in {**inputs, **sources}.items():
        if sha(Path(file).read_bytes()) != expected:
            raise ValueError('Original configuration stdio control source changed: '+file)
    output.write_text(json.dumps({'schema': 1, 'kind': 'original-configuration-stdio-overlay-controls',
        'sources': sources, 'inputs': inputs, 'controls': controls, 'overlay': summary,
        'originalBlocks': list(n.blocks.values()), 'gameConfigurationReadinessAdmitted': False}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls), 'bytesEqual': True,
                      'sourceFilesWritten': False, 'openHandles': len(summary['openHandles'])}))


if __name__ == '__main__':
    main()
