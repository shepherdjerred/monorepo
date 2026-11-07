"""Raster native ground packets with the proven native all-vision resource.

Extent values, projection, camera and scene color state are supplied controls.
This tests coordinate invariance; actual map extent and team FoW are unrecovered.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('ground_fow_draw', Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('angle', type=Path)
    parser.add_argument('--additional-native', type=Path, action='append', default=[])
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}
    assets = cache / 'public'

    def raw(path):
        data = path.read_bytes()
        inputs[str(path)] = adapter.sha(data)
        return data

    def read(path):
        return json.loads(raw(path))

    package = read(assets / 'latest-direct-ground-materials/package.json')
    native = read(cache / 'research/direct-ground-schedule-native.json')
    additional = [read(path.resolve()) for path in args.additional_native]
    for source in additional:
        if (source.get('kind') != 'native-singleton-zero-emitter-position-controls' or
                source.get('scope', {}).get('originalEmitterUpdateAndGeometry') is not True or
                source.get('build') != package['build'] or source.get('protocol') != package['protocol']):
            raise ValueError('Additional geometry must be exact original complete-emitter controls')
    fow = read(cache / 'research/direct-ground-fow-native.json')
    old = read(assets / 'latest-complete-quad-gpu/package.json')
    manifest = read(assets / 'latest-effects/manifest.json')
    image = raw(assets / 'decoder-16.21-macos/image.bin')
    for source in [package, native, *additional, fow]:
        for filename, digest in source['inputs'].items():
            if adapter.sha(raw(Path(filename))) != digest:
                raise ValueError('Ground control input changed: ' + filename)
        for filename, digest in source.get('sources', {}).items():
            if adapter.sha(raw(Path(__file__).with_name(filename))) != digest:
                raise ValueError('Ground control producer changed: ' + filename)
        for block in source.get('originalBlocks', []):
            if adapter.sha(image[block['rva']:block['rva'] + block['size']]) != block['sha256']:
                raise ValueError('Ground geometry original instruction bytes changed')
    resource = fow['defaultTextures']['offsetA0']['resource']
    if (not resource['gpuBytesVerified'] or resource['width'] != 1 or resource['height'] != 1 or
            resource['nativeFormat'] != 2 or resource['levelsHex'] != [['ffffffff']]):
        raise ValueError('Exact original default all-vision resource required')
    bindings = {(b['effectId'], b['emitterIndex']): b for b in old['emitters']}
    renderer = adapter.Draw(args.angle)
    programs, textures, records, panels = {}, {}, [], []
    try:
        for attempt in package['attempts']:
            identity = (attempt['effectId'], attempt['emitterIndex'])
            matches = [(source, c) for source in [native, *additional] for c in source['cases']
                       if (c['effectId'], c['emitterIndex']) == identity and
                       c.get('variant', 'authored') == 'authored']
            if not matches:
                raise ValueError('Missing exact original ground geometry: ' + str(identity))
            geometry_source, case = matches[0]
            source_ref = manifest['definitions'][identity[0]]
            source_path = assets / 'latest-effects' / source_ref['file']
            source_raw = raw(source_path)
            if adapter.sha(source_raw) != source_ref['sha256'] or source_ref['sha256'] != attempt['sourceDefinitionSha256']:
                raise ValueError('Ground geometry/material source identity changed')
            blend = json.loads(source_raw)['definition']['complexEmitterDefinitionData'][identity[1]].get('blendMode', 0)
            best, score = None, -1
            for frame in case['frames']:
                encoded = bytes.fromhex(frame['output']['geometry']['verticesHex'])
                if not encoded:
                    continue
                points = np.array([struct.unpack_from('<3f', encoded, i) for i in range(0, len(encoded), 28)])
                if not any(np.any(np.cross(points[i+1] - points[i], points[i+3] - points[i]) != 0)
                           for i in range(0, len(points), 4)):
                    continue
                color_score = max(max(encoded[i+12:i+15]) if blend == 0 else encoded[i+15]
                                  for i in range(0, len(encoded), 28))
                if color_score > 1 and color_score > score:
                    best, score = frame, color_score
            if best is None:
                raise ValueError('Ground component needs an explicitly recorded visual omission: ' + str(identity))
            vertices = bytes.fromhex(best['output']['geometry']['verticesHex'])
            indices = bytes.fromhex(best['output']['geometry']['indicesHex'])
            points = np.array([struct.unpack_from('<3f', vertices, i) for i in range(0, len(vertices), 28)])
            spans = np.ptp(points, axis=0)
            axes = np.argsort(spans)[-2:]
            center = (points.min(axis=0) + points.max(axis=0)) / 2
            extent = max(spans) * .65
            projection = np.zeros((4, 4))
            for lane, axis in enumerate(axes):
                projection[lane, axis] = 1 / extent
                projection[lane, 3] = -center[axis] / extent
            projection[2, 3], projection[3, 3] = .5, 1
            refs = attempt['shaderProgram']
            key = tuple(refs[s]['sha256'] for s in ['vertex', 'pixel'])
            if key not in programs:
                stages = []
                for stage in ['vertex', 'pixel']:
                    data = raw(assets / 'latest-shaders' / refs[stage]['file'])
                    if adapter.sha(data) != refs[stage]['sha256']:
                        raise ValueError('Ground shader changed')
                    stages.append(json.loads(data))
                programs[key] = (renderer.program(*stages), stages)
            program, stages = programs[key]
            parameters = {p['name']: bytes.fromhex(p['bytesHex']) for p in attempt['nativeParameters']}
            old_binding = bindings[identity]
            bound = {}
            for shader in stages:
                for texture in shader['sidecar']['textures']:
                    if texture['name'] == 'FOW_MAP_SharedTexture':
                        continue
                    candidates = [old_binding['textures'][s['glslName']] for s in texture['samplers']]
                    if not candidates or any(c != candidates[0] for c in candidates):
                        raise ValueError('Ground texture sampler alias conflict')
                    texture_ref = candidates[0]
                    texture_key = json.dumps(texture_ref, sort_keys=True)
                    if texture_key not in textures:
                        if texture_ref['kind'] == 'prepared-texture':
                            path = assets / 'latest-effects' / texture_ref['file']
                            if adapter.sha(raw(path)) != texture_ref['sha256']:
                                raise ValueError('Ground authored texture changed')
                            pixels = np.array(Image.open(path).convert('RGBA'))
                            sampler = next(s for s in attempt['samplers'] if s['layer'] == 'base')
                            if texture_ref['nativeSamplerHex'] != sampler['descriptorHex']:
                                raise ValueError('Ground authored sampler differs from original')
                            address = texture_ref['sampler']['name']
                            filtering = 'nearest' if texture_ref['sampler']['pixelated'] else 'linear'
                        elif texture_ref['kind'] in ['supplied-white-lookup', 'supplied-transparent-remap']:
                            pixels = np.full((1, 1, 4), 255 if texture_ref['kind'] == 'supplied-white-lookup' else 0, dtype=np.uint8)
                            address, filtering = 'clamp', 'nearest'
                        else:
                            raise ValueError('Unbound ground base/remap resource')
                        textures[texture_key] = renderer.texture(pixels, address, filtering)
                    bound[texture['name']] = textures[texture_key]
            baseline, variants = None, []
            for control in fow['uniformControls']:
                fog_vector = control['nativeVector']
                uv = points[:, [0, 2]] * fog_vector[:2] + fog_vector[2:]
                if not np.isfinite(uv).all():
                    raise ValueError('Supplied extent produces invalid FoW coordinates')
                for filtering in ['nearest', 'linear']:
                    texture_key = 'original-default-a0-' + filtering
                    if texture_key not in textures:
                        # Exact bytes from the original default constructor and
                        # verified GPU readback above, never a missing-map fallback.
                        pixels = np.frombuffer(bytes.fromhex(resource['levelsHex'][0][0]), dtype=np.uint8).reshape(1, 1, 4)
                        textures[texture_key] = renderer.texture(pixels, 'clamp', filtering)
                    bound['FOW_MAP_SharedTexture'] = textures[texture_key]
                    values = {}
                    for shader in stages:
                        for block in shader['sidecar']['blocks']:
                            for member in block['members']:
                                if not member['used']:
                                    continue
                                name = member['name']
                                if name == 'mProj': value = projection.flatten().tolist()
                                elif name == 'vCamera': value = [0, 1000, 0]
                                elif name == 'FOG_OF_WAR_PARAMS': value = fog_vector
                                elif name in parameters:
                                    value = list(struct.unpack('<' + 'f' * (member['size'] // 4), parameters[name][:member['size']]))
                                elif name in ['RENDERTARGET_IS_SRGB', 'DEBUG_RENDERTARGET_IS_SRGB_HANDLED']: value = [0]
                                else: raise ValueError('Unprovided ground shader uniform: ' + name)
                                values[block['glslName'] + '.' + name] = value
                    factors = old_binding['nativeBlendFactors']
                    if factors[0] != factors[1] or factors[2] != factors[3]:
                        raise ValueError('Ground diagnostic needs separate-alpha blending')
                    mapping = {1: 1, 6: 0x302, 7: 0x303}
                    rgba, _buffers = renderer.draw(program, stages, vertices, indices, values, bound,
                        blend=(mapping[factors[0]], mapping[factors[2]]))
                    data = rgba.tobytes()
                    if baseline is None: baseline = data
                    if data != baseline: raise ValueError('Native all-vision ground output changes with valid supplied extent/filter')
                    variants.append({'suppliedExtent': control['suppliedExtent'], 'nativeFowVector': fog_vector,
                                     'suppliedFilter': filtering, 'rgbaSha256': adapter.sha(data)})
            visible = int(np.count_nonzero(np.any(np.abs(rgba[:, :, :3].astype(int) - [6, 9, 14]) > 2, axis=2)))
            if not visible: raise ValueError('Ground native all-vision sample has no changed pixels')
            rgb = rgba[:, :, :3].astype(float) / 255
            display = np.clip(np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1/2.4) - .055), 0, 1)
            panels.append(Image.fromarray(np.uint8(display * 255)).resize((256, 256)))
            records.append({'effectId': identity[0], 'emitterIndex': identity[1], 'time': best['input']['time'],
                            'visiblePixels': visible, 'variants': variants,
                            'geometryProducerKind': geometry_source.get('kind'),
                            'blendAwareVisualScore': score})
    finally:
        for program, _ in programs.values(): renderer.gl.glDeleteProgram(program)
        renderer.close()
    sheet = Image.new('RGB', (4*276, 2*306+75), '#101822')
    draw = ImageDraw.Draw(sheet)
    draw.text((15, 15), 'Original ground pass5 / proven native all-vision texture / supplied extent controls', fill='#e6edf3')
    draw.text((15, 38), 'Native geometry; no recorded spectator flag, actual map extent, team visibility or match coverage claim.', fill='#b7c9d9')
    for index, (panel, record) in enumerate(zip(panels, records)):
        x, y = (index % 4)*276+10, (index//4)*306+75
        sheet.paste(panel, (x, y))
        draw.text((x, y+262), record['effectId'].split('/')[1] + '/emitter' + str(record['emitterIndex']), fill='#e6edf3')
    output_image = cache / 'visuals/direct-ground-fow-components.png'
    sheet.save(output_image)
    for filename in [Path(__file__), Path(adapter.__file__), Path(adapter.adapter.__file__)]: raw(filename)
    for filename in ['libEGL.dll', 'libGLESv2.dll']: raw(args.angle / filename)
    report = {'schema': 1, 'kind': 'native-ground-all-vision-coordinate-controls', 'inputs': inputs,
              'cases': records, 'image': str(output_image), 'context': renderer.info,
              'scope': {'originalPass5Shaders': True, 'originalNativeGeometry': True,
                        'originalConstructorTextureBytesGpuVerified': True, 'coordinateExtentControls': True,
                        'actualMapExtentRecovered': False, 'actualSpectatorFlagRecovered': False,
                        'dynamicTeamVisibility': False, 'depthSceneProvided': False,
                        'neutralColorLookupAndRemapSupplied': True, 'mainViewerExpanded': False}}
    output = cache / 'research/direct-ground-fow-rendering.json'
    output.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'components': len(records),
                      'draws': sum(len(r['variants']) for r in records), 'invariant': True, 'image': str(output_image)}))


if __name__ == '__main__':
    main()
