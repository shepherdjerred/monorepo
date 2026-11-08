"""Original particle shader selection and static material parameters.

Complete post-loaded assets remain unchanged. Resource presence, pass, feature
enablement and scene/graphics state are explicit inputs. Resource acquisition,
material factory/cache, shader compilation and submission do not execute here.
String interning, define containers and vector-parameter setters execute in the
original client. No shader/resource-returning helper is replaced by a stub.
"""
import math
import struct

import unicorn
from unicorn import x86_const as r
from vfx_asset_native import NativeVfxAssets
from vfx_spawn_native import ADDRESSES as A

PROGRAM = 0x100e4000
MATERIAL = 0x100e4200
PASS_TABLE = 0x100e4500
FRAME = 0x1000f000


class NativeVfxMaterial(NativeVfxAssets):
    def __init__(self, package, client):
        self.record_material = False
        self.material_blocks = {}
        super().__init__(package, client)
        self.material_baseline_arena = bytes(self.u.mem_read(0x10400000, self.baseline_heap - 0x10400000))

    def call(self, entry, regs, end=None):
        if end is None:
            return super().call(entry, regs, end)
        # These fragments overlap inside one function and can branch backwards.
        # A code hook enforces the exact endpoint even when another fragment
        # previously translated that address with a different emulation limit.
        self.u.context_restore(self.initial)
        self.put(A['stack'], 'Q', A['stop'])
        self.u.reg_write(r.UC_X86_REG_RSP, A['stack'])
        for register, value in regs.items():
            self.u.reg_write(register, value)
        self.u.ctl_remove_cache(self.base + min(entry, end), self.base + max(entry, end) + 0x1000)
        hook = self.u.hook_add(unicorn.UC_HOOK_CODE, lambda uc, address, size, user: uc.emu_stop(),
                               begin=self.base + end, end=self.base + end)
        try:
            self.u.emu_start(self.base + entry, A['stop'], count=5000000)
        finally:
            self.u.hook_del(hook)
        if self.u.reg_read(r.UC_X86_REG_RIP) != self.base + end:
            raise ValueError('Native material fragment exceeded its instruction boundary')

    def check_block(self, uc, address, size, user):
        super().check_block(uc, address, size, user)
        at = address - self.base
        if self.record_material and at in self.blocks:
            self.material_blocks[at] = self.blocks[at]

    def prepare_material(self, graph):
        if graph['build'] != '16.21.829.8620' or graph['protocol'] != '20e09df23c66b85e':
            raise ValueError('Unsupported particle material graph')
        if graph['primitiveKind'] not in ['camera', 'arbitrary']:
            raise ValueError('Unprepared particle material primitive')
        # Restore every image page changed by the previous case, along with the
        # original intern-pool mutex/allocator baseline, before copying a graph.
        # Interning mutates bucket/node links in the baseline arena as well as
        # image globals. Restoring only the allocator cursor would retain links
        # to allocations that the next asset graph overwrites.
        self.u.mem_write(0x10400000, self.material_baseline_arena)
        self.load([])
        self.loading = True
        self.library_calls.clear()
        self.math_calls.clear()
        for segment in graph['segments']:
            start, raw = segment['address'], bytes.fromhex(segment['bytesHex'])
            if not (start == A['definition'] and len(raw) == 0x10000 or
                    start == graph['assetHeapStart'] and len(raw) == graph['assetHeapBytes'] and
                    0x10400000 <= start <= start + len(raw) < 0x11000000):
                raise ValueError('Material graph exceeds owned asset ranges')
            self.u.mem_write(start, raw)
        self.next_heap = graph['nextHeap']
        if self.next_heap != graph['assetHeapStart'] + graph['assetHeapBytes']:
            raise ValueError('Material graph heap endpoint changed')
        self.root_before = bytes(self.u.mem_read(A['definition'], 0x470))
        if self.q(A['definition'] + 0x68):
            raise ValueError('Custom materials require the original custom-material factory')
        self.heap_before = bytes(self.u.mem_read(graph['assetHeapStart'], graph['assetHeapBytes']))
        self.graph = graph
        self.u.mem_write(PROGRAM, bytes(0x600))
        self.put(A['link'] + 8, 'Q', A['resource'])
        self.put(A['resource'] + 0x38, 'Q', A['systemDefinition'])
        self.put(self.base + 0x246dfd0, 'Q', A['manager'])
        self.put(A['link'] + 0x88, 'Q', MATERIAL)
        self.record_material = True

    def defines(self, address):
        count, pointer = self.u32(address + 8), self.q(address)
        if count > 32 or count and not 0x10400000 <= pointer <= self.next_heap - count * 24:
            raise ValueError('Native define container exceeds ownership bound')
        return [{'name': self.cstring(self.q(pointer + i * 24)).decode('ascii'),
                 'value': self.cstring(self.q(pointer + i * 24 + 8)).decode('ascii')}
                for i in range(count)]

    def select(self, values):
        required = {'pass', 'featuresEnabled', 'resourceMask', 'systemFogMode', 'graphics34b', 'graphics29c'}
        if set(values) != required or any(type(values[k]) is not bool for k in ['featuresEnabled', 'graphics34b']):
            raise ValueError('Explicit particle shader environment required')
        for key, low, high in [('pass', 0, 6), ('resourceMask', 0, 7), ('systemFogMode', 0, 1), ('graphics29c', 0, 2)]:
            if type(values[key]) is not int or not low <= values[key] <= high:
                raise ValueError(f'Invalid supplied material environment: {key}')
        self.put(A['link'] + 0x18, 'B', values['featuresEnabled'])
        self.put(A['systemDefinition'] + 0xc0, 'B', values['systemFogMode'])
        self.put(A['manager'] + 0x34b, 'B', values['graphics34b'])
        self.put(A['manager'] + 0x29c, 'B', values['graphics29c'])
        # These are presence predicates, never textures. The 0x20000000 marker
        # is unmapped in this native harness. Any dereference is an error.
        for bit, offset in enumerate([0x58, 0x60, 0x68]):
            self.put(A['link'] + offset, 'Q', 0x20000000 if values['resourceMask'] & (1 << bit) else 0)
        self.u.mem_write(PROGRAM, bytes(0x100))
        self.call(0x16dff20, {r.UC_X86_REG_RDI: A['link'], r.UC_X86_REG_RSI: values['pass'], r.UC_X86_REG_RDX: PROGRAM})
        return {'vertex': self.cstring(self.q(PROGRAM + 0x30)).decode('ascii'),
                'pixel': self.cstring(self.q(PROGRAM + 0x38)).decode('ascii'),
                'defines': self.defines(PROGRAM + 0x40),
                'linkShaderFlag1a': self.u.mem_read(A['link'] + 0x1a, 1)[0]}

    def parameters(self):
        # Original call-site ABI in 0x16de730, after the external material
        # factory and before texture/resource acquisition. The material is an
        # owned, initially empty parameter container, never a GPU resource.
        self.u.mem_write(MATERIAL, bytes(0x100))
        self.put(FRAME - 0x158, 'Q', A['link'] + 0x88)
        self.call(0x16de93f, {r.UC_X86_REG_RBX: A['link'], r.UC_X86_REG_RBP: FRAME}, 0x16dea09)
        self.call(0x16deec2, {r.UC_X86_REG_RBX: A['link'], r.UC_X86_REG_RBP: FRAME}, 0x16def04)
        self.call(0x16def04, {r.UC_X86_REG_RBX: A['link'], r.UC_X86_REG_RBP: FRAME}, 0x16df040)
        count, pointer = self.u32(MATERIAL + 0x18), self.q(MATERIAL + 0x10)
        if count != (5 if self.q(A['definition'] + 0x30) else 3) or not 0x10400000 <= pointer <= self.next_heap - 24 * count:
            raise ValueError('Unexpected native static material parameter container')
        result = []
        for i in range(count):
            row = pointer + i * 24
            if self.u32(row + 16) != 1:
                raise ValueError('Unexpected native material vector count')
            data = bytes(self.u.mem_read(self.q(row + 8), 16))
            values = list(struct.unpack('<4f', data))
            if not all(math.isfinite(v) for v in values):
                raise ValueError('Non-finite native static material parameter')
            result.append({'name': self.cstring(self.q(row)).decode('ascii'), 'bytesHex': data.hex(), 'value': values})
        expected = ['TEXTURE_INFO', 'TEXTURE_INFO_2', 'PARTICLE_DEPTH_PUSH_PULL']
        if self.q(A['definition'] + 0x30):
            expected += ['cSoftParticleParams', 'cSoftParticleControl']
        if [p['name'] for p in result] != expected:
            raise ValueError('Original static material parameter names changed')
        return result

    def erosion_parameters(self, drive):
        if type(drive) not in [float, int] or not math.isfinite(drive):
            raise ValueError('Explicit finite erosion drive required')
        if not self.q(A['definition'] + 0x38):
            return []
        wrapper = PASS_TABLE + 0x10
        self.put(wrapper, 'Q', A['actor'])
        self.put(A['actor'] + 8, 'Q', A['link'])
        encoded_drive = int.from_bytes(struct.pack('<f', drive), 'little')
        self.call(0x173d020, {r.UC_X86_REG_RDI: wrapper, r.UC_X86_REG_XMM0: encoded_drive}, 0x173d0b6)
        frame = self.u.reg_read(r.UC_X86_REG_RBP)
        result = []
        for name, offset in [('cAlphaErosionParams', -0x40), ('cAlphaErosionTextureMixer', -0x30)]:
            data = bytes(self.u.mem_read(frame + offset, 16))
            values = list(struct.unpack('<4f', data))
            if not all(math.isfinite(v) for v in values):
                raise ValueError('Non-finite original erosion parameter')
            result.append({'name': name, 'bytesHex': data.hex(), 'value': values})
        return result

    def samplers(self):
        result = []
        slots = [('base', 0), ('mult', 7)]
        if self.q(A['definition'] + 0x38):
            slots.append(('erosion', 9))
        for name, slot in slots:
            self.call(0x16e3910, {r.UC_X86_REG_RDI: A['link'], r.UC_X86_REG_RCX: slot}, 0x16e3a53)
            frame = self.u.reg_read(r.UC_X86_REG_RBP)
            data = bytes(self.u.mem_read(frame - 0x40, 5))
            if any(value > 3 for value in data[:3]) or any(value > 1 for value in data[3:]):
                raise ValueError('Unknown native particle sampler descriptor')
            result.append({'layer': name, 'slot': slot, 'descriptorHex': data.hex()})
        return result

    def render_state(self, render_pass):
        if type(render_pass) is not int or not 0 <= render_pass <= 6:
            raise ValueError('Invalid supplied render pass')
        primitive = self.q(A['definition'] + 0x60)
        primitive_code = self.u.mem_read(primitive + 8, 1)[0]
        self.put(FRAME - 0x158, 'Q', A['link'] + 0x88)
        self.put(FRAME - 0x184, 'I', primitive_code)
        self.put(PASS_TABLE, 'B', render_pass)
        self.call(0x16df1e0, {r.UC_X86_REG_RBX: A['link'], r.UC_X86_REG_R13: PROGRAM,
            r.UC_X86_REG_R12: FRAME - 0x17c, r.UC_X86_REG_R14: PASS_TABLE,
            r.UC_X86_REG_R15: 0, r.UC_X86_REG_RBP: FRAME}, 0x16df180)
        raw = bytes(self.u.mem_read(FRAME - 0x180, 32))
        self.call(0x17bb570, {r.UC_X86_REG_RDI: PROGRAM, r.UC_X86_REG_RSI: FRAME - 0x180})
        if bytes(self.u.mem_read(PROGRAM + 8, 32)) != raw:
            raise ValueError('Original render-state setter did not retain the constructed bytes')
        count = self.u32(PROGRAM + 0x68)
        uniforms = []
        if count > 8:
            raise ValueError('Native pass-uniform container exceeds bound')
        for i in range(count):
            row = self.q(PROGRAM + 0x60) + 24 * i
            if self.u32(row + 16) != 1:
                raise ValueError('Unexpected native pass uniform size')
            data = bytes(self.u.mem_read(self.q(row + 8), 16))
            uniforms.append({'name': self.cstring(self.q(row)).decode('ascii'), 'bytesHex': data.hex(),
                             'value': list(struct.unpack('<4f', data))})
        return {'bytesHex': raw.hex(), 'programPrefixHex': bytes(self.u.mem_read(PROGRAM, 8)).hex(),
                'defines': self.defines(PROGRAM + 0x40), 'uniforms': uniforms}

    def finish(self):
        self.record_material = self.loading = False
        if self.math_calls:
            raise ValueError('Unexpected external math in static material component')
        if self.root_before != bytes(self.u.mem_read(A['definition'], 0x470)) or self.heap_before != bytes(self.u.mem_read(self.graph['assetHeapStart'], self.graph['assetHeapBytes'])):
            raise ValueError('Material selection/parameter computation mutated the loaded asset')
        if any(self.mutexes.values()):
            raise ValueError('Native material component retained a mutex lock')
