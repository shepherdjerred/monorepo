"""Original shared instancing flag and individual mesh material prefix."""
import argparse
import inspect
import json
import struct
from pathlib import Path
import unicorn
from unicorn import x86_const as r
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from native_vfx_fixture import NativeVfxFixture
from parent_draw_parameters_native import NativeParentDrawParameters, NAME_HASH, PARAMETER_FACTORY, REGISTRY_INSERT
from vfx_graphics_native import DEVICE
from vfx_pipeline_native import PIPELINE_DEVICE_VTABLE
from vfx_spawn_native import sha

UPDATE = 0x100f5260

class MeshDrawParameters(NativeParentDrawParameters):
    def __init__(self, *args, **kwargs):
        self.mesh_uniform_updates = []
        super().__init__(*args, **kwargs)
        self.u.mem_write(UPDATE, b'\xc3')
        self.u.hook_add(unicorn.UC_HOOK_CODE, self.observe_update, begin=UPDATE, end=UPDATE)

    def initialize_graphics_context(self, *args):
        state = super().initialize_graphics_context(*args)
        name = 'DYNAMIC_MESH_CENTER'; encoded = name.encode('ascii')
        text = self.allocate(len(encoded)+1); self.u.mem_write(text,encoded+b'\0')
        self.call(NAME_HASH,{r.UC_X86_REG_RDI:text,r.UC_X86_REG_RSI:len(encoded),r.UC_X86_REG_RDX:0})
        identity = self.u.reg_read(r.UC_X86_REG_RAX)&0xffffffff
        self.call(PARAMETER_FACTORY,{r.UC_X86_REG_RDI:DEVICE,r.UC_X86_REG_RSI:identity,r.UC_X86_REG_RDX:1})
        pointer = self.u.reg_read(r.UC_X86_REG_RAX)
        if self.allocations.get(pointer) != 0x38 or self.u32(pointer+0x10) != 1 or self.u32(pointer+0x14) != identity or self.allocations.get(self.q(pointer+8)) != 16:
            raise ValueError('Original mesh center shared parameter constructor differs')
        key, value = self.allocate(4), self.allocate(8)
        self.put(key,'I',identity); self.put(value,'Q',pointer)
        self.call(REGISTRY_INSERT,{r.UC_X86_REG_RDI:DEVICE+0x80,r.UC_X86_REG_RSI:key,r.UC_X86_REG_RDX:key,r.UC_X86_REG_RCX:value})
        self.draw_parameter_slots[name] = {'pointer':pointer,'vectors':1,'hash':identity}
        # A recording implementation of the supplied graphics-device API.
        # Original CPU material updates execute; no GPU update/draw is claimed.
        self.put(PIPELINE_DEVICE_VTABLE + 0xa0, 'Q', UPDATE)
        return state

    def observe_update(self, uc, address, size, user):
        device, binding, request = [uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI,r.UC_X86_REG_RSI,r.UC_X86_REG_RDX]]
        caller = self.q(uc.reg_read(r.UC_X86_REG_RSP)) - self.base
        if device != DEVICE or binding not in self.native_bindings or caller not in [0x17c1964,0x17c1323,0x17c1213] or not self.library_pointer(request,24):
            raise ValueError('Unowned mesh material uniform observation')
        pointer, count = self.q(request+8), self.u32(request+16)
        if count != (3 if caller == 0x17c1964 else 1) or not self.library_pointer(pointer,count*16):
            raise ValueError('Bounded original mesh material vector observation required')
        self.mesh_uniform_updates.append({'binding':binding,'callerRva':caller,'name':self.cstring(self.q(request)).decode('ascii'),
            'count':count,'bytesHex':bytes(uc.mem_read(pointer,count*16)).hex(),'gpuApplied':False})
        self.ret()

    def imported(self, uc, address, size, user):
        caller = self.q(uc.reg_read(r.UC_X86_REG_RSP)) - self.base
        if self.source.imports[address-self.base] != '_memcmp' or caller != 0x17c18bf:
            return super().imported(uc, address, size, user)
        first, second, count = [uc.reg_read(reg) for reg in [r.UC_X86_REG_RDI, r.UC_X86_REG_RSI, r.UC_X86_REG_RDX]]
        if count != 48 or not self.library_pointer(first, count) or not self.library_pointer(second, count):
            raise ValueError('Unowned original mesh material UV-vector C comparison')
        left, right = bytes(uc.mem_read(first,count)), bytes(uc.mem_read(second,count))
        result = next((a-b for a,b in zip(left,right) if a != b),0)
        self.draw_memcmp_calls.append({'callerRva':caller,'bytes':count,'leftHex':left.hex(),'rightHex':right.hex(),'result':result})
        uc.reg_write(r.UC_X86_REG_RAX,result & 0xffffffffffffffff); self.ret()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    sources = {Path(__file__), Path(inspect.getfile(NativeVfxFixture)), Path(inspect.getfile(GraphicsTextureDevice)), Path(inspect.getfile(GraphicsShaderCatalog))}
    sources.update(Path(inspect.getfile(c)) for c in MeshDrawParameters.__mro__ if c is not object)
    sources.update(Path(__file__).with_name(name) for name in ['graphics_material_bindings.py', 'graphics_pipeline_device.py', 'graphics_mesh_device.py', 'native_texture_dependencies.py', 'render-particle-shader.py', 'observe-shader-angle.py', 'macho.py', 'shader_permutation.py'])
    hashes = {str(p.resolve()): sha(p.read_bytes()) for p in sources}
    fixture = NativeVfxFixture(args.cache)
    for path in [args.client, args.angle / 'libEGL.dll', args.angle / 'libGLESv2.dll']:
        fixture.raw(path)
    for name in ['image.bin', 'profile.json']:
        fixture.raw(fixture.assets / 'decoder-16.21-macos' / name)
    device = GraphicsTextureDevice(args.angle)
    n = shader = None
    try:
        n = MeshDrawParameters(fixture.assets / 'decoder-16.21-macos', args.client, device=device)
        shader = GraphicsShaderCatalog(fixture.assets / 'latest-shaders', device); n.shader_catalog = shader
        a = fixture.activate(n, 'champions/hecarim/0/e57b8289', 1, {'ticks': [1000000000]*3, 'mode': 0, 'timebase': [1,1]}, 0, False)
        n.own_parent(a['object'])
        def values():
            return {name: bytes(n.u.mem_read(n.q(v['pointer'] + 8), v['vectors'] * 16)).hex() for name,v in n.draw_parameter_slots.items()}
        initial = values()
        if initial['USE_INSTANCE_DRAW'] != '00' * 16:
            raise ValueError('Original shared parameter constructor is not zero')
        tick_times = []
        for _ in range(4):
            tick_times.append(n.last_parent_time + 1/60)
            n.tick_parent(tick_times[-1], 8)
        actor = next(a for a in n.frame_actors if a['emitterIndex'] == 15)
        count = n.u32(n.q(actor['pointer'] + 0xa0) + 0x10) & 0xffff
        if count < 1:
            raise ValueError('Actual mesh source did not produce a particle')
        identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
        batched = n.draw_parameters(15, identity, 1047222492, 7)
        if int.from_bytes(bytes.fromhex(batched['values']['USE_INSTANCE_DRAW'])[:4], 'little') != 1:
            raise ValueError('Original batched prefix did not select instancing')
        n.fragment(0x173d9e5, 0x173da01, {})
        cleaned = values()
        if cleaned['USE_INSTANCE_DRAW'] != '00'*16 or cleaned['INSTANCE_OFFSET'] != '00'*16:
            raise ValueError('Original common batched cleanup did not reset shared controls')
        n.u.mem_write(n.draw_scene, bytes(0x300)); n.put(n.draw_scene, 'fff', 0, 100, 1000)
        n.put(n.draw_scene + 0x264, '16f', *identity)
        n.put(n.draw_wrapper, 'Q', actor['pointer']); n.put(n.draw_command, 'II', 0, 0)
        allowed = [(n.draw_scene, n.draw_scene+12), (n.draw_scene+0x264, n.draw_scene+0x2a4)]
        def scene_read(uc, access, address, size, value, user):
            if not any(a <= address < address+size <= z for a,z in allowed):
                raise ValueError(f'Unknown diagnostic scene member read: {address-n.draw_scene:x}/{size}')
        hook = n.u.hook_add(unicorn.UC_HOOK_MEM_READ, scene_read, begin=n.draw_scene, end=n.draw_scene+0x2ff)
        try:
            n.fragment(0x173dfc0, 0x17c2d20, {r.UC_X86_REG_RDI: n.draw_wrapper, r.UC_X86_REG_RSI: n.draw_scene,
                r.UC_X86_REG_RDX: 1047222492, r.UC_X86_REG_RCX: n.draw_command})
        except Exception:
            print(json.dumps({'boundaryRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base,
                'callerRva': n.q(n.u.reg_read(r.UC_X86_REG_RSP))-n.base,
                'rdi': n.u.reg_read(r.UC_X86_REG_RDI), 'rsi': n.u.reg_read(r.UC_X86_REG_RSI), 'rdx': n.u.reg_read(r.UC_X86_REG_RDX)}), flush=True)
            raise
        finally:
            n.u.hook_del(hook)
        before_material = values()
        caller = n.q(n.u.reg_read(r.UC_X86_REG_RSP)) - n.base
        if caller != 0x1809c7b or before_material['USE_INSTANCE_DRAW'] != '00'*16:
            raise ValueError('Did not reach original individual static draw with instancing disabled')
        material = n.u.reg_read(r.UC_X86_REG_RDI)
        n.call(0x17c2100,{r.UC_X86_REG_RDI:material,r.UC_X86_REG_RSI:1047222492})
        row = n.u.reg_read(r.UC_X86_REG_RAX)
        if not row or n.u32(row+8) != 1047222492 or n.u32(row+0x18) != 1:
            raise ValueError('Actual individual material ground pass is not unique')
        variant = n.q(row+0x10)
        pipeline = n.q(n.q(variant+0x70)+8); binding = n.q(variant+0x78)
        if binding not in n.native_bindings or pipeline not in n.native_pipelines:
            raise ValueError('Actual individual material lacks original shader resources')
        program = n.native_programs[n.native_pipelines[pipeline]['nativeProgram']]
        selected_shaders = {}
        for stage in ['vertex','pixel']:
            matches = [v for v in n.native_shaders.values() if v['glHandle'] == program[stage]]
            if len(matches) != 1: raise ValueError('Unique individual shader selection required')
            selected_shaders[stage] = matches[0]
        material_parameters = []
        for at in n.vector(material+0x10,24,4096):
            size, pointer = n.u32(at+16), n.q(at+8)
            if not 0 < size <= 4 or not n.library_pointer(pointer,size*16):
                raise ValueError('Owned current material parameter vectors required')
            material_parameters.append({'name':n.cstring(n.q(at)).decode('ascii'),'count':size,
                'bytesHex':bytes(n.u.mem_read(pointer,size*16)).hex()})
        color = next(v for v in n.mesh_uniform_updates if v['name'] == 'kColorFactor')
        if not any(v > 0 for v in struct.unpack('<4f',bytes.fromhex(color['bytesHex']))[:3]):
            raise ValueError('Positive original mesh material color required')
        for path,digest in shader.inputs.items():
            if sha(fixture.raw(Path(path))) != digest: raise ValueError('Shader drift')
        for path,digest in {**fixture.inputs, **hashes}.items():
            if sha(Path(path).read_bytes()) != digest: raise ValueError('Final mesh draw evidence drift')
        output = fixture.cache / 'research/direct-mesh-draw-branch-native.json'
        output.write_text(json.dumps({'schema': 1, 'kind': 'original-individual-static-mesh-draw-branch', 'build': '16.21.829.8620', 'protocol': '20e09df23c66b85e',
            'effectId': a['effectId'], 'emitterIndex': 15, 'particleCount': count, 'tickTimes':tick_times,
            'initial': initial, 'batched': batched, 'cleaned': cleaned,
            'beforeMaterialApply': before_material, 'materialApplyCallerRva': caller, 'observedUniformUpdates': n.mesh_uniform_updates,
            'selectedMaterial': {'pointer':material,'passHash':1047222492,'nativeBinding':binding,'shaders':selected_shaders,
                'currentCpuParameters':material_parameters,'initialGpuBinding':n.native_bindings[binding]},
            'inputs': fixture.inputs, 'sources': hashes,
            'originalBlocks': list(n.blocks.values()), 'scope': {'originalConstructorsAndSetters': True, 'originalIndividualMeshPrefix': True,
                'sceneInputsExplicitlySupplied': True, 'recordingGraphicsDeviceUniformApi': True,
                'gpuMaterialUniformUpdatesApplied': False, 'materialApplyAndGpuDrawExecuted': False, 'instance208BytePayloadProduced': False,
                'nativeWorldAcceptance': False, 'browserExecuted': False}}, indent=2), encoding='utf-8')
        print(json.dumps({'output': str(output), 'particleCount': count, 'individualInstancing': 0}))
    finally:
        if n:
            if n.material_backend is not None: n.material_backend.close()
            n.mesh_backend.close()
        if shader: shader.close()
        device.close()


if __name__ == '__main__':
    main()
