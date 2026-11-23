"""Original Buff/Spell module globals, before reflection registration.

The complete contiguous prefix constructs the source dictionaries and initial
script-scope vector itself. It stops before the separately admitted metadata
constructors, so existing type descriptors are never registered a second time.
"""
from vfx_spawn_native import sha


def initialize_original_buff_module(n):
    start, end = 0x870ae0, 0x870ee8
    root, count_at = n.base+0x2568640, n.base+0x2568648
    if (sha(n.image) != '3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7' or
            n.image[start:end] != n.source.image[start:end] or n.q(root) or n.q(count_at)):
        raise ValueError('Exact cold original Buff/Spell module global prefix required')
    n.call(start, {}, end=end)
    pointer, count, capacity = n.q(root), n.u32(count_at), n.u32(count_at+4)
    if (count != 1 or capacity != 0x80000008 or not n.library_pointer(pointer, 0x150) or
            n.q(pointer) != pointer+0x10 or n.u32(pointer+8) != 0 or n.u32(pointer+0xc) != 0x80000008):
        raise ValueError('Original module root script-scope ownership/defaults differ')
    return {'originalPrefix': [start, end], 'sourceSha256': sha(n.image[start:end]),
            'rootGlobalRva': 0x2568640, 'rootFrameCount': count, 'rootFrames': pointer,
            'firstFrameHex': bytes(n.u.mem_read(pointer, 0x150)).hex(),
            'originalGlobalConstructionCompleted': True, 'scriptFrameBytesSupplied': False,
            'reflectionConstructorsReexecuted': False, 'liveBuffMembershipAdmitted': False}
