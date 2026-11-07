"""Original VFX manager data components for synchronous preload observations."""
from unicorn import x86_const as r
from module_provider_native import NativeModuleProviders
from vfx_object_native import NativeVfxObjects,MANAGER,MUTEX_OFFSETS,OWNED_MANAGER_BLOCKS,TAG_STARTUP
from vfx_resource_native import RESOURCE_MANAGER_INPUT_BLOCKS
from vfx_spawn_native import ADDRESSES


class NativeEffectPreload(NativeModuleProviders):
    def __init__(self,*args):
        self.object_mutexes,self.object_semaphores = {},{}
        super().__init__(*args)

    def imported(self,uc,address,size,user):
        name = self.source.imports[address-self.base]
        first = uc.reg_read(r.UC_X86_REG_RDI)
        if name in ['_pthread_mutex_init','_pthread_mutex_lock','_pthread_mutex_unlock'] and first-MANAGER in MUTEX_OFFSETS:
            return NativeVfxObjects.imported(self,uc,address,size,user)
        return super().imported(uc,address,size,user)

    def initialize_effect_preload_components(self,quality,graphics34b):
        if self.object_mutexes or self.object_semaphores or self.object_attrs:
            raise ValueError('Effect manager data components already initialized')
        if quality not in [0,1,2,3] or type(graphics34b) is not bool:
            raise ValueError('Explicit effect quality and graphics field inputs required')
        groups = self.q(self.base+0x24712c8)
        reused_groups = bool(groups)
        if groups:
            if self.allocations.get(groups) != 0x20 or not self.q(groups+0x18):
                raise ValueError('Existing original resource group manager ownership differs')
        else:
            self.fragment(*TAG_STARTUP,{})
            groups = self.q(self.base+0x24712c8)
        # Reuse the same original independent blocks as the standalone VFX
        # controls. Retain an existing group manager: replacing it after GPU
        # resources were registered would change their group identity.
        self.u.mem_write(MANAGER,bytes([0xa5])*0x3a8)
        frame = ADDRESSES['stack']-8
        for start,end in [*OWNED_MANAGER_BLOCKS,*RESOURCE_MANAGER_INPUT_BLOCKS]:
            self.fragment(start,end,{r.UC_X86_REG_RDI:MANAGER,r.UC_X86_REG_RSI:0,
                r.UC_X86_REG_RBX:MANAGER,r.UC_X86_REG_XMM0:0,
                r.UC_X86_REG_RBP:frame,r.UC_X86_REG_RSP:frame-0xe8})
        self.put(MANAGER+0x29c,'B',quality)
        self.put(MANAGER+0x34b,'B',graphics34b)
        if self.object_attrs or any(value['depth'] for value in self.object_mutexes.values()):
            raise ValueError('Effect preload components retained a synchronization lock')
        if self.q(self.base+0x24712c8) != groups:
            raise ValueError('Effect preload initialization replaced the resource group manager')
        return {'object':MANAGER,'originalDataComponentsExecuted':True,
                'completeManagerConstructorExecuted':False,'workerPoolExecuted':False,
                'qualityInput':quality,'graphics34bInput':graphics34b,'sceneInput':0,
                'managerHex':bytes(self.u.mem_read(MANAGER,0x3a8)).hex(),
                'mutexes':self.object_mutexes,'resourceGroups':groups,'existingResourceGroupsReused':reused_groups,
                'resourceReadinessVerified':False,'liveWorldBindingsVerified':False}
