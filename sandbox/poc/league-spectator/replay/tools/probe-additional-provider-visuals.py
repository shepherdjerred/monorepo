"""Original visual kernels with an unreadable supplied auxiliary provider.

The original setter executes, but provider selection/ownership and audio anchor
callbacks are excluded. This establishes only a bounded visual independence
control, not a native-match provider, factory or placement admission.
"""
import argparse
import ctypes as C
import inspect
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from graphics_shader_catalog import GraphicsShaderCatalog
from graphics_texture_device import GraphicsTextureDevice
from native_vfx_fixture import NativeVfxFixture
from parent_placement_native import NativeParentPlacement, SYNC
from vfx_spawn_native import sha


class AdditionalProviderControl(NativeParentPlacement):
    def __init__(self, *args, **kwargs):
        self.provider = None
        super().__init__(*args, **kwargs)

    def guard_provider(self, uc, access, address, size, value, user):
        raise ValueError('Visual path dereferenced supplied auxiliary provider at ' +
                         hex(uc.reg_read(r.UC_X86_REG_RIP) - self.base))

    def sync_with_additional_provider(self, obj):
        if obj not in self.object_addresses or self.in_parent_tick:
            raise ValueError('Owned idle object required')
        if self.q(obj + 0x170) or self.q(obj + 0x180) or self.q(obj + 0x198):
            raise ValueError('Control excludes source/target/shared ownership providers')
        if self.q(obj + 0x190) not in [0, self.provider]:
            raise ValueError('Foreign auxiliary provider')
        self.in_placement_sync = True
        try:
            self.call(SYNC, {r.UC_X86_REG_RDI: obj, r.UC_X86_REG_RSI: 0,
                             r.UC_X86_REG_RDX: 0})
        finally:
            self.in_placement_sync = False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--frames', type=int, default=61)
    args = parser.parse_args()
    if not 1 <= args.frames <= 121:
        raise ValueError('Bounded frame count required')
    fixture = NativeVfxFixture(args.cache)
    effect = 'champions/vladimir/39/9fbafd14'
    camera = {'position': [12000, 12000, 0], 'right': [1, 0, 0],
              'up': [0, 0, 1], 'axis': [0, 1, 0]}
    clock = {'ticks': [1000000000] * 3, 'mode': 0, 'timebase': [1, 1]}
    device = GraphicsTextureDevice(args.angle)
    n = AdditionalProviderControl(fixture.assets/'decoder-16.21-macos', args.client, device=device)
    cases, blocks, reference, boundary = [], {}, None, None
    paths = {Path(__file__), Path(inspect.getfile(NativeVfxFixture)),
             Path(inspect.getfile(GraphicsShaderCatalog)), Path(inspect.getfile(GraphicsTextureDevice)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    sources = {str(p.resolve()): sha(p.read_bytes()) for p in paths}
    try:
        for supplied in [False, True]:
            shaders = GraphicsShaderCatalog(fixture.assets/'latest-shaders', device)
            n.shader_catalog = shaders
            texture_start = len(device.textures)
            hook = None
            try:
                active = fixture.activate(n, effect, 12345, clock, 0, False)
                ownership = n.own_parent(active['object'])
                obj = active['object']
                provider, pair, wrapper = n.allocate(0x100, 0xa5), n.allocate(16), n.allocate(0x180)
                n.provider = provider
                n.put(wrapper + 0x178, 'Q', obj)
                n.put(pair, 'QQ', provider if supplied else 0, 0)
                before = bytes(n.u.mem_read(obj, 0x238))
                n.call(0x36b710, {r.UC_X86_REG_RDI: wrapper, r.UC_X86_REG_RSI: pair})
                expected = bytearray(before)
                if supplied:
                    import struct
                    struct.pack_into('<Q', expected, 0x190, provider)
                if bytes(n.u.mem_read(obj, 0x238)) != expected:
                    raise ValueError('Original auxiliary setter changed fields beyond its provider pair')
                hook = n.u.hook_add(unicorn.UC_HOOK_MEM_READ | unicorn.UC_HOOK_MEM_WRITE,
                                    n.guard_provider, begin=provider, end=provider + 0xff)
                frames = []
                for tick in range(args.frames):
                    if tick in [30, 45]:
                        n.suspend_parent(tick == 30)
                    n.apply_placement(obj, {'position': [100 + tick * 2, 40, 200 + tick]})
                    n.sync_with_additional_provider(obj)
                    frame = n.tick_parent(ownership['initialTime'] + tick / 60, 20)
                    # Retain every byte of simulation/particle state. The sole
                    # intentionally different object+190 is a separate input.
                    frames.append({'time': frame['time'], 'substeps': frame['substeps'],
                                   'state': frame['state'], 'draws': n.render_parent(camera)})
                differences = [] if reference is None else [
                    i for i, (a, b) in enumerate(zip(reference, frames)) if a != b]
                if reference is None:
                    reference = frames
                cases.append({'suppliedAuxiliaryProvider': supplied, 'provider': provider,
                              'setterOnlyChangedProviderPair': True,
                              'providerReadsAndWritesDuringVisuals': 0,
                              'frames': frames, 'differentFrames': differences})
                print(json.dumps({'supplied': supplied, 'frames': len(frames),
                                  'differences': len(differences)}), flush=True)
            finally:
                if hook is not None:
                    n.u.hook_del(hook)
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
    result = {'schema': 1, 'kind': 'original-auxiliary-provider-visual-independence-control',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'effectId': effect, 'seed': 12345, 'clock': clock, 'camera': camera,
              'cases': cases, 'boundary': boundary, 'inputs': fixture.inputs,
              'sources': sources, 'originalBlocks': list(blocks.values()),
              'scope': {'originalAuxiliarySetterExecuted': True,
                        'originalVisualSyncSchedulerParticlesAndGeometry': True,
                        'suppliedUnreadableProviderOnly': True,
                        'concreteProviderFactoryExecuted': False, 'audioAnchorHooksExecuted': False,
                        'nativeMatchPlacementOrAcceptanceEstablished': False,
                        'runtimeAdmissionChanged': False, 'gpuSubmitted': False}}
    output = fixture.cache/'research/additional-provider-visuals-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'boundary': boundary, 'cases': len(cases)}))
    if boundary or any(c['differentFrames'] for c in cases):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
