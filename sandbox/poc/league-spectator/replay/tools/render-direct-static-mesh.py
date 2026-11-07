"""Raster original individual mesh uniforms with explicit diagnostic scene inputs.

The two integer textures are deliberately different API-completeness controls,
never reconstructed 208-byte game instance records. Mode zero must ignore both.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageDraw

from offscreen_static_mesh import StaticMeshDraw, adapter
from graphics_material_bindings import GraphicsMaterialBindings
from graphics_pipeline_device import GraphicsPipelineDevice


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('angle', type=Path)
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}
    directory = cache / 'research/direct-static-mesh-materials'

    def raw(path):
        path = path.resolve()
        value = path.read_bytes()
        digest = adapter.sha(value)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Static mesh input changed during capture: ' + str(path))
        inputs[str(path)] = digest
        return value

    def read(path):
        return json.loads(raw(path))

    for path in [Path(__file__), Path(inspect.getfile(StaticMeshDraw)),
                 Path(adapter.__file__), Path(adapter.adapter.__file__),
                 Path(inspect.getfile(GraphicsMaterialBindings)),
                 Path(inspect.getfile(GraphicsPipelineDevice))]:
        raw(path)
    for filename in ['libEGL.dll', 'libGLESv2.dll']:
        raw(args.angle / filename)
    package = read(directory / 'package.json')
    proof = read(cache / 'research/direct-mesh-draw-branch-comparison.json')
    exported = read(cache / 'research/direct-static-mesh-bindings.json')
    native_scene = read(cache / 'research/direct-ground-fow-native.json')
    native_raster = read(cache / 'research/native-raster-conventions-comparison.json')
    if (native_raster['kind'] != 'original-metal-to-gles-raster-coordinate-comparison' or
            not native_raster['scope']['originalDescriptorAndApiMessagesCompared'] or
            not native_raster['scope']['oppositeViewportOriginWindingConversion']):
        raise ValueError('Original native raster API and viewport proof required')
    scene_pixels = []
    for offset, expected in [('offsetA0', 'ffffffff'), ('offsetA8', '00000000')]:
        resource = native_scene['defaultTextures'][offset]['resource']
        if (not resource['gpuBytesVerified'] or resource['width'] != 1 or
                resource['height'] != 1 or resource['levelsHex'] != [[expected]]):
            raise ValueError('Original white/transparent scene resources required')
        scene_pixels.append(list(bytes.fromhex(expected)))
    if (proof['kind'] != 'original-individual-mesh-shader-branch-comparison' or
            proof['originalInstanceFlag'] != 0 or
            not proof['scope']['nativeIndividualMeshPrefixExecuted']):
        raise ValueError('Exact original individual mesh shader control required')
    if (exported['kind'] != 'factory-noninstanced-static-mesh-bindings' or
            not exported['scope']['actualFactoryExecuted']):
        raise ValueError('Actual shared material factory bindings required')
    for source in [package, proof, exported, native_scene, native_raster]:
        for filename, digest in source['inputs'].items():
            if adapter.sha(raw(Path(filename))) != digest:
                raise ValueError('Static mesh proof input changed: ' + filename)
    image = raw(cache / 'public/decoder-16.21-macos/image.bin')
    emitter = next(e for e in package['emitters'] if e['emitterIndex'] == 15 and
                   e['effectId'] == 'champions/hecarim/0/e57b8289')
    row = next(r for r in emitter['rows'] if r['hash'] == proof['selectedPassHash'])
    if len(row['variants']) != 1 or emitter['mesh']['stride'] != 36:
        raise ValueError('One original static mesh material variant required')
    variant = row['variants'][0]

    def resource(ref):
        value = raw(directory / ref['file'])
        if adapter.sha(value) != ref['sha256'] or len(value) != ref['bytes']:
            raise ValueError('Static mesh package resource changed')
        return value

    stages = [json.loads(resource(variant['shaders'][side]))
              for side in ['vertex', 'pixel']]
    vertices = resource(emitter['mesh']['vertices'])
    count = len(vertices) // 36
    if count != emitter['mesh']['triangles'] * 3:
        raise ValueError('Original expanded SCB triangle count differs')
    indices = np.arange(count, dtype='<u2').tobytes()
    snapshots = {(b['stage'], b['name']): b for b in proof['stageUniformSnapshots']}
    world = np.frombuffer(bytes.fromhex(snapshots['vertex', 'CharacterPerDrawVertexCB_vs']['bytesHex']),
                          dtype='<f4', count=16).reshape(4, 4)
    points = np.array([struct.unpack_from('<3f', vertices, at) for at in range(0, len(vertices), 36)])
    world_points = np.column_stack([points, np.ones(count)]) @ world.T
    extent = np.ptp(world_points[:, [0, 2]], axis=0).max() * .65
    center = (world_points[:, [0, 2]].min(0) + world_points[:, [0, 2]].max(0)) / 2
    if not np.isfinite(extent) or extent <= 0:
        raise ValueError('Finite original static mesh projection extent required')
    renderer = StaticMeshDraw(args.angle)
    materials = GraphicsMaterialBindings(renderer, None)
    records, panels = [], []
    try:
        program = renderer.program(*stages)
        pipeline_device = GraphicsPipelineDevice(renderer, image)
        pipeline = pipeline_device.create(bytes.fromhex(variant['pipeline']['descriptorHex']),
                                          {'linked': True, 'glHandle': program})
        if pipeline['state'] != variant['pipeline']['state']:
            raise ValueError('Static mesh native pipeline differs')
        raster = exported['cases'][0]['glesRaster']
        if (raster['sourceState'] != pipeline['state'] or
                raster['policy'] != 'metal-upper-left-to-gles-lower-left-unchanged-ndc-v1' or
                raster['cullModeChanged'] or not raster['windingReversed']):
            raise ValueError('Verified native-to-GLES viewport coordinate adapter required')
        adapted_pipeline = {**pipeline, 'state': raster['state']}

        def apply_pipeline():
            pipeline_device.apply(adapted_pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])
            return pipeline_device.inspect(adapted_pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])

        textures = {}
        for texture in variant['textures']:
            if texture['pixelFormat'] != 'RGBA8' or len(texture['levels']) != 1 or len(texture['levels'][0]) != 1:
                raise ValueError('Only original single-plane RGBA8 static textures admitted')
            plane = texture['levels'][0][0]
            pixels = np.frombuffer(resource(plane), dtype=np.uint8).reshape(plane['height'], plane['width'], 4)
            handle = renderer.texture(pixels, 'clamp', 'nearest')
            sampler = materials.sampler(bytes.fromhex(texture['sampler']['descriptorHex']))
            textures[texture['name']] = {'handle': handle, 'sampler': sampler['glHandle'], 'unit': texture['unit']}
        # These scene resources are explicit controls; this diagnostic does not
        # recover the actual spectator's vision or color-remap selection.
        for name, rgba, unit in [('FOW_MAP_SharedTexture', scene_pixels[0], 1),
                                 ('PIXEL_COLOR_REMAP_RAMP_SharedTexture', scene_pixels[1], 2)]:
            handle = renderer.texture(np.array([[rgba]], dtype=np.uint8), 'clamp', 'nearest')
            textures[name] = {'handle': handle, 'sampler': 0, 'unit': unit}
        control_words = [bytes(208), struct.pack('<52f', *[.125 + i / 128 for i in range(52)])]
        handles = [renderer.uint_texture(words) for words in control_words]
        for facing in [1, -1]:
            projection = np.zeros((4, 4))
            projection[0, 0], projection[0, 3] = 1 / extent, -center[0] / extent
            projection[1, 2], projection[1, 3] = facing / extent, -facing * center[1] / extent
            projection[2, 3], projection[3, 3] = .5, 1
            scene = {'mProj': projection.flatten().tolist(), 'vCamera': [0, -facing * 10000, 0],
                     'FOG_OF_WAR_PARAMS': [.0001, .0001, .5, .5],
                     'FOG_OF_WAR_ALWAYS_BELOW_Y': [0, 0, 0, 1],
                     'mCameraForward': [0, facing, 0], 'mCameraUp': [0, 0, facing],
                     'FOW_EDGE_CONTROL': [0, 0, 0, 1], 'RENDERTARGET_IS_SRGB': [0]}
            blocks = []
            for side, stage in zip(['vertex', 'pixel'], stages, strict=True):
                for block in stage['sidecar']['blocks']:
                    snapshot = snapshots.get((side, block['glslName']))
                    if snapshot is None:
                        if any(t['name'] == block['name'] and t['dimension'] == 'buffer'
                               for t in stage['sidecar']['textures']):
                            continue
                        raise ValueError('Unowned mesh reflection block')
                    packed = bytearray.fromhex(snapshot['bytesHex']) if snapshot['complete'] else bytearray(block['size'])
                    if not snapshot['complete']:
                        for member in block['members']:
                            if not member['used']:
                                continue
                            value = scene[member['name']]
                            code = 'I' if member['scalar'] == 'uint' else 'f'
                            if len(value) * 4 != member['size']:
                                raise ValueError('Explicit mesh scene input width differs')
                            struct.pack_into('<' + code * len(value), packed, member['offset'], *value)
                    blocks.append({'stage': side, 'name': block['glslName'], 'bytes': bytes(packed), 'binding': len(blocks)})
            factory = next(c for c in exported['cases'] if c['diagnosticFacing'] == facing)
            factory_blocks = {(b['stage'], b['name']): b for b in factory['uniformBlocks']}
            for block in blocks:
                original = factory_blocks.get((block['stage'], block['name']))
                if original is None or bytes.fromhex(original['bytesHex']) != block['bytes']:
                    raise ValueError('Shared factory differs from original reflected uniforms: ' + block['name'])
            results = []
            for mode, control in [(0, 0), (0, 1), (1, 0)]:
                current = []
                for block in blocks:
                    packed = bytearray(block['bytes'])
                    if block['name'] == 'VFXDynamicPerParticleInstanceCBVS_vs':
                        struct.pack_into('<I', packed, 44, mode)
                    if block['name'] == 'VFXDynamicPerParticleInstanceCBPS_ps':
                        struct.pack_into('<I', packed, 16, mode)
                    current.append({**block, 'bytes': bytes(packed)})
                rgba, observations = renderer.draw_mesh(program, stages, vertices, indices, current, textures,
                    {'ParticleMeshInstanceInfo_SharedDataBuffer': {'unit': 0, 'handle': handles[control], 'sampler': 0}}, apply_pipeline)
                pixels = int(np.count_nonzero(np.any(np.abs(rgba[:, :, :3].astype(int) - [6, 9, 14]) > 2, axis=2)))
                results.append(rgba)
                records.append({'diagnosticFacing': facing, 'instanceMode': mode, 'controlWordsSha256': adapter.sha(control_words[control]),
                                'visiblePixels': pixels, 'rgbaSha256': adapter.sha(rgba.tobytes()), **observations})
                rgb = rgba[:, :, :3].astype(float) / 255
                display = np.clip(np.where(rgb <= .0031308, rgb * 12.92,
                                  1.055 * rgb ** (1/2.4) - .055), 0, 1)
                panels.append(Image.fromarray(np.uint8(display * 255)))
            if not np.array_equal(results[0], results[1]):
                raise ValueError('Original individual mesh branch reads the synthetic instance controls')
            if records[-3]['visiblePixels'] and np.array_equal(results[0], results[2]):
                raise ValueError('Static mesh instancing control is vacuous')
            # Exercise coordinate and vertical-factor independence of the
            # declared allvision policy with the unchanged mesh shader pair.
            invariance = []
            for fog, below in [([.01, -.01, 0, 1], [0, 0, 0, 1]),
                               ([10, -7, 50, -80], [0, 0, 1, -.5]),
                               ([-.001, .002, -4, 2], [0, 0, -2, .25])]:
                current = []
                for block in blocks:
                    packed = bytearray(block['bytes'])
                    if block['name'] == 'PerFrameVertexCB_vs':
                        struct.pack_into('<4f', packed, 304, *fog)
                        struct.pack_into('<4f', packed, 320, *below)
                    current.append({**block, 'bytes': bytes(packed)})
                rgba, _ = renderer.draw_mesh(program, stages, vertices, indices, current, textures,
                    {'ParticleMeshInstanceInfo_SharedDataBuffer': {'unit': 0, 'handle': handles[0], 'sampler': 0}}, apply_pipeline)
                if not np.array_equal(rgba, results[0]):
                    raise ValueError('Declared original-resource allvision mesh policy depends on scene coordinates')
                invariance.append({'fog': fog, 'below': below, 'rgbaSha256': adapter.sha(rgba.tobytes())})
            records[-3]['allvisionCoordinateControls'] = invariance
        if not any(r['visiblePixels'] for r in records if r['instanceMode'] == 0):
            raise ValueError('Original individual mesh branch produced no visible pixels')
    finally:
        materials.close()
        renderer.close()
    for filename, digest in inputs.items():
        if adapter.sha(Path(filename).read_bytes()) != digest:
            raise ValueError('Final static mesh draw input drift: ' + filename)
    sheet = Image.new('RGB', (1536, 1080), '#18202a')
    labels = ['original individual / zero data', 'original individual / varied data', 'synthetic instanced / zero data']
    draw = ImageDraw.Draw(sheet)
    for i, panel in enumerate(panels):
        x, y = i % 3 * 512, i // 3 * 540
        sheet.paste(panel.convert('RGB'), (x, y + 24))
        draw.text((x + 8, y + 6), labels[i % 3], fill='white')
    output = cache / 'visuals/direct-static-mesh-individual.png'
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)
    report = {'schema': 1, 'kind': 'original-individual-static-mesh-gpu-control', 'inputs': inputs,
              'records': records, 'visual': {'file': str(output), 'sha256': adapter.sha(output.read_bytes())},
              'rasterCoordinates': raster,
              'controls': {'individualDataIndependent': True, 'instancedCounterexampleNonvacuous': True,
                           'sharedFactoryUniformBlocksMatchOriginalSnapshots': True},
              'scope': {'originalScbGeometry': True, 'originalSelectedShaders': True, 'originalMaterialPipeline': True,
                        'originalCpuUniformSnapshots': True, 'inactiveUintSamplerApiBindingProven': True,
                        'sceneResources': 'original-a0-a8-texture-bytes-explicit-allvision-remap-omitted-policy',
                        'allvisionCoordinateAndFactorInvariance': True,
                        'camera': 'supplied-two-sided-topdown-projection', 'visualDisplayTransfer': 'linear-rgb-to-srgb-after-readback',
                        'instance208PayloadProduced': False,
                        'sharedRuntimeMeshAdmissionChanged': False, 'browserExecuted': False}}
    path = cache / 'research/direct-static-mesh-gpu-control.json'
    path.write_text(json.dumps(report, indent=2))
    print(json.dumps({'output': str(path), 'inputs': len(inputs), 'records': len(records),
                      'visiblePixels': [r['visiblePixels'] for r in records]}))


if __name__ == '__main__':
    main()
