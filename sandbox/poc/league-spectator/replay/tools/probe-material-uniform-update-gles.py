"""Compare byte-preserving GLES uniform updates with original CPU observations."""
import argparse
import ctypes as C
import hashlib
import inspect
import json
from pathlib import Path
from types import SimpleNamespace
import xxhash
from graphics_texture_device import GraphicsTextureDevice
from graphics_material_bindings import GraphicsMaterialBindings
from material_uniform_update_native import material_uniform_copy, update_material_uniforms


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('--angle', required=True, type=Path)
    args = p.parse_args()
    inputs = {}

    def raw(path):
        data = Path(path).read_bytes()
        inputs[str(Path(path).resolve())] = hashlib.sha256(data).hexdigest()
        return data

    oracle = json.loads(raw(args.cache / 'research/material-uniform-update-native.json'))
    if (oracle['build'] != '16.21.829.8620' or
            not oracle['scope']['originalCpuKernelsExecuted']):
        raise ValueError('Exact original material-update observations required')
    for path, digest in {**oracle['inputs'], **oracle['sources']}.items():
        if hashlib.sha256(raw(path)).hexdigest() != digest:
            raise ValueError('Original material uniform producer changed: ' + path)
    shaders = SimpleNamespace(shaders={})
    device = GraphicsTextureDevice(args.angle)
    backend = GraphicsMaterialBindings(device, shaders)
    cpu = []
    gpu = []
    rejects = 0
    try:
        for case in oracle['cases']:
            initial, source = bytes.fromhex(case['initialHex']), bytes.fromhex(case['sourceHex'])
            after, changed, copied = material_uniform_copy(initial, case['declarations'],
                                                           case['name'], case['vectorCount'], source)
            if (after.hex() != case['afterHex'] or changed != case['changed'] or
                    copied != case['copiedBytes']):
                raise ValueError('Material uniform CPU translation differs from original observation')
            if material_uniform_copy(after, case['declarations'], case['name'],
                                     case['vectorCount'], source)[1]:
                raise ValueError('Repeated material uniform update is not a no-op')
            cpu.append({'kernelRva': case['kernelRva'], 'changed': changed, 'copiedBytes': copied})
            buffers = []
            for index, stage in enumerate(['vertex', 'pixel'], 1):
                if any(row['hash'] != xxhash.xxh32_intdigest(b'Tint') for row in case['declarations']):
                    raise ValueError('Fixture reflection does not identify its explicit Tint member names')
                block = {'name': '$Globals', 'glslName': 'control_' + stage, 'size': len(initial),
                         'members': [{'name': 'Tint', 'offset': row['offset'], 'size': row['size'], 'used': True}
                                     for row in case['declarations']]}
                shaders.shaders[index] = {'translation': {'sidecar': {'blocks': [block]}}}
                handle = C.c_uint()
                device.gl.glGenBuffers(1, C.byref(handle))
                backend.buffers.append(handle)
                device.gl.glBindBuffer(0x8a11, handle)
                data = C.create_string_buffer(initial)
                device.gl.glBufferData(0x8a11, len(initial), data, 0x88e8)
                buffers.append({'stage': stage, 'name': block['glslName'], 'glHandle': handle.value,
                                'bytesHex': initial.hex()})
            binding = {'glProgram': 0, 'uniformBuffers': buffers,
                       'requiredSceneBlocks': [], 'requiredSceneDataBuffers': []}
            backend.records.append(binding)
            program = {'glHandle': 0, 'vertex': 1, 'pixel': 2}
            result = update_material_uniforms(backend, binding, program, case['name'], case['vectorCount'], source)
            if (result['changed'] != case['changed'] or len(result['buffers']) != 2 or
                    any(buffer['bytesHex'] != case['afterHex'] for buffer in buffers)):
                raise ValueError('Material uniform GLES update differs from original observation')
            repeat = update_material_uniforms(backend, binding, program, case['name'], case['vectorCount'], source)
            if repeat['changed']:
                raise ValueError('Repeated GLES update changed a buffer')
            gpu.append(result)
        before = [row['bytesHex'] for row in binding['uniformBuffers']]
        for bad_binding, bad_name, bad_count, bad_source in [
                (dict(binding), 'Tint', 1, source),
                (binding, 'Tint', -1, source),
                (binding, 'Tint', 0x100000000, source),
                (binding, 'Tint', True, source),
                (binding, 'Tint', 1, b''),
                (binding, 'Bad\0Name', 1, source)]:
            try:
                update_material_uniforms(backend, bad_binding, program, bad_name, bad_count, bad_source)
            except ValueError:
                rejects += 1
            else:
                raise ValueError('Invalid material uniform update was admitted')
        binding['requiredSceneBlocks'] = [{'requiredMembers': [{'name': 'Tint'}]}]
        try:
            update_material_uniforms(backend, binding, program, 'Tint', 1, source)
        except ValueError:
            rejects += 1
        else:
            raise ValueError('Unimplemented scene buffer update was admitted')
        if before != [row['bytesHex'] for row in binding['uniformBuffers']]:
            raise ValueError('Rejected material update changed an owned buffer')
    finally:
        backend.close()
        device.close()
    paths = [Path(__file__), Path(inspect.getfile(material_uniform_copy)),
             Path(inspect.getfile(GraphicsTextureDevice)), Path(inspect.getfile(GraphicsMaterialBindings)),
             Path(xxhash._xxhash.__file__)]
    paths += [args.angle / name for name in ['libEGL.dll', 'libGLESv2.dll']]
    for path in paths:
        raw(path)
    for path, digest in inputs.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
            raise ValueError('Material uniform proof input changed: ' + path)
    result = {'schema': 1, 'kind': 'original-material-uniform-update-gles-comparison',
              'build': oracle['build'], 'inputs': inputs, 'cpuCases': cpu, 'gpuCases': gpu,
              'rejectControls': rejects, 'differences': 0,
              'scope': {'originalCpuObservationsCompared': True, 'gpuBufferUpdatesAndReadback': True,
                        'suppliedReflectionAndBufferControls': True, 'nativeMetalDerivedObjects': False,
                        'originalMaterialCallsiteExecuted': False, 'gpuDrawSubmitted': False,
                        'matchCoverage': False}}
    output = args.cache / 'research/material-uniform-update-gles-comparison.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cpuCases': len(cpu), 'gpuCases': len(gpu),
                      'rejectControls': rejects, 'differences': 0}))


if __name__ == '__main__':
    main()
