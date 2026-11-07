"""Original complete static-mesh material activation; no scene or draw substitute."""
import argparse
import inspect
import json
from pathlib import Path
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from native_vfx_fixture import NativeVfxFixture
from parent_material_native import NativeParentMaterials
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
            for layer, raw in enumerate(planes):
                pixels = self.canonical(request['nativeFormat'], raw)
                digest = sha(pixels)
                checked = next(v for v in record['readbacks'] if v['mip'] == mip and v['layer'] == layer)
                if checked['sha256'] != digest or checked['bytes'] != len(pixels):
                    raise ValueError('Original material pixels differ from GPU readback')
                file = f'planes/{digest}.bin'
                (self.folder / file).write_bytes(pixels)
                level.append({'file': file, 'sha256': digest, 'bytes': len(pixels), 'mip': mip,
                              'layer': layer, 'width': max(1, request['width'] >> mip),
                              'height': max(1, request['height'] >> mip)})
            record['preparedLevels'].append(level)
        return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--effect', required=True)
    args = parser.parse_args()
    folder = args.cache.resolve() / 'research/direct-static-mesh-materials'
    folder.mkdir(parents=True, exist_ok=True)
    sources = {Path(__file__).resolve(), Path(inspect.getfile(NativeVfxFixture)),
               Path(inspect.getfile(GraphicsShaderCatalog)), Path(inspect.getfile(GraphicsTextureDevice))}
    sources.update(Path(inspect.getfile(cls)) for cls in NativeParentMaterials.__mro__ if cls is not object)
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
        n = NativeParentMaterials(fixture.assets / 'decoder-16.21-macos', args.client, device=device)
        shader = GraphicsShaderCatalog(fixture.assets / 'latest-shaders', device)
        n.shader_catalog = shader
        activation = fixture.activate(n, args.effect, 12345,
            {'ticks': [1000000000] * 3, 'mode': 0, 'timebase': [1, 1]}, 0, False)
        ownership = n.own_parent(activation['object'])
        passes = n.material_passes()
        mesh_actors = [a for a in ownership['actors'] if a.get('primitiveVtableRva') == 0x23f6a80]
        if not mesh_actors:
            raise ValueError('Selected unchanged root contains no original static mesh actor')
        result = {'schema': 1, 'kind': 'native-static-mesh-material-observation',
            'effectId': args.effect, 'build': '16.21.829.8620', 'protocol': '20e09df23c66b85e',
            'decoderImageSha256': sha(n.image), 'graphSha256': activation['graphSha256'],
            'activationInputs': {key: activation[key] for key in ['clockInput', 'randomSeed', 'quality', 'graphics34b']},
            'ownership': ownership, 'passes': passes, 'context': device.info,
            'textures': {str(k): v for k, v in n.native_textures.items()},
            'shaders': {str(k): v for k, v in n.native_shaders.items()},
            'programs': {str(k): v for k, v in n.native_programs.items()},
            'pipelines': {str(k): v for k, v in n.native_pipelines.items()},
            'bindings': {str(k): v for k, v in n.native_bindings.items()},
            'meshBuffers': n.mesh_backend.buffer_records, 'meshLayouts': n.mesh_backend.layout_records,
            'staticMeshSetups': n.static_mesh_setups, 'inputs': fixture.inputs, 'sources': source_hashes,
            'originalBlocks': list(n.blocks.values()),
            'scope': {'unchangedCompleteRootActivation': True, 'originalReadOnlyPassLookup': True,
                'sceneInputsProvided': False, 'gpuDrawSubmitted': False, 'browserExecuted': False,
                'runtimeAdmissionChanged': False}}
        for path, digest in shader.inputs.items():
            if sha(fixture.raw(Path(path))) != digest:
                raise ValueError('Shader source drift')
        for path, digest in {**fixture.inputs, **source_hashes}.items():
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError('Final static mesh material input/source drift: ' + path)
        path = folder / 'native.json'
        path.write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps({'output': str(path), 'meshActors': len(mesh_actors),
                          'allActors': len(ownership['actors'])}))
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
