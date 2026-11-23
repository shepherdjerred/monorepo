"""Bounded header-only projection for compact original ANM v5 resources."""
import math
import struct
import unicorn
from unicorn import x86_const as r
from animation_clock_native import RESOURCE
from vfx_spawn_native import ADDRESSES as A


def project_scene_animation_header(kernel, raw):
    if len(raw) >= 0x80:
        return kernel.prepare_header(raw)
    if len(raw) < 0x40 or raw[:8] != b'r3d2anmd' or struct.unpack_from('<I', raw, 8)[0] != 5:
        raise ValueError('Unadmitted compact original animation header')
    header = 0x10040000
    # Poison unused owned storage and prohibit reading it: no fabricated file
    # bytes are presented to the native constructor to satisfy a size check.
    kernel.u.mem_write(header, b'\xa5'*0x1000)
    kernel.u.mem_write(header, raw)
    reads = []

    def source_read(uc, access, address, size, value, user):
        if header <= address < header+0x1000:
            if address+size > header+len(raw):
                raise ValueError('Original compact ANM projection read outside source bytes')
            reads.append([address-header, size])

    hook = kernel.u.hook_add(unicorn.UC_HOOK_MEM_READ, source_read)
    resource = RESOURCE['uncompressed']
    try:
        kernel.u.mem_write(A['system'], bytes(0x70))
        start, end = resource['constructor']
        kernel.call(start, {r.UC_X86_REG_RDI: A['system'], r.UC_X86_REG_RSI: header+12}, end)
        if kernel.q(A['system']) != kernel.base+resource['vtable']:
            raise ValueError('Original compact ANM constructor class differs')
        kernel.call(resource['getter'], {r.UC_X86_REG_RDI: A['system']})
        frames = kernel.u.reg_read(r.UC_X86_REG_EAX)
        kernel.call(resource['fpsGetter'], {r.UC_X86_REG_RDI: A['system']})
        fps = struct.unpack('<f', struct.pack('<I', kernel.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff))[0]
        if not 1 <= frames <= 100000 or not math.isfinite(fps) or fps <= 0 or not reads:
            raise ValueError('Original compact ANM time domain is invalid')
        return {'status': 'prepared', 'kind': 'uncompressed', 'version': 5,
                'resourceFrames': frames, 'resourceFps': fps,
                'resourceHex': bytes(kernel.u.mem_read(A['system'], 0x70)).hex(),
                'headerProjection': {'kind': 'bounded-original-compact-v5',
                                     'sourceBytes': len(raw), 'sourceReads': reads}}
    finally:
        kernel.u.hook_del(hook)
