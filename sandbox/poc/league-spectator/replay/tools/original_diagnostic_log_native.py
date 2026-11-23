"""Original diagnostic mutex constructor fragment, not full module startup."""
import unicorn
from vfx_spawn_native import sha


def initialize_original_diagnostic_log_mutex(n):
    mutex = n.base+0x256c960
    if (mutex in n.character_mutexes or mutex in n.mutexes or
            n.image[0x14aa312:0x14aa32c] != n.source.image[0x14aa312:0x14aa32c] or
            bytes(n.u.mem_read(mutex, 64)) != bytes(n.source.image[0x256c960:0x256c9a0])):
        raise ValueError('Cold original resource diagnostic mutex required')
    stop = n.base+0x14aa32c
    hook = n.u.hook_add(unicorn.UC_HOOK_CODE,
        lambda engine, address, size, user: engine.emu_stop(), begin=stop, end=stop)
    try:
        n.call(0x14aa312, {}, 0x14aa32c)
    finally:
        n.u.hook_del(hook)
    if n.character_mutexes.get(mutex) != {'recursive': True, 'depth': 0}:
        raise ValueError('Original resource diagnostic mutex initialization differs')
    return {'object': mutex, 'source': [0x14aa312, 0x14aa32c],
        'sourceSha256': sha(n.image[0x14aa312:0x14aa32c]),
        'originalConstructorExecuted': True, 'complete14AA130StartupAdmitted': False}
