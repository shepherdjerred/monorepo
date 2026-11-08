"""Original unchanged Karthus Ray particle+atlas update and linked-UV writer."""
import argparse
import importlib.util
import inspect
import json
import struct
import sys
from pathlib import Path
from unicorn import x86_const as r
from vfx_emitter_native import GEOMETRY as G
from vfx_spawn_native import ADDRESSES as A, sha
from vfx_postload_native import NativeVfxPostload

_path = Path(__file__).with_name('probe-direct-ray-geometry.py')
_spec = importlib.util.spec_from_file_location('direct_ray_geometry_observer', _path)
_module = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _module
_spec.loader.exec_module(_module)


class NativeLinkedRay(_module.NativeRayGeometry):
    def render_quad(self, view):
        self.u.mem_write(G['context'], bytes(0x3000))
        for offset, pointer in [(0, G['indices']), (8, G['vertices']), (0x10, G['draw']),
                                (0x18, A['actor']), (0x20, G['view'])]:
            self.put(G['context'] + offset, 'Q', pointer)
        self.put(G['view'], 'fff', *view)
        value = self.writer_inputs(view)
        if value['projectionScroll'] != 0 or value['multUvPresent'] or value['multTexturePresent']:
            raise ValueError('Original zero-projection/no-mult Ray inputs required')
        pool = self.q(A['actor'] + 0xa0)
        count = value['count']
        if not 0 <= count <= 1024:
            raise ValueError('Original Ray particle bound exceeded')
        if count and value['baseUvPresent'] and not self.q(pool + 0x78):
            raise ValueError('Original particle update omitted linked UV vector')
        value['baseUvMatricesHex'] = bytes(self.u.mem_read(self.q(pool + 0x78), count * 24)).hex() if value['baseUvPresent'] and count else ''
        before = self.snapshot()
        self.call(0x1734a30, {r.UC_X86_REG_RDI: self.q(A['definition'] + 0x60), r.UC_X86_REG_RSI: G['context']})
        nv, ni = self.q(G['context'] + 8) - G['vertices'], self.q(G['context']) - G['indices']
        if nv != count * 112 or ni != count * 12:
            raise ValueError('Original linked Ray writer did not render complete pool')
        if before != self.snapshot():
            raise ValueError('Ray camera writer changed particle/RNG state')
        return {'verticesHex': bytes(self.u.mem_read(G['vertices'], nv)).hex(),
                'indicesHex': bytes(self.u.mem_read(G['indices'], ni)).hex(), 'writerInputs': value}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    assets = cache / 'public'
    inputs = {}
    def raw(path):
        data = path.read_bytes()
        digest = sha(data)
        if str(path.resolve()) in inputs and inputs[str(path.resolve())] != digest:
            raise ValueError('Original Ray input drift')
        inputs[str(path.resolve())] = digest
        return data
    def read(path):
        return json.loads(raw(path))
    profile = read(assets / 'decoder-16.21-macos/profile.json')
    image = raw(assets / 'decoder-16.21-macos/image.bin')
    manifest = read(assets / 'latest-effects/manifest.json')
    inventory = read(assets / 'decoder-16.21-macos/vfx-assets.json')
    if sha(image) != profile['decoderImageSha256'] or sha(raw(assets / 'decoder-16.21-macos/vfx-assets.json')) != profile['vfxAssetsSha256']:
        raise ValueError('Exact original image/typed fields required')
    loader = NativeVfxPostload(assets / 'decoder-16.21-macos', args.client)
    native = NativeLinkedRay(assets / 'decoder-16.21-macos', args.client)
    identity = 'champions/karthus/10/8ad0cea5'
    ref = manifest['definitions'][identity]
    source = read(assets / 'latest-effects' / ref['file'])
    if sha(raw(assets / 'latest-effects' / ref['file'])) != ref['sha256']:
        raise ValueError('Original definition hash differs')
    cases, classification = [], []
    bases = [('identity', [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),
             ('yaw90', [0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1]),
             ('pitch90', [1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1])]
    for index in [2, 10]:
        meta = inventory['emitters'][f'{identity}:{index}']
        blob = raw(cache / 'research/latest-effects/bins' / f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
        if sha(blob) != meta['rawSourceSha256']:
            raise ValueError('Original field source differs')
        fields = [blob[x['offset']:x['offset'] + x['bytes']] for x in meta['fields']]
        if any(sha(data) != field['sha256'] for data, field in zip(fields, meta['fields'])):
            raise ValueError('Original field bytes/order differ')
        before = loader.load(fields)
        state = loader.postload()
        loader.restore_preload_arena()
        if before['ignored'] or before['mismatched']:
            raise ValueError('Complete unchanged authored Ray emitter required')
        graph = native.prepare_ray(state)
        frame = A['stack'] - 0x100
        native.put(frame - 0x150, 'Q', A['link'])
        native.call(0x16e1d6d, {r.UC_X86_REG_RAX: A['definition'], r.UC_X86_REG_R15: A['link'], r.UC_X86_REG_RBP: frame}, 0x16e1dbe)
        flags = list(native.u.mem_read(A['link'] + 0xe8, 2))
        if flags != [0, 0]:
            raise ValueError('Original Karthus atlas classification differs')
        graph['segments'][0]['bytesHex'] = bytes(native.u.mem_read(A['definition'], 0x10000)).hex()
        classification.append({'emitterIndex': index, 'flags': flags, 'originalRange': [0x16e1d6d, 0x16e1dbe],
                               'sourceEmitter': source['definition']['complexEmitterDefinitionData'][index]})
        for seed in [1, 0x12345]:
            for pose, basis in bases:
                native.reset_quad(graph, seed, 0)
                frames, previous = [], [23, -11, 81]
                for tick in range(61):
                    time = tick / 60
                    current = [23 + time * 130, -11 + time * 3, 81 + time * 70]
                    value = {'time': time, 'previous': previous, 'current': current,
                             'basis': basis, 'viewPosition': [300 + time * 30, 900, 1200]}
                    frames.append({'input': value, 'output': native.frame_quad(value)})
                    previous = current
                cases.append({'effectId': identity, 'emitterIndex': index, 'seedHex': f'{seed:016x}', 'pose': pose, 'frames': frames})
    # These writer-only controls supply UV matrices explicitly. They are not
    # inferred from the Karthus atlas producer (whose original flags are 0,0).
    native.reset_quad(graph, 1, 0)
    for time in [0, .1]:
        native.frame_quad({'time': time, 'previous': [23, -11, 81], 'current': [23, -11, 81],
                           'basis': bases[0][1], 'viewPosition': [300, 900, 1200]})
    pool = native.q(A['actor'] + 0xa0)
    count = struct.unpack('<I', native.u.mem_read(pool + 0x10, 4))[0]
    if not count:
        raise ValueError('Positive original Ray pool required for linked-UV leaves')
    pointer = native.allocate(count * 24)
    native.put(pool + 0x78, 'QII', pointer, count, count)
    native.put(A['link'] + 0xe8, 'BB', 1, 0)
    leaves = []
    for matrix in [[1,0,0,1,0,0], [.25,0,0,1,.5,0], [2,1,-.5,3,-.25,.75], [-1,0,0,-1,1,1]]:
        for uv_scale in [[1,1], [.5,2]]:
            for i in range(count):
                native.put(pointer + i*24, '6f', *matrix)
            native.put(native.base + 0x247c7d0, '2f', *uv_scale)
            native.put(A['actor'] + 0x28, '2f', .125, -.25)
            snapshot = native.snapshot()
            geometry = native.render_quad([300,900,1200])
            leaves.append({'suppliedMatrix': matrix, 'state': snapshot, 'geometry': geometry})
    for path in {Path(__file__), _path, *[Path(inspect.getfile(c)) for c in type(native).__mro__ if c is not object],
                 *[Path(inspect.getfile(c)) for c in type(loader).__mro__ if c is not object]}:
        raw(path)
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Original Ray producer changed during observation')
    out = cache / 'research/direct-ray-linked-uv-native.json'
    out.write_text(json.dumps({'schema': 1, 'kind': 'original-ray-linked-uv-particle-controls',
        'build': profile['clientVersion'], 'protocol': profile['protocolDigest'],
        'decoderImageSha256': profile['decoderImageSha256'], 'inputs': inputs,
        'classification': classification, 'cases': cases, 'suppliedLinkedUvLeaves': leaves,
        'originalBlocks': list({**loader.blocks, **native.blocks}.values()),
        'scope': {'unchangedTypedEmitter': True, 'originalParticleAndAtlasUpdates': True,
                  'originalUvClassification': True, 'suppliedSeedClockSystemBasisAndRootMotion': True,
                  'materialAcquisition': False, 'paletteTextureBound': False, 'runtimeAdmissionChanged': False,
                  'nativeMatchPlacement': False, 'gpuDraws': False, 'browserPlayback': False}}, separators=(',', ':')))
    print(json.dumps({'output': str(out), 'cases': len(cases), 'frames': sum(len(c['frames']) for c in cases), 'suppliedLinkedUvLeaves': len(leaves), 'inputs': len(inputs)}))


if __name__ == '__main__':
    main()
