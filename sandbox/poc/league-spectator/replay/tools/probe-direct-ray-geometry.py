"""Original ray writer and unchanged typed emitter, explicit diagnostic inputs."""
import argparse
import inspect
import json
import struct
from pathlib import Path
from unicorn import x86_const as r
from vfx_loaded_quad_native import NativeLoadedQuad
from vfx_postload_native import NativeVfxPostload
from vfx_emitter_native import GEOMETRY as G
from vfx_spawn_native import ADDRESSES as A, sha


class NativeRayGeometry(NativeLoadedQuad):
    def prepare_ray(self, state):
        if state['pendingLinkFixups'] or state['mathCalls']:
            raise ValueError('Complete original postload required')
        obj, heap = bytes.fromhex(state['objectHex']), bytes.fromhex(state['heapHex'])
        start = state['heapStart']; end = start + len(heap)
        if len(obj) != 0x470 or not 0x10400000 <= start <= end < 0x12000000 or end % 16:
            raise ValueError('Original loaded ownership differs')
        primitive = struct.unpack_from('<Q', obj, 0x60)[0]
        graph = self.prepare_quad({'__type': 'VfxEmitterDefinitionData',
                                  'SpawnShape': {'__type': 'VfxShapeLegacy'},
                                  'primitive': {'__type': 'VfxPrimitiveArbitraryQuad'}})
        self.u.mem_write(A['definition'], obj)
        self.u.mem_write(0x10400000, bytes(end - 0x10400000))
        self.u.mem_write(start, heap)
        if self.q(primitive) != self.base + 0x23f26e0 or self.q(self.q(primitive) + 0x28) != self.base + 0x1734a30:
            raise ValueError('Original ray primitive required')
        if obj[0x2d1] & 8 or struct.unpack_from('<Q', obj, 0x3c8)[0]:
            raise ValueError('No terrain or child provider in isolated fixture')
        graph.update(allocations=[], nextHeap=end, segments=[
            {'address': A['definition'], 'bytesHex': bytes(self.u.mem_read(A['definition'], 0x10000)).hex()},
            {'address': start, 'bytesHex': heap.hex()}])
        return graph

    def writer_inputs(self, view):
        return {'count': struct.unpack('<I', self.u.mem_read(self.q(A['actor'] + 0xa0) + 0x10, 4))[0],
                'viewPosition': view,
                'systemScale': list(struct.unpack('<2f', self.u.mem_read(A['system'] + 0x150, 8))),
                'colorMultiplier': list(struct.unpack('<4f', self.u.mem_read(A['system'] + 0x1b8, 16))),
                'blendMode': self.u.mem_read(A['definition'] + 0x14, 1)[0],
                'projectionScroll': struct.unpack('<f', self.u.mem_read(A['definition'] + 0x338, 4))[0],
                'uvScale': list(struct.unpack('<2f', self.u.mem_read(self.base + 0x247c7d0, 8))),
                'emitterUv': list(struct.unpack('<2f', self.u.mem_read(A['actor'] + 0x28, 8))),
                'baseUvPresent': bool(self.u.mem_read(A['link'] + 0xe8, 1)[0]),
                'multUvPresent': bool(self.u.mem_read(A['link'] + 0xe9, 1)[0]),
                'multTexturePresent': bool(self.q(A['link'] + 0x58))}

    def render_quad(self, view):
        self.u.mem_write(G['context'], bytes(0x3000))
        for offset, pointer in [(0, G['indices']), (8, G['vertices']), (0x10, G['draw']),
                                (0x18, A['actor']), (0x20, G['view'])]:
            self.put(G['context'] + offset, 'Q', pointer)
        self.put(G['view'], 'fff', *view)
        inputs = self.writer_inputs(view)
        if inputs['projectionScroll'] != 0 or inputs['baseUvPresent'] or inputs['multUvPresent'] or inputs['multTexturePresent']:
            raise ValueError('Only default projection and unbound UV fixture permitted')
        self.call(0x1734a30, {r.UC_X86_REG_RDI: self.q(A['definition'] + 0x60), r.UC_X86_REG_RSI: G['context']})
        nv, ni = self.q(G['context'] + 8) - G['vertices'], self.q(G['context']) - G['indices']
        if nv != inputs['count'] * 112 or ni != inputs['count'] * 12:
            raise ValueError('Complete original ray geometry required')
        return {'verticesHex': bytes(self.u.mem_read(G['vertices'], nv)).hex(),
                'indicesHex': bytes(self.u.mem_read(G['indices'], ni)).hex(), 'writerInputs': inputs}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client']: parser.add_argument(name, type=Path)
    args = parser.parse_args(); cache = args.cache.resolve(); assets = cache / 'public'
    inputs = {}
    def raw(path):
        data = path.read_bytes(); inputs[str(path.resolve())] = sha(data); return data
    def read(path): return json.loads(raw(path))
    profile = read(assets / 'decoder-16.21-macos/profile.json')
    image = raw(assets / 'decoder-16.21-macos/image.bin')
    if sha(image) != profile['decoderImageSha256']: raise ValueError('Original image differs')
    manifest = read(assets / 'latest-effects/manifest.json')
    inventory = read(assets / 'decoder-16.21-macos/vfx-assets.json')
    if inputs[str((assets / 'decoder-16.21-macos/vfx-assets.json').resolve())] != profile['vfxAssetsSha256']:
        raise ValueError('Pinned typed field inventory required')
    loader = NativeVfxPostload(assets / 'decoder-16.21-macos', args.client)
    native = NativeRayGeometry(assets / 'decoder-16.21-macos', args.client)
    identity = 'champions/maokai/3/9dc3629a'; index = 5
    ref = manifest['definitions'][identity]; read(assets / 'latest-effects' / ref['file'])
    if inputs[str((assets / 'latest-effects' / ref['file']).resolve())] != ref['sha256']:
        raise ValueError('Pinned authored emitter required')
    meta = inventory['emitters'][f'{identity}:{index}']
    blob = raw(cache / 'research/latest-effects/bins' / f"{meta['rawSourceSha256']}-{manifest['toolchain']['parserIdentity'][:16]}.bin")
    if sha(blob) != meta['rawSourceSha256']: raise ValueError('Original source differs')
    fields = [blob[x['offset']:x['offset'] + x['bytes']] for x in meta['fields']]
    if any(sha(value) != field['sha256'] for value, field in zip(fields, meta['fields'])):
        raise ValueError('Original field order/bytes differ')
    before = loader.load(fields); state = loader.postload()
    if before['ignored'] or before['mismatched']: raise ValueError('Unchanged complete emitter required')
    graph = native.prepare_ray(state)
    identity_basis = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    yaw_basis = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]
    pitch_basis = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
    cases = []
    for seed in [1, 0x12345]:
        for pose, basis in [('identity', identity_basis), ('yaw90', yaw_basis), ('pitch90', pitch_basis)]:
            native.reset_quad(graph, seed, 0); frames = []; previous = [23, -11, 81]
            for tick in range(31):
                time = tick / 60; current = [23 + time * 130, -11 + time * 3, 81 + time * 70]
                value = {'time': time, 'previous': previous, 'current': current, 'basis': basis, 'viewPosition': [300, 900, 1200]}
                output = native.frame_quad(value)
                frames.append({'input': value, 'output': output}); previous = current
            cases.append({'effectId': identity, 'emitterIndex': index, 'seedHex': f'{seed:016x}', 'pose': pose, 'frames': frames})
    # Explicit raw geometry controls exercise the exact writer without claiming
    # these supplied pool records came from a replay or an authored definition.
    controls = []
    native.reset_quad(graph, 1, 0)
    for time in [0, .1]:
        native.frame_quad({'time': time, 'previous': [0, 0, 0], 'current': [0, 0, 0],
                           'basis': identity_basis, 'viewPosition': [300, 900, 1200]})
    pool = native.q(A['actor'] + 0xa0)
    particle = native.q(pool + 0x38); attrs = native.q(pool + 0x98)
    if struct.unpack('<I', native.u.mem_read(pool + 0x10, 4))[0] != 1:
        raise ValueError('One retained original particle required for leaf controls')
    for blend in [0, 1, 4]:
        for direction in [[0, 1, 0], [1, 2, 3], [0, 0, 0], [1e-6, 0, 0]]:
            for color in [[.3, .6, .9, .4], [-1, 2, .5, 1.5]]:
                native.put(A['definition'] + 0x14, 'B', blend)
                native.put(particle + 0x70, 'fff', *direction)
                native.put(particle + 0x80, 'fff', 17, -29, 133)
                native.put(attrs, 'f' * 11, .75, *color, 13, 27, -4, .25, 1, .125)
                snapshot = native.snapshot()
                geometry = native.render_quad([300, 900, 1200])
                if snapshot != native.snapshot(): raise ValueError('Default ray writer mutated particle/RNG state')
                controls.append({'state': snapshot, 'geometry': geometry})
    source_paths = {Path(__file__), *[Path(inspect.getfile(c)) for c in type(native).__mro__ if c is not object],
                    *[Path(inspect.getfile(c)) for c in type(loader).__mro__ if c is not object]}
    for path in source_paths: raw(path)
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest: raise ValueError('Ray observation input drift')
    output = cache / 'research/direct-ray-geometry-native.json'
    output.write_text(json.dumps({'schema': 1, 'kind': 'native-direct-ray-default-geometry',
        'build': profile['clientVersion'], 'protocol': profile['protocolDigest'],
        'decoderImageSha256': profile['decoderImageSha256'], 'inputs': inputs,
        'originalBlocks': list(native.blocks.values()), 'cases': cases, 'controls': controls,
        'scope': {'unchangedTypedEmitter': True, 'suppliedMotionBasisSeedCamera': True,
                  'defaultProjectionOnly': True, 'materialsResolved': False, 'runtimeAdmissionChanged': False}}, separators=(',', ':')))
    print(json.dumps({'output': str(output), 'cases': len(cases), 'frames': sum(len(c['frames']) for c in cases), 'controls': len(controls)}))


if __name__ == '__main__': main()
