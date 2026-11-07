"""Differential original no-child parent behavior under supplied root HASH values.

The static root/emitters remain unchanged except the isolated objectPath control.
This does not reconstruct match activation, clocks, seeds, world poses or audio.
"""
import argparse
import ctypes as C
import inspect
import json
from pathlib import Path
import struct

import unicorn
from unicorn import x86_const as r

from parent_placement_native import NativeParentPlacement
from native_vfx_fixture import NativeVfxFixture
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_spawn_native import ADDRESSES as A, sha


class RootIdentityControl(NativeParentPlacement):
    def __init__(self, *args, **kwargs):
        self.supplied_identity = None
        self.identity_reads = []
        super().__init__(*args, **kwargs)
        self.u.hook_add(unicorn.UC_HOOK_MEM_READ, self.read_identity,
                        begin=A['definition'] + 0x148, end=A['definition'] + 0x14b)

    def read_identity(self, uc, access, address, size, value, user):
        self.identity_reads.append({'instructionRva': uc.reg_read(r.UC_X86_REG_RIP) - self.base,
                                    'address': address, 'bytes': size})

    def load_prepared_system(self, graph):
        super().load_prepared_system(graph)
        if self.supplied_identity is None:
            raise ValueError('Identity differential needs explicit supplied HASH')
        self.put(A['definition'] + 0x148, 'I', self.supplied_identity)
        self.identity_reads.clear()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    fixture = NativeVfxFixture(args.cache)
    effect_id = 'champions/vladimir/39/9fbafd14'
    manifest = fixture.read(fixture.assets / 'latest-effects/manifest.json')
    authored = fixture.read(fixture.assets / 'latest-effects' / manifest['definitions'][effect_id]['file'])
    if any('child' in k.lower() for e in authored['definition']['complexEmitterDefinitionData'] for k in e):
        raise ValueError('Identity differential requires an authored no-child root')
    camera = {'position': [12000, 12000, 0], 'right': [1, 0, 0],
              'up': [0, 0, 1], 'axis': [0, 1, 0]}
    clock = {'ticks': [1000000000] * 3, 'mode': 0, 'timebase': [1, 1]}
    device = GraphicsTextureDevice(args.angle)
    n = RootIdentityControl(fixture.assets / 'decoder-16.21-macos', args.client, device=device)
    cases = []
    blocks = {}
    try:
        for identity in [0x9fbafd14, 0, 0x13579bdf]:
            n.supplied_identity = identity
            shaders = GraphicsShaderCatalog(fixture.assets / 'latest-shaders', device)
            n.shader_catalog = shaders
            texture_start = len(device.textures)
            try:
                active = fixture.activate(n, effect_id, 12345, clock, 0, False)
                ownership = n.own_parent(active['object'])
                if any(n.q(a['definition'] + 0x3c8) for a in ownership['actors'] if a['kind'] == 'complex'):
                    raise ValueError('Original loaded root has a child-particle pointer')
                obj, parent = active['object'], active['parent']
                initial_object = bytes(n.u.mem_read(obj, 0x238)).hex()
                frames = []
                for tick in range(121):
                    time = ownership['initialTime'] + tick / 60
                    if tick in [30, 45]:
                        n.suspend_parent(tick == 30)
                    pose = {'position': [100 + tick * 2, 40, 200 + tick]}
                    n.apply_placement(obj, pose)
                    n.synchronize_placement(obj)
                    frame = n.tick_parent(time, 20)
                    draws = n.render_parent(camera)
                    state = frame['state']
                    frames.append({'time': frame['time'], 'substeps': frame['substeps'],
                                   'rngHex': state['rngHex'], 'parentHex': state['parentHex'],
                                   'objectHex': bytes(n.u.mem_read(obj, 0x238)).hex(),
                                   'actors': [{'emitterIndex': a['emitterIndex'], 'pointer': a['pointer'],
                                               'bytesHex': a['bytesHex'], 'poolHex': a['poolHex'],
                                               'vectors': a['vectors']} for a in state['actors']],
                                   'draws': draws})
                case = {'suppliedIdentity': identity, 'object': obj, 'parent': parent,
                        'initialObjectHex': initial_object, 'initialTime': ownership['initialTime'],
                        'actors': len(ownership['actors']), 'frames': frames,
                        'identityReads': list(n.identity_reads),
                        'rootHashPreserved': n.u32(A['definition'] + 0x148) == identity}
                cases.append(case)
                print(json.dumps({'suppliedIdentity': identity, 'frames': len(frames),
                                  'identityReads': len(n.identity_reads)}), flush=True)
            finally:
                blocks.update(n.blocks)
                for path, digest in shaders.inputs.items():
                    if sha(fixture.raw(Path(path))) != digest:
                        raise ValueError('Native identity shader input changed')
                if n.material_backend is not None:
                    n.material_backend.close()
                n.mesh_backend.close()
                shaders.close()
                for handle in device.textures[texture_start:]:
                    device.gl.glDeleteTextures(1, C.byref(handle))
                del device.textures[texture_start:]
        mismatches = []
        baseline = cases[0]
        for case in cases[1:]:
            for key in ['object', 'parent', 'initialObjectHex', 'initialTime', 'actors', 'frames']:
                if case[key] != baseline[key]:
                    mismatches.append({'suppliedIdentity': case['suppliedIdentity'], 'field': key})
            if not case['rootHashPreserved']:
                mismatches.append({'suppliedIdentity': case['suppliedIdentity'], 'field': 'root-hash-preserved'})
        paths = {Path(__file__), Path(inspect.getfile(NativeVfxFixture)),
                 Path(inspect.getfile(GraphicsTextureDevice)), Path(inspect.getfile(GraphicsShaderCatalog)),
                 *[Path(inspect.getfile(c)) for c in RootIdentityControl.__mro__ if c is not object]}
        report = {'schema': 1, 'kind': 'native-no-child-parent-root-identity-differential',
                  'build': '16.21.829.8620', 'protocol': '20e09df23c66b85e', 'effectId': effect_id,
                  'decoderImageSha256': n.profile['decoderImageSha256'], 'cases': cases,
                  'camera': camera, 'clock': clock, 'seed': 12345, 'mismatches': mismatches,
                  'originalBlocks': list(blocks.values()), 'inputs': fixture.inputs,
                  'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
                  'scope': {'originalParentActivationAndEmitterScheduling': True,
                            'unchangedEmittersAndMaterialResources': True, 'isolatedSuppliedRootHash': True,
                            'noChildRootOnly': True, 'suppliedClockSeedPoseSuspensionAndCamera': True,
                            'childIdentityBehaviorVerified': False, 'gpuSubmitted': False,
                            'matchActivation': False, 'compilerAdmissionChanged': False}}
        output = fixture.cache / 'research/direct-root-identity-activation-native.json'
        output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
        print(json.dumps({'output': str(output), 'cases': len(cases),
                          'frames': sum(len(c['frames']) for c in cases), 'mismatches': mismatches}))
        if mismatches:
            raise ValueError('Root identity changes observable parent behavior; inspect exact differences')
    finally:
        device.close()


if __name__ == '__main__':
    main()
