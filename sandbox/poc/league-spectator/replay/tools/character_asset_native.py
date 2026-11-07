"""Character asset reader with owned single-thread recursive-mutex services.

Reuse the existing VFX manager's Darwin attribute ABI model. Game classes,
asset readers, callbacks and post-load code remain original.
"""
from unicorn import x86_const as r
import unicorn
from game_mode_data_native import NativeGameModeData
from vfx_object_native import NativeVfxObjects
from vfx_spawn_native import ADDRESSES
from vfx_asset_native import REGISTRY,WRAPPER,STREAM,VTABLE,CALLBACK,CONTEXT,CACHE


class NativeCharacterAssets(NativeGameModeData):
    def __init__(self,*args):
        self.object_attrs,self.object_os_calls,self.character_mutexes = {},[],{}
        self.character_field_frames = {}
        self.character_outer_field = None
        super().__init__(*args)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.observe_field_owner,
                        begin=self.base+0x14bc830,end=self.base+0x14bc830)
        self.u.ctl_remove_cache(self.base+0x14bc830,self.base+0x14bc9a0)

    def initialize_character_types(self):
        self.initializing_resource_types = True
        try:
            for initializer in [0x2cf7f0,0x308480,0x31e9e0,0x3823d0,0x333850,
                                0x2db820,0x3622a0,0x61c280,0x1805890,0x35db20,0x724c20,
                                0x1879930,0x2584f0,0x85bf50,0x15dcbc0,0x14e4060,0xf58f40,0x78ed80,
                                0x136970,0xa1e80,0x8ad000,0x570f40,0x8cf820,0xf9dc10,0x16a7960,0x8d9c30,
                                0x8382f0,0x1f2e40,0x888d80,0x78100,0x5d4eb0,0xb70610,0x344db0,0x7a4a50]:
                try:
                    self.call(initializer,{})
                except Exception as exception:
                    raise ValueError('Character initializer %x stopped at %x: %s' %
                                     (initializer,self.u.reg_read(r.UC_X86_REG_RIP)-self.base,exception)) from exception
            # Original caller LEA+CALL pairs supply the actual static descriptor
            # destinations to their complete constructors. The surrounding
            # audio/catalog modules' unrelated initialization is not executed.
            for start,end in [(0x23391c,0x233928),(0x233942,0x23394e),(0x29f193,0x29f19f)]:
                self.call(start,{},end)
        finally:
            self.initializing_resource_types = False
        count,array = self.u32(self.base+REGISTRY+8),self.q(self.base+REGISTRY)
        if not 821 <= count <= 4096:
            raise ValueError('Original character reflection registry exceeds bounds')
        self.types = {}
        for i in range(count):
            descriptor = self.q(array+i*8)
            if not self.base+0x1fef000 <= descriptor <= self.base+len(self.image)-0x88 or self.u32(descriptor+8) in self.types:
                raise ValueError('Original character descriptor is unowned or duplicated')
            self.types[self.u32(descriptor+8)] = descriptor
        self.type_catalog = self.catalog()
        return count

    def observe_field_owner(self,uc,address,size,user):
        self.character_field_frames[uc.reg_read(r.UC_X86_REG_RSP)] = uc.reg_read(r.UC_X86_REG_RDX)

    def unknown_property(self,uc,address,size,user):
        super().unknown_property(uc,address,size,user)
        frame = uc.reg_read(r.UC_X86_REG_RBP)+8
        descriptor = self.character_field_frames.get(frame)
        if descriptor is None or not self.base+0x1fef000 <= descriptor <= self.base+len(self.image)-0x88:
            raise ValueError('Unknown-field observation lacks an original owning descriptor')
        self.ignored[-1].update(ownerTypeHash=self.u32(descriptor+8),outerFieldHash=self.character_outer_field,
                                originalSkipRva=0x14bc954)

    def read_actor_field(self,obj,descriptor):
        # Large authored animation graphs exceed the small spawn probe's
        # five-million-instruction call budget. Resume the same original reader
        # in bounded slices, requiring serialized-byte progress in each slice.
        self.u.context_restore(self.initial)
        self.put(ADDRESSES['stack'],'Q',ADDRESSES['stop'])
        self.u.reg_write(r.UC_X86_REG_RSP,ADDRESSES['stack'])
        for register,value in {r.UC_X86_REG_RDI:CONTEXT,r.UC_X86_REG_RSI:obj,r.UC_X86_REG_RDX:descriptor,
                               r.UC_X86_REG_RCX:WRAPPER,r.UC_X86_REG_R8:CACHE}.items():
            self.u.reg_write(register,value)
        start = self.base+0x14bc830
        progress = []
        for index in range(16):
            before = self.cursor
            self.u.emu_start(start,ADDRESSES['stop'],count=5000000)
            start = self.u.reg_read(r.UC_X86_REG_RIP)
            progress.append(self.cursor-before)
            if start == ADDRESSES['stop']:
                return {'instructionSliceBound':5000000,'slices':index+1,'serializedBytesPerSlice':progress}
            if self.cursor <= before:
                raise ValueError('Original actor reader exhausted instruction slice without input progress')
        raise ValueError('Original actor reader exceeded sixteen bounded instruction slices')

    def observe_actor_fields(self,type_hash,fields):
        # Observation contract: native skips are returned explicitly and never
        # relabeled as complete fields or ready assets. Type mismatches fail.
        descriptor = self.types[type_hash]
        size = self.q(descriptor+0x40)
        if not 0 < size <= 0x10000:
            raise ValueError('Actor typed allocation exceeds explicit bound')
        obj = self.allocate(size)
        self.u.mem_write(WRAPPER,bytes(0x500))
        self.put(WRAPPER,'Q',STREAM)
        self.put(STREAM,'Q',VTABLE)
        for i,offset in enumerate([0x10,0x28,0x30]):
            self.put(VTABLE+offset,'Q',CALLBACK+i*16)
        self.ignored,self.mismatched,self.stream_calls = [],[],[]
        field_runs = []
        self.loading = True
        try:
            self.call(self.q(descriptor+0x20)-self.base,{r.UC_X86_REG_RDI:obj})
            for field in fields:
                self.character_outer_field = int.from_bytes(field[:4],'little')
                self.input,self.cursor = field,0
                self.put(CACHE,'Q',0)
                field_runs.append(self.read_actor_field(obj,descriptor))
                if self.cursor != len(field):
                    raise ValueError('Actor observation left unread authored bytes')
        finally:
            self.loading = False
            self.character_outer_field = None
        if self.mismatched:
            raise ValueError('Original actor reader encountered a type mismatch')
        count,pointer = self.u32(CONTEXT+0x10),self.q(CONTEXT+8)
        if count > 65536 or count and not self.library_pointer(pointer,count*16):
            raise ValueError('Actor pending reference queue exceeds owned bounds')
        return {'object':obj,'typeHash':type_hash,'size':size,'objectHex':bytes(self.u.mem_read(obj,size)).hex(),
                'fields':len(fields),'fieldExecutions':field_runs,'originalSkippedFields':list(self.ignored),'assetReady':False,
                'pendingReferences':[{'destination':self.q(pointer+i*16),'expectedType':self.q(pointer+i*16+8),
                                      'identity':self.q(self.q(pointer+i*16))} for i in range(count)]}

    def imported(self,uc,address,size,user):
        name = self.source.imports[address-self.base]
        first,second = uc.reg_read(r.UC_X86_REG_RDI),uc.reg_read(r.UC_X86_REG_RSI)
        if name == '_wcslen':
            # Darwin wide-code-unit scanning; do not call Windows' 16-bit CRT.
            # https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/wcslen.3.html
            for count in range(4096):
                at = first+count*4
                if not self.library_pointer(at,4):
                    raise ValueError('Wide string escaped original owned memory')
                if self.u32(at) == 0:
                    self.object_os_calls.append({'name':name,'source':first,'units':count,'unitBytes':4})
                    uc.reg_write(r.UC_X86_REG_RAX,count)
                    self.ret()
                    return
            raise ValueError('Wide string exceeds explicit unit bound')
        if name in ['_memset_pattern16','_pthread_mutexattr_init','_pthread_mutexattr_settype','_pthread_mutexattr_destroy']:
            return NativeVfxObjects.imported(self,uc,address,size,user)
        if name == '_pthread_mutex_init' and second in self.object_attrs:
            if (first in self.character_mutexes or first in self.mutexes or
                    not (self.base+0x1fef000 <= first <= self.base+len(self.image)-64 or
                         0x10400000 <= first <= self.next_heap-64 or
                         ADDRESSES['stack']-0x8000 <= first <= ADDRESSES['stack']-64)):
                raise ValueError('Unowned character mutex initialization')
            self.character_mutexes[first] = {'recursive':self.object_attrs[second] == 2,'depth':0}
        elif name in ['_pthread_mutex_lock','_pthread_mutex_unlock'] and first in self.character_mutexes:
            mutex = self.character_mutexes[first]
            if name == '_pthread_mutex_lock':
                if mutex['depth'] and not mutex['recursive']:
                    raise ValueError('Nonrecursive character mutex reentry')
                mutex['depth'] += 1
            else:
                if not mutex['depth']:
                    raise ValueError('Unlock of unowned character mutex')
                mutex['depth'] -= 1
        else:
            return super().imported(uc,address,size,user)
        self.object_os_calls.append({'name':name,'mutex':first,'argument':second})
        uc.reg_write(r.UC_X86_REG_RAX,0)
        self.ret()
