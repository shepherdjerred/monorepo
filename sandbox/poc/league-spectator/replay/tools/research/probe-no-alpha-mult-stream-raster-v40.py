"""Cache-only native bound-quad streams and exact-state GLES raster controls.

No production material admission, match placement, browser appearance, or
native-client framebuffer parity is established by this diagnostic.
"""
import ctypes as C
import hashlib
import inspect
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[6]
TOOLS = ROOT / 'sandbox/poc/league-spectator/replay/tools'
sys.path.insert(0, str(TOOLS))
from vfx_bound_quad_native import NativeBoundQuad
from graphics_pipeline_device import GraphicsPipelineDevice
from offscreen_ray import RayDraw

INPUTS = {}
OUT = ROOT / '.cache/replay-spike/research/no-alpha-mult-stream-raster-v40.json'
VS = '903a023260c71aa435f3edcfaf6eebf4d2b4c864c490c95103aff8c95087e314'
PS = '568fd279eefb3f35c202e320d7e5c7ac7b18f8c5869c5c834b4c8e587d369621'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def raw(path, expected=None):
    path = Path(path).resolve()
    data = path.read_bytes()
    digest = sha(data)
    if expected is not None and digest != expected:
        raise ValueError('Exact input differs: ' + str(path))
    if str(path) in INPUTS and INPUTS[str(path)] != digest:
        raise ValueError('Input changed: ' + str(path))
    INPUTS[str(path)] = digest
    return data


def read(path, expected=None):
    return json.loads(raw(path, expected))


def depth_attachment(d):
    for name, result, args in [
        ('glGenRenderbuffers', None, [C.c_int, C.POINTER(C.c_uint)]),
        ('glBindRenderbuffer', None, [C.c_uint, C.c_uint]),
        ('glRenderbufferStorage', None, [C.c_uint, C.c_uint, C.c_int, C.c_int]),
        ('glFramebufferRenderbuffer', None, [C.c_uint, C.c_uint, C.c_uint, C.c_uint]),
        ('glDeleteRenderbuffers', None, [C.c_int, C.POINTER(C.c_uint)]),
        ('glClearDepthf', None, [C.c_float]),
    ]:
        d.fn(d.gl, name, result, *args)
    handle = C.c_uint()
    d.gl.glGenRenderbuffers(1, C.byref(handle))
    d.gl.glBindRenderbuffer(0x8d41, handle)
    d.gl.glRenderbufferStorage(0x8d41, 0x81a6, 512, 512)
    d.gl.glFramebufferRenderbuffer(0x8d40, 0x8d00, 0x8d41, handle)
    if d.gl.glCheckFramebufferStatus(0x8d40) != 0x8cd5 or d.gl.glGetError():
        raise ValueError('Complete depth24 raster target required')
    return handle


def projection(vertices, front_face):
    # A supplied diagnostic orthographic camera; geometry bytes stay unchanged.
    points = np.frombuffer(vertices, dtype=np.dtype({'names': ['p'], 'formats': [('<f4', 3)], 'offsets': [0], 'itemsize': 28}))['p']
    lo, hi = points.min(axis=0), points.max(axis=0)
    axes = list(np.argsort(-(hi - lo))[:2])
    remaining = next(axis for axis in range(3) if axis not in axes)
    matrix = np.zeros((4, 4), dtype=np.float32)
    for row, axis in enumerate(axes):
        span = float(hi[axis] - lo[axis])
        if span <= 0:
            raise ValueError('Positive-area source geometry required')
        matrix[row, axis] = 1.6 / span
        matrix[row, 3] = -.8 - matrix[row, axis] * lo[axis]
    matrix[2, remaining] = 0
    # Original translated shader converts D3D/Metal [0,1] clip depth to GLES
    # [-1,1]. Put this explicit diagnostic plane at depth .5, not at LEQUAL's
    # near-plane tie, so a zero-depth occluder has a strict ordering.
    matrix[2, 3] = .5
    matrix[3, 3] = 1
    # Native CCW/clockwise state is kept unchanged. Select a front-facing
    # diagnostic view from the original first triangle, rather than changing
    # native culling or rewriting authored positions.
    clip = (matrix @ np.column_stack([points[:3], np.ones(3)]).T).T
    edge_a, edge_b = clip[1, :2] - clip[0, :2], clip[2, :2] - clip[0, :2]
    signed_area = edge_a[0] * edge_b[1] - edge_a[1] * edge_b[0]
    if (signed_area > 0) != (front_face == 0x0901):
        matrix[1, :] *= -1
    # QUAD_VS consumes mProj as four consecutive dp4 rows, not a GLSL mat4.
    # Keep that reflected byte convention explicit and check its depth before
    # relying on any GPU occlusion observation.
    packed = matrix.flatten().tolist()
    supplied_clip = (np.array(packed).reshape(4, 4) @ np.column_stack([points, np.ones(len(points))]).T).T
    if not np.all(supplied_clip[:, 3] == 1) or not np.all(supplied_clip[:, 2] == .5):
        raise ValueError('Native shader row-packed diagnostic depth differs')
    return packed, axes


