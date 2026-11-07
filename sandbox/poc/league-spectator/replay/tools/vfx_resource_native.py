"""Owned native resource-context components for effect activation research.

The material cache constructor executes completely. The texture manager executes
its original independent initialization prefix, stopping before graphics-provider
queries and default texture creation. Those dependencies are not replaced.
"""
import struct
from unicorn import x86_const as r
from vfx_object_native import NativeVfxObjects, MANAGER
from vfx_spawn_native import ADDRESSES as A

TEXTURE_MANAGER_PREFIX=(0x17e2301,0x17e240c)
MATERIAL_CACHE_CONSTRUCTOR=0x17c3fd0
TEXTURE_MANAGER_GLOBAL=0x246fdf0
MATERIAL_CACHE_GLOBAL=0x247c9c0
RESOURCE_MANAGER_INPUT_BLOCKS=[(0x1745440,0x17454fb),(0x1745581,0x1745591),
    (0x1745693,0x17456a3),(0x17456d4,0x17456f7)]


class NativeVfxResourceContext(NativeVfxObjects):
    def load_prepared_system(self,graph):
        super().load_prepared_system(graph)
        self.resource_mutexes={}
        self.texture_manager=None
        self.material_cache=None
        self.clock_context=None
        self.clock_timebase=None

    def imported(self,uc,address,size,user):
        name=self.source.imports[address-self.base]
        first=self.u.reg_read(r.UC_X86_REG_RDI)
        if name=='_mach_timebase_info':
            if self.clock_timebase is None or not A['stack']-0x100<=first<=A['stack']-8:
                raise ValueError('Unowned clock timebase request')
            self.put(first,'II',*self.clock_timebase)
            self.object_os_calls.append({'name':name,'numer':self.clock_timebase[0],'denom':self.clock_timebase[1]})
            self.u.reg_write(r.UC_X86_REG_RAX,0);self.ret();return
        owner=next((at for at,n in self.allocations.items()
            if (n==0x108 and first==at+0x10) or (n==0x2c0 and first==at+0x98)),None)
        if owner is None or name not in ['_pthread_mutex_init','_pthread_mutex_lock','_pthread_mutex_unlock']:
            return super().imported(uc,address,size,user)
        if name=='_pthread_mutex_init':
            attributes=self.u.reg_read(r.UC_X86_REG_RSI)
            if first in self.resource_mutexes or (attributes and attributes not in self.object_attrs):
                raise ValueError('Invalid owned resource/parent mutex initialization')
            self.resource_mutexes[first]={'recursive':bool(attributes and self.object_attrs[attributes]==2),'depth':0}
        else:
            mutex=self.resource_mutexes.get(first)
            if mutex is None:raise ValueError('Uninitialized owned resource/parent mutex')
            if name=='_pthread_mutex_lock':
                if mutex['depth'] and not mutex['recursive']:raise ValueError('Nonrecursive resource mutex reentry')
                mutex['depth']+=1
            else:
                if not mutex['depth']:raise ValueError('Unlock of unowned resource mutex')
                mutex['depth']-=1
        self.object_os_calls.append({'name':name,'owner':owner,'mutex':first,**self.resource_mutexes[first]})
        self.u.reg_write(r.UC_X86_REG_RAX,0);self.ret()

    def initialize_resource_context(self,quality,graphics34b):
        if quality not in [0,1,2,3] or type(graphics34b) is not bool:
            raise ValueError('Explicit resource quality and graphics predicate required')
        # Extend the existing owned object manager with its independent original
        # cache/list/flag initializers. The full constructor starts a platform
        # worker pool; it is not replaced by fake successful thread creation.
        self.initialize_owned_manager(quality,graphics34b)
        for start,end in RESOURCE_MANAGER_INPUT_BLOCKS:
            self.fragment(start,end,{r.UC_X86_REG_RDI:MANAGER,r.UC_X86_REG_RSI:0,
                r.UC_X86_REG_RBX:MANAGER,r.UC_X86_REG_XMM0:0,
                r.UC_X86_REG_RBP:A['stack']-8,r.UC_X86_REG_RSP:A['stack']-0xe8})
        self.call(0x1474a30,{r.UC_X86_REG_RDI:0x108})
        self.texture_manager=self.u.reg_read(r.UC_X86_REG_RAX)
        self.fragment(*TEXTURE_MANAGER_PREFIX,{r.UC_X86_REG_RDI:self.texture_manager,
            r.UC_X86_REG_RBP:A['stack']-8,r.UC_X86_REG_RSP:A['stack']-0xa0})
        self.call(0x1474a30,{r.UC_X86_REG_RDI:0x90})
        self.material_cache=self.u.reg_read(r.UC_X86_REG_RAX)
        self.call(MATERIAL_CACHE_CONSTRUCTOR,{r.UC_X86_REG_RDI:self.material_cache})
        if self.q(self.base+TEXTURE_MANAGER_GLOBAL)!=self.texture_manager or self.q(self.base+MATERIAL_CACHE_GLOBAL)!=self.material_cache:
            raise ValueError('Original resource singleton publication differs')
        return self.resource_context_state()

    def resource_context_state(self):
        if self.texture_manager is None or self.material_cache is None:
            raise ValueError('Native resource context is not initialized')
        if any(m['depth'] for m in [*self.resource_mutexes.values(),*self.object_mutexes.values()]):
            raise ValueError('Resource context retained a mutex lock')
        return {'textureManager':self.texture_manager,'materialCache':self.material_cache,
            'textureManagerHex':bytes(self.u.mem_read(self.texture_manager,0x108)).hex(),
            'materialCacheHex':bytes(self.u.mem_read(self.material_cache,0x90)).hex(),
            'mutexes':{at:dict(mutex) for at,mutex in self.resource_mutexes.items()},
            'scope':{'fullMaterialCacheConstructor':True,'textureManagerPrefix':True,
                'fullTextureManagerConstructor':False,'graphicsProvider':False,
                'defaultTexturesCreated':False,'gameCallbacksReplaced':False}}

    def supply_clock_inputs(self,ticks,mode,timebase):
        """Supply the exact data-only clock-reader ABI; never replace its getter.

        Three explicit clocks correspond to the original selector's +0x10,
        +0x18 and +0x20 inputs. Their match provenance remains a caller concern.
        """
        if len(ticks)!=3 or any(type(t) is not int or not 0<=t<2**63 for t in ticks) or mode not in [0,1,2]:
            raise ValueError('Three explicit nonnegative clock ticks and selector mode required')
        if len(timebase)!=2 or any(type(t) is not int or not 0<t<2**32 for t in timebase):
            raise ValueError('Explicit Darwin numerator/denominator timebase required')
        if self.clock_timebase is not None and self.clock_timebase!=tuple(timebase):
            raise ValueError('Clock timebase cannot change within one owned world')
        self.clock_timebase=tuple(timebase)
        self.call(0x14db4b0,{})
        frequency=self.u.reg_read(r.UC_X86_REG_RAX)
        if not 0<frequency<2**63:raise ValueError('Unadmitted native clock frequency')
        self.fragment(0x15eaeac,0x15eaf0a,{r.UC_X86_REG_RAX:frequency})
        context=self.allocate(0x50,0xa5);selector=self.allocate(0x10,0xa5)
        self.put(context+0x48,'Q',selector);self.put(selector+8,'B',mode)
        for offset,value in zip([0x10,0x18,0x20],ticks):
            wrapper=self.allocate(0x10,0xa5);source=self.allocate(0x38,0xa5);data=self.allocate(8,0xa5)
            self.put(wrapper,'Q',source);self.put(wrapper+8,'B',0)
            self.put(source+0x30,'Q',data);self.put(data,'q',value)
            self.put(context+offset,'Q',wrapper)
        self.put(self.base+0x246d000,'Q',context);self.clock_context=context
        return {'context':context,'ticks':ticks,'selectorMode':mode,'timebase':timebase,
            'tickScale':struct.unpack('<d',self.u.mem_read(self.base+0x256d398,8))[0],
            'nativeFrequency':frequency,'originalGetterExecutedOnActivation':True,'originalClockOriginRecovered':False}
