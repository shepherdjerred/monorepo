"""Replay an observed transition material request through actual GLES resources."""
import argparse
import json
from pathlib import Path
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from graphics_pipeline_device import GraphicsPipelineDevice
from graphics_material_bindings import GraphicsMaterialBindings
from vfx_spawn_native import sha


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'observation', 'package', 'angle']:
        p.add_argument(name, type=Path)
    args = p.parse_args()
    source = json.loads(args.observation.read_bytes())
    if source['build'] != '16.21.829.8620':
        raise ValueError('Exact-build material observation required')
    graphics = source['nativeGraphics']
    request = graphics['materialBindingRequests'][-1]
    pipeline = next(row for row in graphics['pipelines'] if row['nativePointer'] == request['nativePipeline'])
    original_program = next(row for row in graphics['programs'] if row['glHandle'] == pipeline['glProgram'])
    device = GraphicsTextureDevice(args.angle)
    shaders = GraphicsShaderCatalog(args.package, device)
    materials = GraphicsMaterialBindings(device, shaders)
    try:
        handles = {}
        for stage in ['vertex', 'pixel']:
            original = next(row for row in graphics['shaderRequests'] if row['glHandle'] == original_program[stage])
            compiled = shaders.create_shader(original['path'], stage, original['defines'])
            if compiled['recordId'] != original['recordId']:
                raise ValueError('Transition material selected another shader record')
            handles[stage] = compiled['glHandle']
        program = shaders.create_program(handles['vertex'], handles['pixel'])
        state = GraphicsPipelineDevice(device, (args.cache / 'public/decoder-16.21-macos/image.bin').read_bytes()).create(
            bytes.fromhex(pipeline['descriptorHex']), program)
        textures = {}
        for pointer in {row['nativeTexture'] for row in request['textures']}:
            original = next(row for row in graphics['textures'] if row['pointer'] == pointer)
            textures[pointer] = device.create({**original,
                'levels': [[bytes.fromhex(plane) for plane in level] for level in original['levelsHex']]})
        bound = materials.create(request, state, program, textures)
        missing = bound['requiredMaterialTextures']
        if (bound['drawReady'] or not missing or any(row['nativeResource'] is not None for row in missing) or
                not any(row['name'] == 'TransitionDestTexture__TX' for row in missing)):
            raise ValueError('Incomplete transition material escaped the draw readiness gate')
        result = {'schema': 1, 'kind': 'observed-material-absence-gles-control', 'build': source['build'],
            'observationSha256': sha(args.observation.read_bytes()), 'binding': bound,
            'shaderInputs': shaders.inputs, 'programLinked': True,
            'scope': {'actualGlesResources': True, 'nativeAbsentInputsRetained': True,
                      'drawReady': False, 'gpuDrawSubmitted': False, 'matchCoverage': False}}
        output = args.cache / 'research/material-binding-absence-gles.json'
        output.write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps({'output': str(output), 'programLinked': True, 'drawReady': bound['drawReady'],
                          'missingMaterialTextures': [row['name'] for row in missing]}))
    finally:
        materials.close()
        shaders.close()
        device.close()


if __name__ == '__main__':
    main()
