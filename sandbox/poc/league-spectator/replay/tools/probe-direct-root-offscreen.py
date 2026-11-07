"""Execute the original ordinary-parent wrapper with an owned empty view list.

The empty list is a supplied control, not recovered match camera visibility.
Diagnostic geometry is generated independently and does not imply visibility.
"""
import argparse
from collections import Counter
import ctypes as C
import importlib.util
import inspect
import json
from pathlib import Path
import struct
import sys

import capstone
import unicorn
from unicorn import x86_const as r

from native_vfx_fixture import NativeVfxFixture
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_spawn_native import ADDRESSES as A, sha
from vfx_parent_frames_native import float_bits, f32


producer = Path(__file__).with_name('probe-direct-root-flags.py')
spec = importlib.util.spec_from_file_location('root_flags_control', producer)
flags_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = flags_module
spec.loader.exec_module(flags_module)


class EmptyViewControl(flags_module.RootFlagsControl):
    def __init__(self, *args, **kwargs):
        self.wrapper_branches = Counter()
        super().__init__(*args, **kwargs)
        self.u.hook_add(unicorn.UC_HOOK_CODE, self.capture_wrapper,
                        begin=self.base + 0x1744c20, end=self.base + 0x1744f25)

    def capture_wrapper(self, uc, address, size, user):
        ip = address - self.base
        if ip in [0x1744ced, 0x1744d67, 0x1744db0, 0x1744e96, 0x1744ea4,
                  0x1744ebb, 0x1744ec0, 0x1744f00]:
            self.wrapper_branches[ip] += 1

    def tick_empty_views(self, time, views):
        if self.allocations.get(views) != 16 or bytes(self.u.mem_read(views, 16)) != bytes(16):
            raise ValueError('Wrapper requires its exact owned empty camera vector')
        self.parent_substeps = []
        self.math_calls.clear()
        self.births.clear()
        self.wrapper_branches.clear()
        self.in_parent_tick = True
        try:
            self.call(0x1744c20, {r.UC_X86_REG_RDI: self.frame_parent,
                                  r.UC_X86_REG_RSI: views, r.UC_X86_REG_RDX: 0,
                                  r.UC_X86_REG_RCX: 20, r.UC_X86_REG_XMM0: float_bits(time)})
        finally:
            self.in_parent_tick = False
        self.last_parent_time = f32(time)
        return {'time': self.last_parent_time, 'substeps': list(self.parent_substeps),
                'branches': dict(self.wrapper_branches), 'state': self.parent_state()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    fixture = NativeVfxFixture(cache)
    baseline_path = cache / 'research/direct-root-identity-activation-native.json'
    baseline = fixture.read(baseline_path)
    for path, digest in baseline['inputs'].items():
        if sha(fixture.raw(Path(path))) != digest:
            raise ValueError('Original baseline static input changed')
    for name, digest in baseline['sources'].items():
        if sha(fixture.raw(Path(__file__).with_name(name))) != digest:
            raise ValueError('Original baseline producer changed: ' + name)
    reference = next(c for c in baseline['cases'] if c['suppliedIdentity'] == 0x9fbafd14)
    image = fixture.raw(fixture.assets / 'decoder-16.21-macos/image.bin')
    cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    cs.detail = True
    instructions = list(cs.disasm(image[0x1744c20:0x1744f26], 0x1744c20))
    globals_by_site = {}
    for ip in [0x1744d03, 0x1744d23]:
        inst = next(i for i in instructions if i.address == ip)
        operand = inst.operands[1] if inst.mnemonic == 'mov' else inst.operands[0]
        if operand.type != capstone.CS_OP_MEM or operand.mem.base != capstone.x86.X86_REG_RIP:
            raise ValueError('Original wrapper global is no longer RIP-relative')
        globals_by_site[ip] = inst.address + inst.size + operand.mem.disp
    device = GraphicsTextureDevice(args.angle)
    n = EmptyViewControl(fixture.assets / 'decoder-16.21-macos', args.client, device=device)
    cases, blocks = [], {}
    try:
        for flags in [212, 213, 197, 198]:
            n.supplied_flags = flags
            shaders = GraphicsShaderCatalog(fixture.assets / 'latest-shaders', device)
            n.shader_catalog = shaders
            texture_start = len(device.textures)
            try:
                active = fixture.activate(n, baseline['effectId'], baseline['seed'], baseline['clock'], 0, False)
                ownership = n.own_parent(active['object'])
                parent, obj = ownership['parent'], active['object']
                views = n.allocate(16)
                manager = n.q(n.base + globals_by_site[0x1744d03])
                if manager != A['manager']:
                    raise ValueError('Wrapper manager is not the owned initialized manager')
                control = {'managerRva': globals_by_site[0x1744d03],
                           'managerByte34d': n.u.mem_read(manager + 0x34d, 1)[0],
                           'globalByteRva': globals_by_site[0x1744d23],
                           'globalByte': n.u.mem_read(n.base + globals_by_site[0x1744d23], 1)[0],
                           'rootC0': n.u.mem_read(A['definition'] + 0xc0, 1)[0],
                           'rootC4': n.u.mem_read(A['definition'] + 0xc4, 1)[0],
                           'rootCc': struct.unpack('<f', n.u.mem_read(A['definition'] + 0xcc, 4))[0],
                           'parentF8': n.u32(parent + 0xf8),
                           'parent2a9': struct.unpack('<H', n.u.mem_read(parent + 0x2a9, 2))[0],
                           'viewVectorHex': bytes(n.u.mem_read(views, 16)).hex(),
                           'argEdx': 0, 'argEcx': 20}
                rows = []
                for tick, ref in enumerate(reference['frames']):
                    if tick in [30, 45]:
                        n.suspend_parent(tick == 30)
                    n.apply_placement(obj, {'position': [100 + tick * 2, 40, 200 + tick]})
                    n.synchronize_placement(obj)
                    frame = n.tick_empty_views(ref['time'], views)
                    state = frame['state']
                    draws = n.render_parent(baseline['camera'])
                    actors = flags_module.actor_records(state)
                    rows.append({'tick': tick, 'time': frame['time'], 'branches': frame['branches'],
                                 'substeps': frame['substeps'], 'rngHex': state['rngHex'],
                                 'parentFlags2a9': struct.unpack('<H', n.u.mem_read(parent + 0x2a9, 2))[0],
                                 'parentFlagsF8': n.u32(parent + 0xf8),
                                 'parentClocks12c': list(struct.unpack('<8f', n.u.mem_read(parent + 0x12c, 32))),
                                 'particles': [a['vectors']['life']['count'] for a in state['actors']],
                                 'actorSha256': sha(flags_module.encoded(actors)),
                                 'geometrySha256': sha(flags_module.encoded(draws)),
                                 'referenceActorMatch': actors == ref['actors'],
                                 'referenceGeometryMatch': draws == ref['draws'],
                                 'referenceRngMatch': state['rngHex'] == ref['rngHex']})
                cases.append({'flags': flags, 'controls': control, 'frames': rows,
                              'flagReads': [{'instructionRva': ip, 'bytes': size, 'count': count}
                                            for (ip, size), count in sorted(n.flag_reads.items())]})
                print(json.dumps({'flags': flags, 'frames': len(rows),
                                  'parentTickCalls': sum(row['branches'].get(0x1744ebb, 0) for row in rows),
                                  'geometryReferenceMatches': sum(row['referenceGeometryMatch'] for row in rows),
                                  'finalParticles': rows[-1]['particles'], 'controls': control}), flush=True)
            finally:
                blocks.update(n.blocks)
                for path, digest in shaders.inputs.items():
                    if sha(fixture.raw(Path(path))) != digest:
                        raise ValueError('Wrapper shader input changed')
                if n.material_backend is not None:
                    n.material_backend.close()
                n.mesh_backend.close()
                shaders.close()
                for handle in device.textures[texture_start:]:
                    device.gl.glDeleteTextures(1, C.byref(handle))
                del device.textures[texture_start:]
        paths = {Path(__file__), producer, Path(inspect.getfile(NativeVfxFixture)),
                 Path(inspect.getfile(GraphicsTextureDevice)), Path(inspect.getfile(GraphicsShaderCatalog)),
                 *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
        result = {'schema': 1, 'kind': 'original-parent-wrapper-empty-view-controls',
                  'baselineSha256': sha(baseline_path.read_bytes()), 'effectId': baseline['effectId'],
                  'build': baseline['build'], 'protocol': baseline['protocol'],
                  'cases': cases, 'originalBlocks': list(blocks.values()),
                  'wrapperBytesHex': image[0x1744c20:0x1744f26].hex(), 'inputs': fixture.inputs,
                  'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
                  'scope': {'originalWrapper1744c20': True, 'suppliedEmptyViewVector': True,
                            'actualMatchViewInputs': False, 'diagnosticGeometryIndependentOfCulling': True,
                            'compilerAdmissionChanged': False, 'matchCoverage': False, 'gpuSubmitted': False}}
        output = cache / 'research/direct-root-offscreen-native.json'
        output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
        print(json.dumps({'output': str(output), 'cases': len(cases),
                          'frames': sum(len(c['frames']) for c in cases)}))
    finally:
        device.close()


if __name__ == '__main__':
    main()
