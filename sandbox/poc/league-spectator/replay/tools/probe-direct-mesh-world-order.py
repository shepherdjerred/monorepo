"""Original individual mesh matrix setters with supplied non-diagonal poses."""
import argparse
import importlib.util
import inspect
import json
import struct
import sys
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from native_vfx_fixture import NativeVfxFixture
from vfx_spawn_native import sha

_spec = importlib.util.spec_from_file_location('mesh_draw_branch_observer', Path(__file__).with_name('probe-direct-mesh-draw-branch.py'))
_module = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _module
_spec.loader.exec_module(_module)


class MeshWorldOrder(_module.MeshDrawParameters):
    def __init__(self, *args, **kwargs):
        self.capture_matrix_order = False
        self.matrix_sources = []
        self.cpu_records = []
        super().__init__(*args, **kwargs)
        self.u.hook_add(unicorn.UC_HOOK_CODE, self.observe_order, begin=self.base + 0x173e69a, end=self.base + 0x173e69a)
        self.u.hook_add(unicorn.UC_HOOK_CODE, self.observe_order, begin=self.base + 0x1916f70, end=self.base + 0x1916f70)

    def observe_order(self, uc, address, size, user):
        if not self.capture_matrix_order:
            return
        if address == self.base + 0x173e69a:
            self.cpu_records.append(bytes(uc.mem_read(uc.reg_read(r.UC_X86_REG_RBP) - 0x330, 176)).hex())
            return
        handle = uc.reg_read(r.UC_X86_REG_RDI)
        names = [name for name in ['mWorld', 'mWorldInv'] if self.draw_parameter_slots[name]['pointer'] == handle]
        if len(names) != 1:
            raise ValueError('Individual mesh setter reached an unexpected matrix slot')
        self.matrix_sources.append({'name': names[0], 'callerRva': self.q(uc.reg_read(r.UC_X86_REG_RSP)) - self.base,
                                    'bytesHex': bytes(uc.mem_read(uc.reg_read(r.UC_X86_REG_RSI), 64)).hex()})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    fixture = NativeVfxFixture(args.cache)
    sources = {Path(__file__), Path(__file__).with_name('probe-direct-mesh-draw-branch.py'),
               Path(inspect.getfile(NativeVfxFixture)), Path(inspect.getfile(GraphicsShaderCatalog)),
               Path(inspect.getfile(GraphicsTextureDevice)),
               *[Path(inspect.getfile(c)) for c in MeshWorldOrder.__mro__ if c is not object]}
    sources.update(Path(__file__).with_name(name) for name in ['graphics_material_bindings.py', 'graphics_pipeline_device.py',
        'graphics_mesh_device.py', 'native_texture_dependencies.py', 'render-particle-shader.py', 'observe-shader-angle.py', 'macho.py', 'shader_permutation.py'])
    source_hashes = {str(path.resolve()): sha(path.read_bytes()) for path in sources}
    for path in [args.client, args.angle / 'libEGL.dll', args.angle / 'libGLESv2.dll']:
        fixture.raw(path)
    for name in ['image.bin', 'profile.json']:
        fixture.raw(fixture.assets / 'decoder-16.21-macos' / name)
    device = GraphicsTextureDevice(args.angle)
    native = shader = None
    try:
        native = MeshWorldOrder(fixture.assets / 'decoder-16.21-macos', args.client, device=device)
        shader = GraphicsShaderCatalog(fixture.assets / 'latest-shaders', device)
        native.shader_catalog = shader
        activation = fixture.activate(native, 'champions/hecarim/0/e57b8289', 1,
            {'ticks': [1000000000] * 3, 'mode': 0, 'timebase': [1, 1]}, 0, False)
        native.own_parent(activation['object'])
        actor = next(a for a in native.frame_actors if a['emitterIndex'] == 15)
        checkpoint = native.checkpoint_parent()
        identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
        poses = [('identity', identity),
                 ('yaw90', [0,0,-1,0,0,1,0,0,1,0,0,0,0,0,0,1]),
                 ('pitch90', [1,0,0,0,0,0,1,0,0,-1,0,0,0,0,0,1]),
                 ('shear', [1,.2,-.3,0,.1,1,.4,0,.3,-.2,1,0,0,0,0,1])]
        cases = []
        for label, basis in poses:
            native.restore_parent(checkpoint)
            placement = native.apply_placement(activation['object'], {'basis': basis, 'position': [23, -11, 81]}, initial=True)
            synchronized = native.synchronize_placement(activation['object'])
            for _ in range(4):
                native.tick_parent(native.last_parent_time + 1 / 60, 8)
            count = native.u32(native.q(actor['pointer'] + 0xa0) + 0x10) & 0xffff
            if count != 1:
                raise ValueError('Exact one actual Hecarim15 particle required')
            native.u.mem_write(native.draw_scene, bytes(0x300))
            native.put(native.draw_scene, '3f', 0, 100, 1000)
            native.put(native.draw_scene + 0x264, '16f', *identity)
            native.put(native.draw_wrapper, 'Q', actor['pointer'])
            native.put(native.draw_command, 'II', 0, 0)
            native.matrix_sources = []
            native.cpu_records = []
            native.capture_matrix_order = True
            try:
                native.fragment(0x173dfc0, 0x17c2d20, {
                    r.UC_X86_REG_RDI: native.draw_wrapper, r.UC_X86_REG_RSI: native.draw_scene,
                    r.UC_X86_REG_RDX: 1047222492, r.UC_X86_REG_RCX: native.draw_command})
            finally:
                native.capture_matrix_order = False
            caller = native.q(native.u.reg_read(r.UC_X86_REG_RSP)) - native.base
            if caller != 0x1809c7b or len(native.cpu_records) != 1 or len(native.matrix_sources) != 2:
                raise ValueError('Original individual mesh material boundary differs')
            shared = {name: bytes(native.u.mem_read(native.q(native.draw_parameter_slots[name]['pointer'] + 8), 64)).hex()
                      for name in ['mWorld', 'mWorldInv']}
            flag = bytes(native.u.mem_read(native.q(native.draw_parameter_slots['USE_INSTANCE_DRAW']['pointer'] + 8), 16)).hex()
            if flag != '00' * 16:
                raise ValueError('Individual mesh unexpectedly selected instancing')
            cases.append({'pose': label, 'suppliedBasis': basis, 'suppliedPosition': [23, -11, 81],
                          'placement': placement, 'synchronized': synchronized,
                          'record176Hex': native.cpu_records[0], 'setterInputs': native.matrix_sources,
                          'sharedValues': shared, 'materialApplyCallerRva': caller, 'useInstanceDrawHex': flag})
        for path, digest in shader.inputs.items():
            if sha(fixture.raw(Path(path))) != digest:
                raise ValueError('Shader drift')
        for path, digest in {**fixture.inputs, **source_hashes}.items():
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError('Final matrix order input drift')
        report = {'schema': 1, 'kind': 'original-individual-mesh-world-matrix-byte-order',
                  'build': '16.21.829.8620', 'protocol': '20e09df23c66b85e',
                  'decoderImageSha256': sha(native.image), 'effectId': activation['effectId'], 'emitterIndex': 15,
                  'cases': cases, 'inputs': fixture.inputs, 'sources': source_hashes,
                  'originalBlocks': list(native.blocks.values()),
                  'scope': {'originalObjectPlacementAndSynchronization': True, 'originalParticleBirthAndUpdate': True,
                            'originalIndividualDrawToMaterialApplyEntry': True,
                            'suppliedPoseClockSeedAndDiagnosticScene': True, 'gpuUniformUpdateApplied': False,
                            'materialApplyAndGpuDrawExecuted': False, 'nativeAcceptance': None}}
        output = fixture.cache / 'research/direct-mesh-world-order-native.json'
        output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
        print(json.dumps({'output': str(output), 'cases': len(cases), 'inputs': len(fixture.inputs) + len(source_hashes)}))
    finally:
        if native:
            if native.material_backend is not None:
                native.material_backend.close()
            native.mesh_backend.close()
        if shader:
            shader.close()
        device.close()


if __name__ == '__main__':
    main()
