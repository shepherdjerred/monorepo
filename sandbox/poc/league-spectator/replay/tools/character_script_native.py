"""Original character-script VM bootstrap, without supplied game bindings."""
from unicorn import x86_const as r
from wad_file_native import NativeWadFiles


class NativeCharacterScripts(NativeWadFiles):
    def __init__(self,*args):
        self.script_jumps = {}
        self.script_jump_calls = []
        self.script_strtok_cursor = 0
        super().__init__(*args)

    def imported(self,uc,address,size,user):
        name = self.source.imports[address-self.base]
        if name == '_strtok':
            first,second = uc.reg_read(r.UC_X86_REG_RDI),uc.reg_read(r.UC_X86_REG_RSI)
            delimiters = set(self.cstring(second))
            cursor = first or self.script_strtok_cursor
            result = 0
            if cursor:
                text = self.cstring(cursor)
                start = 0
                while start < len(text) and text[start] in delimiters:start += 1
                if start < len(text):
                    end = start
                    while end < len(text) and text[end] not in delimiters:end += 1
                    result = cursor+start
                    if end < len(text):
                        if not self.writable_file_memory(cursor+end,1):
                            raise ValueError('Script tokenizer delimiter escaped writable input')
                        uc.mem_write(cursor+end,b'\0')
                        self.script_strtok_cursor = cursor+end+1
                    else:self.script_strtok_cursor = 0
                else:self.script_strtok_cursor = 0
            uc.reg_write(r.UC_X86_REG_RAX,result)
            self.ret()
            return
        if name == '___tolower':
            value = uc.reg_read(r.UC_X86_REG_RDI)&0xffffffff
            if value != 0xffffffff and value > 255:
                raise ValueError('Script C-locale case conversion received an invalid character')
            uc.reg_write(r.UC_X86_REG_RAX,value+32 if 65 <= value <= 90 else value)
            self.ret()
            return
        if name not in ['__setjmp','__longjmp']:
            return super().imported(uc,address,size,user)
        buffer = uc.reg_read(r.UC_X86_REG_RDI)
        stack = uc.reg_read(r.UC_X86_REG_RSP)
        # The caller's original Lua_longjmp embeds a 148-byte Darwin jmp_buf.
        # Its storage is opaque: register contexts live in this single-thread
        # platform model, not invented game memory or replacement callbacks.
        if not self.writable_file_memory(buffer,148):
            raise ValueError('Script nonlocal-jump buffer escaped owned memory')
        if name == '__setjmp':
            if buffer not in self.script_jumps and len(self.script_jumps) >= 128:
                raise ValueError('Script nonlocal-jump contexts exceeded bounds')
            target = self.q(stack)
            if not self.base <= target < self.base+0x1fef000:
                raise ValueError('Script setjmp return is not original executable code')
            self.script_jumps[buffer] = {'context':uc.context_save(),'stack':stack,'target':target}
            self.script_jump_calls.append({'name':name,'buffer':buffer,'stack':stack,'target':target})
            uc.reg_write(r.UC_X86_REG_RAX,0)
            self.ret()
        else:
            saved = self.script_jumps.get(buffer)
            if saved is None or not 0x10000000 <= stack <= saved['stack'] <= 0x10010000:
                raise ValueError('Script longjmp target is absent or outside its active stack')
            value = uc.reg_read(r.UC_X86_REG_RSI)&0xffffffff
            uc.context_restore(saved['context'])
            uc.reg_write(r.UC_X86_REG_RAX,value or 1)
            uc.reg_write(r.UC_X86_REG_RSP,saved['stack']+8)
            uc.reg_write(r.UC_X86_REG_RIP,saved['target'])
            self.script_jump_calls.append({'name':name,'buffer':buffer,'value':value or 1})

    def initialize_character_script_vm(self):
        if self.q(self.base+0x246cfb8) or self.q(self.base+0x255b830):
            raise ValueError('Character-script VM already exists')
        if not self.u.mem_read(self.base+0x2516728,1)[0]:
            self.call(0x149a5c0,{})
        mutex = self.base+0x256c2e0
        if mutex in self.mutexes or mutex in self.character_mutexes:
            raise ValueError('Archive decompression mutex was already initialized')
        # Independent original LEA/MOV/XOR/CALL pair from the global module
        # initializer. No filesystem randomness or unrelated globals run here.
        self.call(0x14736c2,{},0x14736d3)
        if mutex not in self.mutexes or self.mutexes[mutex]:
            raise ValueError('Original decompression mutex did not initialize unlocked')
        # The preload reader queries this settings tree. Construct its real
        # default object only when the original client configuration has not
        # already constructed it. Preserve an existing owned instance, including
        # any settings entries. Its presence is not proof of live overrides.
        settings = self.q(self.base+0x246d620)
        reused_settings = bool(settings)
        if not settings:
            settings = self.allocate(0x70)
            self.call(0x404b10,{r.UC_X86_REG_RDI:settings})
        if (self.q(self.base+0x246d620) != settings or self.allocations.get(settings) != 0x70 or
                self.q(settings) != self.base+0x404b22+0x1f21cee):
            raise ValueError('Original script settings ownership/class differs')
        # The original caller at 0x669f12 allocates precisely eight bytes.
        # Its complete constructor publishes both service and Lua state.
        service = self.allocate(0x108)
        self.u.mem_write(service+8,bytes([0xa5])*0x100)
        self.call(0x1e8ff0,{r.UC_X86_REG_RDI:service})
        if (self.q(self.base+0x246cfb8) != service or
                bytes(self.u.mem_read(service+8,0x100)) != bytes([0xa5])*0x100):
            raise ValueError('Original script service ownership/guard differs')
        state = self.q(self.base+0x255b830)
        if not self.library_pointer(state,0xc0):
            raise ValueError('Original script constructor did not publish an owned Lua state')
        if self.q(self.base+0x246d620) != settings:
            raise ValueError('Original script VM replaced its settings instance')
        return {'service':service,'state':state,'constructorRva':0x1e8ff0,
                'originalConstructorCompleted':True,'guardIntact':True,
                'decompressionMutexOriginalPrefixExecuted':True,
                'originalDefaultSettingsConstructed':not reused_settings,'settings':settings,
                'existingSettingsReused':reused_settings,'settingsOwnerClassVerified':True,
                'liveSettingsOverridesRecovered':False,
                'gameBindingsRegistered':False,'worldBindingsVerified':False}
