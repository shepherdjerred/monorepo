"""Raster native Ray packets through actual owned bindings under an explicit scene."""
import argparse
import inspect
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

from offscreen_ray import RayDraw, adapter
from offscreen_ray_material import prepare_ray_material
from graphics_material_bindings import GraphicsMaterialBindings
from graphics_pipeline_device import GraphicsPipelineDevice


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('cache', type=Path)
    p.add_argument('angle', type=Path)
    args = p.parse_args()
    cache, inputs = args.cache.resolve(), {}

    def raw(path):
        path = Path(path).resolve()
        b = path.read_bytes()
        h = adapter.sha(b)
        if str(path) in inputs and inputs[str(path)] != h:
            raise ValueError('Ray raster input drift: ' + str(path))
        inputs[str(path)] = h
        return b

    for obj in [Path(__file__), Path(inspect.getfile(RayDraw)),
                Path(inspect.getfile(prepare_ray_material)), Path(adapter.__file__),
                Path(adapter.adapter.__file__), Path(inspect.getfile(GraphicsMaterialBindings)),
                Path(inspect.getfile(GraphicsPipelineDevice))]:
        raw(obj)
    for name in ['libEGL.dll', 'libGLESv2.dll']:
        raw(args.angle / name)
    proof = json.loads(raw(cache / 'research/direct-ray-bindings.json'))
    for path, h in proof['inputs'].items():
        if adapter.sha(raw(path)) != h:
            raise ValueError('Owned Ray binding changed: ' + path)
    renderer = RayDraw(args.angle)
    device = GraphicsMaterialBindings(renderer, None)
    pipeline_device = GraphicsPipelineDevice(renderer, raw(cache / 'public/decoder-16.21-macos/image.bin'))
    records, panels = [], []
    try:
        for case in proof['cases']:
            bound = {**case, 'textures': [{**t, 'levelsHex': t['levels']} for t in case['textures']]}
            program, stages, pipeline, textures = prepare_ray_material(renderer, device, pipeline_device, bound, case['glesRaster'])
            blocks = [{**b, 'bytes': bytes.fromhex(b['bytesHex'])} for b in case['uniforms']]

            def apply():
                pipeline_device.apply(pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])
                return pipeline_device.inspect(pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])

            vertices = bytes.fromhex(case['geometry']['verticesHex'])
            indices = bytes.fromhex(case['geometry']['indicesHex'])
            rgba, observations = renderer.draw_ray(program, stages, vertices, indices, blocks, textures, apply)
            changed = int(np.count_nonzero(np.any(np.abs(rgba[:, :, :3].astype(int) - [6, 9, 14]) > 2, axis=2)))
            if changed == 0:
                raise ValueError('Original Ray diagnostic case produced no visible pixels')
            rgb = rgba[:, :, :3].astype(float) / 255
            rgb = np.clip(np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - .055), 0, 1)
            panel = Image.fromarray((rgb * 255).astype(np.uint8))
            ImageDraw.Draw(panel).text((10, 10), f"Ray emitter {case['emitterIndex']} | {changed} pixels", fill='white')
            panels.append(panel)
            records.append({'effectId': case['effectId'], 'emitterIndex': case['emitterIndex'],
                'changedPixels': changed, 'verticesSha256': adapter.sha(vertices),
                'indicesSha256': adapter.sha(indices), 'uniforms': observations,
                'omissions': case['omissions']})
            for t in textures.values():
                renderer.gl.glBindSampler(t['unit'], 0)
        image = Image.new('RGB', (512 * len(panels), 512))
        for i, panel in enumerate(panels):
            image.paste(panel, (i * 512, 0))
        output = cache / 'visuals/direct-ray.png'
        image.save(output)
        for path, h in inputs.items():
            if adapter.sha(Path(path).read_bytes()) != h:
                raise ValueError('Final Ray raster drift: ' + path)
        report = {'schema': 1, 'kind': 'owned-native-ray-offscreen-raster', 'inputs': inputs,
                  'cases': records, 'visual': {'path': str(output), 'sha256': adapter.sha(output.read_bytes())},
                  'scope': {'actualOwnedMaterialFactory': True, 'originalGeometryPackets': True,
                            'scenePolicyExplicit': True, 'browserExecuted': False,
                            'actualMatchWorldRendered': False, 'nativeWorldAcceptance': None}}
        target = cache / 'research/direct-ray-offscreen.json'
        target.write_text(json.dumps(report, indent=2))
        print(json.dumps({'output': str(target), 'cases': len(records),
                          'changedPixels': [r['changedPixels'] for r in records], 'inputs': len(inputs)}))
    finally:
        renderer.close()


if __name__ == '__main__':
    main()
