"""Bounded platform libc++ resize/capacity operations on the x86-64 ABI."""
from unicorn import x86_const as r
from libcpp_concat_native import read_libcpp_string

RESIZE_RVA = 0x1fee390
RESIZE_NAME = '__ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6resizeEmc'
RESERVE_RVA = 0x1fee3a2
RESERVE_NAME = '__ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE7reserveEm'
INSERT_RVA = 0x1fee384
INSERT_NAME = '__ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEE6insertEmPKcm'
COPY_RVA = 0x1fee3c6
COPY_NAME = '__ZNSt3__112basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEEaSERKS5_'


class NativeLibcppStringResize:
    def __init__(self, *args, **kwargs):
        self.libcpp_resize_calls = []
        self.libcpp_reserve_calls = []
        self.libcpp_insert_calls = []
        self.libcpp_copy_calls = []
        super().__init__(*args, **kwargs)
        if self.source.imports.get(RESIZE_RVA) != RESIZE_NAME:
            raise ValueError('Original libc++ string resize import differs')
        if self.source.imports.get(RESERVE_RVA) != RESERVE_NAME:
            raise ValueError('Original libc++ string reserve import differs')
        if self.source.imports.get(INSERT_RVA) != INSERT_NAME:
            raise ValueError('Original libc++ string insertion import differs')
        if self.source.imports.get(COPY_RVA) != COPY_NAME:
            raise ValueError('Original libc++ string copy assignment import differs')

    def imported(self, engine, address, size, user):
        at = address - self.base
        if at not in [RESIZE_RVA, RESERVE_RVA, INSERT_RVA, COPY_RVA]:
            return super().imported(engine, address, size, user)
        target = engine.reg_read(r.UC_X86_REG_RDI)
        length = engine.reg_read(r.UC_X86_REG_RSI)
        fill = engine.reg_read(r.UC_X86_REG_RDX) & 255
        caller = self.q(engine.reg_read(r.UC_X86_REG_RSP)) - self.base
        if not self.writable_file_memory(target, 24) or at != COPY_RVA and length > 0xffff:
            raise ValueError('libc++ resize escaped bounded owned string storage')
        long_storage = self.u.mem_read(target, 1)[0] & 1
        if long_storage:
            allocated, old_length, pointer = self.q(target) & ~1, self.q(target + 8), self.q(target + 16)
            if (not 0 < allocated <= 0x10000 or old_length >= allocated or
                    self.allocations.get(pointer, 0) < allocated or
                    not self.writable_file_memory(pointer, allocated)):
                raise ValueError('libc++ resize received an unowned long string')
            capacity = allocated - 1
        else:
            old_length = self.u.mem_read(target, 1)[0] >> 1
            if old_length > 22:
                raise ValueError('libc++ resize received an invalid inline string length')
            pointer, capacity = target + 1, 22
        before = bytes(self.u.mem_read(pointer, old_length))
        if self.u.mem_read(pointer + old_length, 1)[0]:
            raise ValueError('libc++ resize received a string without its terminator')
        insertion = None
        if at == COPY_RVA:
            contents = read_libcpp_string(self, length)
            new_length = len(contents)
            requested = new_length
        elif at == INSERT_RVA:
            position = length
            source, amount = engine.reg_read(r.UC_X86_REG_RDX), engine.reg_read(r.UC_X86_REG_RCX)
            if (position > old_length or amount > 0xffff - old_length or
                    amount and not self.library_pointer(source, amount)):
                raise ValueError('libc++ insertion escaped bounded source/position/length')
            insertion = bytes(self.u.mem_read(source, amount)) if amount else b''
            contents = before[:position] + insertion + before[position:]
            new_length = len(contents)
            requested = new_length
        else:
            contents = before if at == RESERVE_RVA else before[:length] + bytes([fill]) * max(0, length - old_length)
            new_length = old_length if at == RESERVE_RVA else length
            requested = length
        grew = requested > capacity
        if grew:
            # Same original constructor recommendation as the existing bounded
            # assignment adapter (0x11fe0). No game-return value is substituted.
            allocated = 26 if requested == 23 else (requested | 7) + 1
            pointer = self.allocate(allocated)
            self.put(target, 'QQQ', allocated | 1, new_length, pointer)
        elif long_storage:
            self.put(target + 8, 'Q', new_length)
        else:
            self.u.mem_write(target, bytes([new_length * 2]))
        self.u.mem_write(pointer, contents + b'\0')
        calls = self.libcpp_copy_calls if at == COPY_RVA else self.libcpp_insert_calls if at == INSERT_RVA else self.libcpp_reserve_calls if at == RESERVE_RVA else self.libcpp_resize_calls
        calls.append({'callerRva': caller, 'object': target,
                                         'beforeBytes': old_length, 'afterBytes': new_length,
                                         'sourceObject' if at == COPY_RVA else 'requestedCapacity' if at == RESERVE_RVA else 'position' if at == INSERT_RVA else 'requestedLength': length,
                                         'insertedBytes': len(insertion) if insertion is not None else None,
                                         'fillByte': fill, 'allocatedNewStorage': grew,
                                         'oldAllocationReclaimed': False,
                                         'platformLibraryBoundary': True})
        if at in [INSERT_RVA, COPY_RVA]:
            engine.reg_write(r.UC_X86_REG_RAX, target)
        self.ret()
