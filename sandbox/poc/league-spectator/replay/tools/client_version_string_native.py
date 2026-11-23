"""Scoped integer-to-string library ABI using the original string constructor."""
from unicorn import x86_const as r
from libcpp_concat_native import read_libcpp_string


class NativeClientVersionString:
    def imported(self, engine, address, size, user):
        if self.source.imports[address-self.base] != '__ZNSt3__19to_stringEi':
            return super().imported(engine, address, size, user)
        stack = engine.reg_read(r.UC_X86_REG_RSP)
        caller = self.q(stack)-self.base
        destination = engine.reg_read(r.UC_X86_REG_RDI)
        value = engine.reg_read(r.UC_X86_REG_RSI)
        if (caller not in [0x14dc859, 0x14dc8a2, 0x14dc92f, 0x14dc9ba] or value > 65535 or
                not self.writable_file_memory(destination, 24) or
                self.image[0x14dc820:0x14dc9ba] != self.source.image[0x14dc820:0x14dc9ba]):
            raise ValueError('Unowned original version integer-to-string caller/argument')
        if getattr(self, 'pending_version_string', None) is not None:
            raise ValueError('Reentrant original version string constructor')
        calls = getattr(self, 'client_version_string_calls', [])
        if len(calls) >= 4096:
            raise ValueError('Original version integer-string call quota exceeded')
        data = str(value).encode('ascii')
        source = self.allocate_text(data.decode('ascii'))
        if not hasattr(self, 'version_string_return'):
            self.version_string_return = self.allocate_native_callback('client-version-string-return', self.finish_version_string)
        row = {'value': value, 'callerRva': caller, 'destination': destination,
               'originalStringConstructorRva': 0x11fe0, 'completed': False, 'expectedHex': data.hex()}
        calls.append(row)
        self.client_version_string_calls = calls
        self.pending_version_string = {'stack': stack, 'row': row}
        self.put(stack-16, 'Q', self.version_string_return)
        for register, argument in {r.UC_X86_REG_RDI: destination, r.UC_X86_REG_RSI: source,
                r.UC_X86_REG_RDX: len(data), r.UC_X86_REG_RSP: stack-16,
                r.UC_X86_REG_RIP: self.base+0x11fe0}.items():
            engine.reg_write(register, argument)

    def finish_version_string(self, engine, address, size, user):
        pending = self.pending_version_string
        if pending is None or engine.reg_read(r.UC_X86_REG_RSP) != pending['stack']-8:
            raise ValueError('Original version string constructor lost its owned continuation')
        row = pending['row']
        data = read_libcpp_string(self, row['destination'])
        if data.hex() != row['expectedHex']:
            raise ValueError('Original version string constructor output differs')
        row.update(completed=True, actualHex=data.hex())
        engine.reg_write(r.UC_X86_REG_RAX, row['destination'])
        engine.reg_write(r.UC_X86_REG_RSP, pending['stack'])
        self.pending_version_string = None
        self.ret()
