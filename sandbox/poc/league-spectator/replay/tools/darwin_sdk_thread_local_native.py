"""Two dyld-proven SDK TLV descriptors sharing each context's original template.

This is platform thread-local storage, not a supplied SDK pointer or readiness
value. Existing post-load/random TLV mappings remain independently owned.
"""
import struct
import unicorn
from unicorn import x86_const as r
from macho_pointer_bindings import pointer_bindings
from vfx_spawn_native import sha


def configure_sdk_thread_local(n, state):
    if getattr(n, 'sdk_thread_local', None) is not None:
        raise ValueError('SDK TLV platform ownership is not reentrant')
    selected = {n.base+0x2488328: {'offset': 112, 'callers': [0x1c65420, 0x1c65466]},
                n.base+0x2488340: {'offset': 176, 'callers': [0x1c65412, 0x1c65452]}}
    variables = [row for row in n.source.sections if row[0] == '__thread_vars']
    data = [row for row in n.source.sections if row[0] == '__thread_data']
    bss = [row for row in n.source.sections if row[0] == '__thread_bss']
    if len(variables) != 1 or len(data) != 1 or len(bss) != 1:
        raise ValueError('Exact original SDK TLS sections required')
    start, end = data[0][1], bss[0][1]+bss[0][2]
    bindings = pointer_bindings(n.source.binary)
    descriptors = []
    for descriptor, definition in selected.items():
        raw = bytes(n.source.image[descriptor-n.base:descriptor-n.base+24])
        binding = bindings.get(descriptor)
        offset = definition['offset']
        if (n.source.base != n.base or binding != {'symbol': '__tlv_bootstrap', 'addend': 0} or
                not variables[0][1] <= descriptor <= variables[0][1]+variables[0][2]-24 or
                (descriptor-variables[0][1]) % 24 or struct.unpack('<QQQ', raw) != (0, 0, offset) or
                not 0 < end-start <= 0x10000 or not bss[0][1] <= start+offset <= end-8 or
                bytes(n.u.mem_read(descriptor, 24)) != raw or descriptor in n.slots):
            raise ValueError('Original SDK descriptor/binding/template identity differs')
        definition['raw'] = raw
        descriptors.append({'descriptorRva': descriptor-n.base, 'descriptorHex': raw.hex(),
            'binding': binding, 'templateOffset': offset})
    template = bytes(n.source.image[start-n.base:end-n.base])
    public = {'descriptors': descriptors, 'templateRva': start-n.base, 'templateBytes': len(template),
        'templateSha256': sha(template), 'contexts': {}, 'calls': [],
        'nativeDarwinLoaderExecuted': False, 'sdkReadinessSupplied': False}
    cells = {}
    callback = None
    def returned(engine, address, size, user):
        caller = n.q(engine.reg_read(r.UC_X86_REG_RSP))-n.base
        owner = n.cooperative_active_thread
        descriptor = engine.reg_read(r.UC_X86_REG_RDI)
        definition = selected.get(descriptor)
        if (definition is None or n.q(descriptor) != callback or
                bytes(engine.mem_read(descriptor+8, 16)) != definition['raw'][8:] or
                caller not in definition['callers'] or len(public['calls']) >= 65536 or
                owner is not None and owner not in n.cooperative_threads or
                n.image[0x1c653f0:0x1c65480] != n.source.image[0x1c653f0:0x1c65480]):
            raise ValueError('Owned original SDK TLS descriptor/caller/context required')
        key = owner if owner is not None else 0
        if key not in cells:
            if len(cells) >= 9:
                raise ValueError('SDK TLS context quota exceeded')
            storage = n.allocate(len(template)+0x200)
            cell = storage+0x100
            engine.mem_write(storage, b'\xa5'*0x100)
            engine.mem_write(cell, template)
            engine.mem_write(cell+len(template), b'\xa5'*0x100)
            def reject_guard(uc, access, at, width, value, detail):
                raise ValueError('Original SDK TLS access escaped its source template')
            for begin in [storage, cell+len(template)]:
                for mode in [unicorn.UC_HOOK_MEM_READ, unicorn.UC_HOOK_MEM_WRITE]:
                    n.u.hook_add(mode, reject_guard, begin=begin, end=begin+0xff)
            cells[key] = cell
            public['contexts'][str(key)] = {'storage': storage, 'template': cell,
                'originalTemplateCopied': True}
        value = cells[key]+definition['offset']
        public['calls'].append({'context': key, 'callerRva': caller,
            'descriptorRva': descriptor-n.base, 'value': value})
        engine.reg_write(r.UC_X86_REG_RAX, value)
        n.ret()
    callback = n.allocate_native_callback('original-sdk-tlv-bootstrap', returned)
    for descriptor in selected:
        n.put(descriptor, 'Q', callback)
    n.sdk_thread_local = {'callback': callback, 'cells': cells, 'public': public}
    state['threadLocal'] = public
    return public
