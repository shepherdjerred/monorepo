"""Guard inherited filesystem errno writes without claiming worker errno support."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha

entry = Path(__file__).with_name('probe-cooperative-threads.py')
spec = importlib.util.spec_from_file_location('native_cooperative_errno_control', entry)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    parser.add_argument('installation', type=Path)
    args = parser.parse_args()
    controls, sources, inputs, blocks = [], {}, {}, {}
    for operation, existing_errno in [('mkdir', False), ('mkdir', True), ('fopen', False), ('fopen', True)]:
        fixture = NativeAIUnitFixture(args.cache, args.client, module.Control)
        n = fixture.native
        paths = module.runtime.producer_paths(n) | {Path(__file__), entry}
        before_sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
        n.initialize_asset_arena(64)
        n.configure_client_loose_files(args.installation / 'Game')
        error_import = next(at for at, name in n.source.imports.items() if name == '___error')
        if existing_errno:
            n.call(error_import, {})
            n.put(n.file_errno, 'I', 7)
        before_errno = n.file_errno
        before_bytes = bytes(n.u.mem_read(before_errno, 4)) if before_errno else None
        output = n.allocate(8)
        start, path, second = ((0x1feea5c, '/Config/', 0o777) if operation == 'mkdir' else
                               (0x1fee86a, 'DATA/CFG/Game.cfg', n.allocate_text('rb')))
        n.call(0x1feebc4, {r.UC_X86_REG_RDI: output, r.UC_X86_REG_RSI: 0,
            r.UC_X86_REG_RDX: n.base + start, r.UC_X86_REG_RCX: n.allocate_text(path)})
        state = n.cooperative_threads[n.q(output)]
        parent = n.u.context_save()
        n.u.context_restore(state['context'])
        n.u.reg_write(r.UC_X86_REG_RSI, second)
        state['context'] = n.u.context_save()
        n.u.context_restore(parent)
        registers = [r.UC_X86_REG_RIP, r.UC_X86_REG_RSP, r.UC_X86_REG_RAX, r.UC_X86_REG_RBX,
                     r.UC_X86_REG_RSI, r.UC_X86_REG_RDI]
        parent_registers = [n.u.reg_read(register) for register in registers]
        rejected = False
        try:
            n.run_cooperative_thread(state['handle'])
        except ValueError as error:
            if 'suspended parent errno' not in str(error):
                raise
            rejected = True
        after_bytes = bytes(n.u.mem_read(before_errno, 4)) if before_errno else None
        matched = (rejected and state['failed'] and not state['completed'] and state['result'] is None and
                   n.file_errno == before_errno and
                   after_bytes == before_bytes and
                   [n.u.reg_read(register) for register in registers] == parent_registers)
        loose_files = n.validate_client_loose_files()
        if operation == 'fopen' and (len(loose_files) != 1 or loose_files[0]['present']):
            raise ValueError('Actual missing physical configuration fixture required')
        controls.append({'platformOperation': operation, 'existingParentErrno': existing_errno,
            'beforeErrnoPointer': before_errno, 'afterErrnoPointer': n.file_errno,
            'beforeErrnoHex': before_bytes.hex() if before_bytes else None,
            'afterErrnoHex': after_bytes.hex() if after_bytes else None,
            'workerRejected': rejected, 'workerFailed': state['failed'], 'matched': matched,
            'workerCompleted': state['completed'], 'workerResult': state['result'],
            'physicalFileObservations': loose_files})
        after_sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
        if before_sources != after_sources or sources and sources != after_sources:
            raise ValueError('Worker errno producer changed during controls')
        sources = after_sources
        inputs.update(fixture.inputs)
        blocks.update(n.blocks)
    output = args.cache / 'research/cooperative-thread-errno-native.json'
    output.write_text(json.dumps({'schema': 1, 'build': n.profile['clientVersion'],
        'protocol': n.profile['protocolDigest'], 'decoderImageSha256': sha(n.image),
        'controls': controls, 'sources': sources, 'inputs': inputs,
        'originalBlocks': list(blocks.values()), 'scope': {'platformAbiOnly': True,
            'readOnlyMkdirErrorExecuted': True, 'actualMissingPhysicalFopenExecuted': True,
            'hostDirectoryCreated': False,
            'actualGameWorkerExecuted': False, 'isolatedWorkerErrnoImplemented': False}}, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': controls}))
    if not all(control['matched'] for control in controls):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
