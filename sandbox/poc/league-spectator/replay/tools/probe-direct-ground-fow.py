"""Observe original FoW parameters and texture selection without guessed fog.

Scalar extents and CPU grids are supplied controls. Texture defaults are made
by the original texture-manager constructor and verified by GPU readback.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct

from unicorn import x86_const as r
from graphics_texture_device import GraphicsTextureDevice
from native_vfx_fixture import NativeVfxFixture
from vfx_graphics_native import NativeVfxGraphicsContext
from vfx_parent_frames_native import float_bits
from vfx_spawn_native import ADDRESSES as A, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    fixture = NativeVfxFixture(args.cache)
    device = GraphicsTextureDevice(args.angle)
    n = NativeVfxGraphicsContext(fixture.assets / 'decoder-16.21-macos', args.client, device=device)
    try:
        # This graph restores the owned definition/heap arena. It is neither
        # activated nor a champion-specific implementation branch.
        graph_ref = fixture.systems['systems']['champions/vladimir/39/9fbafd14']
        graph_path = fixture.assets / 'latest-vfx-system-assets' / graph_ref['file']
        graph = fixture.read(graph_path)
        if sha(fixture.raw(graph_path)) != graph_ref['sha256']:
            raise ValueError('Owned original graphics fixture graph changed')
        n.load_prepared_system(graph)
        for item in fixture.context['initializedGlobals']:
            n.u.mem_write(n.base + item['rva'], bytes.fromhex(item['bytesHex']))
        n.initialize_graphics_context(0, False)
        texture_manager = n.q(n.base + 0x246fdf0)
        default = n.q(texture_manager + 0xa0)
        alternate = n.q(texture_manager + 0xa8)

        def texture_record(wrapper):
            table = n.q(wrapper)
            getter = n.q(table + 8)
            if not n.base <= getter < n.base + 0x1fef000:
                raise ValueError('Original default texture getter is not original code')
            n.call(getter - n.base, {r.UC_X86_REG_RDI: wrapper})
            header = n.u.reg_read(r.UC_X86_REG_RAX)
            matches = [v for v in n.gpu_records if v['pointer'] == header]
            if len(matches) != 1 or not matches[0]['gpuBytesVerified']:
                raise ValueError('Native default texture does not have exact GPU byte evidence')
            return {'wrapper': wrapper, 'getterRva': getter - n.base, 'header': header,
                    'resource': matches[0]}

        defaults = {'offsetA0': texture_record(default), 'offsetA8': texture_record(alternate)}
        controller, view = n.allocate(0x28), n.allocate(0x28)
        n.put(controller + 0x20, 'Q', view)
        n.put(view + 0x20, 'Q', alternate)
        selection = []
        frame = A['stack'] - 8
        for disabled, supplied_controller in [(0, controller), (1, controller), (0, 0), (1, 0)]:
            n.put(n.base + 0x24967c8, 'B', disabled)
            n.put(n.base + 0x24967d0, 'Q', supplied_controller)
            n.call(0x21c18b, {r.UC_X86_REG_RBP: frame, r.UC_X86_REG_RSP: frame - 0x80}, 0x21c1cf)
            selected = n.u.reg_read(r.UC_X86_REG_RBX)
            expected = alternate if not disabled and supplied_controller else default
            if selected != expected:
                raise ValueError('Original FoW texture selection differs from recovered branch')
            selection.append({'suppliedDisableFlag': disabled,
                              'suppliedControllerPresent': bool(supplied_controller),
                              'selectedNativeTextureWrapper': selected,
                              'selectedTextureManagerA0': selected == default,
                              'alternateIsControlledTextureIdentityNotActualFow': True})

        metadata = n.allocate(0x80)
        uniforms = []
        for extent in [100, 512, 14760, 30000]:
            n.put(metadata + 0x18, 'f', extent)
            n.call(0x21c22c, {r.UC_X86_REG_RAX: metadata, r.UC_X86_REG_RBP: frame}, 0x21c252)
            raw = bytes(n.u.mem_read(frame - 0x20, 16))
            uniforms.append({'suppliedExtent': extent, 'nativeVector': list(struct.unpack('<4f', raw)),
                             'bits': list(struct.unpack('<4I', raw))})

        # Execute the original CPU map constructor prefix, stopping before its
        # world-event subscription. Its actual initialized arrays are controls.
        cpu = n.allocate(0x80)
        n.call(0x21c910, {r.UC_X86_REG_RDI: cpu, r.UC_X86_REG_RSI: 4,
                          r.UC_X86_REG_XMM0: float_bits(100)}, 0x21c9e1)
        grid = n.q(cpu + 0x20)
        if n.allocations.get(grid) != 16 or bytes(n.u.mem_read(grid, 16)) != bytes(16):
            raise ValueError('Original CPU FoW grid constructor prefix differs')
        controlled_grid = bytes([0, 1, 0, 1] * 4)
        n.u.mem_write(grid, controlled_grid)
        n.put(n.base + 0x24967d8, 'Q', cpu)
        queries = []
        for position in [[0, 0, 0], [25, 0, 0], [99, 0, 99], [100, 0, 0], [-1, 0, 0], [50, 0, 50]]:
            n.put(A['point'], '3f', *position)
            n.call(0x21c470, {r.UC_X86_REG_RDI: A['point']})
            queries.append({'suppliedPosition': position, 'nativeResult': n.u.reg_read(r.UC_X86_REG_RAX) & 255})

        sites = [('original-global-name-registration', 0x21c060, 0x21c111),
                 ('original-texture-selector', 0x21c18b, 0x21c21b),
                 ('original-map-uniform-vector', 0x21c220, 0x21c262),
                 ('original-map-query', 0x21c470, 0x21c4e2),
                 ('original-cpu-map-constructor-prefix', 0x21c910, 0x21c9e1),
                 ('original-map-and-controller-producer', 0x21bd63, 0x21bdce),
                 ('original-render-target-constructor-prefix', 0x21e1e0, 0x21e308)]
        paths = {Path(__file__), Path(inspect.getfile(NativeVfxFixture)),
                 Path(inspect.getfile(GraphicsTextureDevice)),
                 *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
        result = {'schema': 1, 'kind': 'original-ground-fow-resource-controls',
                  'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
                  'decoderImageSha256': n.profile['decoderImageSha256'],
                  'defaultTextures': defaults, 'selectionControls': selection,
                  'uniformControls': uniforms, 'cpuGridControls': {
                      'constructorPrefixExecuted': True, 'suppliedExtent': 100, 'suppliedResolution': 4,
                      'suppliedGridHex': controlled_grid.hex(), 'queries': queries},
                  'sourceSites': [{'label': label, 'startRva': start, 'endRva': end,
                                   'sha256': sha(n.image[start:end]), 'bytesHex': n.image[start:end].hex()}
                                  for label, start, end in sites],
                  'inputs': fixture.inputs,
                  'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
                  'scope': {'originalDefaultTextureConstructorAndGpuReadback': True,
                            'originalTextureSelectorAndUniformPrefix': True,
                            'actualMapExtentRecovered': False, 'actualSpectatorDisableFlagRecovered': False,
                            'dynamicFowTextureProduced': False, 'matchVisibilityGridRecovered': False,
                            'whiteTextureSynthesized': False, 'compilerAdmissionChanged': False,
                            'groundDrawSubmitted': False, 'actualMatchCoverage': False}}
        output = fixture.cache / 'research/direct-ground-fow-native.json'
        output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
        print(json.dumps({'output': str(output), 'defaultA0': defaults['offsetA0'],
                          'selectionControls': selection, 'uniformControls': uniforms, 'cpuQueries': queries}))
    finally:
        device.close()


if __name__ == '__main__':
    main()
