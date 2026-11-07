"""Platform stack-page probe used by the original concrete hero constructor."""
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES


class NativeHeroStackProbe:
    def __init__(self, *args, **kwargs):
        self.hero_stack_probes = []
        super().__init__(*args, **kwargs)

    def imported(self, engine, address, size, user):
        if self.source.imports[address - self.base] == '____chkstk_darwin':
            count = engine.reg_read(r.UC_X86_REG_RAX)
            stack = engine.reg_read(r.UC_X86_REG_RSP)
            caller = self.q(stack) - self.base
            if caller == 0x154c28 and count == 0x12c8:
                if not ADDRESSES['stack'] - 0x8000 <= stack - count <= stack <= ADDRESSES['stack']:
                    raise ValueError('Original hero stack probe escaped its owned stack')
                for at in range(stack - count, stack + 1, 4096):
                    engine.mem_read(at, 1)
                self.hero_stack_probes.append({'callerRva': caller, 'bytes': count, 'stack': stack})
                self.ret()
                return
        return super().imported(engine, address, size, user)
