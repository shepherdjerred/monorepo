"""Compare original DXBC/WARP pixels with translated GLSL/ANGLE pixels.

Both paths receive identical native geometry, constant-buffer bytes, textures
and supplied draw state. No window, browser, desktop or League process is used.
These diagnostic inputs do not establish the game's actual scene or passes.
"""
import argparse
import ctypes as C
import importlib.util
import json
from pathlib import Path
import struct
import subprocess

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('native_draw', Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
Draw, sha = adapter.Draw, adapter.sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'angle', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    sources = {}
    def raw(path):
        data = path.read_bytes()
        sources[str(path.resolve())] = sha(data)
        return data
    def read(path):
        return json.loads(raw(path))
    oracle_dir = cache / 'research/shader-oracle'
    oracle = oracle_dir / 'shader-oracle.exe'
    build = read(oracle_dir / 'build.json')
    if sha(raw(oracle)) != build['binarySha256'] or sha(raw(Path(__file__).with_name('shader-oracle.cpp'))) != build['sourceSha256'] or sha(raw(Path(__file__).with_name('build-shader-oracle.ps1'))) != build['builderSha256']:
        raise ValueError('Native DXBC oracle source/build changed')
    import os
    for name, expected in build['libraries'].items():
        if sha(raw(Path(os.environ['WINDIR']) / 'System32' / name)) != expected:
            raise ValueError('Native DXBC oracle runtime library changed')
    visual = read(cache / 'public/evidence/latest-native-materials.json')
    if visual['drawAdapterSha256'] != sha(raw(Path(__file__).with_name('render-particle-shader.py'))):
        raise ValueError('Offscreen draw adapter changed')
    for path, expected in visual['sources'].items():
        if sha(raw(Path(path))) != expected:
            raise ValueError(f'Native material visual source changed: {path}')
    materials = read(cache / 'research/vfx-materials-native.json')
    native = read(cache / 'research/vfx-bound-quads-native.json')
    effects = read(cache / 'public/latest-effects/manifest.json')
    base_root, shadow_root = cache / 'public/latest-shaders', cache / 'public/latest-shadow-shaders'
    base, shadows = read(base_root / 'package.json'), read(shadow_root / 'package.json')
    base_pairs = read(cache / 'research/latest-shaders/pairs.json')
    shadow_pairs = read(cache / 'research/latest-shadow-shaders/pairs.json')
    if shadows['baseShaderPackageSha256'] != sources[str((base_root / 'package.json').resolve())] or base['build'] != materials['build'] or shadows['build'] != base['build']:
        raise ValueError('Shadow/base/material shader build mismatch')
    work = cache / 'research/shader-pixels'
    work.mkdir(parents=True, exist_ok=True)
    renderer = Draw(args.angle)
    programs = []
    observations, panels = [], []
    try:
        for is_shadow, unblended in [(False, False), (False, True), (True, False)]:
            for index, sample in enumerate(visual['samples']):
                entry = next(e for e in materials['emitters'] if e['effectId'] == sample['effectId'] and e['emitterIndex'] == sample['emitterIndex'])
                material = materials['resultCatalog'][sample['materialResult']]
                if is_shadow:
                    probe = next(p for p in entry['probes'] if p['input']['pass'] == 1)
                    material = materials['resultCatalog'][probe['result']]
                    root, package, pair_inventory = shadow_root, shadows, shadow_pairs
                else:
                    root, package, pair_inventory = base_root, base, base_pairs
                selected = material['selection']
                family = next(p for p in package['pairs'] if p['vertex'] == selected['vertex'].lower() and p['pixel'] == selected['pixel'].lower())
                declared = {d['name']: d['value'] for g in pair_inventory['groups'] if g['name'] == family['name'] for d in g['declares']}
                final = sorted((d for d in material['renderState']['defines'] if declared.get(d['name']) == d['value']), key=lambda d: d['name'])
                pair = next(p for p in pair_inventory['programs'] if p['family'] == family['name'] and p['defines'] == final)
                stages = []
                for stage in ['vertex', 'pixel']:
                    value = read(root / pair[stage]['file'])
                    if sources[str((root / pair[stage]['file']).resolve())] != pair[stage]['sha256'] or sha(raw(root / pair[stage]['dxbc'])) != pair[stage]['dxbcSha256']:
                        raise ValueError('Oracle shader container/translation changed')
                    stages.append(value)
                source = effects['definitions'][sample['effectId']]
                emitter = read(cache / 'public/latest-effects' / source['file'])['definition']['complexEmitterDefinitionData'][sample['emitterIndex']]
                case = next(c for c in native['cases'] if c['graphSha256'] == entry['graphSha256'] and c['mode'] == sample['mode'])
                frame = next(f for f in case['frames'] if f['input']['time'] == sample['time'])
                vertices = bytes.fromhex(frame['output']['geometry']['verticesHex'])
                indices = bytes.fromhex(frame['output']['geometry']['indicesHex'])
                if sha(vertices) != sample['verticesSha256'] or sha(indices) != sample['indicesSha256']:
                    raise ValueError('Oracle native geometry changed')
                required = {t['name'] for stage in stages for t in stage['sidecar']['textures']}
                texture_inputs, sampler_inputs, textures = [], {}, {}
                for name in sorted(required):
                    if name == 'PIXEL_COLOR_REMAP_RAMP_SharedTexture':
                        image = np.zeros((1, 1, 4), dtype=np.uint8); descriptor = bytes([1, 1, 1, 0, 0])
                    elif name == 'PARTICLE_COLOR_TEXTURE__TX' and 'particleColorTexture' not in emitter:
                        image = np.full((1, 1, 4), 255, dtype=np.uint8); descriptor = bytes([1, 1, 1, 0, 0])
                    else:
                        if name == 'TEXTURE__TX':
                            path, layer = emitter['texture'], 'base'
                        elif name == 'TEXTUREMULT__TX':
                            path, layer = emitter['textureMult']['textureMult'], 'mult'
                        elif name == 'sAlphaErosionTexture__TX':
                            path, layer = emitter['alphaErosionDefinition']['erosionMapName'], 'erosion'
                        elif name == 'PARTICLE_COLOR_TEXTURE__TX':
                            path, layer = emitter['particleColorTexture'], 'base'
                        else:
                            raise ValueError(f'Oracle texture is not provided: {name}')
                        asset = effects['assets'][path.lower()]
                        if asset['status'] != 'prepared' or asset['kind'] != 'texture':
                            raise ValueError('Oracle texture is not prepared')
                        file = cache / 'public/latest-effects' / asset['file']
                        if sha(raw(file)) != asset['sha256']:
                            raise ValueError('Oracle texture changed')
                        image = np.array(Image.open(file).convert('RGBA'))
                        descriptor = bytes.fromhex(sample['nativeSamplerDescriptors'][layer])
                    if descriptor[:3] != descriptor[:1] * 3 or descriptor[3] != descriptor[4] or descriptor[0] not in [0, 1, 2]:
                        raise ValueError('Oracle/ANGLE sampler is unsupported')
                    handle = renderer.texture(image, {0: 'repeat', 1: 'clamp', 2: 'mirror'}[descriptor[0]], 'linear' if descriptor[3] else 'nearest')
                    textures[name] = handle
                    texture_inputs.append((name, image.shape[1], image.shape[0], image.tobytes()))
                    for stage in stages:
                        for texture in stage['sidecar']['textures']:
                            if texture['name'] != name:
                                continue
                            for sampler in texture['samplers']:
                                if sampler['sampler'] is None:
                                    raise ValueError('Oracle sampler-less resource is unsupported')
                                supplied = (descriptor[0], descriptor[3])
                                if sampler['sampler'] in sampler_inputs and sampler_inputs[sampler['sampler']] != supplied:
                                    raise ValueError('Conflicting native sampler-name inputs')
                                sampler_inputs[sampler['sampler']] = supplied
                # Uniform values are the same prepared native/scene bytes as the
                # previous diagnostic. Unused buffers/members remain explicit zero.
                values = dict(sample['values'])
                for stage in stages:
                    for block in stage['sidecar']['blocks']:
                        for member in block['members']:
                            key = block['glslName'] + '.' + member['name']
                            if member['used'] and key not in values:
                                params = {p['name']: p['value'] for p in entry['parameters'] + entry['erosionParameters'] + material['renderState']['uniforms']}
                                if member['name'] not in params:
                                    raise ValueError(f'Oracle uniform is not provided: {key}')
                                values[key] = params[member['name']][:member['size'] // 4]
                buffer_inputs = []
                for stage_index, stage in enumerate(stages):
                    for block in stage['sidecar']['blocks']:
                        data = bytearray(block['size'])
                        for member in block['members']:
                            if member['used']:
                                value = values[block['glslName'] + '.' + member['name']]
                                if len(value) * 4 != member['size']:
                                    raise ValueError('Oracle uniform width mismatch')
                                code = {'float': 'f', 'int': 'i', 'uint': 'I', 'bool': 'I'}[member['scalar']]
                                struct.pack_into('<' + code * len(value), data, member['offset'], *value)
                        buffer_inputs.append((stage_index, block, bytes(data)))
                program = renderer.program(*stages)
                programs.append(program)
                blend_input = (1, 0) if unblended else tuple(sample['blend'])
                angle_rgba, _ = renderer.draw(program, stages, vertices, indices, values, textures, blend=blend_input)
                if not is_shadow and not unblended and sha(angle_rgba.tobytes()) != sample['rgbaSha256']:
                    raise ValueError('Color pixel observation no longer reproduces the native-material visual')
                chunks = [b'SCDXBC01']
                def word(value): chunks.append(struct.pack('<I', value))
                def blob(value): word(len(value)); chunks.append(value)
                def text(value): blob(value.encode('ascii'))
                word(512); word(512)
                blend = {0: 1, 1: 2, 0x0302: 5, 0x0303: 6}
                word(blend[blend_input[0]]); word(blend[blend_input[1]])
                for stage in ['vertex', 'pixel']: blob(raw(root / pair[stage]['dxbc']))
                blob(vertices); blob(indices)
                word(len(buffer_inputs))
                for stage_index, block, data in buffer_inputs:
                    word(stage_index); text(block['name']); blob(data); word(len(block['members']))
                    for member in block['members']:
                        text(member['name'])
                        for value in [member['offset'], member['size'], int(member['used']), {'float': 3, 'int': 2, 'uint': 19, 'bool': 1}[member['scalar']], member['rows'], member['columns'], member['elements'], int(member['rowMajor'])]: word(value)
                word(len(texture_inputs))
                for name, width, height, data in texture_inputs:
                    text(name); word(width); word(height); blob(data)
                word(len(sampler_inputs))
                for name, (address, filtering) in sorted(sampler_inputs.items()):
                    text(name); word(address); word(filtering)
                prefix = work / f"{'shadow' if is_shadow else 'source-color' if unblended else 'color'}-{index}"
                request = prefix.with_suffix('.bin'); request.write_bytes(b''.join(chunks))
                pixel_output, report_output = prefix.with_suffix('.rgba'), prefix.with_suffix('.json')
                child = subprocess.run([str(oracle), str(request), str(pixel_output), str(report_output)], capture_output=True, text=True)
                if child.returncode:
                    raise ValueError(f'Original DXBC oracle failed for {prefix.name}: {child.stderr.strip()}')
                d3d_raw = raw(pixel_output)
                if len(d3d_raw) != 512 * 512 * 4:
                    raise ValueError('Original DXBC oracle output size mismatch')
                d3d_rgba = np.frombuffer(d3d_raw, dtype=np.uint8).reshape(512, 512, 4)
                translated_file = prefix.with_suffix('.gl.rgba')
                translated_file.write_bytes(angle_rgba.tobytes())
                delta = np.abs(d3d_rgba.astype(np.int16) - angle_rgba.astype(np.int16))
                changed = np.any(delta != 0, axis=2)
                report = read(report_output)
                observation = {'effectId': sample['effectId'], 'emitterIndex': sample['emitterIndex'], 'time': sample['time'], 'shadow': is_shadow, 'unblended': unblended,
                    'family': family['name'], 'defines': final, 'requestFile': str(request), 'requestSha256': sha(raw(request)),
                    'originalDxbcSha256': [pair[s]['dxbcSha256'] for s in ['vertex', 'pixel']],
                    'originalRgbaSha256': sha(d3d_raw), 'translatedRgbaSha256': sha(angle_rgba.tobytes()),
                    'changedPixels': int(changed.sum()), 'maximumAbsoluteRgbaError': int(delta.max()),
                    'maximumPerChannelError': delta.max(axis=(0, 1)).tolist(), 'meanAbsoluteRgbaError': float(delta.mean()),
                    'originalPixelFile': str(pixel_output), 'translatedPixelFile': str(translated_file),
                    'changedPixelDetails': [{'x': int(x), 'y': int(y), 'original': d3d_rgba[y, x].tolist(), 'translated': angle_rgba[y, x].tolist()} for y, x in np.argwhere(changed)[:100]],
                    'nativeReflection': report, 'buffers': [{'stage': s, 'name': b['name'], 'sha256': sha(data), 'bytes': len(data)} for s, b, data in buffer_inputs]}
                observations.append(observation)
                if not unblended:
                    panels.append((observation, d3d_rgba, angle_rgba, delta))
                print(json.dumps({k: observation[k] for k in ['effectId', 'time', 'shadow', 'unblended', 'changedPixels', 'maximumAbsoluteRgbaError']}), flush=True)
        kernel = C.WinDLL('kernel32', use_last_error=True)
        kernel.GetModuleHandleW.argtypes, kernel.GetModuleHandleW.restype = [C.c_wchar_p], C.c_void_p
        kernel.GetModuleFileNameW.argtypes, kernel.GetModuleFileNameW.restype = [C.c_void_p, C.c_wchar_p, C.c_uint], C.c_uint
        dependencies = {}
        for name in ['d3d11.dll', 'd3dcompiler_47.dll', 'd3d10warp.dll']:
            handle = kernel.GetModuleHandleW(name)
            if not handle:
                raise ValueError(f'ANGLE dependency was not loaded: {name}')
            path_buffer = C.create_unicode_buffer(32768)
            length = kernel.GetModuleFileNameW(handle, path_buffer, len(path_buffer))
            if length == 0 or length >= len(path_buffer):
                raise ValueError('Could not identify the loaded ANGLE native dependency')
            path = Path(path_buffer.value)
            dependencies[name] = {'path': str(path), 'sha256': sha(raw(path))}
    finally:
        for program in programs: renderer.gl.glDeleteProgram(program)
        renderer.close()
    # Show the largest observed discrepancy for each actor/pass, not a
    # preselected exact sample. Exact shadow ties use their largest silhouette.
    panels = [max([p for p in panels if p[0]['shadow'] == shadow and actor in p[0]['effectId']],
                  key=lambda p: (p[0]['changedPixels'], int(np.any(p[1][:, :, :3] > 32, axis=2).sum())))
              for shadow in [False, True] for actor in ['ornn', 'viego']]
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'text.color': '#e8edf6', 'figure.facecolor': '#0e1828'})
    fig, axes = plt.subplots(len(panels), 3, figsize=(14, 17))
    fig.subplots_adjust(top=.88, bottom=.12, left=.07, right=.96, hspace=.28, wspace=.10)
    fig.text(.05, .965, 'Original DXBC pixels vs translated GLSL pixels', fontsize=23, weight='bold')
    fig.text(.05, .935, 'Same native geometry, constant buffers, textures, sampler descriptors and supplied draw state', fontsize=12, color='#b3c6e2')
    for row, (observation, original, translated, difference) in enumerate(panels):
        for column, rgba in enumerate([original, translated]):
            linear = rgba[:, :, :3].astype(np.float64) / 255
            display = np.clip(np.where(linear <= .0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - .055), 0, 1)
            axes[row, column].imshow(display)
            axes[row, column].axis('off')
        # Include alpha-only discrepancies in the displayed difference, too.
        heat = np.clip(difference.max(axis=2) * 32, 0, 255).astype(np.uint8)
        axes[row, 2].imshow(np.repeat(heat[:, :, None], 3, axis=2), interpolation='nearest')
        axes[row, 2].axis('off')
        name = 'Ornn' if 'ornn' in observation['effectId'] else 'Viego'
        kind = 'shadow shader coverage' if observation['shadow'] else 'color shader'
        axes[row, 0].set_title(f'{name} · {kind} · {observation["time"]:.2f}s\nOriginal DXBC / D3D11 WARP', color='#e8edf6', fontsize=11)
        axes[row, 1].set_title('Translated GLSL / ANGLE WARP', color='#e8edf6', fontsize=11)
        axes[row, 2].set_title(f'RGBA maximum difference ×32\n{observation["changedPixels"]:,} changed pixels · max {observation["maximumAbsoluteRgbaError"]}/255 RGBA', color='#e8edf6', fontsize=11)
    fig.text(.05, .075, 'Every RGBA channel and every pixel is compared without tolerance, edge exclusions or alpha exclusions.', fontsize=11)
    fig.text(.05, .05, 'Display RGB is sRGB-encoded. This validates diagnostic shader execution, not League playback, scene shadows or full A/V.', fontsize=10, color='#c5b58f')
    fig.savefig(args.output, dpi=120, facecolor=fig.get_facecolor())
    result = {'schema': 1, 'kind': 'original-dxbc-vs-translated-glsl-pixels', 'build': base['build'],
        'sources': sources, 'observerSha256': sha(Path(__file__).read_bytes()), 'drawAdapterSha256': sha(Path(__file__).with_name('render-particle-shader.py').read_bytes()),
        'imageSha256': sha(args.output.read_bytes()), 'context': renderer.info,
        'angleLibraries': {name: sha(raw(args.angle / name)) for name in ['libEGL.dll', 'libGLESv2.dll']},
        'oracleBuild': build, 'angleNativeDependencies': dependencies, 'observations': observations,
        'counts': {'cases': len(observations), 'colorCases': sum(not o['shadow'] and not o['unblended'] for o in observations), 'shadowCases': sum(o['shadow'] for o in observations),
            'unblendedColorCases': sum(o['unblended'] for o in observations),
            'nativeReflectionMemberChecks': sum(o['nativeReflection']['reflectedMembers'] for o in observations),
            'exactCases': sum(o['changedPixels'] == 0 for o in observations), 'changedPixels': sum(o['changedPixels'] for o in observations),
            'maximumAbsoluteRgbaError': max(o['maximumAbsoluteRgbaError'] for o in observations)},
        'scope': {'tolerance': 0, 'edgePixelsExcluded': False, 'alphaExcluded': False, 'browserRun': False, 'leagueRun': False,
            'originalSceneInputsRecovered': False, 'sceneShadowsRendered': False, 'mainViewerIntegrated': False, 'leagueReferenceCompared': False}}
    args.output.with_suffix('.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result['counts']))


if __name__ == '__main__':
    main()
