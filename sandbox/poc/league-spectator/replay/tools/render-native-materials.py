"""Render native-selected quad programs with recovered native material values.

The camera, RGBA8 target, remap texture and absent color lookup are explicit
diagnostic inputs. No League/browser/desktop process is started.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import struct

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('shader_draw', Path(__file__).with_name('render-particle-shader.py'))
draw_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(draw_module)
Draw, sha, positions = draw_module.Draw, draw_module.sha, draw_module.positions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['materials', 'shaders', 'pairs', 'decoder', 'native', 'comparison', 'effects', 'angle', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    sources = {}
    def read(path):
        raw = path.read_bytes()
        sources[str(path.resolve())] = sha(raw)
        return json.loads(raw)
    materials, shaders, pairs = read(args.materials), read(args.shaders / 'package.json'), read(args.pairs)
    meta, native, proof = read(args.decoder / 'vfx-bound-quads.json'), read(args.native), read(args.comparison)
    effects = read(args.effects / 'manifest.json')
    if materials['scope']['partialCorpus'] or materials['build'] != '16.21.829.8620' or not materials['scope']['assetBytesUnchanged'] or not materials['scope']['resourcePresenceMarkerUnmapped']:
        raise ValueError('Incomplete native material corpus')
    if materials['quadPackageSha256'] != sources[str((args.decoder / 'vfx-bound-quads.json').resolve())] or proof['definitionSha256'] != materials['quadPackageSha256'] or proof['nativeEvidenceSha256'] != sources[str(args.native.resolve())] or proof['mismatchCount']:
        raise ValueError('Native material and vertex sources disagree')
    for name, expected in materials['sources'].items():
        if sha(Path(__file__).with_name(name).read_bytes()) != expected:
            raise ValueError(f'Native material compiler source changed: {name}')
    if pairs['shaderPackageSha256'] != sources[str((args.shaders / 'package.json').resolve())]:
        raise ValueError('Shader pair package changed')
    renderer = Draw(args.angle)
    white = renderer.texture(np.full((1, 1, 4), 255, dtype=np.uint8), 'clamp', 'nearest')
    transparent = renderer.texture(np.zeros((1, 1, 4), dtype=np.uint8), 'clamp', 'nearest')
    examples = [('champions/ornn/0/0299df86', 0, 0, [.1, .3, .5], 'Ornn · native atlas / alpha-add'),
                ('champions/viego/43/56ac80ee', 1, 3, [.05, .2, .5], 'Viego · native mult / erosion / alpha test')]
    rows, samples, programs = [], [], []
    def load_texture(path, descriptor):
        asset = effects['assets'][path.lower()]
        if asset['status'] != 'prepared' or asset['kind'] != 'texture':
            raise ValueError(f'Native material texture is not prepared: {path}')
        raw = (args.effects / asset['file']).read_bytes()
        if sha(raw) != asset['sha256']:
            raise ValueError('Native material texture changed')
        sources[str((args.effects / asset['file']).resolve())] = sha(raw)
        data = bytes.fromhex(descriptor)
        if data[:3] != bytes([data[0]]) * 3 or data[3] != data[4]:
            raise ValueError('Diagnostic requires symmetric native sampler state')
        address = {0: 'repeat', 1: 'clamp', 2: 'mirror'}.get(data[0])
        if address is None or data[3] not in [0, 1]:
            raise ValueError('Native sampler is not implemented by this diagnostic')
        return renderer.texture(np.array(Image.open(args.effects / asset['file']).convert('RGBA')),
                                address, 'linear' if data[3] else 'nearest')
    try:
        for effect, index, mode, times, title in examples:
            entry = next(e for e in materials['emitters'] if e['effectId'] == effect and e['emitterIndex'] == index)
            resource_mask = entry['definedObjectMask']
            env = {'pass': 0, 'featuresEnabled': True, 'resourceMask': resource_mask, 'systemFogMode': 1, 'graphics34b': False, 'graphics29c': 0}
            probe = next(p for p in entry['probes'] if p['input'] == env)
            material = materials['resultCatalog'][probe['result']]
            final_defines = sorted(material['renderState']['defines'], key=lambda d: d['name'])
            selected = material['selection']
            families = [p for p in shaders['pairs'] if p['vertex'] == selected['vertex'].lower() and p['pixel'] == selected['pixel'].lower()]
            if len(families) != 1:
                raise ValueError('Native shader files do not identify one installed shader family')
            candidates = [p for p in pairs['programs'] if p['family'] == families[0]['name'] and p['defines'] == final_defines]
            if len(candidates) != 1:
                raise ValueError(f'Native shader selection did not resolve uniquely: {selected}')
            program_ref = candidates[0]
            stages = []
            for stage in ['vertex', 'pixel']:
                path = args.shaders / program_ref[stage]['file']
                shader = read(path)
                if sources[str(path.resolve())] != program_ref[stage]['sha256']:
                    raise ValueError('Native-selected shader changed')
                stages.append(shader)
            program = renderer.program(*stages)
            programs.append(program)
            definition = effects['definitions'][effect]
            source_path = args.effects / definition['file']
            source = read(source_path)
            if sources[str(source_path.resolve())] != definition['sha256']:
                raise ValueError('Native material definition changed')
            emitter = source['definition']['complexEmitterDefinitionData'][index]
            ref = next(r for r in meta['templates'] if r['effectId'] == effect and r['emitterIndex'] == index)
            if ref['sha256'] != entry['graphSha256']:
                raise ValueError('Native material/geometry graph mismatch')
            case = next(c for c in native['cases'] if c['graphSha256'] == ref['sha256'] and c['mode'] == mode)
            frames = [next(f for f in case['frames'] if f['input']['time'] == time) for time in times]
            all_positions = np.concatenate([positions(bytes.fromhex(f['output']['geometry']['verticesHex'])) for f in frames])
            center = (all_positions.max(axis=0) + all_positions.min(axis=0)) / 2
            _, _, axes = np.linalg.svd(all_positions - center, full_matrices=False)
            right, up = axes[:2]
            extent = np.max(np.abs((all_positions - center) @ axes[:2].T)) * 1.15
            projection = np.array([[*(right / extent), -np.dot(center, right) / extent],
                [*(up / extent), -np.dot(center, up) / extent], [0, 0, 0, .5], [0, 0, 0, 1]], dtype=np.float32)
            params = {p['name']: p['value'] for p in entry['parameters'] + entry['erosionParameters'] + material['renderState']['uniforms']}
            samplers = {s['layer']: s['descriptorHex'] for s in entry['samplers']}
            texture_values = {'PIXEL_COLOR_REMAP_RAMP_SharedTexture': transparent}
            required_textures = {t['name'] for s in stages for t in s['sidecar']['textures']}
            if 'TEXTURE__TX' in required_textures:
                texture_values['TEXTURE__TX'] = load_texture(emitter['texture'], samplers['base'])
            if 'TEXTUREMULT__TX' in required_textures:
                texture_values['TEXTUREMULT__TX'] = load_texture(emitter['textureMult']['textureMult'], samplers['mult'])
            if 'sAlphaErosionTexture__TX' in required_textures:
                texture_values['sAlphaErosionTexture__TX'] = load_texture(emitter['alphaErosionDefinition']['erosionMapName'], samplers['erosion'])
            if 'PARTICLE_COLOR_TEXTURE__TX' in required_textures:
                if 'particleColorTexture' in emitter:
                    texture_values['PARTICLE_COLOR_TEXTURE__TX'] = load_texture(emitter['particleColorTexture'], samplers['base'])
                else:
                    texture_values['PARTICLE_COLOR_TEXTURE__TX'] = white
            if required_textures != set(texture_values):
                raise ValueError(f'Native material has unprovided textures: {required_textures - set(texture_values)}')
            values = {'PerFrameVertexCB_vs.mProj': projection.ravel().tolist(), 'PerFrameVertexCB_vs.vCamera': [0, 0, 1000],
                'Globals_ps.DEBUG_RENDERTARGET_IS_SRGB_HANDLED': [0], 'PerFramePixelCB_ps.RENDERTARGET_IS_SRGB': [0]}
            for stage in stages:
                for block in stage['sidecar']['blocks']:
                    for member in block['members']:
                        if not member['used']:
                            continue
                        key = block['glslName'] + '.' + member['name']
                        if key in values:
                            continue
                        if member['name'] not in params or member['size'] not in [4, 8, 12, 16]:
                            raise ValueError(f'Native material has an unprovided used uniform: {key}')
                        values[key] = params[member['name']][:member['size'] // 4]
            state = bytes.fromhex(material['renderState']['bytesHex'])
            if state[10] != state[11] or state[12] != state[13] or state[14] != 0 or not state[4] & 4:
                raise ValueError('Native blend state is not implemented by this diagnostic')
            factors = {0: 0, 1: 1, 6: 0x0302, 7: 0x0303}
            if state[10] not in factors or state[12] not in factors:
                raise ValueError('Native blend factor is not implemented by this diagnostic')
            blend = (factors[state[10]], factors[state[12]])
            row = []
            for frame in frames:
                vertices = bytes.fromhex(frame['output']['geometry']['verticesHex'])
                indices = bytes.fromhex(frame['output']['geometry']['indicesHex'])
                rgba, blocks = renderer.draw(program, stages, vertices, indices, values, texture_values, blend=blend)
                visible = np.any(rgba[:, :, :3] > np.array([7, 9, 14]), axis=2)
                if visible.sum() < 30:
                    raise ValueError('Native material diagnostic has no visible particle pixels')
                time = frame['input']['time']
                # The framebuffer RGB already includes blending. Ignore its
                # alpha for display and encode linear RGB for the PNG viewer.
                # This is display encoding, not League's untraced postprocess.
                linear = rgba[:, :, :3].astype(np.float64) / 255
                display = np.clip(np.where(linear <= .0031308, linear * 12.92,
                    1.055 * np.power(linear, 1 / 2.4) - .055), 0, 1)
                row.append((time, display))
                samples.append({'effectId': effect, 'emitterIndex': index, 'mode': mode, 'time': time,
                    'materialResult': probe['result'], 'shaderDefines': final_defines, 'verticesSha256': sha(vertices),
                    'indicesSha256': sha(indices), 'rgbaSha256': sha(rgba.tobytes()),
                    'displayRgbSha256': sha(display.tobytes()), 'visiblePixels': int(visible.sum()),
                    'buffers': blocks, 'values': values, 'blend': list(blend), 'nativeSamplerDescriptors': samplers})
            rows.append((title, row))
    finally:
        for program in programs:
            renderer.gl.glDeleteProgram(program)
        renderer.close()
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'text.color': '#e8edf6', 'figure.facecolor': '#0e1828'})
    fig, axes = plt.subplots(2, 3, figsize=(16, 12))
    fig.subplots_adjust(top=.79, bottom=.23, left=.05, right=.97, hspace=.26, wspace=.08)
    fig.text(.05, .95, 'Native material selection and parameters now drive game shaders', fontsize=22, weight='bold')
    fig.text(.05, .905, 'Original shader/define selection, alpha threshold, atlas, erosion, samplers and blend factors · build 16.21.829.8620', fontsize=11, color='#b3c6e2')
    for row_index, (title, row) in enumerate(rows):
        for column, (time, rgba) in enumerate(row):
            axes[row_index, column].imshow(rgba)
            axes[row_index, column].axis('off')
            axes[row_index, column].set_title(f'{title}\n{time:.3f}s', fontsize=12, color='#e8edf6')
    fig.text(.05, .17, 'Recorded native geometry, colors and UVs; actual prepared base, mult and erosion textures.', fontsize=12)
    fig.text(.05, .135, 'Supplied scene: fitted camera, linear RGBA8 target, fog mode 1, prepared resource-presence predicates and transparent remap.', fontsize=11, color='#c5b58f')
    fig.text(.05, .10, 'Display uses sRGB encoding; Ornn uses an explicit white color lookup. Original postprocess, depth/cull and game passes remain unverified.', fontsize=11, color='#c5b58f')
    fig.text(.05, .055, 'Offscreen ANGLE / D3D11 WARP. Browser integration, original resource acquisition and reference pixel comparison remain open.', fontsize=11, color='#c5b58f')
    fig.savefig(args.output, dpi=125, facecolor=fig.get_facecolor())
    result = {'schema': 1, 'kind': 'native-material-shader-visual', 'build': materials['build'], 'sources': sources,
        'rendererSha256': sha(Path(__file__).read_bytes()), 'drawAdapterSha256': sha(Path(__file__).with_name('render-particle-shader.py').read_bytes()),
        'imageSha256': sha(args.output.read_bytes()), 'context': renderer.info,
        'libraries': {name: sha((args.angle / name).read_bytes()) for name in ['libEGL.dll', 'libGLESv2.dll']},
        'samples': samples, 'scope': {'browserRun': False, 'mainViewerIntegrated': False,
            'resourceAcquisition': False, 'referencePixelsCompared': False, 'gpu': 'offscreen ANGLE D3D11 WARP',
            'displayEncoding': 'IEC sRGB encoding of linear readback RGB; original game postprocess is unverified'}}
    args.output.with_suffix('.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'samples': len(samples), 'imageSha256': result['imageSha256']}))


if __name__ == '__main__':
    main()
