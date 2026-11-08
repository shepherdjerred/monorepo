"""Complete unchanged Ray-root material acquisition, independent of placement."""
import argparse
import inspect
import json
from pathlib import Path
import unicorn
from unicorn import x86_const as r

from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from native_vfx_fixture import NativeVfxFixture
from parent_material_native import NativeParentMaterials
from graphics_material_bindings import GraphicsMaterialBindings
from vfx_spawn_native import sha


class CapturedTextures(GraphicsTextureDevice):
    def __init__(self, angle, folder):
        self.folder = folder
        (folder / 'planes').mkdir(parents=True, exist_ok=True)
        super().__init__(angle)

    def create(self, request):
        record = super().create(request)
        record['preparedLevels'] = []
        for mip, planes in enumerate(request['levels']):
            level = []
            for layer, source in enumerate(planes):
                pixels = self.canonical(request['nativeFormat'], source)
                digest = sha(pixels)
                observed = next(r for r in record['readbacks'] if r['mip'] == mip and r['layer'] == layer)
                if observed['sha256'] != digest or observed['bytes'] != len(pixels):
                    raise ValueError('Original Ray texture pixels differ from GPU readback')
                file = f'planes/{digest}.bin'
                (self.folder / file).write_bytes(pixels)
                level.append({'file': file, 'sha256': digest, 'bytes': len(pixels), 'mip': mip, 'layer': layer,
                              'width': max(1, request['width'] >> mip), 'height': max(1, request['height'] >> mip)})
            record['preparedLevels'].append(level)
        return record


class CapturedSamplers(GraphicsMaterialBindings):
    def create(self, request, pipeline, program, textures):
        border = [t for t in request['textures'] if bytes.fromhex(t['descriptorHex'])[:3] == b'\x03\x03\x03']
        if border:
            for t in border:
                if t['descriptorHex'] != '03030300000000000100010100000000':
                    raise ValueError('Unknown unrelated-sibling border sampler structure')
            return {'glProgram': program['glHandle'], 'uniformBuffers': [], 'textures': [],
                'requiredSceneBlocks': [], 'requiredSceneTextures': [], 'requiredSceneDataBuffers': [],
                'created': False, 'drawReady': False, 'sceneInputsBound': False,
                'requestRecordedOnly': True, 'request': request,
                'omissions': ['material:unrelated-sibling-native-border-sampler-untranslated']}
        return super().create(request, pipeline, program, textures)

    def sampler(self, raw):
        try:
            return super().sampler(raw)
        except ValueError as error:
            raise ValueError(f'{error}; original descriptor={raw.hex()}') from error


