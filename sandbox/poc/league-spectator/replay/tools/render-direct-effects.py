"""Render direct-runtime packets through prepared shaders in an offscreen pbuffer.

No browser, desktop capture or League process is used. These are isolated,
supplied-world component samples, not rendered coverage of recorded requests.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('direct_draw', Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('angle', type=Path)
    parser.add_argument('--camera', action='store_true')
    parser.add_argument('--loaded', action='store_true')
    parser.add_argument('--angular', action='store_true')
    parser.add_argument('--motion', action='store_true')
    parser.add_argument('--blend', action='store_true')
    parser.add_argument('--ground', action='store_true')
    parser.add_argument('--trail', action='store_true')
    args = parser.parse_args()
    if sum([args.camera, args.loaded, args.angular, args.motion, args.blend, args.ground, args.trail]) > 1:
        parser.error('Choose a single native primitive cohort')
    if args.trail:
        args.motion = True
    cache, inputs = args.cache.resolve(), {}
    assets = cache / 'public'

    def raw(path):
        data = path.read_bytes()
        inputs[str(path.resolve())] = adapter.sha(data)
        return data

    def read(path):
        return json.loads(raw(path))

    raw(Path(__file__))
    raw(Path(adapter.__file__))
    raw(Path(adapter.adapter.__file__))
    for library in ['libEGL.dll', 'libGLESv2.dll']:
        raw(args.angle / library)
    proof = read(cache / ('research/direct-trail-schedule-comparison.json' if args.trail else
                         'research/direct-ground-schedule-comparison.json' if args.ground else
                         'research/direct-blend-schedule-comparison.json' if args.blend else
                         'research/direct-motion-schedule-comparison.json' if args.motion else
                         'research/direct-camera-schedule-comparison.json' if args.camera else
                         'research/direct-angular-schedule-comparison.json' if args.angular else
                         'research/direct-loaded-schedule-comparison.json' if args.loaded else 'research/direct-effect-kernels.json'))
    if proof['mismatches'] or not proof['counts']['vertices']:
        raise ValueError('A passing direct/native component comparison is required')
    for path, digest in proof['inputs'].items():
        if adapter.sha(raw(Path(path))) != digest:
            raise ValueError('Direct component input changed: ' + path)
    packages = [read(assets / directory / filename) for directory, filename in [
        ('latest-complete-quad-gpu', 'package.json'), ('latest-trail-particles', 'gpu.json'),
        ('latest-quad-erosion-gpu', 'package.json')]]
    bindings = {(e['effectId'], e['emitterIndex']): e for p in packages for e in p['emitters']}
    ground_path = assets / 'latest-direct-ground-materials/package.json'
    ground_pin = next((digest for path, digest in proof['inputs'].items()
                       if Path(path).resolve() == ground_path.resolve()), None)
    if ground_pin is not None:
        package = read(ground_path)
        if adapter.sha(raw(ground_path)) != ground_pin or package['scenePolicy']['policy'] != 'native-ground-pass5-all-vision-diagnostic':
            raise ValueError('Exact native ground diagnostic package required')
        for binding in package['emitters']:
            if binding['environment']['pass'] != 5 or binding['materialPolicy'] != package['scenePolicy']['policy']:
                raise ValueError('Ground component does not retain exact pass5 policy')
            bindings[(binding['effectId'], binding['emitterIndex'])] = binding
    elif args.ground:
        raise ValueError('Ground comparison must pin its native material package')
    ground_components = set()
    render_cases = proof['comparisons']
    sequences = proof.get('motionSequences', []) if args.motion else []
    empty_frames = []
    if args.motion:
        if not sequences:
            raise ValueError('Native-compared motion sequences required')
        render_cases = []
        for sequence in sequences:
            key = (sequence['effectId'], sequence['emitterIndex'])
            peak = next((c for c in proof['comparisons']
                         if (c['effectId'], c['emitterIndex']) == key), None)
            # One fixed projection for the entire sequence. Recentring every
            # frame would conceal the authored particle/root displacement.
            if peak is None:
                continue
            def points_of(geometry):
                encoded = bytes.fromhex(geometry['verticesHex'])
                return np.array([struct.unpack_from('<3f', encoded, i)
                                 for i in range(0, len(encoded), 28)])
            peak_points = points_of(peak['visual']['geometry'][0])
            points = np.concatenate([points_of(frame['geometry']) for frame in sequence['frames']
                                     if frame['geometry']['verticesHex']])
            if sequence['primitiveKind'] in ['camera', 'camera-trail']:
                right, up = np.array(sequence['camera']['right']), np.array(sequence['camera']['up'])
            else:
                axes = np.argsort(np.ptp(peak_points, axis=0))[-2:]
                right, up = np.eye(3)[axes[0]], np.eye(3)[axes[1]]
            projected = np.column_stack((points @ right, points @ up))
            center = (projected.min(0) + projected.max(0)) / 2
            extent = np.ptp(projected, axis=0).max() * .6
            if not np.isfinite(extent) or extent <= 0:
                raise ValueError('Motion sequence projection has no finite extent')
            projection = np.zeros((4, 4))
            projection[0, :3], projection[1, :3] = right / extent, up / extent
            projection[0, 3], projection[1, 3] = -center / extent
            projection[2, 3], projection[3, 3] = .5, 1
            for frame in sequence['frames']:
                render_cases.append({**sequence, 'projectionMatrix': projection,
                    'visual': {'time': frame['time'], 'geometry': [frame['geometry']]}})
    renderer = adapter.Draw(args.angle)
    programs, textures, panels, records, omitted = {}, {}, [], [], list(proof.get('visualOmissions', []))
    try:
        for case in render_cases:
            camera_projection = args.camera or args.trail or ((args.blend or args.ground) and case['primitiveKind'] == 'camera')
            binding = bindings.get((case['effectId'], case['emitterIndex']))
            if binding is None:
                omitted.append({'effectId': case['effectId'], 'emitterIndex': case['emitterIndex'], 'reason': 'material:translated-shader-binding'})
                continue
            if binding.get('materialPolicy') == 'native-ground-pass5-all-vision-diagnostic':
                ground_components.add((case['effectId'], case['emitterIndex']))
            for geometry in case['visual']['geometry']:
                vertices, indices = bytes.fromhex(geometry['verticesHex']), bytes.fromhex(geometry['indicesHex'])
                if not indices:
                    if args.motion:
                        empty_frames.append({'effectId': case['effectId'], 'emitterIndex': case['emitterIndex'],
                            'time': case['visual']['time'], 'reason': 'native-compared-no-live-geometry'})
                    continue
                points = np.array([struct.unpack_from('<3f', vertices, i) for i in range(0, len(vertices), 28)])
                low, high = points.min(0), points.max(0)
                axes = np.argsort(high - low)[-2:]
                center = (low + high) / 2
                if args.motion:
                    projection = case['projectionMatrix']
                elif camera_projection:
                    right, up = np.array(case['camera']['right']), np.array(case['camera']['up'])
                    projected = np.column_stack((points @ right, points @ up))
                    extent = np.ptp(projected, axis=0).max() * .6
                else:
                    extent = max((high - low)[axes]) * .6
                if not args.motion:
                    if not np.isfinite(extent):
                        raise ValueError('Direct packet has a nonfinite extent')
                    if extent <= 0:
                        omitted.append({'effectId': case['effectId'], 'emitterIndex': case['emitterIndex'],
                                        'time': case['visual']['time'], 'camera': case.get('camera'),
                                        'reason': 'geometry:zero-extent-native-component'})
                        continue
                    projection = np.zeros((4, 4))
                    if camera_projection:
                        projection[0, :3], projection[1, :3] = right / extent, up / extent
                        projection[0, 3], projection[1, 3] = -np.dot(center, right) / extent, -np.dot(center, up) / extent
                    else:
                        projection[0, axes[0]], projection[1, axes[1]] = 1 / extent, 1 / extent
                        projection[0, 3], projection[1, 3] = -center[axes[0]] / extent, -center[axes[1]] / extent
                    projection[2, 3], projection[3, 3] = .5, 1
                key = tuple(binding['shaders'][stage]['sha256'] for stage in ['vertex', 'pixel'])
                if key not in programs:
                    stages = []
                    for stage in ['vertex', 'pixel']:
                        ref = binding['shaders'][stage]
                        data = raw(assets / 'latest-shaders' / ref['file'])
                        if adapter.sha(data) != ref['sha256']:
                            raise ValueError('Direct shader hash differs')
                        stages.append(json.loads(data))
                    programs[key] = (renderer.program(*stages), stages)
                program, stages = programs[key]
                values, bound = {}, {}
                for shader in stages:
                    for block in shader['sidecar']['blocks']:
                        prepared = next(b for b in binding['blocks'] if b['glslName'] == block['glslName'])
                        data = bytes.fromhex(prepared['bytesHex'])
                        for member in block['members']:
                            if not member['used']:
                                continue
                            if member['name'] == 'mProj':
                                value = projection.flatten().tolist()
                            elif member['name'] == 'vCamera':
                                value = [0, 1000, 0]
                            else:
                                code = {'float': 'f', 'uint': 'I', 'int': 'i', 'bool': 'I'}[member['scalar']]
                                value = list(struct.unpack_from('<' + code * (member['size'] // 4), data, member['offset']))
                            values[block['glslName'] + '.' + member['name']] = value
                    for texture in shader['sidecar']['textures']:
                        choices = [binding['textures'][s['glslName']] for s in texture['samplers']]
                        if not choices or any(v != choices[0] for v in choices):
                            raise ValueError('Conflicting direct shader texture binding')
                        resource = choices[0]
                        tk = json.dumps(resource, sort_keys=True)
                        if tk not in textures:
                            if resource['kind'] == 'prepared-texture':
                                path = assets / 'latest-effects' / resource['file']
                                if adapter.sha(raw(path)) != resource['sha256']:
                                    raise ValueError('Direct texture hash differs')
                                pixels = np.array(Image.open(path).convert('RGBA'))
                                address = resource['sampler']['name']
                                filtering = 'nearest' if resource['sampler']['pixelated'] else 'linear'
                            elif resource['kind'] == 'native-ground-all-vision':
                                if (resource['rgbaHex'] != 'ffffffff' or
                                        resource['nativeTextureSha256'] != 'ad95131bc0b799c0b1af477fb14fcf26a6a9f76079e48bf090acb7e8367bfd0e' or
                                        resource['sampler'] != {'name': 'clamp', 'pixelated': True}):
                                    raise ValueError('Exact original native all-vision resource required')
                                pixels = np.frombuffer(bytes.fromhex(resource['rgbaHex']), dtype=np.uint8).reshape(1, 1, 4)
                                address, filtering = 'clamp', 'nearest'
                            elif resource['kind'] in ['supplied-white-lookup', 'supplied-transparent-remap']:
                                pixels = np.full((1, 1, 4), 255 if resource['kind'] == 'supplied-white-lookup' else 0, dtype=np.uint8)
                                address, filtering = 'clamp', 'nearest'
                            else:
                                raise ValueError('Unprovided direct texture kind')
                            textures[tk] = renderer.texture(pixels, address, filtering)
                        bound[texture['name']] = textures[tk]
                factors = binding['nativeBlendFactors']
                if factors[0] != factors[1] or factors[2] != factors[3]:
                    raise ValueError('Separate alpha factors need a different offscreen adapter')
                mapping = {1: 1, 6: 0x302, 7: 0x303}
                rgba, buffers = renderer.draw(program, stages, vertices, indices, values, bound,
                    blend=(mapping[factors[0]], mapping[factors[2]]))
                visible = int(np.count_nonzero(np.any(np.abs(rgba[:, :, :3].astype(int) - [6, 9, 14]) > 2, axis=2)))
                rgb = rgba[:, :, :3].astype(float) / 255
                display = np.clip(np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - .055), 0, 1)
                panels.append(Image.fromarray(np.uint8(display * 255)).resize((256, 256)))
                records.append({'effectId': case['effectId'], 'emitterIndex': case['emitterIndex'],
                    'camera': case.get('camera'),
                    'suppliedTime': case['visual']['time'], 'visiblePixels': visible,
                    'verticesSha256': adapter.sha(vertices), 'indicesSha256': adapter.sha(indices),
                    'rgbaSha256': adapter.sha(rgba.tobytes()), 'uniformBuffers': buffers})
    finally:
        for program, _ in programs.values():
            renderer.gl.glDeleteProgram(program)
        renderer.close()
    if not panels:
        raise ValueError('No direct samples reached offscreen rendering')
    sheet_pairs = list(zip(panels, records))
    motion_capture = None
    if args.motion:
        groups = {(s['effectId'], s['emitterIndex']): s for s in sequences}
        samples = {(r['effectId'], r['emitterIndex'], r['suppliedTime']): panel
                   for panel, r in sheet_pairs}
        times = sorted({f['time'] for s in sequences for f in s['frames']})
        animation = []
        for supplied_time in times:
            frame = Image.new('RGB', (3 * 286, ((len(groups) + 2) // 3) * 294 + 65), '#101822')
            labels = ImageDraw.Draw(frame)
            labels.text((16, 14), 'Native-compared direct particle motion / fixed offscreen projections', fill='#e9eef7')
            labels.text((16, 36), f'Supplied time {supplied_time:.2f}s. Moving roots and seeds; no browser or match coverage.', fill='#a8bdd0')
            for i, key in enumerate(groups):
                panel = samples.get((*key, supplied_time), Image.new('RGB', (256, 256), '#2a3442'))
                x, y = (i % 3) * 286 + 15, (i // 3) * 294 + 65
                frame.paste(panel, (x, y))
                labels.text((x, y + 262), key[0].split('/')[1] + ' / ' + str(key[1]), fill='#e9eef7')
            animation.append(frame)
        movie = cache / ('visuals/direct-trail-playback.gif' if args.trail else 'visuals/direct-motion-playback.gif')
        movie.parent.mkdir(parents=True, exist_ok=True)
        durations = [round((times[i + 1] - t) * 1000) if i + 1 < len(times) else 250
                     for i, t in enumerate(times)]
        animation[0].save(movie, save_all=True, append_images=animation[1:], duration=durations, loop=0)
        motion_capture = {'path': str(movie), 'sha256': adapter.sha(movie.read_bytes()),
                          'frames': len(animation), 'suppliedTimes': times, 'components': len(groups),
                          'frameDurationsMs': durations,
                          'projectionPolicy': 'One fixed projection per component across all supplied simulation times',
                          'emptyFrames': empty_frames}
        # A compact static companion uses each component's strongest pixel frame;
        # the report retains every submitted sample and its original time.
        strongest = {}
        for pair in sheet_pairs:
            key = (pair[1]['effectId'], pair[1]['emitterIndex'])
            if key not in strongest or pair[1]['visiblePixels'] > strongest[key][1]['visiblePixels']:
                strongest[key] = pair
        sheet_pairs = list(strongest.values())
    columns, cell_width, cell_height = 4, 286, 304
    rows = (len(sheet_pairs) + columns - 1) // columns
    sheet = Image.new('RGB', (columns * cell_width, rows * cell_height + 90), '#101822')
    drawing = ImageDraw.Draw(sheet)
    drawing.text((16, 16), 'Direct JavaScript effects / prepared game shaders', fill='#e9eef7')
    drawing.text((16, 40), 'Isolated supplied-world components. No browser or match-level coverage claim.', fill='#a8bdd0')
    if ground_components:
        drawing.text((16, 58), 'Ground pass5 uses native all-vision diagnostic policy; recorded team visibility remains unrecovered.', fill='#a8bdd0')
    for i, (panel, record) in enumerate(sheet_pairs):
        x, y = (i % columns) * cell_width + 15, (i // columns) * cell_height + 75
        sheet.paste(panel, (x, y))
        label = record['effectId'].split('/')[1] + ' / emitter ' + str(record['emitterIndex'])
        drawing.text((x, y + 262), label, fill='#e9eef7')
        drawing.text((x, y + 278), str(record['visiblePixels']) + ' changed pixels', fill='#a8bdd0')
    path = cache / ('visuals/direct-trail-components.png' if args.trail else
                    'visuals/direct-ground-components.png' if args.ground else
                    'visuals/direct-blend-components.png' if args.blend else
                    'visuals/direct-motion-components.png' if args.motion else
                    'visuals/direct-camera-components.png' if args.camera else
                    'visuals/direct-angular-components.png' if args.angular else
                    'visuals/direct-loaded-components.png' if args.loaded else 'visuals/direct-effect-components.png')
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)
    if args.camera:
        # A small offscreen flow artifact: three supplied camera poses at the
        # same sampled particle state. This is not a spectator screen capture.
        groups = {}
        for panel, record in zip(panels, records):
            key = (record['effectId'], record['emitterIndex'], record['suppliedTime'])
            groups.setdefault(key, []).append((panel, record))
        if any(len(group) != 3 for group in groups.values()):
            raise ValueError('Camera capture requires three views of each retained state')
        animation = []
        for view in range(3):
            frame = Image.new('RGB', (3 * 286, ((len(groups) + 2) // 3) * 294 + 65), '#101822')
            labels = ImageDraw.Draw(frame)
            labels.text((16, 14), 'Offscreen camera poses / frozen direct particle state', fill='#e9eef7')
            labels.text((16, 36), 'Supplied view '+str(view + 1)+' of 3. No browser or match coverage.', fill='#a8bdd0')
            for i, group in enumerate(groups.values()):
                panel, record = group[view]
                x, y = (i % 3) * 286 + 15, (i // 3) * 294 + 65
                frame.paste(panel, (x, y))
                labels.text((x, y + 262), record['effectId'].split('/')[1]+' / '+str(record['emitterIndex']), fill='#e9eef7')
            animation.append(frame)
        animation[0].save(path.with_name('direct-camera-views.gif'), save_all=True,
                          append_images=animation[1:], duration=600, loop=0)
    result = {'schema': 1, 'kind': 'direct-runtime-offscreen-components', 'inputs': inputs,
        'context': renderer.info,
        'imageSha256': adapter.sha(path.read_bytes()), 'samples': records, 'omitted': omitted,
        'motionCapture': motion_capture,
        'scope': {'offscreenGpuSubmission': True, 'browserExecuted': False, 'matchCoverage': False,
            'suppliedProjection': True, 'sourceEventPlacementVerified': False,
            'groundAllVisionDiagnosticComponents': [list(key) for key in sorted(ground_components)],
            'actualSpectatorFlagRecovered': False, 'dynamicTeamVisibilityRecovered': False}}
    path.with_suffix('.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'image': str(path), 'samples': len(records), 'visibleSamples': sum(r['visiblePixels'] > 0 for r in records)}))


if __name__ == '__main__':
    main()
