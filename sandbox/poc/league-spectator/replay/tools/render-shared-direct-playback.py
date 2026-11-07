"""Submit actual shared-runtime frame packets together through prepared shaders.

This fixed offscreen diagnostic projection contains effects only. It does not
establish browser playback, scene occlusion, per-instance pixels or match parity.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
import subprocess
import ctypes as C
import numpy as np
from PIL import Image, ImageDraw
from offscreen_direct_batch import DirectBatchDraw, adapter
from offscreen_static_mesh import StaticMeshDraw
from offscreen_ray import RayDraw
from offscreen_ray_material import prepare_ray_material
from graphics_material_bindings import GraphicsMaterialBindings
from graphics_pipeline_device import GraphicsPipelineDevice
from offscreen_nav_ground import OwnedNavGroundReplay
from diagnostic_creator_coverage import decoded_hero_owners, raster_identity, summarize_raster_ownership


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('angle', type=Path)
    parser.add_argument('--bun', default='bun', help='Bun executable for the shared JS material binder')
    parser.add_argument('--comparison-projection',type=Path,help='Pinned frozen projection/camera/viewport JSON')
    parser.add_argument('--report-output',type=Path)
    parser.add_argument('--media-prefix',default='shared-direct-playback')
    parser.add_argument('--artifact-prefix',default='shared')
    parser.add_argument('--session-capture',type=Path,help='Explicit actual-session worker capture, separate from the original worker fixture')
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}
    if any(not value or any(char not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for char in value)
           for value in [args.media_prefix,args.artifact_prefix]):
        raise ValueError('Bounded diagnostic media/artifact filename prefixes required')
    assets = cache / 'public'

    def raw(path):
        data = path.read_bytes()
        key, digest = str(path.resolve()), adapter.sha(data)
        if key in inputs and inputs[key] != digest:
            raise ValueError('Shared raster input changed during capture: ' + key)
        inputs[key] = digest
        return data

    def read(path):
        return json.loads(raw(path))

    for path in [Path(__file__), Path(inspect.getfile(DirectBatchDraw)), Path(adapter.__file__), Path(adapter.adapter.__file__)]:
        raw(path)
    for name in ['libEGL.dll', 'libGLESv2.dll']:
        raw(args.angle / name)
    proof = read(args.session_capture.resolve() if args.session_capture else cache / 'research/shared-direct-playback-worker.json')
    if args.session_capture:
        if (proof.get('kind') != 'actual-ordinary-direct-session-playback-capture' or
                proof['scope'].get('actualInitializedOrdinarySessionClient') is not True or
                proof['scope'].get('actualDecodedReplayRequests') is not True or
                proof['scope'].get('suppliedEffectDefinitions') is not False or
                proof['scope'].get('suppliedPerRequestPlacement') is not False or
                any(proof['controls'].get(key) is not True for key in
                    ['realBunModuleWorker','identical1x4xCheckpoint','cameraWithoutSimulation','backwardRepeatedSeek']) or
                not proof.get('snapshots')):
            raise ValueError('Complete actual-session retained-state capture required')
    elif (proof['kind'] != 'ordinary-decoded-initial-resource-presentation-worker-control' or
          not proof['scope']['actualDecodedReplayRequests'] or proof['scope']['suppliedEffectDefinitions'] or
          not proof['controls']['identical1x4xCheckpoint'] or not proof['directMissilePreparation'] or not proof['snapshots']):
        raise ValueError('Complete actual shared worker proof with retained-state controls required')
    for path, digest in proof['inputs'].items():
        if adapter.sha(raw(Path(path))) != digest:
            raise ValueError('Shared worker proof input changed: ' + path)
    heroes = decoded_hero_owners(proof, cache, raw)
    raw(Path(__file__).with_name('diagnostic_creator_coverage.py'))
    bindings = {}
    if args.session_capture:
        # Only the initial selected quad capability is implemented here. Each
        # captured THREE binding must equal its real selected package row.
        quad_path = (assets / 'latest-complete-quad-gpu/package.json').resolve()
        quad_bytes = raw(quad_path)
        if proof['inputs'].get(str(quad_path)) != adapter.sha(quad_bytes):
            raise ValueError('Session capture must pin its actual quad package')
        quad_rows = {(b['effectId'],b['emitterIndex']):b for b in json.loads(quad_bytes)['emitters']}
        for binding in proof['materialBindings']:
            key = binding['effectId'],binding['emitterIndex']
            if key in bindings or quad_rows.get(key) != binding:
                raise ValueError('Actual session material differs from its selected quad row')
            bindings[key] = binding
        for frame in proof['snapshots']:
            for draw in frame['draws']:
                # The existing direct packet contract omits `primitive` on
                # quads; trails/rays/meshes carry an explicit discriminator.
                particles = draw.get('particleCount')
                if (draw.get('primitive') not in [None,'camera-quad','arbitrary-quad'] or
                        type(particles) is not int or not 1 <= particles <= 65535 or
                        len(draw['geometry']['verticesHex']) != particles * 4 * 28 * 2 or
                        len(draw['geometry']['indicesHex']) != particles * 6 * 2 * 2 or
                        (draw['definitionId'],draw['emitterId']) not in bindings):
                    raise ValueError('Session-capture raster requires owned quad materials and exact quad packet buffers')
    else:
        for directory, filename in [('latest-complete-quad-gpu', 'package.json'), ('latest-trail-particles', 'gpu.json'),
                                    ('latest-quad-erosion-gpu', 'package.json'), ('latest-direct-ground-materials', 'package.json')]:
            for binding in read(assets / directory / filename)['emitters']:
                bindings[(binding['effectId'], binding['emitterIndex'])] = binding
    frames = proof['snapshots']
    nav_programs = {(p['definitionId'],p['emitterId']) for p in proof.get('navGroundPrograms',[])}
    depth_bias_programs = {(p['definitionId'],p['emitterId']):p['depthBiasProgram'] for p in proof.get('depthBiasPrograms',[])}
    mesh_programs = {(p['definitionId'], p['emitterId']): p for p in proof.get('staticMeshPrograms', [])}
    mesh_assets = {}
    if mesh_programs:
        for path in [Path(inspect.getfile(StaticMeshDraw)), Path(inspect.getfile(GraphicsMaterialBindings)),
                     Path(inspect.getfile(GraphicsPipelineDevice))]:
            raw(path)
        mesh_package = read(assets / 'latest-direct-static-mesh-materials/package.json')
        for key, metadata in mesh_programs.items():
            emitter = next(e for e in mesh_package['emitters'] if (e['effectId'], e['emitterIndex']) == key)
            selected = metadata['meshMaterialSelection']
            row = next(r for r in emitter['rows'] if r['hash'] == selected['passHash'])
            variant = row['variants'][selected['variantIndex']]
            def mesh_resource(ref):
                value = raw(assets / 'latest-direct-static-mesh-materials' / ref['file'])
                if len(value) != ref['bytes'] or adapter.sha(value) != ref['sha256']:
                    raise ValueError('Exact static mesh resource changed')
                return value
            vertices = mesh_resource(emitter['mesh']['vertices'])
            if metadata['meshProgram']['resource']['vertices']['sha256'] != adapter.sha(vertices):
                raise ValueError('Worker static mesh resource identity differs')
            mesh_assets[key] = {'emitter': emitter, 'variant': variant, 'vertices': vertices,
                'stages': [json.loads(mesh_resource(variant['shaders'][s])) for s in ['vertex', 'pixel']],
                'textures': [{**t, 'pixels': mesh_resource(t['levels'][0][0])} for t in variant['textures']]}
    view = frames[0]['camera']
    if any(frame['camera'] != view for frame in frames):
        raise ValueError('One fixed diagnostic projection requires matching worker camera frames')
    right, up = np.array(view['right']), np.array(view['up'])

    def points(draw):
        if draw.get('primitive') == 'static-mesh':
            asset = mesh_assets[(draw['definitionId'], draw['emitterId'])]
            vertices = np.frombuffer(asset['vertices'], dtype=np.uint8).reshape(-1, 36)
            positions = np.array([struct.unpack_from('<3f', row.tobytes()) for row in vertices])
            homogeneous = np.column_stack([positions, np.ones(len(positions))])
            records = bytes.fromhex(draw['geometry']['meshRecordsHex'])
            if len(records) != draw['particleCount'] * 176:
                raise ValueError('Exact retained mesh record count required')
            result = [homogeneous @ np.frombuffer(records, dtype='<f4', count=16, offset=i * 176).reshape(4, 4)
                      for i in range(draw['particleCount'])]
            return np.concatenate(result)[:, :3] if result else np.empty((0, 3))
        data = bytes.fromhex(draw['geometry']['verticesHex'])
        if len(data) % 28:
            raise ValueError('Actual worker vertex stride differs')
        return np.array([struct.unpack_from('<3f', data, at) for at in range(0, len(data), 28)])

    positions = np.concatenate([points(draw) for frame in frames for draw in frame['draws']])
    projected = np.column_stack((positions @ right, positions @ up))
    center, extent = (projected.min(0) + projected.max(0)) / 2, np.ptp(projected, axis=0).max() * .6
    if not np.isfinite(extent) or extent <= 0:
        raise ValueError('Actual shared-frame projection has no finite extent')
    projection = np.zeros((4, 4))
    projection[0, :3], projection[1, :3] = right / extent, up / extent
    projection[0, 3], projection[1, 3] = -center / extent
    projection[2, 3], projection[3, 3] = .5, 1
    projection_source=None
    if args.comparison_projection:
        frozen=read(args.comparison_projection)
        if (frozen.get('kind')!='frozen-offscreen-replay-projection' or frozen['viewport']!=[0,0,512,512] or
                frozen['camera']!=view or len(frozen['projection'])!=16 or not all(np.isfinite(frozen['projection']))):
            raise ValueError('Exact frozen projection, camera and viewport required')
        for path,digest in frozen['inputs'].items():
            if adapter.sha(raw(Path(path)))!=digest:raise ValueError('Frozen projection source changed: '+path)
        if str(Path(adapter.__file__).resolve()) not in frozen['inputs']:
            raise ValueError('Frozen 512x512 viewport adapter source pin required')
        baseline_rasters=[Path(path) for path in frozen['inputs'] if Path(path).name.startswith('shared-direct-playback-offscreen-v')]
        baseline_workers=[Path(path) for path in frozen['inputs'] if Path(path).name.startswith('shared-direct-playback-worker-v')]
        if len(baseline_rasters)!=1 or len(baseline_workers)!=1:
            raise ValueError('One immutable baseline raster and worker required')
        baseline_raster,baseline_worker=read(baseline_rasters[0]),read(baseline_workers[0])
        worker_pins=[digest for path,digest in baseline_raster['inputs'].items() if Path(path).name=='shared-direct-playback-worker.json']
        if worker_pins!=[frozen['inputs'][str(baseline_workers[0])]]:
            raise ValueError('Frozen baseline raster must bind the exact baseline worker bytes')
        if (baseline_raster['projection']!=frozen['projection'] or
                baseline_raster.get('viewport',[0,0,512,512])!=frozen['viewport'] or
                baseline_raster['inputs'].get(str(Path(adapter.__file__).resolve()))!=frozen['inputs'][str(Path(adapter.__file__).resolve())] or
                baseline_worker['comparisonWindow']!=proof['comparisonWindow'] or
                baseline_worker['sourceCounts']!=proof['sourceCounts'] or
                [frame['time'] for frame in baseline_raster['frames']]!=[frame['time'] for frame in frames] or
                [frame['camera'] for frame in baseline_worker['snapshots']]!=[frame['camera'] for frame in frames]):
            raise ValueError('Frozen baseline projection, viewport, source clock and complete camera sequence must match')
        for name in ['.rofl','latest-effects/manifest.json']:
            selected=lambda record:{path:digest for path,digest in record['inputs'].items()
                if path.replace('\\','/').endswith(name)}
            baseline,current=selected(baseline_worker),selected(proof)
            if len(baseline)!=1 or baseline!=current:
                raise ValueError('Frozen baseline replay/build input differs: '+name)
            for path,digest in baseline.items():
                if adapter.sha(raw(Path(path)))!=digest:
                    raise ValueError('Frozen replay/build source changed: '+path)
        projection=np.asarray(frozen['projection'],dtype=float).reshape(4,4)
        projection_source=str(args.comparison_projection.resolve())
    nav_export = None
    if nav_programs:
        scene_path = cache/'research'/f'{args.artifact_prefix}-nav-ground-scene.json'
        scene_path.write_text(json.dumps({'projectionRows':projection.flatten().tolist(),'position':view['position']}))
        raw(scene_path)
        export_path = cache/'research'/f'{args.artifact_prefix}-nav-ground-frame-bindings.json'
        subprocess.run([args.bun,str(Path(__file__).with_name('export-direct-nav-ground-renderer.mjs')),str(cache),
            str(cache/'research/shared-direct-playback-worker.json'),str(scene_path),str(export_path)],check=True)
        nav_export = read(export_path)
        for path,digest in nav_export['inputs'].items():
            if adapter.sha(raw(Path(path)))!=digest:raise ValueError('Shared navigation binder input changed: '+path)
    mesh_frames = None
    if mesh_programs:
        scene_path = cache / 'research'/f'{args.artifact_prefix}-static-mesh-scene.json'
        scene_path.write_text(json.dumps({'projectionRows': projection.flatten().tolist(), 'position': [0, 1000, 0],
            'forward': (-np.cross(right, up)).tolist(), 'up': up.tolist()}))
        raw(scene_path)
        exporter = Path(__file__).with_name('export-shared-static-mesh-frames.mjs')
        mesh_path=cache/'research'/f'{args.artifact_prefix}-static-mesh-frame-bindings.json'
        subprocess.run([args.bun, str(exporter), str(cache), str(scene_path),
            str(cache/'research/shared-direct-playback-worker.json'),str(mesh_path)], check=True)
        mesh_export = read(mesh_path)
        for path, digest in mesh_export['inputs'].items():
            if adapter.sha(raw(Path(path))) != digest:
                raise ValueError('Shared JS mesh binder input changed')
        mesh_frames = mesh_export['frames']
        if len(mesh_frames) != len(frames) or any(a['time'] != b['time'] for a, b in zip(mesh_frames, frames, strict=True)):
            raise ValueError('Shared mesh binder frame ordering differs')
    ray_programs = proof.get('rayPrograms', [])
    ray_export = None
    if ray_programs:
        for path in [Path(inspect.getfile(RayDraw)), Path(inspect.getfile(prepare_ray_material))]:
            raw(path)
        scene_path = cache / 'research'/f'{args.artifact_prefix}-ray-scene.json'
        scene_path.write_text(json.dumps({'projectionRows': projection.flatten().tolist(), 'position': view['position']}))
        raw(scene_path)
        ray_path=cache/'research'/f'{args.artifact_prefix}-ray-frame-bindings.json'
        subprocess.run([args.bun, str(Path(__file__).with_name('export-shared-ray-frames.mjs')), str(cache), str(scene_path),
            str(cache/'research/shared-direct-playback-worker.json'),str(ray_path)], check=True)
        ray_export = read(ray_path)
        for path, digest in ray_export['inputs'].items():
            if adapter.sha(raw(Path(path))) != digest:
                raise ValueError('Shared JS Ray binder input changed')
        if len(ray_export['frames']) != len(frames) or any(a['time'] != b['time'] for a, b in zip(ray_export['frames'], frames, strict=True)):
            raise ValueError('Shared Ray binder frame ordering differs')
    renderer = DirectBatchDraw(args.angle)
    renderer.fn(renderer.gl, 'glBindSampler', None, C.c_uint, C.c_uint)
    material_device = GraphicsMaterialBindings(renderer, None) if mesh_programs or ray_programs else None
    pipeline_device = GraphicsPipelineDevice(renderer, raw(assets / 'decoder-16.21-macos/image.bin')) if mesh_programs or ray_programs else None
    mesh_prepared = {}
    ray_prepared = {}
    programs, textures, records, images = {}, {}, [], []
    nav_replay = OwnedNavGroundReplay(renderer,cache,nav_export,raw) if nav_export else None
    try:
        for frame_index, frame in enumerate(frames):
            submitted, previous_rgb = [], None
            if not frame['draws']:
                renderer.gl.glClearColor(0.025, 0.035, 0.055, 1)
                renderer.gl.glClear(0x4000)
                renderer.gl.glFinish()
                empty_pixels = (C.c_ubyte * (512 * 512 * 4))()
                renderer.gl.glReadPixels(0, 0, 512, 512, 0x1908, 0x1401, empty_pixels)
                rgba = np.frombuffer(empty_pixels, dtype=np.uint8).reshape(512,512,4)[::-1].copy()
                if renderer.gl.glGetError():
                    raise ValueError('Empty shared frame clear/readback failed')
            for index, draw in enumerate(frame['draws']):
                if (draw['definitionId'],draw['emitterId']) in nav_programs:
                    rgba, observations = nav_replay.draw(frame['time'],draw,clear=previous_rgb is None)
                    rgb_bytes=rgba[:,:,:3].astype(int)
                    baseline=[6,9,14] if previous_rgb is None else previous_rgb
                    changed=int(np.count_nonzero(np.any(np.abs(rgb_bytes-baseline)>2,axis=2)))
                    previous_rgb=rgb_bytes
                    submitted.append({**raster_identity(draw,heroes),'primitive':'navigation-ground-quad',
                        'prefixFramebufferChangedPixels':changed,'verticesSha256':adapter.sha(bytes.fromhex(draw['geometry']['verticesHex'])),
                        'indicesSha256':adapter.sha(bytes.fromhex(draw['geometry']['indicesHex'])),
                        'uniformBuffers':observations['uniformBlocks'],'partialTexturePolicies':['owned-selected-scene-navigation','allvision-remap-omitted']})
                    continue
                if draw.get('primitive') == 'ray':
                    key = draw['materialKey']
                    if key not in ray_prepared:
                        ray_prepared[key] = prepare_ray_material(renderer, material_device, pipeline_device,
                            ray_export['materials'][key], ray_export['rasterStates'][key])
                    program, stages, pipeline, tex = ray_prepared[key]
                    matches = [d for d in ray_export['frames'][frame_index]['draws'] if
                        (d['sourceEventId'], d['generation'], d['emitterId']) ==
                        (draw['sourceEventId'], draw['generation'], draw['emitterId'])]
                    if len(matches) != 1 or matches[0]['particleCount'] != draw['particleCount']:
                        raise ValueError('Exact shared Ray packet ownership required')
                    blocks = [{**b, 'bytes': bytes.fromhex(b['bytesHex'])} for b in matches[0]['uniformBlocks']]
                    vertices = bytes.fromhex(draw['geometry']['verticesHex'])
                    indices = bytes.fromhex(draw['geometry']['indicesHex'])
                    def apply_ray_pipeline():
                        pipeline_device.apply(pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])
                        return pipeline_device.inspect(pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])
                    rgba, observations = RayDraw.draw_ray(renderer, program, stages, vertices, indices, blocks, tex,
                        apply_ray_pipeline, clear=previous_rgb is None, readback=True)
                    rgb_bytes = rgba[:, :, :3].astype(int)
                    baseline = [6, 9, 14] if previous_rgb is None else previous_rgb
                    changed = int(np.count_nonzero(np.any(np.abs(rgb_bytes - baseline) > 2, axis=2)))
                    previous_rgb = rgb_bytes
                    for t in tex.values():
                        renderer.gl.glBindSampler(t['unit'], 0)
                    submitted.append({**raster_identity(draw, heroes), 'sourceEventId': draw['sourceEventId'], 'generation': draw['generation'],
                        'definitionId': draw['definitionId'], 'emitterId': draw['emitterId'], 'primitive': 'ray',
                        'prefixFramebufferChangedPixels': changed, 'verticesSha256': adapter.sha(vertices),
                        'indicesSha256': adapter.sha(indices), 'uniformBuffers': observations['uniformBlocks'],
                        'glesRaster': ray_export['rasterStates'][key],
                        'partialTexturePolicies': ['native-ray-allvision-remap-omitted-v1']})
                    continue
                if draw.get('primitive') == 'static-mesh':
                    owner = draw['definitionId'], draw['emitterId']
                    asset = mesh_assets[owner]
                    if owner not in mesh_prepared:
                        stages = asset['stages']
                        program = renderer.program(*stages)
                        pipeline = pipeline_device.create(bytes.fromhex(asset['variant']['pipeline']['descriptorHex']), {'linked': True, 'glHandle': program})
                        if pipeline['state'] != asset['variant']['pipeline']['state']:
                            raise ValueError('Original mesh pipeline differs')
                        raster = mesh_export['rasterStates'][draw['materialKey']]
                        if raster['sourceState'] != pipeline['state'] or not raster['windingReversed'] or raster['cullModeChanged']:
                            raise ValueError('Exact native Metal to lower-left GLES raster conversion required')
                        pipeline = {**pipeline, 'nativeRasterState': pipeline['state'], 'state': raster['state']}
                        tex = {}
                        for t in asset['textures']:
                            if len(t['levels']) != 1 or len(t['levels'][0]) != 1:
                                raise ValueError('Static mesh raster requires original single-mip texture')
                            pixels = np.frombuffer(t['pixels'], dtype=np.uint8).reshape(t['height'], t['width'], 4)
                            handle = renderer.texture(pixels, 'clamp', 'nearest')
                            sampler = material_device.sampler(bytes.fromhex(t['sampler']['descriptorHex']))
                            tex[t['name']] = {'handle': handle, 'sampler': sampler['glHandle'], 'unit': t['unit']}
                        for name, rgba_value, unit in [('FOW_MAP_SharedTexture', [255] * 4, 1), ('PIXEL_COLOR_REMAP_RAMP_SharedTexture', [0] * 4, 2)]:
                            tex[name] = {'handle': renderer.texture(np.array([[rgba_value]], dtype=np.uint8), 'clamp', 'nearest'), 'sampler': 0, 'unit': unit}
                        inactive = StaticMeshDraw.uint_texture(renderer, bytes(208))
                        mesh_prepared[owner] = program, stages, pipeline, tex, inactive
                    program, stages, pipeline, tex, inactive = mesh_prepared[owner]
                    matches = [d for d in mesh_frames[frame_index]['draws'] if d['sourceEventId'] == draw['sourceEventId'] and d['generation'] == draw['generation'] and d['emitterId'] == draw['emitterId']]
                    if len(matches) != 1 or len(matches[0]['particles']) != draw['particleCount']:
                        raise ValueError('Exact shared mesh particle binding ownership required')
                    mesh_indices = np.arange(len(asset['vertices']) // 36, dtype='<u2').tobytes()
                    changed = 0
                    uniform_observations = []
                    def apply_pipeline():
                        pipeline_device.apply(pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])
                        return pipeline_device.inspect(pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])
                    for particle_index, particle in enumerate(matches[0]['particles']):
                        blocks = [{**b, 'bytes': bytes.fromhex(b['bytesHex'])} for b in particle['uniformBlocks']]
                        rgba, observations = StaticMeshDraw.draw_mesh(renderer, program, stages, asset['vertices'], mesh_indices, blocks, tex,
                            {'ParticleMeshInstanceInfo_SharedDataBuffer': {'handle': inactive, 'sampler': 0, 'unit': 0}}, apply_pipeline,
                            clear=previous_rgb is None, readback=True)
                        rgb_bytes = rgba[:, :, :3].astype(int)
                        baseline = [6, 9, 14] if previous_rgb is None else previous_rgb
                        changed += int(np.count_nonzero(np.any(np.abs(rgb_bytes - baseline) > 2, axis=2)))
                        previous_rgb = rgb_bytes
                        uniform_observations.append(observations['uniformBlocks'])
                    for unit in {0, *(t['unit'] for t in tex.values())}:
                        renderer.gl.glBindSampler(unit, 0)
                    submitted.append({**raster_identity(draw, heroes), 'sourceEventId': draw['sourceEventId'], 'generation': draw['generation'],
                        'definitionId': draw['definitionId'], 'emitterId': draw['emitterId'], 'primitive': 'static-mesh',
                        'prefixFramebufferChangedPixels': changed, 'verticesSha256': adapter.sha(asset['vertices']),
                        'indicesSha256': adapter.sha(mesh_indices), 'uniformBuffers': uniform_observations,
                        'glesRaster': mesh_export['rasterStates'][draw['materialKey']],
                        'partialTexturePolicies': ['native-static-mesh-allvision-remap-omitted-v1']})
                    continue
                binding = bindings[(draw['definitionId'], draw['emitterId'])]
                key = tuple(binding['shaders'][stage]['sha256'] for stage in ['vertex', 'pixel'])
                if key not in programs:
                    stages = []
                    for stage in ['vertex', 'pixel']:
                        ref = binding['shaders'][stage]
                        data = raw(assets / 'latest-shaders' / ref['file'])
                        if adapter.sha(data) != ref['sha256']:
                            raise ValueError('Shared-frame shader hash differs')
                        stages.append(json.loads(data))
                    programs[key] = renderer.program(*stages), stages
                program, stages = programs[key]
                values, bound = {}, {}
                for shader in stages:
                    for block in shader['sidecar']['blocks']:
                        prepared = next(item for item in binding['blocks'] if item['glslName'] == block['glslName'])
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
                        choices = [binding['textures'][item['glslName']] for item in texture['samplers']]
                        if not choices or any(item != choices[0] for item in choices):
                            raise ValueError('Conflicting shared-frame texture inputs')
                        resource = choices[0]
                        token = json.dumps(resource, sort_keys=True)
                        if token not in textures:
                            if resource['kind'] == 'prepared-texture':
                                path = assets / 'latest-effects' / resource['file']
                                if adapter.sha(raw(path)) != resource['sha256']:
                                    raise ValueError('Shared-frame texture hash differs')
                                pixels = np.array(Image.open(path).convert('RGBA'))
                                address = resource['sampler']['name']
                                filtering = 'nearest' if resource['sampler']['pixelated'] else 'linear'
                            elif resource['kind'] == 'native-ground-all-vision':
                                if (resource['rgbaHex'] != 'ffffffff' or
                                        resource['nativeTextureSha256'] != 'ad95131bc0b799c0b1af477fb14fcf26a6a9f76079e48bf090acb7e8367bfd0e' or
                                        resource['sampler'] != {'name': 'clamp', 'pixelated': True}):
                                    raise ValueError('Exact native diagnostic terrain visibility texture required')
                                pixels = np.frombuffer(bytes.fromhex(resource['rgbaHex']), dtype=np.uint8).reshape(1, 1, 4)
                                address, filtering = 'clamp', 'nearest'
                            elif resource['kind'] in ['supplied-white-lookup', 'supplied-transparent-remap']:
                                pixels = np.full((1, 1, 4), 255 if resource['kind'] == 'supplied-white-lookup' else 0, dtype=np.uint8)
                                address, filtering = 'clamp', 'nearest'
                            else:
                                raise ValueError('Unimplemented shared-frame diagnostic texture kind')
                            textures[token] = renderer.texture(pixels, address, filtering)
                        bound[texture['name']] = textures[token]
                factors = binding['nativeBlendFactors']
                if factors[0] != factors[1] or factors[2] != factors[3]:
                    raise ValueError('Separate alpha blend factors require a matching adapter')
                mapping = {1: 1, 6: 0x302, 7: 0x303}
                vertices = bytes.fromhex(draw['geometry']['verticesHex'])
                indices = bytes.fromhex(draw['geometry']['indicesHex'])
                bias_program=depth_bias_programs.get((draw['definitionId'],draw['emitterId']))
                depth_bias=None
                if bias_program is not None:
                    native_state=bytes.fromhex(binding['nativeRenderStateHex'])
                    if len(native_state)!=32 or bias_program.get('policy')!='original-camera-quad-raster-depth-bias-v1' or bool(native_state[4]&8)!=bias_program['enabled'] or struct.pack('<ff',bias_program['slope'],bias_program['constant'])!=native_state[24:32]:
                        raise ValueError('Compiled direct bias differs from owned material native raster bytes')
                    if bias_program['enabled']:depth_bias=[bias_program['slope'],bias_program['constant']]
                rgba, blocks = renderer.draw(program, stages, vertices, indices, values, bound,
                    blend=(mapping[factors[0]], mapping[factors[2]]), clear=previous_rgb is None, readback=True,depth_bias=depth_bias)
                # Readbacks observe the same ordered framebuffer without changing
                # the draw stream. A positive prefix contribution can subsequently
                # be covered by another draw; it is not final pixel attribution.
                rgb_bytes = rgba[:, :, :3].astype(int)
                baseline = [6, 9, 14] if previous_rgb is None else previous_rgb
                changed = int(np.count_nonzero(np.any(np.abs(rgb_bytes - baseline) > 2, axis=2)))
                previous_rgb = rgb_bytes
                submitted.append({**raster_identity(draw, heroes), 'sourceEventId': draw['sourceEventId'], 'generation': draw['generation'],
                    'definitionId': draw['definitionId'], 'emitterId': draw['emitterId'],
                    'prefixFramebufferChangedPixels': changed,
                    'verticesSha256': adapter.sha(vertices), 'indicesSha256': adapter.sha(indices),
                    'uniformBuffers': blocks,
                    'depthBiasProgram':bias_program,
                    'partialTexturePolicies': sorted({value['kind'] for value in binding['textures'].values() if value['kind'].startswith('supplied-')})})
            visible = int(np.count_nonzero(np.any(np.abs(rgba[:, :, :3].astype(int) - [6, 9, 14]) > 2, axis=2)))
            rgb = rgba[:, :, :3].astype(float) / 255
            display = np.clip(np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - .055), 0, 1)
            image = Image.new('RGB', (660, 570), '#101822')
            image.paste(Image.fromarray(np.uint8(display * 255)), (74, 50))
            labels = ImageDraw.Draw(image)
            labels.text((14, 8), f"Actual decoded replay effect packets / {frame['time']:.3f}s / {len(submitted)} draw components", fill='#e9eef7')
            labels.text((14, 26), 'One fixed offscreen view; effects only. Explicit partial policies; browser acceptance unverified.', fill='#a8bdd0')
            images.append(image)
            records.append({'time': frame['time'], 'visiblePixels': visible, 'draws': submitted,
                            'rgbaSha256': adapter.sha(rgba.tobytes())})
    finally:
        if nav_replay:nav_replay.close()
        for program, _ in programs.values():
            renderer.gl.glDeleteProgram(program)
        for program, *_ in mesh_prepared.values():
            renderer.gl.glDeleteProgram(program)
        if material_device:
            material_device.close()
        renderer.close()
    folder = cache / 'visuals'
    folder.mkdir(exist_ok=True)
    gif = folder / f'{args.media_prefix}.gif'
    durations = [max(1, round((frames[index + 1]['time'] - frame['time']) * 1000))
                 if index + 1 < len(frames) else 500 for index, frame in enumerate(frames)]
    images[0].save(gif, save_all=True, append_images=images[1:], duration=durations, loop=0)
    # Keep the strongest frame for each submitted-definition set.
    strongest = {}
    for index, row in enumerate(records):
        key = tuple(sorted({draw['definitionId'] for draw in row['draws']}))
        if key not in strongest or row['visiblePixels'] > records[strongest[key]]['visiblePixels']:
            strongest[key] = index
    # Cover every submitted definition before adding extra comparison frames;
    # taking the first six signatures hides later missile/auxiliary effects.
    remaining, covered, chosen = list(strongest.values()), set(), []
    while remaining:
        index = max(remaining, key=lambda i: (
            len({draw['definitionId'] for draw in records[i]['draws']} - covered),
            records[i]['visiblePixels']))
        newly = {draw['definitionId'] for draw in records[index]['draws']} - covered
        if not newly:
            break
        chosen.append(index)
        covered.update(newly)
        remaining.remove(index)
    for index in sorted(remaining, key=lambda i: records[i]['visiblePixels'], reverse=True):
        if len(chosen) >= max(6, len(covered)):
            break
        chosen.append(index)
    sheet = Image.new('RGB', (660 * min(3, len(chosen)), 570 * ((len(chosen) + 2) // 3)), '#101822')
    for at, index in enumerate(chosen):
        sheet.paste(images[index], ((at % 3) * 660, (at // 3) * 570))
    image_path = folder / f'{args.media_prefix}.png'
    sheet.save(image_path)
    for path, digest in inputs.items():
        if adapter.sha(Path(path).read_bytes()) != digest:
            raise ValueError('Shared raster input changed: ' + path)
    submitted = [draw for row in records for draw in row['draws']]
    contributors = [draw for draw in submitted if draw['prefixFramebufferChangedPixels'] > 0]
    result = {'schema': 1, 'kind': 'actual-shared-direct-packets-offscreen-raster', 'inputs': inputs,
        'image': str(image_path), 'imageSha256': adapter.sha(image_path.read_bytes()),
        'capture': {'path': str(gif), 'sha256': adapter.sha(gif.read_bytes()), 'durationsMs': durations,
                    'replayTimes': [frame['time'] for frame in frames]},
        'frames': records, 'context': renderer.info, 'projection': projection.flatten().tolist(),
        'comparisonProjectionSource':projection_source,'viewport':[0,0,512,512],
        'counts': {'submittedFrames': len(records), 'visibleFrames': sum(row['visiblePixels'] > 0 for row in records),
                   'submittedInstances': len({(draw['sourceEventId'], draw['generation']) for draw in submitted}),
                   'submittedDefinitions': len({draw['definitionId'] for draw in submitted}),
                   'submittedComponents': len({(draw['sourceEventId'], draw['generation'], draw['emitterId']) for draw in submitted}),
                   'prefixContributingInstances': len({(draw['sourceEventId'], draw['generation']) for draw in contributors}),
                   'prefixContributingDefinitions': len({draw['definitionId'] for draw in contributors}),
                   'prefixContributingComponents': len({(draw['sourceEventId'], draw['generation'], draw['emitterId']) for draw in contributors}),
                   'prefixContributingCreatorChampions': sorted({draw['creatorChampion'] for draw in contributors if draw['creatorChampion'] is not None}),
                   'prefixContributingAssetFamilies': sorted({draw['assetFamily'] for draw in contributors})},
        'ownershipCoverage': summarize_raster_ownership(submitted, 'prefixFramebufferChangedPixels'),
        'scope': {'actualDecodedReplayPackets': True, 'offscreenGpuSubmission': True,
                  'simultaneousComponentsShareFramebuffer': True, 'drawOrderPreserved': True,
                  'fixedDiagnosticProjection': True, 'worldSceneRendered': False,
                  'perSubmissionPrefixFramebufferChangesEstablished': True,
                  'prefixContributionEstablishesFinalUnoccludedPixels': False,
                  'perInstanceVisiblePixelsEstablished': False, 'browserPlaybackObserved': False,
                  'nativeMatchAcceptance': None, 'completeEffectFidelity': False}}
    output = args.report_output.resolve() if args.report_output else cache / 'research/shared-direct-playback-offscreen.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'image': str(image_path), 'capture': str(gif), 'counts': result['counts']}))


if __name__ == '__main__':
    main()
