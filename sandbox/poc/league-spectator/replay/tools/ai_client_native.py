"""Original AI client construction with its bounded platform stack probe."""
from unicorn import x86_const as r
from character_postload_native import NativeCharacterPostload
from vfx_spawn_native import ADDRESSES
from effect_context_native import NativeEffectContexts


class NativeAIClientInputs(NativeCharacterPostload):
    original_string = NativeEffectContexts.original_string
    character_context = NativeEffectContexts.character_context

    def fragment(self,start,end,registers):
        self.call(start,registers,end)

    def __init__(self,*args):
        self.client_stack_probes = []
        super().__init__(*args)

    def initialize_audio_facade(self):
        if self.q(self.base+0x246d500):
            raise ValueError('Original audio facade is already initialized')
        # Complete original inlined facade construction, stopping before audio
        # device/settings activation. String-to-ID queries use original code.
        self.call(0x666129,{},0x666213)
        facade = self.q(self.base+0x246d500)
        if self.allocations.get(facade) != 0x98:
            raise ValueError('Original audio facade ownership differs')
        return {'object':facade,'bytesHex':bytes(self.u.mem_read(facade,0x98)).hex(),
                'originalPrefix':[0x666129,0x666213],'deviceActivated':False,'soundPlaybackImplemented':False}

    def initialize_ui_data_prefix(self):
        if self.q(self.base+0x246d010):
            raise ValueError('Original UI data prefix is already initialized')
        ui = self.allocate(0xe8)
        # The original independent data prefix leaves its presentation owners
        # absent. Settings, camera, widget and texture initialization are not
        # supplied or declared complete by this cold-client control.
        self.call(0xc5979a,{r.UC_X86_REG_RDI:ui},0xc5982f)
        if self.q(self.base+0x246d010) != ui or self.q(ui+0x78):
            raise ValueError('Original cold UI data prefix differs')
        return {'object':ui,'bytesHex':bytes(self.u.mem_read(ui,0xe8)).hex(),
                'originalPrefix':[0xc5979a,0xc5982f],'fullConstructorExecuted':False,
                'presentationOwnersInitialized':False}

    def imported(self,uc,address,size,user):
        name = self.source.imports[address-self.base]
        if name == '____chkstk_darwin':
            count,sp = uc.reg_read(r.UC_X86_REG_RAX),uc.reg_read(r.UC_X86_REG_RSP)
            caller = self.q(sp)-self.base
            if caller == 0xea3d8 and count == 0x18b8:
                if not ADDRESSES['stack']-0x8000 <= sp-count <= sp <= ADDRESSES['stack']:
                    raise ValueError('Original AI client stack probe escaped owned stack')
                for at in range(sp-count,sp+1,4096):
                    uc.mem_read(at,1)
                self.client_stack_probes.append({'callerRva':caller,'bytes':count,'stack':sp})
                self.ret()
                return
        return super().imported(uc,address,size,user)
