"""Actual authored Ornn systems: bound-size coefficient versus typed zero.

Both variants retain the complete Flex object, all other authored fields and
all native emitters. Supplied provider-free placement keeps native bound size0.
"""
import argparse
import ctypes as C
import inspect
import json
from pathlib import Path
import struct
from unicorn import x86_const as r
from graphics_shader_catalog import GraphicsShaderCatalog
from graphics_texture_device import GraphicsTextureDevice
from native_vfx_fixture import NativeVfxFixture
from parent_placement_native import NativeParentPlacement
from vfx_asset_native import WRAPPER, CONTEXT, CACHE
from vfx_spawn_native import ADDRESSES as A, name_hash, sha


class FlexControl(NativeParentPlacement):
    zero_coefficient = None
    rendering_indices = None

    def parent_state(self):
        state = super().parent_state()
        if self.rendering_indices is not None:
            selected = [a for a in state['actors'] if a['emitterIndex'] in self.rendering_indices]
            if len(selected) != len(self.rendering_indices):
                raise ValueError('Required native geometry emitter missing')
            state = {**state, 'actors': selected}
        return state

    def render_selected_emitters(self, camera, indices):
        if self.rendering_indices is not None:
            raise ValueError('Nested diagnostic geometry selection')
        self.rendering_indices = indices
        try:
            return self.render_parent(camera)
        finally:
            self.rendering_indices = None

    def load_prepared_system(self, graph):
        super().load_prepared_system(graph)
        if type(self.zero_coefficient) is not bool:
            raise ValueError('Explicit coefficient control required')
        pointer, count = self.q(A['definition'] + 0x20), self.u32(A['definition'] + 0x28)
        self.flex_records = []
        for index in range(count):
            definition = self.q(pointer + index * 8)
            flex = self.q(definition + 0x258)
            if not flex:
                continue
            before = bytes(self.u.mem_read(flex, 48))
            if self.zero_coefficient:
                field = struct.pack('<IBf', name_hash('scaleBirthScaleByBoundObjectSize'), 10, 0)
                self.input, self.cursor, self.ignored, self.mismatched = field, 0, [], []
                self.loading = True
                try:
                    self.put(CACHE, 'Q', 0)
                    self.call(0x14bc830, {r.UC_X86_REG_RDI: CONTEXT, r.UC_X86_REG_RSI: flex,
                        r.UC_X86_REG_RDX: self.types[0xb13097f0], r.UC_X86_REG_RCX: WRAPPER,
                        r.UC_X86_REG_R8: CACHE})
                finally:
                    self.loading = False
                expected = bytearray(before)
                expected[4:8] = bytes(4)
                if self.cursor != len(field) or self.ignored or self.mismatched or bytes(self.u.mem_read(flex, 48)) != expected:
                    raise ValueError('Original typed float changed more than the coefficient')
            self.flex_records.append({'emitterIndex': index, 'pointer': flex,
                                      'authoredHex': before.hex(),
                                      'controlledHex': bytes(self.u.mem_read(flex, 48)).hex()})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--frames', type=int, default=61)
    args = parser.parse_args()
    if not 1 <= args.frames <= 121:
        raise ValueError('Bounded frame count required')
    fixture = NativeVfxFixture(args.cache)
    device = GraphicsTextureDevice(args.angle)
    n = FlexControl(fixture.assets/'decoder-16.21-macos', args.client, device=device)
    paths = {Path(__file__), Path(inspect.getfile(NativeVfxFixture)),
             Path(inspect.getfile(GraphicsShaderCatalog)), Path(inspect.getfile(GraphicsTextureDevice)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    sources = {str(p.resolve()): sha(p.read_bytes()) for p in paths}
    cases, blocks, boundary = [], {}, None
    camera = {'position': [12000, 12000, 0], 'right': [1, 0, 0], 'up': [0, 0, 1], 'axis': [0, 1, 0]}
    clock = {'ticks': [1000000000]*3, 'mode': 0, 'timebase': [1, 1]}
    try:
        for effect, geometry_indices in [('champions/ornn/0/1dce7d04', [2, 4]),
                                         ('champions/ornn/0/869ee434', [1])]:
            reference = None
            for zero in [False, True]:
                n.zero_coefficient = zero
                shaders = GraphicsShaderCatalog(fixture.assets/'latest-shaders', device)
                n.shader_catalog = shaders
                texture_start = len(device.textures)
                try:
                    active = fixture.activate(n, effect, 12345, clock, 0, False)
                    ownership = n.own_parent(active['object'])
                    frames = []
                    for tick in range(args.frames):
                        n.apply_placement(active['object'], {'position': [100 + tick*2, 40, 200 + tick]})
                        n.synchronize_placement(active['object'])
                        frame = n.tick_parent(ownership['initialTime'] + tick / 60, 20)
                        if n.u32(active['object'] + 0x100) or n.u32(active['parent'] + 0x1cc):
                            raise ValueError('Provider-free native bound size changed')
                        frames.append({'time': frame['time'], 'substeps': frame['substeps'],
                                       'state': frame['state'],
                                       'draws': n.render_selected_emitters(camera, geometry_indices)})
                    differences = [] if reference is None else [i for i,(a,b) in enumerate(zip(reference,frames)) if a != b]
                    if reference is None:
                        reference = frames
                    cases.append({'effectId': effect, 'zeroCoefficientControl': zero,
                                  'flexFields': n.flex_records, 'geometryEmitterIndices': geometry_indices,
                                  'frames': frames, 'differentFrames': differences})
                    print(json.dumps({'effect': effect, 'zero': zero, 'frames': len(frames),
                                      'differences': len(differences)}), flush=True)
                finally:
                    blocks.update(n.blocks)
                    for path, digest in shaders.inputs.items():
                        if sha(fixture.raw(Path(path))) != digest:
                            raise ValueError('Shader input changed')
                    if n.material_backend is not None:
                        n.material_backend.close()
                    n.mesh_backend.close()
                    shaders.close()
                    for handle in device.textures[texture_start:]:
                        device.gl.glDeleteTextures(1, C.byref(handle))
                    del device.textures[texture_start:]
    except Exception as error:
        boundary = {'type': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    finally:
        device.close()
    for path, digest in sources.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Producer changed during control: ' + path)
    result = {'schema': 1, 'kind': 'original-authored-flex-zero-bound-size-visual-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'cases': cases, 'boundary': boundary, 'inputs': fixture.inputs, 'sources': sources,
              'originalBlocks': list(blocks.values()), 'seed': 12345, 'clock': clock, 'camera': camera,
              'scope': {'completeAuthoredSystemsRetained': True, 'originalTypedFloatReader': True,
                        'originalVisualSyncSchedulingParticlesAndGeometry': True,
                        'allOriginalEmitterSimulationAndStateCompared': True,
                        'geometryLimitedToExplicitEmitterIndices': True,
                        'unsupportedSiblingGeometryExecuted': False,
                        'providerFreeBoundSizeZeroOnly': True, 'suppliedClockSeedCameraPosition': True,
                        'nativeMatchAcceptanceEstablished': False, 'runtimeAdmissionChanged': False,
                        'gpuSubmitted': False}}
    output = fixture.cache/'research/flex-bound-size-visuals-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases), 'boundary': boundary}))
    if boundary or any(c['differentFrames'] for c in cases):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
