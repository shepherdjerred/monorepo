"""Observe exact numeric emitter defaults; no replay or asset guess is used."""
import argparse
import inspect
import json
import struct
import sys
from pathlib import Path
from unicorn import x86_const as r
from vfx_point_quad_native import NativePointQuad
from vfx_spawn_native import ADDRESSES, VALUE_WIDTHS, field_layout, sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('client', type=Path)
    args = p.parse_args()
    cache = args.cache.resolve()
    inputs = {}
    tools = Path(__file__).resolve().parent
    def raw(path):
        path = Path(path).resolve(); data = path.read_bytes(); inputs[str(path)] = sha(data); return data
    paths = {Path(__file__), args.client, *[Path(inspect.getfile(c)) for c in NativePointQuad.__mro__ if c is not object]}
    paths.update(Path(m.__file__) for m in tuple(sys.modules.values())
                 if getattr(m, '__file__', None) and Path(m.__file__).suffix == '.py'
                 and Path(m.__file__).resolve().is_relative_to(tools))
    for path in paths: raw(path)
    raw(cache / 'public/decoder-16.21-macos/profile.json')
    raw(cache / 'public/decoder-16.21-macos/image.bin')
    n = NativePointQuad(cache / 'public/decoder-16.21-macos', args.client)
    # The emitter constructor copies the shared unit-vector global, rather than
    # embedding its value. Execute its original static initializer first, as the
    # complete typed-asset environment does; uninitialized image BSS is not a
    # valid observation of the final constructor defaults.
    one_before = bytes(n.u.mem_read(n.base + 0x256cb28, 12)).hex()
    n.call(0x14aa3bf, {}, 0x14aa516)
    one_after = bytes(n.u.mem_read(n.base + 0x256cb28, 12)).hex()
    if one_after != struct.pack('<fff', 1, 1, 1).hex():
        raise ValueError('Original unit-vector static initializer differs')
    n.call(0x16ffef0, {r.UC_X86_REG_RDI: ADDRESSES['definition']})
    layout = field_layout(n.source.image)
    fields = {}
    shape_registration = layout['SpawnShape']
    shape_pointer = n.q(ADDRESSES['definition'] + shape_registration['offset'])
    if shape_registration['offset'] != 0x238 or shape_pointer != 0:
        raise ValueError('Original absent spawn-shape default changed')
    for name in ['rate', 'particleLifetime', 'birthScale0', 'bindWeight', 'lifetime']:
        width = VALUE_WIDTHS.get(name, 1)
        at = ADDRESSES['definition'] + layout[name]['offset']
        raw = bytes(n.u.mem_read(at, width * 4))
        if name != 'lifetime' and n.q(at + (16 if width >= 3 else 8)):
            raise ValueError('Native numeric default unexpectedly owns dynamic data')
        fields[name] = {'registration': layout[name], 'bits': list(struct.unpack('<' + 'I' * width, raw)),
                        'values': list(struct.unpack('<' + 'f' * width, raw))}
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest: raise ValueError('Native default input changed')
    result = {'schema': 1, 'kind': 'original-direct-emitter-numeric-defaults',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': n.profile['decoderImageSha256'], 'constructorRva': 0x16ffef0,
              'fields': fields, 'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths) if p.suffix == '.py'},
              'inputs': inputs,
              'staticInitializer': {'startRva': 0x14aa3bf, 'endRva': 0x14aa516,
                                    'sha256': sha(n.image[0x14aa3bf:0x14aa516]),
                                    'unitVectorRva': 0x256cb28, 'beforeHex': one_before, 'afterHex': one_after},
              'birthScaleConstructorCopy': {'startRva': 0x1700325, 'endRva': 0x1700338,
                                           'sha256': sha(n.image[0x1700325:0x1700338])},
              'pointerDefaults': {'SpawnShape': {'registration': shape_registration, 'pointer': shape_pointer}},
              'nullShapeBirthBranch': {'startRva': 0x17591fc, 'endRva': 0x175925c,
                                      'sha256': sha(n.image[0x17591fc:0x175925c])},
              'originalBlocks': list(n.blocks.values()),
              'scope': {'completeOriginalEmitterConstructor': True, 'originalFieldRegistrations': True,
                        'staticBuildDataOnly': True, 'nullShapeDefaultObserved': True,
                        'containsReplayEvents': False, 'liveWorldBindings': False}}
    output = cache / 'research/direct-effect-defaults-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'fields': {k: v['bits'] for k, v in fields.items()}}))


if __name__ == '__main__':
    main()
