"""Couple original explicit all-vision action, FoW resource binding and GPU data.

The unchanged complete Shared registry/sampler control runs first. Only then do
the real replay-camera factory/callback and original FoW texture updater run.
No scene controller, global flag, named texture pointer or white pixel is faked.
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path
import unicorn
from unicorn import x86_const as r
import shader_global_registry_native
from shader_global_registry_native import NativeShaderGlobalGraphics
from ui_manager_native import NativeUiManager
from vfx_spawn_native import ADDRESSES, sha


class Control(NativeUiManager, NativeShaderGlobalGraphics):
    # The UI's bounded allocation-only zero-fill port is scoped to its receiver
    # factory. Other existing native startup/global zero-fill paths retain the
    # unchanged graphics owner's platform implementation.
    def imported(self, uc, address, size, user):
        if getattr(self, 'camera_factory_active', False) and self.source.imports[address-self.base] == '___bzero':
            return NativeUiManager.imported(self, uc, address, size, user)
        return NativeShaderGlobalGraphics.imported(self, uc, address, size, user)

    def reject(self, uc, address, size, user):
        if getattr(self, 'camera_factory_active', False):
            return NativeUiManager.reject(self, uc, address, size, user)
        return NativeShaderGlobalGraphics.reject(self, uc, address, size, user)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['assets', 'client', 'fields', 'extent', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--registration', type=Path, action='append', required=True)
    parser.add_argument('--graphics', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Fresh original FoW material resource receipt required')
    tools = Path(__file__).resolve().parent
    observer = tools/'observe-native-shader-global-fields.py'
    paths = {Path(__file__), observer}
    paths.update(Path(module.__file__) for module in tuple(sys.modules.values())
                 if getattr(module, '__file__', None) and Path(module.__file__).suffix == '.py'
                 and Path(module.__file__).resolve().is_relative_to(tools))
    inputs = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    extent_bytes = args.extent.read_bytes()
    extent = json.loads(extent_bytes)
    if (extent['kind'] != 'original-map11-fow-extent-uniform-control' or
            not extent['scope']['actualMap11ExtentRecovered'] or not extent['scope']['originalUniformLeafExecuted']):
        raise ValueError('Original actual Map11 extent/uniform proof required')
    inputs[str(args.extent.resolve())] = sha(extent_bytes)
    for file, expected in extent['inputs'].items():
        if sha(Path(file).read_bytes()) != expected:
            raise ValueError('Actual Map11 uniform proof source changed: '+file)
        inputs[file] = expected
    original_control = shader_global_registry_native.observe_shared_remap_registration
    original_type = shader_global_registry_native.NativeShaderGlobalGraphics
    extension = {}

    def observe_fow(n, records, angle):
        proven = original_control(n, records, angle)
        extension['completeOriginalSharedControlReturned'] = True
        if extent['decoderImageSha256'] != sha(n.image):
            raise ValueError('FoW extent and resource native images differ')
        for block in extent['sourceBlocks']:
            if sha(n.image[block['rva']:block['rva']+block['bytes']]) != block['sha256']:
                raise ValueError('Original FoW extent instruction bytes differ')
        roots = [row for row in records if row['ownerPathHash'] == '85390927' and row['classHash'] == '344a9a75']
        if len(roots) != 1 or roots[0]['status'] != 'original-typed-root-fields-read':
            raise ValueError('Complete original Shared texture root required')
        root = roots[0]['observation']['object']
        pointer, count = n.q(root+0x18), n.u32(root+0x20)
        if not 0 < count <= 1024 or not n.library_pointer(pointer, count*0x40):
            raise ValueError('Original Shared texture vector escaped bounds')
        candidates = []
        for index in range(count):
            row = pointer+index*0x40
            if n.cstring(n.q(row)).decode('ascii') == 'FOW_MAP':
                candidates.append((index, row))
        if len(candidates) != 1:
            raise ValueError('Unique actual FOW_MAP Shared source row required')
        index, row = candidates[0]
        name = n.q(row)
        n.call(0x1914dc0, {r.UC_X86_REG_RDI: n.shared_backend, r.UC_X86_REG_RSI: name})
        if n.u.reg_read(r.UC_X86_REG_RAX):
            raise ValueError('Original FoW registration requires its cold name')
        n.call(0x1914440, {r.UC_X86_REG_RDI: n.shared_backend, r.UC_X86_REG_RSI: row})
        n.call(0x1914dc0, {r.UC_X86_REG_RDI: n.shared_backend, r.UC_X86_REG_RSI: name})
        view = n.u.reg_read(r.UC_X86_REG_RAX)
        if n.allocations.get(view) != 0x48:
            raise ValueError('Original FoW source row did not publish its owned view')
        # Run the real global-name acquisition prefix, stopping before its
        # unrelated constant queries. The view pointer is never assigned here.
        n.call(0x21c060, {}, 0x21c088)
        if n.q(n.base+0x255ccb0) != view:
            raise ValueError('Original FoW global acquisition selected another view')
        n.initialize_layout_constants()
        n.camera_factory_active = True
        try:
            n.call(0xf0c0f0, {})
        finally:
            n.camera_factory_active = False
        owner = n.u.reg_read(r.UC_X86_REG_RAX)
        if n.allocations.get(owner) != 0x340:
            raise ValueError('Original replay-camera receiver factory differs')
        n.call(0xf03da0, {r.UC_X86_REG_RDI: owner, r.UC_X86_REG_RSI: 0}, 0xf03e1c)
        if bytes(n.u.mem_read(n.base+0x24967c8, 1)) != b'\1' or bytes(n.u.mem_read(n.base+0x255cc88, 1)) != b'\0':
            raise ValueError('Original explicit all-vision callback publications differ')
        reads = []
        hook = n.u.hook_add(unicorn.UC_HOOK_MEM_READ,
            lambda _u, _access, address, size, _value, _user: reads.append({'address': address, 'bytes': size}),
            begin=n.base+0x24967d0, end=n.base+0x24967d7)
        try:
            # This executes native texture selection, its original getter,
            # complete1917340 Shared view/sampler update and wrapper release.
            n.call(0x21c180, {}, 0x21c220)
        finally:
            n.u.hook_del(hook)
        if reads:
            raise ValueError('All-vision resource path consumed a scene FoW controller')
        header = n.q(view+8)
        resources = [resource for resource in n.gpu_records if resource['pointer'] == header]
        if (len(resources) != 1 or not resources[0]['gpuBytesVerified'] or
                resources[0]['width'] != 1 or resources[0]['height'] != 1 or
                resources[0]['nativeFormat'] != 2 or resources[0]['levelsHex'] != [['ffffffff']]):
            raise ValueError('Original all-vision FoW resource lacks native white GPU byte proof')
        sampler = dict(n.shared_sampler_arguments)
        matches = [value for value in n.shared_sampler_resources.values()
                   if value['nativeArguments']['descriptorHex'] == sampler['descriptorHex']]
        if len(matches) != 1:
            raise ValueError('Original FoW sampler lacks unique native/GPU evidence')
        unknown = n.allocate_text('SCOUT_UNREGISTERED_FOW_TEXTURE_CONTROL')
        n.call(0x1914dc0, {r.UC_X86_REG_RDI: n.shared_backend, r.UC_X86_REG_RSI: unknown})
        if n.u.reg_read(r.UC_X86_REG_RAX):
            raise ValueError('Unknown original texture name unexpectedly resolved')
        extension.update(sourceOwnerPathHash='85390927', sourceTextureIndex=index, nativeView=view,
                         receiver=owner, nativeViewHex=bytes(n.u.mem_read(view, 0x48)).hex(),
                         selectedResource=resources[0], samplerArguments=sampler, samplerProof=matches[0],
                         controllerReads=reads, unregisteredNameResult=0,
                         extentProofSha256=sha(extent_bytes), uniformHex=extent['uniformHex'],
                         scope={'explicitAllVisionNativeCallbackExecuted': True,
                                'originalNamedSourceViewAndGlobalAcquisition': True,
                                'originalTextureSelectorGetterSetterAndReleaseExecuted': True,
                                'sceneControllerNotRead': True, 'nativeWhiteTextureSynthesized': False,
                                'actualMap11UniformSource': True, 'shaderFogModeChanged': False,
                                'fullGuiRefreshExecuted': False, 'teamPerspectiveAdmitted': False,
                                'gpuDrawSubmitted': False, 'nativeSpectatorAdmitted': False})
        return proven

    previous_argv = sys.argv
    shader_global_registry_native.observe_shared_remap_registration = observe_fow
    shader_global_registry_native.NativeShaderGlobalGraphics = Control
    sys.argv = [str(observer), str(args.assets/'decoder-16.21-macos'), str(args.client), str(args.fields), str(args.output),
                *[value for file in args.registration for value in ['--registration', str(file)]],
                '--graphics-angle', str(args.graphics)]
    try:
        spec = importlib.util.spec_from_file_location('complete_original_fow_resource_control', observer)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    finally:
        sys.argv = previous_argv
        shader_global_registry_native.observe_shared_remap_registration = original_control
        shader_global_registry_native.NativeShaderGlobalGraphics = original_type
        for file, expected in inputs.items():
            if sha(Path(file).read_bytes()) != expected:
                raise ValueError('FoW resource proof input/source changed: '+file)
        if args.output.exists():
            report = json.loads(args.output.read_bytes())
            report['fowResourceExtension'] = extension
            report['fowResourceExtensionInputs'] = inputs
            args.output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    main()
