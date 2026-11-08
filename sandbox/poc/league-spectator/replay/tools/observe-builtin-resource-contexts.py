"""Original built-in context identity, publication and null-resource getters.

The cold-registry miss observations are controls, not a recovered match registry.
In particular, an unknown recorded identity never becomes a Shared context merely
because this isolated registry has no entry for it.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
import sys

from unicorn import x86_const as r
from effect_context_native import NativeEffectContexts
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache, client = args.cache.resolve(), args.client.resolve()
    package = cache / 'public/decoder-16.21-macos'
    paths = {Path(__file__).resolve(), client, package / 'profile.json', package / 'image.bin'}
    paths.update(Path(inspect.getfile(cls)).resolve()
                 for cls in NativeEffectContexts.__mro__ if cls is not object)
    tools = Path(__file__).resolve().parent
    paths.update(Path(module.__file__).resolve() for module in tuple(sys.modules.values())
                 if getattr(module, '__file__', None)
                 and Path(module.__file__).suffix == '.py'
                 and Path(module.__file__).resolve().is_relative_to(tools))
    before = {str(path): sha(path.read_bytes()) for path in sorted(paths)}
    n = NativeEffectContexts(package, client)
    q = lambda p: struct.unpack('<Q', n.u.mem_read(p, 8))[0]
    u32 = lambda p: struct.unpack('<I', n.u.mem_read(p, 4))[0]
    if u32(n.base + 0x255d0f0) or q(n.base + 0x24728d0):
        raise ValueError('Built-in observation requires original cold globals')
    n.call(0x35dd5c, {}, 0x35dd6e)
    identity = u32(n.base + 0x255d0f0)
    if identity != 3579051965:
        raise ValueError('Original Shared identity differs')
    registry = n.registry()
    shared = n.lookup_context(registry, identity)
    if q(n.base + 0x24728d0) != registry or shared != registry + 0x68:
        raise ValueError('Original constructor did not publish its Shared context')

    def query(pointer):
        vtable = q(pointer)
        getter = q(vtable + 0x30) - n.base
        if getter != 0x35a270:
            raise ValueError('Built-in resource getter differs')
        memory = bytes(n.u.mem_read(registry, 0xc0))
        heap = n.next_heap
        n.call(getter, {r.UC_X86_REG_RDI: pointer})
        result = n.u.reg_read(r.UC_X86_REG_RAX)
        if result or n.next_heap != heap or bytes(n.u.mem_read(registry, 0xc0)) != memory:
            raise ValueError('Built-in resource getter is not a pure null return')
        return {'pointer': pointer, 'getterRva': getter, 'resolver': result,
                'readOnly': True, 'allocationFree': True}

    shared_query = query(shared)
    levels = []
    for map_id in [0, 1, 12, 0xffffffff]:
        n.call(0x354230, {r.UC_X86_REG_RDI: registry, r.UC_X86_REG_RSI: map_id})
        pointer = n.u.reg_read(r.UC_X86_REG_RAX)
        context_identity = u32(pointer + 0x28)
        if u32(pointer + 0x2c) != map_id or n.lookup_context(registry, context_identity) != pointer:
            raise ValueError('Original Level creation/registration differs')
        levels.append({'mapId': map_id, 'identity': context_identity, **query(pointer)})
    misses = []
    for key in [0, 1, 3143740604, 0xffffffff]:
        pointer = n.lookup_context(registry, key)
        if pointer != shared:
            raise ValueError('Original cold-registry missing-key route differs')
        misses.append({'identity': key, 'pointer': pointer,
                       'scope': 'cold-control-registry-only', **query(pointer)})
    for path, digest in before.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Built-in observer input changed during execution: ' + path)
    result = {
        'schema': 1, 'kind': 'original-builtin-resource-context-observations',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': sha(n.image), 'sharedIdentity': identity,
        'sharedInitializer': [0x35dd5c, 0x35dd6e],
        'registryConstructorRva': 0x3530b0, 'registryLookupRva': 0x354280,
        'levelAcquireRva': 0x354230, 'levelConstructorRva': 0x353f90,
        'registry': registry, 'shared': shared_query, 'levels': levels,
        'missingIdentityControls': misses,
        'originalBlocks': list(n.blocks.values()), 'inputs': before,
        'sourceFingerprintsCheckedBeforeAndAfterExecution': True,
        'scope': {'staticProgramAndControls': True, 'actualReplayRegistry': False,
                  'unknownRecordedIdentityAccepted': False, 'globalResourceMapsRecovered': False,
                  'acceptedEntities': False, 'actualBrowserExecuted': False},
    }
    output = cache / 'research/builtin-resource-contexts-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'sharedIdentity': identity,
                      'nullGetterControls': 1 + len(levels) + len(misses),
                      'originalBlocks': len(n.blocks)}))


if __name__ == '__main__':
    main()
