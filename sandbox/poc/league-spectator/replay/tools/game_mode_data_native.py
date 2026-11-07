"""Original GameModeMapData reflection and typed field loading.

Post-load/global installation and reference fixups are separate operations. A
loaded object with pending references is not a ready global data provider.
"""
from unicorn import x86_const as r
from appearance_resource_native import NativeAppearanceResources
from vfx_asset_native import REGISTRY,WRAPPER,STREAM,VTABLE,CALLBACK,CONTEXT,CACHE


class NativeGameModeData(NativeAppearanceResources):
    def __init__(self,*args):
        self.initializing_game_types = False
        self.initializing_spell_types = False
        self.game_type_zeroes = []
        self.clock_inputs = None
        self.clock_calls = []
        super().__init__(*args)
        self.initializing_game_types = self.initializing_resource_types = True
        try:
            self.call(0x4248b0,{})
        finally:
            self.initializing_game_types = self.initializing_resource_types = False
        count,array = self.u32(self.base+REGISTRY+8),self.q(self.base+REGISTRY)
        if not 653 <= count <= 4096:
            raise ValueError('Game mode reflection registry exceeds explicit bound')
        self.types = {}
        for i in range(count):
            descriptor = self.q(array+i*8)
            if not self.base+0x1fef000 <= descriptor <= self.base+len(self.image)-0x88:
                raise ValueError('Game mode type descriptor outside original data image')
            identity = self.u32(descriptor+8)
            if identity in self.types:
                raise ValueError('Duplicate original game mode type')
            self.types[identity] = descriptor
        self.type_catalog = self.catalog()
        if 0x89ce9636 not in self.types or self.q(self.types[0x89ce9636]+0x40) != 0x1e0:
            raise ValueError('Original GameModeMapData layout differs')

    def imported(self,uc,address,size,user):
        name = self.source.imports[address-self.base]
        if self.clock_inputs is not None and name in ['_mach_timebase_info','_mach_absolute_time']:
            # Standard platform ABI only, supplied explicitly for this control:
            # https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/osfmk/mach/mach_time.h
            clock = self.clock_inputs
            if not (type(clock['numer']) is int and type(clock['denom']) is int and
                    0 < clock['numer'] <= 0xffffffff and 0 < clock['denom'] <= 0xffffffff and
                    type(clock['ticks']) is int and 0 <= clock['ticks'] <= 0xffffffffffffffff):
                raise ValueError('Explicit bounded platform clock inputs required')
            caller = self.q(uc.reg_read(r.UC_X86_REG_RSP))-self.base
            if name == '_mach_timebase_info':
                destination = uc.reg_read(r.UC_X86_REG_RDI)
                if not (0x10000000 <= destination <= 0x12000000-8 or
                        self.base+0x1fef000 <= destination <= self.base+len(self.image)-8):
                    raise ValueError('Platform timebase output outside owned data/stack')
                self.put(destination,'II',clock['numer'],clock['denom'])
                uc.reg_write(r.UC_X86_REG_RAX,0)
            else:
                uc.reg_write(r.UC_X86_REG_RAX,clock['ticks'])
            self.clock_calls.append({'name':name,'callerRva':caller,**clock})
            self.ret()
            return
        if (self.initializing_game_types or self.initializing_spell_types) and name == '___bzero':
            target,count = uc.reg_read(r.UC_X86_REG_RDI),uc.reg_read(r.UC_X86_REG_RSI)
            caller = self.q(uc.reg_read(r.UC_X86_REG_RSP))-self.base
            allowed_caller = (self.initializing_game_types and 0x4248b0 <= caller < 0x42a450 or
                              self.initializing_spell_types and 0x870ae0 <= caller < 0x872630)
            if not (allowed_caller and 0 < count <= 0x100000 and
                    self.base+0x1fef000 <= target <= self.base+len(self.image)-count):
                raise ValueError('Game mode initializer zero exceeds its original caller/data bounds')
            self.u.mem_write(target,bytes(count))
            self.game_type_zeroes.append({'callerRva':caller,'targetRva':target-self.base,'bytes':count})
            self.ret()
            return
        return super().imported(uc,address,size,user)

    def initialize_spell_statics(self):
        self.initializing_spell_types = self.initializing_resource_types = True
        try:
            self.call(0x870ae0,{})
        finally:
            self.initializing_spell_types = self.initializing_resource_types = False
        pointer,count = self.q(self.base+0x2568640),self.u32(self.base+0x2568648)
        if not count or count > 256 or not self.library_pointer(pointer,count*0x150):
            raise ValueError('Original default spell settings stack differs')
        return {'stack':pointer,'count':count,'top':pointer+(count-1)*0x150,
                'topHex':bytes(self.u.mem_read(pointer+(count-1)*0x150,0x150)).hex()}

    def read_typed_fields(self,type_hash,fields):
        if type_hash not in self.types:
            raise ValueError('Original game mode class is unregistered')
        descriptor = self.types[type_hash]
        size = self.q(descriptor+0x40)
        if not 0 < size <= 0x10000:
            raise ValueError('Game mode typed allocation exceeds explicit bound')
        obj = self.allocate(size)
        self.u.mem_write(WRAPPER,bytes(0x500))
        self.put(WRAPPER,'Q',STREAM)
        self.put(STREAM,'Q',VTABLE)
        for i,offset in enumerate([0x10,0x28,0x30]):
            self.put(VTABLE+offset,'Q',CALLBACK+i*16)
        self.ignored,self.mismatched,self.stream_calls = [],[],[]
        self.loading = True
        try:
            self.call(self.q(descriptor+0x20)-self.base,{r.UC_X86_REG_RDI:obj})
            for field in fields:
                self.input,self.cursor = field,0
                self.put(CACHE,'Q',0)
                self.call(0x14bc830,{r.UC_X86_REG_RDI:CONTEXT,r.UC_X86_REG_RSI:obj,
                    r.UC_X86_REG_RDX:descriptor,r.UC_X86_REG_RCX:WRAPPER,r.UC_X86_REG_R8:CACHE})
                if self.cursor != len(field):
                    raise ValueError('Original game mode field left unread bytes')
        finally:
            self.loading = False
        if self.ignored or self.mismatched:
            raise ValueError('Original game mode reader skipped/mismatched fields')
        pending_count,pending_ptr = self.u32(CONTEXT+0x10),self.q(CONTEXT+8)
        if pending_count > 65536 or pending_count and not self.library_pointer(pending_ptr,pending_count*16):
            raise ValueError('Game mode pending references outside owned arena')
        return {'object':obj,'typeHash':type_hash,'size':size,'objectHex':bytes(self.u.mem_read(obj,size)).hex(),
                'fields':len(fields),'streamCalls':len(self.stream_calls),'pendingReferences':[
                    {'destination':self.q(pending_ptr+i*16),'expectedType':self.q(pending_ptr+i*16+8),
                     'identity':self.q(self.q(pending_ptr+i*16))} for i in range(pending_count)]}

    def build_constant_index(self,mode,constants,mode_hash):
        provider = mode['object']
        links = [link for link in mode['pendingReferences'] if link['destination'] == provider+0x178]
        if len(links) != 1 or self.u32(provider+8) != mode_hash:
            raise ValueError('One original constants reference and matching recorded mode required')
        link = links[0]
        if link['identity'] != constants['identity'] or constants['loaded']['pendingReferences']:
            raise ValueError('Matching self-contained typed constants root required')
        loaded = constants['loaded']
        descriptor = self.types[loaded['typeHash']]
        # A one-reference fixup context uses the original queued destination and
        # expected descriptor. Other GameModeMapData references remain pending.
        library,table,context,pending = self.allocate(0x48),self.allocate(24),self.allocate(24),self.allocate(16)
        self.put(table,'QQII',loaded['object'],descriptor,link['identity'],0)
        self.put(library+0x10,'QII',table,1,1)
        self.put(pending,'QQ',link['destination'],link['expectedType'])
        self.put(context,'QQII',library,pending,1,1)
        self.call(0x14bbf40,{r.UC_X86_REG_RDI:context})
        if self.q(provider+0x178) != loaded['object'] or self.u32(context+0x10):
            raise ValueError('Original constants reference fixup did not complete')
        self.call(0x409d00,{r.UC_X86_REG_RDI:provider})
        # Original mode hash store and post-load guard/global installation,
        # stopping before configuration callbacks at 4098d0.
        self.call(0x60b9ee,{r.UC_X86_REG_RSI:mode_hash},0x60b9f4)
        self.call(0x409890,{r.UC_X86_REG_RDI:provider},0x4098d0)
        if self.q(self.base+0x2561d18) != provider:
            raise ValueError('Original global provider installation prefix differs')
        return {'provider':provider,'constants':loaded['object'],'fixedReference':link,
                'remainingModeReferences':len(mode['pendingReferences'])-1,
                'indexBuckets':self.q(provider+0x190),'indexEntries':self.q(provider+0x1a0),
                'fullGlobalPostloadExecuted':False}
