"""Execute the registered original SDK memory-module static constructor."""
import struct
from vfx_spawn_native import sha


def original_module_initializer_identity(n, entry, index):
    sections = [row for row in n.source.sections if row[0] == '__mod_init_func']
    if len(sections) != 1 or sections[0][2] % 8 or not 0 < sections[0][2] <= 0x10000:
        raise ValueError('Bounded original module initializer inventory required')
    section = sections[0]
    raw = bytes(n.source.image[section[1]-n.base:section[1]-n.base+section[2]])
    values = struct.unpack('<'+'Q'*(len(raw)//8), raw)
    if [ordinal for ordinal, value in enumerate(values) if value == n.base+entry] != [index]:
        raise ValueError('Exact original module initializer entry/order required')
    return {'initializerRva': entry, 'moduleInitializerIndex': index,
            'moduleInitializerSectionSha256': sha(raw)}


def initialize_original_sdk_memory_statics(n, result):
    identity = original_module_initializer_identity(n, 0x1c02880, 936)
    if (getattr(n, 'original_sdk_memory_statics', False) or
            n.image[0x1c02880:0x1c029e7] != n.source.image[0x1c02880:0x1c029e7] or
            bytes(n.u.mem_read(n.base+0x2570960, 0x1e0)) != bytes(n.source.image[0x2570960:0x2570b40]) or
            any(n.base+at in n.character_mutexes for at in [0x2570960, 0x25709a0, 0x2570ae0])):
        raise ValueError('Cold registered original SDK memory-module initializer required')
    n.call(0x1c02880, {})
    mutexes = []
    for at in [0x2570960, 0x25709a0, 0x2570ae0]:
        mutex = n.character_mutexes.get(n.base+at)
        if mutex != {'recursive': True, 'depth': 0}:
            raise ValueError('Original SDK memory module did not construct its recursive mutexes')
        mutexes.append({'rva': at, **mutex})
    n.original_sdk_memory_statics = True
    result.update(**identity, initializerSha256=sha(n.image[0x1c02880:0x1c029e7]),
        mutexes=mutexes, originalConstructorCompleted=True,
        scope={'allModuleInitializersExecuted': False, 'sdkWorkerReadinessAdmitted': False,
               'audioDeviceActivated': False})
    return result
