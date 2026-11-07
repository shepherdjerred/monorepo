"""Original shared spell-preload manager construction for cold controls."""
from unicorn import x86_const as r
from character_script_native import NativeCharacterScripts
from vfx_spawn_native import ADDRESSES


class NativeSpellPreload(NativeCharacterScripts):
    def initialize_script_file_registry(self):
        if self.q(self.base+0x24712a0) or not self.q(self.base+0x246d7b0):
            raise ValueError('Script file registry needs an archive manager and no existing registry')
        self.u.context_restore(self.initial)
        self.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
        self.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack'])
        start = self.base+0x6770e0
        slices = []
        for index in range(64):
            self.u.emu_start(start,ADDRESSES['stop'],count=5000000)
            start = self.u.reg_read(r.UC_X86_REG_RIP)
            slices.append({'instructionBound':5000000,'stop':start})
            if start == ADDRESSES['stop']:break
        else:raise ValueError('Original script file registry exceeded 64 instruction slices')
        registry = self.q(self.base+0x24712a0)
        if self.allocations.get(registry) != 0x40 or not self.u32(registry+0x38):
            raise ValueError('Original script manifest registry did not load populated data')
        return {'object':registry,'factoryRva':0x6770e0,'originalConstructorCompleted':True,
                'instructionSlices':slices,'entriesCompared':False,'gameBindingsRegistered':False}

    def initialize_spell_preload_manager(self):
        if self.q(self.base+0x2472910):
            raise ValueError('Original spell-preload manager already exists')
        # Matching startup allocates 0x9f0 bytes at 0x66a50e and calls the
        # complete derived constructor, including its original base interfaces.
        manager = self.allocate(0xaf0)
        self.u.mem_write(manager+0x9f0,bytes([0xa5])*0x100)
        self.call(0x84dc50,{r.UC_X86_REG_RDI:manager})
        if (self.q(self.base+0x2472910) != manager or
                bytes(self.u.mem_read(manager+0x9f0,0x100)) != bytes([0xa5])*0x100):
            raise ValueError('Original spell-preload manager ownership/guard differs')
        primary,secondary = self.q(manager),self.q(manager+8)
        if primary != self.base+0x235a150 or secondary != self.base+0x235a1c0:
            raise ValueError('Original spell-preload manager interfaces differ')
        return {'object':manager,'constructorRva':0x84dc50,'allocatedObjectBytes':0x9f0,
                'originalConstructorCompleted':True,'guardIntact':True,
                'resourceRegistryReady':False,'liveWorldBindingsVerified':False}
