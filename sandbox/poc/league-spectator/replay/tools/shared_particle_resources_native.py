"""Compose the existing GLES pipeline/material bridges with installed asset loading."""
import unicorn
from unicorn import x86_const as r
from legacy_effect_native import NativeLegacyEffectInputs
from graphics_pipeline_device import GraphicsPipelineDevice
from graphics_material_bindings import GraphicsMaterialBindings
from vfx_graphics_native import DEVICE,DEVICE_VTABLE,MATERIAL_PASS_STARTUP
from vfx_mesh_native import NativeVfxMeshContext,LAYOUT_CREATE,LAYOUT_STOP
from vfx_spawn_native import ADDRESSES
from vfx_pipeline_native import (NativeVfxPipelineContext,PIPELINE_RETURN,MATERIAL_BINDINGS,
                                 BINDINGS_RETURN,PIPELINE_DEVICE_VTABLE)


class NativeSharedParticleResources(NativeLegacyEffectInputs):
    pipeline_return = NativeVfxPipelineContext.pipeline_return
    material_binding_request = NativeVfxPipelineContext.material_binding_request
    bindings_return = NativeVfxPipelineContext.bindings_return
    observe_shared_parameter = NativeVfxPipelineContext.observe_shared_parameter
    layout_create = NativeVfxMeshContext.layout_create
    layout_return = NativeVfxMeshContext.layout_return
    observe_layout_binding = NativeVfxMeshContext.observe_layout_binding

    def __init__(self,*args):
        self.pending_pipeline,self.pending_binding = None,None
        self.native_pipelines,self.native_bindings = {},{}
        self.pipeline_backend,self.material_backend = None,None
        self.material_binding_requests = []
        self.pending_shared_parameters,self.shared_parameter_queries = [],[]
        self.pending_mesh_layout = None
        self.native_mesh_layouts = {}
        self.pending_layout_bindings = []
        super().__init__(*args)
        for address,callback in [(PIPELINE_RETURN,self.pipeline_return),(MATERIAL_BINDINGS,self.material_binding_request),
                                  (BINDINGS_RETURN,self.bindings_return),(LAYOUT_CREATE,self.layout_create)]:
            self.u.mem_write(address,b'\xc3')
            self.u.hook_add(unicorn.UC_HOOK_CODE,callback,begin=address,end=address)
        for at in [0x1913b10,0x1913c16]:
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.observe_shared_parameter,begin=self.base+at,end=self.base+at)
        self.u.hook_add(unicorn.UC_HOOK_CODE,self.layout_return,begin=self.base+LAYOUT_STOP,end=self.base+LAYOUT_STOP)
        for at in [0x192def0,0x192dfa4]:
            self.u.hook_add(unicorn.UC_HOOK_CODE,self.observe_layout_binding,begin=self.base+at,end=self.base+at)

    def initialize_character_graphics(self,angle):
        state = super().initialize_character_graphics(angle)
        self.pipeline_backend = GraphicsPipelineDevice(self.device,self.image)
        # Retain the port vtable before the complete original CPU device-base
        # constructor initializes its larger shared-parameter storage.
        self.u.mem_write(PIPELINE_DEVICE_VTABLE,bytes(self.u.mem_read(DEVICE_VTABLE,0x2b0)))
        self.call(0x1922690,{r.UC_X86_REG_RDI:DEVICE})
        self.put(DEVICE,'Q',PIPELINE_DEVICE_VTABLE)
        self.put(PIPELINE_DEVICE_VTABLE+0x88,'Q',MATERIAL_BINDINGS)
        self.put(PIPELINE_DEVICE_VTABLE+0xe8,'Q',LAYOUT_CREATE)
        self.put(PIPELINE_DEVICE_VTABLE+0x268,'Q',self.base+0x1913b10)
        self.fragment(*MATERIAL_PASS_STARTUP,{r.UC_X86_REG_RBP:ADDRESSES['stack']-8,
                      r.UC_X86_REG_RSP:ADDRESSES['stack']-0x80})
        state['originalCpuDeviceBaseConstructorCompleted'] = True
        state['originalSharedMaterialPassStartupExecuted'] = True
        return state

    def attach_shared_material_provider(self,catalog):
        if self.material_backend is not None or self.pipeline_backend is None or self.shader_catalog is not catalog:
            raise ValueError('Shared material provider requires its owned pipeline and shader providers')
        self.material_backend = GraphicsMaterialBindings(self.device,catalog)

    def graphics_call(self,uc,address,size,kind):
        if kind == 'pipeline':
            return NativeVfxPipelineContext.graphics_call(self,uc,address,size,kind)
        return super().graphics_call(uc,address,size,kind)

    def close_graphics(self):
        if self.material_backend is not None:
            self.material_backend.close()
            self.material_backend = None
        if self.shader_catalog is not None:self.shader_catalog.close()
        super().close_graphics()
