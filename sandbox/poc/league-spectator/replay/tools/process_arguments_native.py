"""Original argument parsing/product construction over a bounded Foundation ABI.

Only supplied process-argument strings are exposed. No live command line or
credentials are read, and no game configuration field is assigned by the host.
"""
import unicorn
from unicorn import x86_const as r


def initialize_product_configuration(n, product):
    if product not in ['LoL', 'TFT']:
        raise ValueError('Explicit admitted product control required')
    if n.q(n.base + 0x24728c0) or n.q(n.base + 0x256cdb8):
        raise ValueError('Original product and process-argument globals must be cold')
    if n.source.data_imports.get(0x22e0408) != '_objc_msgSend':
        raise ValueError('Original Foundation message import differs')
    arguments = ['LeagueofLegends', '-Product=' + product]
    values = [n.allocate_text(value) for value in arguments]
    tokens = {name: n.allocate(8) for name in ['class', 'process', 'array', 'arg0', 'arg1']}
    messages = []
    callback = n.allocate(16)
    n.u.mem_write(callback, b'\xc3')
    def message(engine, address, size, user):
        receiver = engine.reg_read(r.UC_X86_REG_RDI)
        selector = n.cstring(engine.reg_read(r.UC_X86_REG_RSI)).decode('ascii')
        argument = engine.reg_read(r.UC_X86_REG_RDX)
        if receiver == tokens['class'] and selector == 'processInfo':
            result = tokens['process']
        elif receiver == tokens['process'] and selector == 'arguments':
            result = tokens['array']
        elif receiver == tokens['array'] and selector == 'count':
            result = len(arguments)
        elif receiver == tokens['array'] and selector == 'objectAtIndex:' and argument < len(arguments):
            result = tokens['arg' + str(argument)]
        elif receiver in [tokens['arg0'], tokens['arg1']] and selector == 'UTF8String':
            result = values[receiver == tokens['arg1']]
        else:
            raise ValueError('Unadmitted process-argument Foundation message: ' + selector)
        messages.append({'receiver': receiver, 'selector': selector, 'result': result})
        engine.reg_write(r.UC_X86_REG_RAX, result)
        n.ret()
    hook = n.u.hook_add(unicorn.UC_HOOK_CODE, message, begin=callback, end=callback)
    objc_import = n.base + 0x22e0408
    process_class = n.base + 0x246b6d8
    original_import, original_class = n.q(objc_import), n.q(process_class)
    argument_object, configuration = n.allocate(0x110), n.allocate(0x118)
    n.u.mem_write(argument_object + 0x10, b'\xa5' * 0x100)
    n.u.mem_write(configuration + 0x18, b'\xa5' * 0x100)
    try:
        n.put(objc_import, 'Q', callback)
        n.put(process_class, 'Q', tokens['class'])
        n.call(0x14d94f0, {r.UC_X86_REG_RDI: argument_object})
        if n.q(n.base + 0x256cdb8) != argument_object or n.u32(argument_object + 8) != len(arguments):
            raise ValueError('Original process-argument constructor did not retain its complete supplied vector')
        n.call(0x61e0c0, {r.UC_X86_REG_RDI: configuration, r.UC_X86_REG_RSI: argument_object})
        if (n.q(n.base + 0x24728c0) != configuration or
                n.u32(configuration + 8) != {'LoL': 1, 'TFT': 2}[product] or
                n.u.mem_read(configuration + 0x10, 1)[0] != 1):
            raise ValueError('Original product consumer did not select the supplied recognized product')
        for pointer, offset in [(argument_object, 0x10), (configuration, 0x18)]:
            if bytes(n.u.mem_read(pointer + offset, 0x100)) != b'\xa5' * 0x100:
                raise ValueError('Original process/product constructor escaped its allocation')
    finally:
        n.put(objc_import, 'Q', original_import)
        n.put(process_class, 'Q', original_class)
        n.u.hook_del(hook)
    return {'argumentObject': argument_object, 'configuration': configuration,
            'suppliedArguments': arguments, 'product': product, 'nativeProduct': n.u32(configuration + 8),
            'originalArgumentConstructorRva': 0x14d94f0, 'originalProductConstructorRva': 0x61e0c0,
            'foundationMessages': messages, 'configurationHex': bytes(n.u.mem_read(configuration, 0x18)).hex(),
            'scope': {'completeOriginalConstructors': True, 'platformArgumentStringsSupplied': True,
                      'actualProcessArgumentsRecovered': False, 'gameConfigurationFieldsSupplied': False,
                      'acceptedReplayState': False, 'mainViewerExpanded': False}}
