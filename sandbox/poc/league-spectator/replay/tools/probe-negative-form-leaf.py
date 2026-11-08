"""Negative signed-index rejection leaf only; opcode-129 prelude is excluded."""
import argparse
import inspect
import json
from pathlib import Path
from unicorn import x86_const as r
from unit_resource_native import NativeUnitResources
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    n = NativeUnitResources(args.cache/'public/decoder-16.21-macos', args.client)
    paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
    sources = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    controls = []
    heap_before, allocations_before = n.next_heap, dict(n.allocations)
    for index in range(128, 256):
        for flag in [False, True]:
            # Neither component nor unit exists: successful return establishes
            # that this leaf cannot dereference their resource/form state.
            n.call(0x30ed00, {r.UC_X86_REG_RDI: 0, r.UC_X86_REG_RSI: index,
                              r.UC_X86_REG_RDX: 0, r.UC_X86_REG_RCX: int(flag)})
            result = n.u.reg_read(r.UC_X86_REG_RAX) & 255
            if result != 0 or n.next_heap != heap_before or n.allocations != allocations_before:
                raise ValueError('Negative signed form index failed its bounded rejection contract')
            controls.append({'index': index, 'signedIndex': index - 256,
                             'nativeFlag': flag, 'returned': False})
    # Pin both this early rejection and the distinct lazy component producer
    # reached BEFORE it by the complete opcode-129 listener.
    ranges = [(0x30ed00, 0x30ed2b), (0x30edd6, 0x30edf5),
              (0xfdd00, 0xfdd25), (0xbf8b0, 0xbf9b0),
              (0x30d220, 0x30d510), (0xd7b90, 0xd7c70)]
    blocks = []
    for begin, end in ranges:
        if n.image[begin:end] != n.source.image[begin:end]:
            raise ValueError('Original form source changed')
        blocks.append({'rva': begin, 'size': end - begin,
                       'sha256': sha(n.image[begin:end])})
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Native producer changed during leaf control: ' + path)
    result = {'schema': 1, 'kind': 'original-negative-form-selection-leaf-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'controls': controls,
              'sourceBlocks': blocks, 'originalBlocks': list(n.blocks.values()),
              'sources': sources,
              'scope': {'fullSelectionLeafReturned': True, 'all128NegativeIndicesBothFlags': True,
                        'nullComponentAndUnitNeverDereferenced': True,
                        'heapUnchanged': True, 'fullOpcode129ListenerExecuted': False,
                        'lazyComponentCreationAndGraphicsPreparationEstablished': False,
                        'wholePacketResourceOrVisualNoOpEstablished': False,
                        'runtimeEligibilityChanged': False},
              'omissions': ['Original fdd00 invokes bf8b0 lazy component producer before this leaf.',
                            'Missing component invokes original d7b90 and 30d220/30d510 preparation.',
                            'A negative selection leaf alone cannot waive the complete resource request.']}
    output = args.cache/'research/negative-form-selection-leaf-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'controls': len(controls),
                      'wholePacketNoOpEstablished': False}))


if __name__ == '__main__':
    main()
