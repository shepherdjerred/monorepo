"""Render recorded replay particles with full native graphs and game shaders.

This is an offscreen diagnostic of the renderer's checked inputs. It does not
launch a browser or establish THREE submission, scene-resource or League parity.
"""
import argparse
import importlib.util
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('draw_adapter', Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
Draw, sha = adapter.Draw, adapter.sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'angle', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    cache, sources = args.cache.resolve(), {}
    def raw(path):
        data = path.read_bytes()
        sources[str(path.resolve())] = sha(data)
        return data
    def read(path):
        return json.loads(raw(path))
    inspection = read(cache / 'research/replay-particle-gpu.json')
    for path, expected in inspection['sources'].items():
        if sha(raw(Path(path))) != expected:
            raise ValueError(f'Replay particle GPU source changed: {path}')
    if inspection['inspectorSha256'] != sha(raw(Path(__file__).with_name('inspect-replay-particle-gpu.mjs'))):
        raise ValueError('Replay GPU inspector changed')
    renderer, programs, textures, samples, panels = Draw(args.angle), {}, {}, [], []
    clear_function = renderer.gl.glClear
    try:
        for frame in inspection['frames']:
            # The existing single-draw diagnostic clears its target. Compose
            # this batch by forwarding exactly its first clear to real GL.
            clear_count = [0]
            def clear_once(mask):
                if clear_count[0] == 0:
                    clear_function(mask)
                clear_count[0] += 1
            renderer.gl.glClear = clear_once
            all_buffers = []
            for draw in frame['draws']:
                key = tuple(stage['sha256'] for stage in draw['shaders']) + (draw['materialName'],)
                if key not in programs:
                    stages = []
                    for ref in draw['shaders']:
                        shader = read(Path(ref['path']))
                        if sources[str(Path(ref['path']).resolve())] != ref['sha256'] or not shader['glsl'].startswith('#version 300 es\n'):
                            raise ValueError('Replay shader changed')
                        shader['glsl'] = '#version 300 es\n#define SHADER_TYPE RawShaderMaterial\n#define SHADER_NAME ' + draw['materialName'] + '\n' + shader['glsl'][len('#version 300 es\n'):]
                        stages.append(shader)
                    programs[key] = (renderer.program(*stages), stages)
                program, stages = programs[key]
                bindings = {}
                for stage in stages:
                    for texture in stage['sidecar']['textures']:
                        supplied = [draw['textures'][sampler['glslName']] for sampler in texture['samplers']]
                        if not supplied or any(binding != supplied[0] for binding in supplied):
                            raise ValueError('Replay texture has conflicting sampler inputs')
                        binding = supplied[0]
                        texture_key = json.dumps(binding, sort_keys=True)
                        if texture_key not in textures:
                            if binding['kind'] == 'prepared-texture':
                                path = cache / 'public/latest-effects' / binding['file']
                                if sha(raw(path)) != binding['sha256']:
                                    raise ValueError('Replay texture changed')
                                image = np.array(Image.open(path).convert('RGBA'))
                                address, filtering = binding['sampler']['name'], 'nearest' if binding['sampler']['pixelated'] else 'linear'
                            elif binding['kind'] in ['supplied-white-lookup', 'supplied-transparent-remap']:
                                image = np.full((1, 1, 4), 255 if binding['kind'] == 'supplied-white-lookup' else 0, dtype=np.uint8)
                                address, filtering = 'clamp', 'nearest'
                            else:
                                raise ValueError('Unprovided replay texture')
                            textures[texture_key] = renderer.texture(image, address, filtering)
                        bindings[texture['name']] = textures[texture_key]
                geometry = draw['geometry']
                blend = draw['nativeBlendFactors']
                if blend[0] != blend[1] or blend[2] != blend[3]:
                    raise ValueError('Separate native blend factors not implemented')
                mapping = {1: 1, 6: 0x0302, 7: 0x0303}
                rgba, buffers = renderer.draw(program, stages, bytes.fromhex(geometry['verticesHex']), bytes.fromhex(geometry['indicesHex']), draw['uniformValues'], bindings, blend=(mapping[blend[0]], mapping[blend[2]]))
                expected_buffers = {block['name']: sha(bytes.fromhex(block['bytesHex'])) for block in draw['uniformBuffers']}
                if any(buffer['sha256'] != expected_buffers[buffer['name']] for buffer in buffers):
                    raise ValueError('GPU uniform packing differs from actual THREE adapter bytes')
                all_buffers.extend(buffers)
            renderer.gl.glClear = clear_function
            if clear_count[0] != len(frame['draws']):
                raise ValueError('Diagnostic batch clear/draw count mismatch')
            background = np.array([6, 9, 14], dtype=np.int16)
            visible = int(np.any(np.abs(rgba[:, :, :3].astype(np.int16) - background) > 2, axis=2).sum())
            # Keep fully faded/alpha-clipped live pools in the sequence. Pool
            # presence does not imply visible shader output at every sample.
            samples.append({'time': frame['time'], 'draws': len(frame['draws']), 'visiblePixels': visible,
                'rgbaSha256': sha(rgba.tobytes()), 'uniformBufferChecks': len(all_buffers)})
            panels.append(rgba)
            print(json.dumps(samples[-1]), flush=True)
    finally:
        renderer.gl.glClear = clear_function
        for program, _ in programs.values():
            renderer.gl.glDeleteProgram(program)
        renderer.close()
    if not any(sample['visiblePixels'] >= 30 for sample in samples):
        raise ValueError('Entire replay particle diagnostic is empty')
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'text.color': '#e8edf6', 'figure.facecolor': '#0e1828'})
    fig, axes = plt.subplots(2, 3, figsize=(15, 11))
    fig.subplots_adjust(top=.82, bottom=.16, left=.04, right=.97, hspace=.21, wspace=.08)
    fig.text(.04, .96, 'Recorded replay → complete native quad assets → game shaders', fontsize=21, weight='bold')
    fig.text(.04, .92, 'Vladimir skin 39 · decoded missile tracks · original packed colors and half UVs · native alpha, atlas, samplers and blend', fontsize=11, color='#b3c6e2')
    fig.text(.04, .88, '1,050 playback samples / 8,610 native input frames: zero state or geometry disagreements; reverse seeking reproduces all snapshots', fontsize=10, color='#b3c6e2')
    for axis, sample, rgba in zip(axes.flat, samples, panels, strict=True):
        linear = rgba[:, :, :3].astype(np.float64) / 255
        display = np.clip(np.where(linear <= .0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - .055), 0, 1)
        axis.imshow(display)
        axis.axis('off')
        axis.set_title(f'{sample["time"]:.3f}s match time · {sample["draws"]} quad draws\n{sample["visiblePixels"]:,} foreground pixels', color='#e8edf6', fontsize=11)
    fig.text(.04, .095, 'Offscreen ANGLE/WARP. Camera fitted to these recorded positions; no map/depth occlusion or full postprocess.', fontsize=11)
    fig.text(.04, .065, 'Activation/clock/seed/basis, omniscient fog mode, neutral lookup/remap and target convention remain supplied preview inputs.', fontsize=10, color='#c5b58f')
    fig.text(.04, .035, 'Main viewer source is integrated. Browser/THREE GPU submission and League reference fidelity have not been observed.', fontsize=10, color='#c5b58f')
    fig.savefig(args.output, dpi=120, facecolor=fig.get_facecolor())
    result = {'schema': 1, 'kind': 'replay-particles-offscreen-visual', 'build': inspection['build'], 'sources': sources,
        'rendererSha256': sha(Path(__file__).read_bytes()), 'drawAdapterSha256': sha(Path(__file__).with_name('render-particle-shader.py').read_bytes()),
        'imageSha256': sha(args.output.read_bytes()), 'context': renderer.info, 'samples': samples,
        'counts': {'frames': len(samples), 'drawCalls': sum(sample['draws'] for sample in samples), 'uniquePrograms': len(programs),
            'uniformBufferChecks': sum(sample['uniformBufferChecks'] for sample in samples)},
        'scope': {'cameraFitted': True, 'mapRendered': False, 'depthOcclusion': False, 'sRgbDisplayEncoding': True,
            'shaderBodiesRewritten': False, 'threeMaterialNamePrefixAdded': True, 'browserRun': False,
            'threeGpuSubmissionObserved': False, 'mainViewerSourceIntegrated': True, 'leagueReferenceCompared': False}}
    args.output.with_suffix('.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result['counts']))


if __name__ == '__main__':
    main()