def render_control(d, pipeline_device, binding, stages, frame, assets):
    vertices = bytes.fromhex(frame['output']['geometry']['verticesHex'])
    indices = bytes.fromhex(frame['output']['geometry']['indicesHex'])
    native_state = pipeline_device.decode(bytes.fromhex(binding['nativeRenderStateHex']))
    proj, axes = projection(vertices, native_state['frontFace'])
    blocks, number = [], 0
    for side, stage in zip(['vertex', 'pixel'], stages, strict=True):
        for block in stage['sidecar']['blocks']:
            if not any(member['used'] for member in block['members']):
                continue
            supplied = next(row for row in binding['blocks'] if row['glslName'] == block['glslName'])
            data = bytearray.fromhex(supplied['bytesHex'])
            for member in supplied['sceneMembers']:
                value = proj if member['name'] == 'mProj' else frame['input']['viewPosition'] if member['name'] == 'vCamera' else None
                if value is None or len(value) * 4 != member['size']:
                    raise ValueError('Explicit exact reflected scene uniform required')
                struct.pack_into('<' + 'f' * len(value), data, member['offset'], *value)
            blocks.append({'stage': side, 'name': block['glslName'], 'binding': number, 'bytes': bytes(data)})
            number += 1
    textures = {}
    for stage in stages:
        for texture in stage['sidecar']['textures']:
            choices = [binding['textures'][sampler['glslName']] for sampler in texture['samplers']]
            if not choices or any(row != choices[0] for row in choices):
                raise ValueError('Exact shared sampler binding required')
            value = choices[0]
            if value['kind'] == 'prepared-texture':
                data = raw(assets / 'latest-effects' / value['file'], value['sha256'])
                import io
                pixels = np.array(Image.open(io.BytesIO(data)).convert('RGBA'))
                address = value['sampler']['name']
                filtering = 'nearest' if value['sampler']['pixelated'] else 'linear'
            elif value['kind'] in ['supplied-white-lookup', 'supplied-transparent-remap']:
                pixels = np.full((1, 1, 4), 255 if value['kind'] == 'supplied-white-lookup' else 0, dtype=np.uint8)
                address, filtering = 'clamp', 'nearest'
            else:
                raise ValueError('Unadmitted original texture kind')
            textures[texture['name']] = {'unit': len(textures), 'handle': d.texture(pixels, address, filtering).value, 'sampler': 0}
    program = d.program(*stages)
    pipeline = pipeline_device.create(bytes.fromhex(binding['nativeRenderStateHex']), {'linked': True, 'glHandle': program})
    state = pipeline['state']
    if not state['depthEnabled'] or not state['cullEnabled'] or state['blendFactors'] != [0x302, 1, 0x302, 1] or state['depthMask']:
        raise ValueError('Exact no-alpha native depth/cull/blend pipeline required')
    records = []
    for label, depth, reverse, disable_depth in [('open', 1, False, False), ('near-depth-occluder', 0, False, False), ('reversed-winding', 1, True, False), ('occluder-with-depth-disabled-control', 0, False, True)]:
        d.gl.glDepthMask(1)
        d.gl.glClearDepthf(depth)
        d.gl.glClear(0x100)
        local_indices = indices
        if reverse:
            values = list(struct.unpack('<' + 'H' * (len(indices) // 2), indices))
            for at in range(0, len(values), 3):
                values[at + 1], values[at + 2] = values[at + 2], values[at + 1]
            local_indices = struct.pack('<' + 'H' * len(values), *values)
        def apply():
            pipeline_device.apply(pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])
            observed = pipeline_device.inspect(pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])
            if disable_depth:
                d.gl.glDisable(0x0b71)
            return observed
        rgba, observed = d.draw_ray(program, stages, vertices, local_indices, blocks, textures, apply)
        changed = int(np.count_nonzero(np.any(np.abs(rgba[:, :, :3].astype(int) - [6, 9, 14]) > 2, axis=2)))
        records.append({'label': label, 'changedPixels': changed, 'rgbaSha256': sha(rgba.tobytes()), 'pipeline': observed['pipeline'], 'diagnosticDepthDisabled': disable_depth})
        if label == 'open':
            Image.fromarray(rgba).save(OUT.with_name('no-alpha-mult-v40-' + binding['effectId'].split('/')[1] + '.png'))
    d.gl.glDeleteProgram(program)
    by = {row['label']: row for row in records}
    if by['open']['changedPixels'] <= 0 or by['near-depth-occluder']['changedPixels'] != 0 or by['reversed-winding']['changedPixels'] != 0 or by['occluder-with-depth-disabled-control']['rgbaSha256'] != by['open']['rgbaSha256']:
        raise ValueError('Native blend/depth/cull raster controls differ: ' + json.dumps(records))
    return {'projection': proj, 'projectedAxes': [int(axis) for axis in axes], 'verticesSha256': sha(vertices), 'indicesSha256': sha(indices), 'uniformBlocks': observed['uniformBlocks'], 'rasterControls': records}


def main():
    if OUT.exists():
        raise ValueError('Preserve immutable prior result')
    baseline = read(ROOT / '.cache/replay-spike/research/no-alpha-mult-v39-native-baseline/no-alpha-mult-native-reflection-v39.json', '032b9e3a5704a386f13352ce3590434b8862a1601f804f8d46ddf30d0cb847d4')
    angle = Path('C:/Users/Jerred/AppData/Local/Programs/cursor')
    primary = ROOT / '.cache/replay-spike'
    client = primary / 'research/LeagueofLegends-macos'
    native = NativeBoundQuad(primary / 'public/decoder-16.21-macos', client)
    d = RayDraw(angle)
    depth = None
    rows = []
    try:
        image = raw(primary / 'public/decoder-16.21-macos/image.bin', '3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7')
        pipeline_device = GraphicsPipelineDevice(d, image)
        depth = depth_attachment(d)
        for old in baseline['rows']:
            cache = ROOT / '.cache' / old['cache']
            assets = cache / 'public'
            package = read(assets / 'latest-complete-quad-gpu/package.json', baseline['inputs'][str((assets / 'latest-complete-quad-gpu/package.json').resolve())])
            key = old['materialKey']
            binding = next(row for row in package['emitters'] if f"{row['effectId']}:{row['emitterIndex']}" == key)
            if binding['shaders']['vertex']['sha256'] != VS or binding['shaders']['pixel']['sha256'] != PS or binding['suppliedSortPass'] != old['ownedSortPass']:
                raise ValueError('Exact native material tuple changed')
            materials = read(cache / 'research/vfx-materials-native.json', package['nativeMaterialSha256'])
            observation = next(row for row in materials['emitters'] if f"{row['effectId']}:{row['emitterIndex']}" == key)
            graph = read(assets / 'decoder-16.21-macos' / observation['graphFile'], observation['graphSha256'])
            metadata = read(assets / 'decoder-16.21-macos/vfx-bound-quads.json')
            native.reset_bound(graph, 1, 0, metadata)
            previous, frames = [0, 0, 0], []
            for tick in range(61):
                time = tick / 60
                current = [time * 130, time * 3, time * 70]
                value = {'time': time, 'previous': previous, 'current': current,
                         'basis': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                         'viewPosition': [0, 0, 1000], 'cameraRight': [1, 0, 0], 'cameraUp': [0, 1, 0],
                         'viewAxis': [0, 0, 1], 'multTexturePresent': True}
                output = native.frame_bound(value)
                frames.append({'input': value, 'output': {'state': {name: output['state'][name] for name in ['births', 'vectors', 'rngHex']}, 'geometry': {name: output['geometry'][name] for name in ['verticesHex', 'indicesHex', 'drawHex']}}})
                previous = current
            positive = [frame for frame in frames if frame['output']['geometry']['verticesHex'] and any(bytes.fromhex(frame['output']['geometry']['verticesHex'])[at + 15] for at in range(0, len(bytes.fromhex(frame['output']['geometry']['verticesHex'])), 28))]
            if not positive:
                raise ValueError('Positive native vertex-alpha frames required')
            # Use a well-developed native particle rather than its zero-alpha birth.
            frame = max(positive, key=lambda frame: max(bytes.fromhex(frame['output']['geometry']['verticesHex'])[15::28]))
            stages = [read(assets / 'latest-shaders' / binding['shaders'][name]['file'], binding['shaders'][name]['sha256']) for name in ['vertex', 'pixel']]
            raster = render_control(d, pipeline_device, binding, stages, frame, assets)
            rows.append({'cache': old['cache'], 'materialKey': key, 'seedHex': '0000000000000001', 'sourceDefinitionSha256': binding['sourceDefinitionSha256'], 'ownedSortPass': old['ownedSortPass'], 'nativeGraphSha256': observation['graphSha256'], 'frames': frames, 'rasterFrameTime': frame['input']['time'], 'raster': raster})
            print(json.dumps({'materialKey': key, 'nativeFrames': len(frames), 'rasterFrameTime': frame['input']['time'], 'rasterPixels': [(row['label'], row['changedPixels']) for row in raster['rasterControls']]}), flush=True)
        for module in tuple(sys.modules.values()):
            path = getattr(module, '__file__', None)
            if path and Path(path).suffix == '.py' and Path(path).resolve().is_relative_to(TOOLS):
                raw(path)
        for path in [Path(__file__), client, angle / 'libEGL.dll', angle / 'libGLESv2.dll']:
            raw(path)
        for path, digest in INPUTS.items():
            if sha(Path(path).read_bytes()) != digest:
                raise ValueError('Proof input drifted: ' + path)
        result = {'schema': 1, 'kind': 'original-no-alpha-mult-bound-stream-and-native-pipeline-raster-controls', 'inputs': INPUTS, 'context': d.info, 'rows': rows, 'originalBlocks': list(native.blocks.values()), 'counts': {'materials': len(rows), 'nativeFrames': sum(len(row['frames']) for row in rows), 'rasterControls': sum(len(row['raster']['rasterControls']) for row in rows)}, 'scope': {'unchangedNativeLoadedGraphs': True, 'multTexturePresenceSuppliedTrue': True, 'suppliedUnitDefaultFlexContext': True, 'originalNativePipelineDepthCullBlend': True, 'suppliedDiagnosticProjectionAndDepthOccluder': True, 'originalTexturePayloads': True, 'lookupAndRemapPartialPoliciesExplicit': True, 'directRuntimeCompared': False, 'productionAdmissionChanged': False, 'matchRenderedCoverage': False, 'browserAcceptance': False, 'leagueFramebufferParity': False}}
        OUT.write_text(json.dumps(result, separators=(',', ':'), allow_nan=False))
        print(json.dumps({'output': str(OUT), 'sha256': sha(OUT.read_bytes()), 'counts': result['counts']}), flush=True)
    finally:
        if depth is not None:
            d.gl.glDeleteRenderbuffers(1, C.byref(depth))
        d.close()


if __name__ == '__main__':
    main()
