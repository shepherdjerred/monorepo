"""Offscreen complete-root gallery and live vertex-erosion branch comparison.

Uses compared native geometry and prepared game shaders. The fitted camera and
scene inputs are supplied diagnostics, not reconstructed match presentation.
"""
import importlib.util
import json
from pathlib import Path
import struct
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('root_draw', Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
cache, angle = [Path(v).resolve() for v in sys.argv[1:3]]
assets = cache/'public'
inputs = {}

def raw(path):
    b = path.read_bytes()
    inputs[str(path)] = adapter.sha(b)
    return b

def read(path):
    return json.loads(raw(path))

native_path = cache/'research/effect-root-frames-native.json'
native = read(native_path)
proof = read(cache/'research/effect-root-frames-wasm.json')
if proof['observationSha256'] != inputs[str(native_path)] or proof['mismatchCount'] or not proof['scope']['allPreparedRootsCompared']:
    raise ValueError('Requested-root frames lack complete native/WASM comparison')
for report, directory in [(native, Path(__file__).parent), (proof, Path(__file__).parent.parent)]:
    for name, digest in report['sources'].items():
        if adapter.sha(raw(directory/name)) != digest:
            raise ValueError('Root frame producer changed: '+name)
    for path, digest in report['inputs'].items():
        if adapter.sha(raw(Path(path))) != digest:
            raise ValueError('Root frame input changed: '+path)
packages = [read(assets/name) for name in ['latest-complete-quad-gpu/package.json',
    'latest-trail-particles/gpu.json', 'latest-quad-erosion-gpu/package.json']]
bindings = {(e['effectId'], e['emitterIndex']): e for p in packages for e in p['emitters']}
for path, digest in packages[2]['inputs'].items():
    if adapter.sha(raw(Path(path))) != digest:
        raise ValueError('Erosion material input changed: '+path)
selected = ['champions/ornn/0/e0792451', 'champions/jinx/2/30f9e0b8',
            'champions/akshan/20/96537678', 'champions/gangplank/14/dc110b57',
            'champions/maokai/3/91aaf44c', 'champions/ornn/0/5dcd8300']
renderer = adapter.Draw(angle)
programs, textures, panels, draws, comparisons = {}, {}, [], [], []
clear = renderer.gl.glClear

def resources(binding, projection):
    key = tuple(binding['shaders'][s]['sha256'] for s in ['vertex', 'pixel'])
    if key not in programs:
        stages = []
        for stage in ['vertex', 'pixel']:
            ref = binding['shaders'][stage]
            b = raw(assets/'latest-shaders'/ref['file'])
            if adapter.sha(b) != ref['sha256']:
                raise ValueError('Game shader changed')
            stages.append(json.loads(b))
        programs[key] = renderer.program(*stages), stages
    program, stages = programs[key]
    values, bound = {}, {}
    for shader in stages:
        for block in shader['sidecar']['blocks']:
            b = bytes.fromhex(next(v for v in binding['blocks'] if v['glslName'] == block['glslName'])['bytesHex'])
            for m in block['members']:
                if not m['used']:
                    continue
                if m['name'] == 'mProj':
                    value = projection
                elif m['name'] == 'vCamera':
                    value = native['camera']['position']
                else:
                    code = {'float': 'f', 'uint': 'I', 'int': 'i', 'bool': 'I'}[m['scalar']]
                    value = list(struct.unpack_from('<'+code*(m['size']//4), b, m['offset']))
                values[block['glslName']+'.'+m['name']] = value
        for texture in shader['sidecar']['textures']:
            choices = [binding['textures'][s['glslName']] for s in texture['samplers']]
            if not choices or any(v != choices[0] for v in choices):
                raise ValueError('Ambiguous root texture binding')
            t = choices[0]
            key = json.dumps(t, sort_keys=True)
            if key not in textures:
                if t['kind'] == 'prepared-texture':
                    path = assets/'latest-effects'/t['file']
                    if adapter.sha(raw(path)) != t['sha256']:
                        raise ValueError('Root texture changed')
                    pixels = np.array(Image.open(path).convert('RGBA'))
                    address, filtering = t['sampler']['name'], 'nearest' if t['sampler']['pixelated'] else 'linear'
                elif t['kind'] in ['supplied-white-lookup', 'supplied-transparent-remap']:
                    pixels = np.full((1, 1, 4), 255 if t['kind'] == 'supplied-white-lookup' else 0, dtype=np.uint8)
                    address, filtering = 'clamp', 'nearest'
                else:
                    raise ValueError('Unprovided root texture')
                textures[key] = renderer.texture(pixels, address, filtering)
            bound[texture['name']] = textures[key]
    factors = binding['nativeBlendFactors']
    if factors[0] != factors[1] or factors[2] != factors[3]:
        raise ValueError('Separate diagnostic blend factors unsupported')
    mapping = {1: 1, 6: 0x302, 7: 0x303}
    return program, stages, values, bound, (mapping[factors[0]], mapping[factors[2]])

try:
    for effect_id in selected:
        case = next(c for c in native['cases'] if c['effectId'] == effect_id)
        frame = case['frames'][11]
        coords = [struct.unpack_from('<3f', bytes.fromhex(g['verticesHex']), i)
                  for g in frame['geometry'] for i in range(0, len(bytes.fromhex(g['verticesHex'])), 28)]
        points = np.asarray(coords)
        lo, hi = points.min(0), points.max(0)
        center, extent = (lo+hi)/2, max(hi[0]-lo[0], hi[2]-lo[2])*.6
        if not np.isfinite(extent) or extent <= 0:
            raise ValueError('Root diagnostic has no top-view extent')
        projection = [1/extent, 0, 0, -center[0]/extent, 0, 0, -1/extent, center[2]/extent,
                      0, 0, 0, .5, 0, 0, 0, 1]
        ordered = sorted(frame['geometry'], key=lambda g: bindings[(effect_id, g['emitterIndex'])]['suppliedSortPass'])
        # Quad shaders consume the packed drive directly (unlike the mesh
        # shader's USE_INSTANCE_DRAW branch). Verify the static placeholder is
        # unused, and changing the actual vertex drive changes GPU pixels.
        for geometry in ordered:
            binding = bindings[(effect_id, geometry['emitterIndex'])]
            if binding.get('erosionInput') != 'native-quad-texcoord-w' or not geometry['indicesHex']:
                continue
            program, stages, values, bound, blend = resources(binding, projection)
            vertices, indices = bytes.fromhex(geometry['verticesHex']), bytes.fromhex(geometry['indicesHex'])
            erosion_key = 'Globals_ps.cAlphaErosionParams'
            renderer.gl.glClear = clear
            batch, _ = renderer.draw(program, stages, vertices, indices, values, bound, blend=blend)
            values[erosion_key] = [.375, *values[erosion_key][1:]]
            replaced, _ = renderer.draw(program, stages, vertices, indices, values, bound, blend=blend)
            if not np.array_equal(batch, replaced):
                raise ValueError('Quad erosion unexpectedly uses the static placeholder drive')
            variants = []
            for drive in [0., .5, 1.]:
                modified = bytearray(vertices)
                for off in range(22, len(modified), 28):
                    struct.pack_into('<e', modified, off, drive)
                variant, _ = renderer.draw(program, stages, bytes(modified), indices, values, bound, blend=blend)
                variants.append(adapter.sha(variant.tobytes()))
            comparisons.append({'effectId': effect_id, 'emitterIndex': geometry['emitterIndex'],
                'particles': geometry['particleCount'], 'rgbaSha256': adapter.sha(batch.tobytes()),
                'staticPlaceholderUnused': True, 'driveVariantSha256': variants,
                'liveDriveChangesPixels': len(set(variants)) > 1})
        renderer.gl.glClear = clear
        clear(0x4000)
        renderer.gl.glClear = lambda mask: None
        rgba = None
        active = 0
        for geometry in ordered:
            if not geometry['indicesHex']:
                continue
            binding = bindings[(effect_id, geometry['emitterIndex'])]
            program, stages, values, bound, blend = resources(binding, projection)
            rgba, buffers = renderer.draw(program, stages, bytes.fromhex(geometry['verticesHex']),
                bytes.fromhex(geometry['indicesHex']), values, bound, blend=blend)
            draws.append({'effectId': effect_id, 'emitterIndex': geometry['emitterIndex'],
                'geometrySha256': adapter.sha(bytes.fromhex(geometry['verticesHex'])), 'uniformBuffers': buffers})
            active += 1
        if rgba is None:
            raise ValueError('No root diagnostic draws')
        foreground = int(np.any(rgba[:, :, :3] > np.array([7, 9, 14]), axis=2).sum())
        if foreground < 100:
            raise ValueError('No visible root diagnostic pixels')
        linear = rgba[:, :, :3].astype(np.float64)/255
        display = np.clip(np.where(linear <= .0031308, linear*12.92, 1.055*linear**(1/2.4)-.055), 0, 1)
        panels.append({'effectId': effect_id, 'name': case['name'], 'tick': frame['tick'],
            'draws': active, 'foregroundPixels': foreground, 'rgbaSha256': adapter.sha(rgba.tobytes()), 'display': display})
finally:
    renderer.gl.glClear = clear
    for program, _ in programs.values():
        renderer.gl.glDeleteProgram(program)
    renderer.close()
fig, axes = plt.subplots(2, 3, figsize=(15, 10), facecolor='#101822')
for ax, panel in zip(axes.flat, panels):
    ax.imshow(panel['display'])
    ax.axis('off')
    ax.set_title(panel['name']+'\n'+str(panel['draws'])+' active layers', color='#e9eef7', fontsize=10)
fig.suptitle('Shared particle pipeline: additional complete effect roots', color='#f5f7fc', fontsize=19)
fig.text(.5, .025, 'Native/WASM geometry compared · real game shaders/textures · supplied +0.20s clock and fitted camera\nComponent gallery: replay attachments, scene lighting and client-reference fidelity remain unverified',
         ha='center', color='#aab9ce', fontsize=10)
fig.subplots_adjust(top=.9, bottom=.1, wspace=.08, hspace=.18)
target = assets/'evidence/latest-effect-root-frames.png'
fig.savefig(target, dpi=120, facecolor=fig.get_facecolor())
plt.close(fig)
report = {'schema': 1, 'kind': 'requested-root-offscreen-diagnostic', 'inputs': inputs,
    'rendererSha256': adapter.sha(Path(__file__).read_bytes()),
    'panels': [{k: v for k, v in p.items() if k != 'display'} for p in panels],
    'draws': draws, 'erosionComparisons': comparisons,
    'counts': {'panels': len(panels), 'draws': len(draws), 'erosionDrawComparisons': len(comparisons),
               'liveDrivePixelResponses': sum(v['liveDriveChangesPixels'] for v in comparisons),
               'erosionParticlesCompared': sum(v['particles'] for v in comparisons)},
    'image': {'file': target.name, 'sha256': adapter.sha(target.read_bytes())},
    'scope': {'actualComparedParentGeometry': True, 'nativeVertexErosion': True,
        'suppliedCameraAndSceneInputs': True, 'diagnosticDepthAndCullingDisabled': True,
        'browserExecuted': False, 'matchLifecycleMapping': False, 'referenceCompared': False}}
(target.with_suffix('.json')).write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({'image': str(target), 'counts': report['counts']}))