class RayMaterials(NativeParentMaterials):
    def bindings_return(self, *args):
        pending = self.pending_binding
        pointer, unsupported = pending['pointer'], pending['gpu'].get('requestRecordedOnly', False)
        super().bindings_return(*args)
        if unsupported:
            self.unavailable_binding_fields.append({'pointer': pointer, 'start': pointer + 8, 'endExclusive': pointer + 0x28})
            self.u.hook_add(unicorn.UC_HOOK_MEM_READ, self.reject_unavailable_fields, begin=pointer + 8, end=pointer + 0x27)

    def reject_unavailable_fields(self, uc, access, address, size, value, user):
        exact = next((v for v in self.unavailable_binding_fields if address == v['pointer'] + 0x21), None)
        if exact is not None and size == 1 and uc.reg_read(r.UC_X86_REG_RIP) - self.base == 0x17bb943:
            if bytes(uc.mem_read(address, 1)) != b'\0':
                raise ValueError('Original binding-base flag no longer has constructor-produced zero')
            self.unavailable_binding_base_flag_reads.append({'rva': 0x17bb943, 'pointer': exact['pointer'], 'offset': 0x21, 'value': 0,
                'source': 'original-1911010-base-constructor-zero-copied-to-material-59'})
            return
        self.unavailable_binding_reads.append({'address': address, 'size': size})
        raise ValueError(f'Original CPU activation read unavailable sibling GPU-specific binding fields: address={address:x}, size={size}, rva={uc.reg_read(r.UC_X86_REG_RIP)-self.base:x}, bounds={self.unavailable_binding_fields}')

    def material_binding_request(self, *args):
        try:
            return super().material_binding_request(*args)
        except ValueError as error:
            request = self.material_binding_requests[-1]
            program = self.native_programs[self.native_pipelines[request['nativePipeline']]['nativeProgram']]
            stages = [next(v['path'] for v in self.native_shaders.values() if v['glHandle'] == program[s]) for s in ['vertex', 'pixel']]
            raise ValueError(f'{error}; shader paths={stages}; textures={request["textures"]}') from error

    def load_prepared_system(self, graph):
        super().load_prepared_system(graph)
        if self.material_backend is not None:
            self.material_backend.close()
        self.material_backend = CapturedSamplers(self.device, self.shader_catalog)
        self.unavailable_binding_fields = []
        self.unavailable_binding_reads = []
        self.unavailable_binding_base_flag_reads = []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--effect', required=True)
    args = parser.parse_args()
    folder = args.cache.resolve() / 'research/direct-ray-materials-v28'
    folder.mkdir(parents=True, exist_ok=True)
    sources = {Path(__file__).resolve(), Path(inspect.getfile(NativeVfxFixture)),
               Path(inspect.getfile(GraphicsShaderCatalog)), Path(inspect.getfile(GraphicsTextureDevice))}
    sources.update(Path(inspect.getfile(cls)) for cls in RayMaterials.__mro__ if cls is not object)
    sources.update(Path(__file__).with_name(name) for name in ['graphics_material_bindings.py',
        'graphics_pipeline_device.py', 'graphics_mesh_device.py', 'native_texture_dependencies.py',
        'render-particle-shader.py', 'observe-shader-angle.py', 'macho.py'])
    source_hashes = {str(p.resolve()): sha(p.read_bytes()) for p in sources}
    fixture = NativeVfxFixture(args.cache)
    fixture.raw(args.client)
    for name in ['libEGL.dll', 'libGLESv2.dll']:
        fixture.raw(args.angle / name)
    for name in ['profile.json', 'image.bin', 'vfx-bound-quads.json', 'vfx-system.json']:
        fixture.raw(fixture.assets / 'decoder-16.21-macos' / name)
    device = CapturedTextures(args.angle, folder)
    n = shader = None
    try:
        n = RayMaterials(fixture.assets / 'decoder-16.21-macos', args.client, device=device)
        shader = GraphicsShaderCatalog(fixture.assets / 'latest-shaders', device)
        n.shader_catalog = shader
        activation = fixture.activate(n, args.effect, 12345,
            {'ticks': [1000000000] * 3, 'mode': 0, 'timebase': [1, 1]}, 0, False)
        ownership = n.own_parent(activation['object'])
        rays = [a for a in ownership['actors'] if a.get('primitiveVtableRva') == 0x23f26e0]
        if not rays:
            raise ValueError('Selected unchanged root contains no original Ray actor')
        result = {'schema': 1, 'kind': 'native-complete-ray-material-observation',
            'effectId': args.effect, 'build': '16.21.829.8620', 'protocol': '20e09df23c66b85e',
            'decoderImageSha256': sha(n.image), 'graphSha256': activation['graphSha256'],
            'activationInputs': {key: activation[key] for key in ['clockInput', 'randomSeed', 'quality', 'graphics34b']},
            'ownership': ownership, 'passes': n.material_passes(), 'context': device.info,
            'textures': {str(k): v for k, v in n.native_textures.items()},
            'shaders': {str(k): v for k, v in n.native_shaders.items()},
            'programs': {str(k): v for k, v in n.native_programs.items()},
            'pipelines': {str(k): v for k, v in n.native_pipelines.items()},
            'bindings': {str(k): v for k, v in n.native_bindings.items()},
            'preloadedTextures': n.preloaded_textures,
            'materialBindingRequests': n.material_binding_requests,
            'unavailableSiblingBindingFields': n.unavailable_binding_fields,
            'unavailableSiblingBindingFieldReads': n.unavailable_binding_reads,
            'unavailableSiblingOriginalBaseFlagCopies': n.unavailable_binding_base_flag_reads,
            'inputs': fixture.inputs, 'sources': source_hashes, 'originalBlocks': list(n.blocks.values()),
            'scope': {'unchangedCompleteRootActivation': True, 'originalReadOnlyPassLookup': True,
                'sceneInputsProvided': False, 'gpuDrawSubmitted': False, 'browserExecuted': False,
                'runtimeAdmissionChanged': False, 'wholeRootGpuMaterialsPrepared': False,
                'unsupportedSiblingGpuReadinessProvided': False,
                'unavailableSiblingGpuFieldsReadGuarded': True}}
        for path, digest in shader.inputs.items():
            if sha(fixture.raw(Path(path))) != digest:
                raise ValueError('Ray shader input drift')
        for path, digest in {**fixture.inputs, **source_hashes}.items():
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError('Final Ray material source/input drift: ' + path)
        path = folder / 'native.json'
        path.write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps({'output': str(path), 'rayActors': len(rays), 'allActors': len(ownership['actors'])}))
    finally:
        if n is not None:
            if n.material_backend is not None:
                n.material_backend.close()
            n.mesh_backend.close()
        if shader is not None:
            shader.close()
        device.close()


if __name__ == '__main__':
    main()
