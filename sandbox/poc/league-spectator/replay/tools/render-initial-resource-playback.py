"""Raster actual decoded-request worker packets under the declared prefix policy.

The projection is an offscreen diagnostic view. This is not browser playback,
League reference footage, native match acceptance, or complete-effect coverage.
"""
import argparse
import importlib.util
import inspect
import json
from pathlib import Path
import struct
import subprocess
import ctypes as C
import numpy as np
from PIL import Image, ImageDraw
import diagnostic_frame_sampling as sampling
from offscreen_static_mesh import StaticMeshDraw
from offscreen_ray import RayDraw
from offscreen_ray_material import prepare_ray_material
from diagnostic_ray_packet import ray_packet_arrays
from graphics_material_bindings import GraphicsMaterialBindings
from graphics_pipeline_device import GraphicsPipelineDevice
from offscreen_nav_ground import OwnedNavGroundReplay
from diagnostic_creator_coverage import decoded_hero_owners, raster_identity, summarize_raster_ownership

spec = importlib.util.spec_from_file_location('actual_direct_draw', Path(__file__).with_name('render-particle-shader.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('angle', type=Path)
    parser.add_argument('--bun', default='bun')
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}
    assets = cache / 'public'

    def raw(path):
        data = path.read_bytes()
        key, digest = str(path.resolve()), adapter.sha(data)
        if key in inputs and inputs[key] != digest:
            raise ValueError('Isolated raster input changed during capture: ' + key)
        inputs[key] = digest
        return data

    def read(path):
        return json.loads(raw(path))

    for path in [Path(__file__), Path(adapter.__file__), Path(adapter.adapter.__file__), Path(sampling.__file__)]:
        raw(path)
    for name in ['libEGL.dll', 'libGLESv2.dll']:
        raw(args.angle / name)
    proof = read(cache / 'research/initial-resource-playback-worker.json')
    if (proof['kind'] != 'ordinary-decoded-initial-resource-presentation-worker-control' or
            not proof['scope']['actualDecodedReplayRequests'] or proof['scope']['suppliedEffectDefinitions'] or
            not proof['controls']['identical1x4xCheckpoint'] or not proof['snapshots']):
        raise ValueError('Actual decoded replay worker packets with retained-state controls required')
    for path, digest in proof['inputs'].items():
        if adapter.sha(raw(Path(path))) != digest:
            raise ValueError('Worker proof input changed: ' + path)
    heroes = decoded_hero_owners(proof, cache, raw)
    raw(Path(__file__).with_name('diagnostic_creator_coverage.py'))
    bindings = {}
    for directory, filename in [('latest-complete-quad-gpu', 'package.json'),
                                ('latest-trail-particles', 'gpu.json'), ('latest-quad-erosion-gpu', 'package.json'),
                                ('latest-direct-ground-materials', 'package.json')]:
        for binding in read(assets / directory / filename)['emitters']:
            bindings[(binding['effectId'], binding['emitterIndex'])] = binding
    nav_programs = {(p['definitionId'],p['emitterId']) for p in proof.get('navGroundPrograms',[])}
    mesh_programs = {(p['definitionId'], p['emitterId']): p for p in proof.get('staticMeshPrograms', [])}
    ray_programs = {(p['definitionId'], p['emitterId']): p for p in proof.get('rayPrograms', [])}
    if ray_programs:
        for function in [RayDraw, prepare_ray_material, ray_packet_arrays]:
            raw(Path(inspect.getfile(function)))
    mesh_assets = {}
    if mesh_programs:
        for path in [Path(inspect.getfile(StaticMeshDraw)), Path(inspect.getfile(GraphicsMaterialBindings)), Path(inspect.getfile(GraphicsPipelineDevice))]:
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
                    raise ValueError('Exact isolated mesh resource changed')
                return value
            vertices = mesh_resource(emitter['mesh']['vertices'])
            if metadata['meshProgram']['resource']['vertices']['sha256'] != adapter.sha(vertices):
                raise ValueError('Isolated worker mesh source differs')
            mesh_assets[key] = {'emitter': emitter, 'variant': variant, 'vertices': vertices,
                'stages': [json.loads(mesh_resource(variant['shaders'][s])) for s in ['vertex', 'pixel']],
                'textures': [{**t, 'pixels': mesh_resource(t['levels'][0][0])} for t in variant['textures']]}
    def draw_positions(draw):
        if draw.get('primitive') == 'ray':
            return ray_packet_arrays(draw)[0]
        if draw.get('primitive') != 'static-mesh':
            return np.asarray(draw['positions']).reshape(-1, 3)
        asset = mesh_assets[(draw['definitionId'], draw['emitterId'])]
        vertices = np.frombuffer(asset['vertices'], dtype=np.uint8).reshape(-1, 36)
        positions = np.array([struct.unpack_from('<3f', row.tobytes()) for row in vertices])
        homogeneous = np.column_stack([positions, np.ones(len(positions))])
        records = bytes.fromhex(draw['geometry']['meshRecordsHex'])
        if len(records) != draw['particleCount'] * 176 or draw['particleCount'] < 1:
            raise ValueError('Positive retained mesh particle count required')
        return np.concatenate([homogeneous @ np.frombuffer(records, dtype='<f4', count=16, offset=i * 176).reshape(4, 4)
                               for i in range(draw['particleCount'])])[:, :3]
    groups = {}
    for frame in proof['snapshots']:
        for draw in frame['draws']:
            if draw.get('primitive') == 'camera-trail':
                raise ValueError('This renderer increment requires ordinary quad packets')
            groups.setdefault(draw['sourceEventId'], []).append((frame, draw))
    projections = {}
    for source, frames in groups.items():
        points = np.concatenate([draw_positions(draw) for _, draw in frames])
        low, high = points.min(0), points.max(0)
        axes, center = np.argsort(high - low)[-2:], (low + high) / 2
        # Ground static meshes retain original culling. Use the explicitly
        # supplied top-down X/Z orientation, not a tie-dependent axis sort
        # which can reverse its winding even for identical horizontal bounds.
        if any(draw.get('primitive') == 'static-mesh' for _, draw in frames):
            axes = np.array([0, 2])
        extent = max((high - low)[axes]) * .6
        if not np.isfinite(extent) or extent <= 0:
            raise ValueError('Actual draw projection has no finite extent')
        matrix = np.zeros((4, 4))
        matrix[0, axes[0]], matrix[1, axes[1]] = 1 / extent, 1 / extent
        matrix[0, 3], matrix[1, 3] = -center[axes[0]] / extent, -center[axes[1]] / extent
        if any(draw.get('primitive') == 'static-mesh' for _, draw in frames):
            matrix[1, 2], matrix[1, 3] = -1 / extent, center[2] / extent
        matrix[2, 3], matrix[3, 3] = .5, 1
        projections[source] = matrix
    sampling_groups = []
    for source, history in groups.items():
        components = {}
        for frame, draw in history:
            components.setdefault((draw['generation'], draw['emitterId']), []).append((frame, draw))
        selected = []
        for (generation, emitter), samples in components.items():
            scores = []
            for frame, draw in samples:
                positions = draw_positions(draw)
                points = np.column_stack((positions, np.ones(len(positions)))) @ projections[source].T
                mesh = draw.get('primitive') == 'static-mesh'
                ray = draw.get('primitive') == 'ray'
                ray_arrays = ray_packet_arrays(draw) if ray else None
                triangle_indices = ray_arrays[2] if ray else np.asarray(draw.get('indices', []))
                triangles = points.reshape(-1, 3, 4)[:, :, :2] if mesh else points[triangle_indices.reshape(-1, 3), :2]
                left, right = triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]
                area = np.abs(left[:, 0] * right[:, 1] - left[:, 1] * right[:, 0]).sum()
                colors = np.array([struct.unpack_from('<4f', bytes.fromhex(draw['geometry']['meshRecordsHex']), i * 176 + 0x90)
                                   for i in range(draw['particleCount'])]) if mesh else ray_arrays[1] if ray else np.asarray(draw['colors']).reshape(-1, 4)
                intensity = np.max(np.abs(colors[:, :3]) * np.maximum(colors[:, 3:4], 0))
                scores.append(float(area * intensity))
            indices = sampling.select_diagnostic_frames(scores)
            selected.extend(samples[index] for index in indices)
            sampling_groups.append({'sourceEventId': source, 'generation': generation, 'emitterId': emitter,
                'availableFrames': len(samples), 'selectedFrames': len(indices),
                'omittedDiagnosticFrames': len(samples) - len(indices), 'selectedIndices': indices})
        groups[source] = sorted(selected, key=lambda item: (item[0]['time'], item[1]['emitterId']))
    diagnostic_sampling = {'policy': sampling.POLICY, 'maximumFramesPerInstanceComponent': 12,
        'availableFrames': sum(row['availableFrames'] for row in sampling_groups),
        'selectedFrames': sum(row['selectedFrames'] for row in sampling_groups),
        'omittedDiagnosticFrames': sum(row['omittedDiagnosticFrames'] for row in sampling_groups),
        'runtimeEventsOrComponentsDropped': False, 'scoreEstablishesGpuVisibility': False,
        'groups': sampling_groups}
    nav_export = None
    if nav_programs:
        scene_path=cache/'research/isolated-nav-ground-scenes.json'
        scene_path.write_text(json.dumps({'bySource':{source:{'projectionRows':projection.flatten().tolist(),'position':[0,1000,0]}
            for source,projection in projections.items()}}))
        raw(scene_path)
        export_path=cache/'research/initial-nav-ground-frame-bindings.json'
        subprocess.run([args.bun,str(Path(__file__).with_name('export-direct-nav-ground-renderer.mjs')),str(cache),
            str(cache/'research/initial-resource-playback-worker.json'),str(scene_path),str(export_path)],check=True)
        nav_export=read(export_path)
        for path,digest in nav_export['inputs'].items():
            if adapter.sha(raw(Path(path)))!=digest:raise ValueError('Isolated navigation binder changed: '+path)
    mesh_frames = None
    if mesh_programs:
        scene_path = cache / 'research/isolated-static-mesh-scenes.json'
        scene_path.write_text(json.dumps({'bySource': {source: {'projectionRows': projection.flatten().tolist(), 'position': [0, 1000, 0],
            'forward': [0, -1, 0], 'up': [0, 0, -1]} for source, projection in projections.items()}}))
        raw(scene_path)
        subprocess.run([args.bun, str(Path(__file__).with_name('export-shared-static-mesh-frames.mjs')), str(cache), str(scene_path),
                        str(cache / 'research/initial-resource-playback-worker.json'), str(cache / 'research/initial-static-mesh-frame-bindings.json')], check=True)
        mesh_export = read(cache / 'research/initial-static-mesh-frame-bindings.json')
        for path, digest in mesh_export['inputs'].items():
            if adapter.sha(raw(Path(path))) != digest:
                raise ValueError('Isolated JS mesh binder changed')
        mesh_frames = {f['time']: f['draws'] for f in mesh_export['frames']}
        if len(mesh_frames) != len(proof['snapshots']):
            raise ValueError('Ambiguous isolated mesh snapshot clock')
    ray_frames = None
    if ray_programs:
        scene_path = cache / 'research/isolated-ray-scenes.json'
        scene_path.write_text(json.dumps({'bySource': {source: {'projectionRows': projection.flatten().tolist(), 'position': [0, 1000, 0]}
            for source, projection in projections.items()}}))
        raw(scene_path)
        export_path = cache / 'research/initial-ray-frame-bindings.json'
        subprocess.run([args.bun, str(Path(__file__).with_name('export-shared-ray-frames.mjs')), str(cache), str(scene_path),
                        str(cache / 'research/initial-resource-playback-worker.json'), str(export_path)], check=True)
        ray_export = read(export_path)
        for path, digest in ray_export['inputs'].items():
            if adapter.sha(raw(Path(path))) != digest:
                raise ValueError('Isolated JS Ray binder changed')
        ray_frames = {f['time']: f['draws'] for f in ray_export['frames']}
        if len(ray_frames) != len(proof['snapshots']):
            raise ValueError('Ambiguous isolated Ray snapshot clock')
    renderer = adapter.Draw(args.angle)
    renderer.fn(renderer.gl, 'glBindSampler', None, C.c_uint, C.c_uint)
    material_device = GraphicsMaterialBindings(renderer, None) if mesh_programs or ray_programs else None
    pipeline_device = GraphicsPipelineDevice(renderer, raw(assets / 'decoder-16.21-macos/image.bin')) if mesh_programs or ray_programs else None
    mesh_prepared = {}
    ray_prepared = {}
    programs, textures, records, rendered, mesh_rendered = {}, {}, [], {}, {}
    ray_rendered = {}
    nav_replay=OwnedNavGroundReplay(renderer,cache,nav_export,raw) if nav_export else None
    try:
        for source, frames in groups.items():
            for frame, draw in frames:
                if (draw['definitionId'],draw['emitterId']) in nav_programs:
                    rgba, observations=nav_replay.draw(frame['time'],draw)
                    visible=int(np.count_nonzero(np.any(np.abs(rgba[:,:,:3].astype(int)-[6,9,14])>2,axis=2)))
                    rgb=rgba[:,:,:3].astype(float)/255
                    display=np.clip(np.where(rgb<=.0031308,rgb*12.92,1.055*rgb**(1/2.4)-.055),0,1)
                    panel=Image.fromarray(np.uint8(display*255)).resize((256,256))
                    rendered.setdefault(source,[]).append((panel,frame['time'],visible))
                    records.append({**raster_identity(draw,heroes),'primitive':'navigation-ground-quad','time':frame['time'],
                        'visiblePixels':visible,'rgbaSha256':adapter.sha(rgba.tobytes()),'uniformBuffers':observations['uniformBlocks'],
                        'verticesSha256':adapter.sha(bytes.fromhex(draw['geometry']['verticesHex'])),
                        'indicesSha256':adapter.sha(bytes.fromhex(draw['geometry']['indicesHex'])),
                        'partialTexturePolicies':['owned-selected-scene-navigation','allvision-remap-omitted']})
                    continue
                if draw.get('primitive') == 'ray':
                    key = draw['materialKey']
                    owner = draw['definitionId'], draw['emitterId']
                    if owner not in ray_programs:
                        raise ValueError('Unowned isolated Ray definition/component')
                    if key not in ray_prepared:
                        ray_prepared[key] = prepare_ray_material(renderer, material_device, pipeline_device,
                            ray_export['materials'][key], ray_export['rasterStates'][key])
                    program, stages, native_pipeline, tex = ray_prepared[key]
                    matches = [d for d in ray_frames[frame['time']] if d['sourceEventId'] == source and d['generation'] == draw['generation'] and d['emitterId'] == draw['emitterId']]
                    if len(matches) != 1 or matches[0]['particleCount'] != draw['particleCount']:
                        raise ValueError('Isolated Ray ownership differs')
                    blocks = [{**b, 'bytes': bytes.fromhex(b['bytesHex'])} for b in matches[0]['uniformBlocks']]
                    vertices, indices = [bytes.fromhex(draw['geometry'][name]) for name in ['verticesHex', 'indicesHex']]
                    def apply_ray_pipeline():
                        pipeline_device.apply(native_pipeline, stencil_reference=0, blend_color=[0,0,0,0])
                        return pipeline_device.inspect(native_pipeline, stencil_reference=0, blend_color=[0,0,0,0])
                    rgba, observed = RayDraw.draw_ray(renderer, program, stages, vertices, indices, blocks, tex, apply_ray_pipeline)
                    for texture in tex.values():
                        renderer.gl.glBindSampler(texture['unit'], 0)
                    visible = int(np.count_nonzero(np.any(np.abs(rgba[:, :, :3].astype(int) - [6, 9, 14]) > 2, axis=2)))
                    rgb = rgba[:, :, :3].astype(float) / 255
                    display = np.clip(np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - .055), 0, 1)
                    panel = Image.fromarray(np.uint8(display * 255)).resize((256, 256))
                    rendered.setdefault(source, []).append((panel, frame['time'], visible))
                    ray_rendered.setdefault(owner, []).append((source, panel, frame['time'], visible))
                    records.append({**raster_identity(draw, heroes), 'sourceEventId': source, 'definitionId': draw['definitionId'], 'emitterId': draw['emitterId'], 'primitive': 'ray',
                        'time': frame['time'], 'visiblePixels': visible, 'verticesSha256': adapter.sha(vertices), 'indicesSha256': adapter.sha(indices),
                        'rgbaSha256': adapter.sha(rgba.tobytes()), 'uniformBuffers': observed['uniformBlocks'],
                        'glesRaster': ray_export['rasterStates'][key], 'partialTexturePolicies': ['native-ray-allvision-remap-omitted-v1']})
                    continue
                if draw.get('primitive') == 'static-mesh':
                    owner = draw['definitionId'], draw['emitterId']
                    asset = mesh_assets[owner]
                    if owner not in mesh_prepared:
                        stages = asset['stages']
                        program = renderer.program(*stages)
                        native_pipeline = pipeline_device.create(bytes.fromhex(asset['variant']['pipeline']['descriptorHex']), {'linked': True, 'glHandle': program})
                        if native_pipeline['state'] != asset['variant']['pipeline']['state']:
                            raise ValueError('Isolated native mesh pipeline differs')
                        raster = mesh_export['rasterStates'][draw['materialKey']]
                        if raster['sourceState'] != native_pipeline['state'] or not raster['windingReversed'] or raster['cullModeChanged']:
                            raise ValueError('Exact isolated native-to-GLES raster conversion required')
                        native_pipeline = {**native_pipeline, 'nativeRasterState': native_pipeline['state'], 'state': raster['state']}
                        tex = {}
                        for t in asset['textures']:
                            if len(t['levels']) != 1 or len(t['levels'][0]) != 1:
                                raise ValueError('Isolated native mesh requires original single mip')
                            handle = renderer.texture(np.frombuffer(t['pixels'], dtype=np.uint8).reshape(t['height'], t['width'], 4), 'clamp', 'nearest')
                            sampler = material_device.sampler(bytes.fromhex(t['sampler']['descriptorHex']))
                            tex[t['name']] = {'handle': handle, 'sampler': sampler['glHandle'], 'unit': t['unit']}
                        for name, rgba_value, unit in [('FOW_MAP_SharedTexture', [255] * 4, 1), ('PIXEL_COLOR_REMAP_RAMP_SharedTexture', [0] * 4, 2)]:
                            tex[name] = {'handle': renderer.texture(np.array([[rgba_value]], dtype=np.uint8), 'clamp', 'nearest'), 'sampler': 0, 'unit': unit}
                        mesh_prepared[owner] = program, stages, native_pipeline, tex, StaticMeshDraw.uint_texture(renderer, bytes(208))
                    program, stages, native_pipeline, tex, inactive = mesh_prepared[owner]
                    matches = [d for d in mesh_frames[frame['time']] if d['sourceEventId'] == source and d['generation'] == draw['generation'] and d['emitterId'] == draw['emitterId']]
                    if len(matches) != 1 or len(matches[0]['particles']) != draw['particleCount']:
                        raise ValueError('Isolated static mesh ownership differs')
                    mesh_indices = np.arange(len(asset['vertices']) // 36, dtype='<u2').tobytes()
                    buffers = []
                    def apply_pipeline():
                        pipeline_device.apply(native_pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])
                        return pipeline_device.inspect(native_pipeline, stencil_reference=0, blend_color=[0, 0, 0, 0])
                    for i, particle in enumerate(matches[0]['particles']):
                        blocks = [{**b, 'bytes': bytes.fromhex(b['bytesHex'])} for b in particle['uniformBlocks']]
                        rgba, observed = StaticMeshDraw.draw_mesh(renderer, program, stages, asset['vertices'], mesh_indices, blocks, tex,
                            {'ParticleMeshInstanceInfo_SharedDataBuffer': {'handle': inactive, 'sampler': 0, 'unit': 0}}, apply_pipeline, clear=i == 0, readback=True)
                        buffers.append(observed['uniformBlocks'])
                    for unit in {0, *(t['unit'] for t in tex.values())}:
                        renderer.gl.glBindSampler(unit, 0)
                    visible = int(np.count_nonzero(np.any(np.abs(rgba[:, :, :3].astype(int) - [6, 9, 14]) > 2, axis=2)))
                    rgb = rgba[:, :, :3].astype(float) / 255
                    display = np.clip(np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - .055), 0, 1)
                    panel = Image.fromarray(np.uint8(display * 255)).resize((256, 256))
                    rendered.setdefault(source, []).append((panel, frame['time'], visible))
                    mesh_rendered.setdefault(source, []).append((panel, frame['time'], visible))
                    records.append({**raster_identity(draw, heroes), 'sourceEventId': source, 'definitionId': draw['definitionId'], 'emitterId': draw['emitterId'], 'primitive': 'static-mesh',
                        'time': frame['time'], 'visiblePixels': visible, 'verticesSha256': adapter.sha(asset['vertices']), 'indicesSha256': adapter.sha(mesh_indices),
                        'rgbaSha256': adapter.sha(rgba.tobytes()), 'uniformBuffers': buffers, 'partialTexturePolicies': ['native-static-mesh-allvision-remap-omitted-v1']})
                    records[-1]['glesRaster'] = mesh_export['rasterStates'][draw['materialKey']]
                    continue
                binding = bindings[(draw['definitionId'], draw['emitterId'])]
                key = tuple(binding['shaders'][stage]['sha256'] for stage in ['vertex', 'pixel'])
                if key not in programs:
                    stages = []
                    for stage in ['vertex', 'pixel']:
                        ref = binding['shaders'][stage]
                        data = raw(assets / 'latest-shaders' / ref['file'])
                        if adapter.sha(data) != ref['sha256']:
                            raise ValueError('Actual packet shader hash differs')
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
                                value = projections[source].flatten().tolist()
                            elif member['name'] == 'vCamera':
                                value = [0, 1000, 0]
                            else:
                                code = {'float': 'f', 'uint': 'I', 'int': 'i', 'bool': 'I'}[member['scalar']]
                                value = list(struct.unpack_from('<' + code * (member['size'] // 4), data, member['offset']))
                            values[block['glslName'] + '.' + member['name']] = value
                    for texture in shader['sidecar']['textures']:
                        choices = [binding['textures'][item['glslName']] for item in texture['samplers']]
                        if not choices or any(item != choices[0] for item in choices):
                            raise ValueError('Conflicting actual packet texture inputs')
                        resource = choices[0]
                        token = json.dumps(resource, sort_keys=True)
                        if token not in textures:
                            if resource['kind'] == 'prepared-texture':
                                path = assets / 'latest-effects' / resource['file']
                                if adapter.sha(raw(path)) != resource['sha256']:
                                    raise ValueError('Actual packet texture hash differs')
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
                                raise ValueError('Unimplemented actual packet diagnostic texture kind')
                            textures[token] = renderer.texture(pixels, address, filtering)
                        bound[texture['name']] = textures[token]
                factors = binding['nativeBlendFactors']
                if factors[0] != factors[1] or factors[2] != factors[3]:
                    raise ValueError('Separate alpha blending requires its own adapter')
                blend = {1: 1, 6: 0x302, 7: 0x303}
                vertices = bytes.fromhex(draw['geometry']['verticesHex'])
                indices = bytes.fromhex(draw['geometry']['indicesHex'])
                rgba, buffers = renderer.draw(program, stages, vertices, indices, values, bound,
                    blend=(blend[factors[0]], blend[factors[2]]))
                visible = int(np.count_nonzero(np.any(np.abs(rgba[:, :, :3].astype(int) - [6, 9, 14]) > 2, axis=2)))
                rgb = rgba[:, :, :3].astype(float) / 255
                display = np.clip(np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - .055), 0, 1)
                panel = Image.fromarray(np.uint8(display * 255)).resize((256, 256))
                rendered.setdefault(source, []).append((panel, frame['time'], visible))
                records.append({**raster_identity(draw, heroes), 'sourceEventId': source, 'definitionId': draw['definitionId'], 'emitterId': draw['emitterId'],
                    'time': frame['time'], 'visiblePixels': visible, 'verticesSha256': adapter.sha(vertices),
                    'indicesSha256': adapter.sha(indices), 'rgbaSha256': adapter.sha(rgba.tobytes()), 'uniformBuffers': buffers,
                    'partialTexturePolicies': sorted({value['kind'] for value in binding['textures'].values() if value['kind'].startswith('supplied-')})})
    finally:
        if nav_replay:nav_replay.close()
        for program, _ in programs.values():
            renderer.gl.glDeleteProgram(program)
        for program, *_ in mesh_prepared.values():
            renderer.gl.glDeleteProgram(program)
        for program, *_ in ray_prepared.values():
            renderer.gl.glDeleteProgram(program)
        if material_device:
            material_device.close()
        renderer.close()
    folder = cache / 'visuals'
    folder.mkdir(exist_ok=True)
    columns = min(4, len(rendered))
    sheet = Image.new('RGB', (286 * columns, 60 + 300 * ((len(rendered) + columns - 1) // columns)), '#101822')
    label = ImageDraw.Draw(sheet)
    label.text((15, 10), 'Actual decoded request packets / initial resource presentation policy', fill='#e9eef7')
    label.text((15, 30), 'Fixed offscreen views; provisional seeds. Browser/native match acceptance remain unverified.', fill='#a8bdd0')
    captures = []
    for index, (source, panels) in enumerate(rendered.items()):
        best = max(panels, key=lambda item: item[2])
        x, y = index % columns * 286 + 15, 60 + index // columns * 300
        sheet.paste(best[0], (x, y))
        label.text((x, y + 262), f'{source.split(":")[1]} @ {best[1]:.3f}s', fill='#e9eef7')
        component = next(row for row in records if row['sourceEventId'] == source)
        label.text((x, y + 280), f"{best[2]} changed pixels / {component['definitionId'].split('/')[1]}", fill='#a8bdd0')
        images = []
        for panel, time, _ in panels:
            image = Image.new('RGB', (450, 310), '#101822')
            image.paste(panel, (97, 40))
            caption = ImageDraw.Draw(image)
            caption.text((10, 8), f'Actual request {source} / {time:.3f}s', fill='#e9eef7')
            caption.text((10, 25), 'Offscreen diagnostic projection; declared partial policy', fill='#a8bdd0')
            images.append(image)
        gif = folder / f'initial-resource-request-{index}.gif'
        images[0].save(gif, save_all=True, append_images=images[1:], duration=33, loop=0)
        captures.append({'path': str(gif), 'sha256': adapter.sha(gif.read_bytes()), 'sourceEventId': source,
                         'frames': len(images), 'replayTimes': [item[1] for item in panels]})
    path = folder / 'initial-resource-playback.png'
    sheet.save(path)
    mesh_visual = None
    if mesh_rendered:
        mesh_sheet = Image.new('RGB', (300 * len(mesh_rendered), 340), '#101822')
        labels = ImageDraw.Draw(mesh_sheet)
        for index, (source, samples) in enumerate(mesh_rendered.items()):
            panel, time, visible = max(samples, key=lambda item: item[2])
            mesh_sheet.paste(panel, (index * 300 + 22, 40))
            labels.text((index * 300 + 8, 8), 'Actual static mesh / diagnostic top-down', fill='#e9eef7')
            labels.text((index * 300 + 8, 304), f'{source.split(":")[1]} @ {time:.3f}s / {visible} pixels', fill='#a8bdd0')
        mesh_path = folder / 'initial-resource-static-mesh.png'
        mesh_sheet.save(mesh_path)
        mesh_visual = {'image': str(mesh_path), 'sha256': adapter.sha(mesh_path.read_bytes()),
                       'sources': list(mesh_rendered), 'scope': 'actual retained records; one isolated component; supplied top-down projection'}
    ray_visual = None
    if ray_rendered:
        ray_sheet = Image.new('RGB', (300 * len(ray_rendered), 350), '#101822')
        labels, components = ImageDraw.Draw(ray_sheet), []
        for index, ((definition, emitter), samples) in enumerate(sorted(ray_rendered.items())):
            source, panel, time, visible = max(samples, key=lambda row: row[3])
            ray_sheet.paste(panel, (index * 300 + 22, 40))
            labels.text((index * 300 + 8, 8), f'Actual Ray / emitter {emitter}', fill='#e9eef7')
            labels.text((index * 300 + 8, 304), f'{source.split(":")[1]} @ {time:.3f}s / {visible} pixels', fill='#a8bdd0')
            labels.text((index * 300 + 8, 325), 'One component; supplied projection', fill='#a8bdd0')
            components.append({'definitionId': definition, 'emitterId': emitter, 'sourceEventId': source,
                               'time': time, 'visiblePixels': visible})
        ray_path = folder / 'initial-resource-rays.png'
        ray_sheet.save(ray_path)
        ray_visual = {'image': str(ray_path), 'sha256': adapter.sha(ray_path.read_bytes()),
                      'sourceEventIds': sorted({sample[0] for samples in ray_rendered.values() for sample in samples}),
                      'components': components,
                      'scope': 'actual retained packets; one isolated Ray component; supplied projection'}
    for filename, digest in inputs.items():
        if adapter.sha(Path(filename).read_bytes()) != digest:
            raise ValueError('Actual offscreen input changed: ' + filename)
    result = {'schema': 1, 'kind': 'actual-decoded-request-offscreen-partial-effects', 'inputs': inputs,
        'image': str(path), 'imageSha256': adapter.sha(path.read_bytes()), 'captures': captures,
        'samples': records, 'context': renderer.info, 'diagnosticSampling': diagnostic_sampling,
        'staticMeshVisual': mesh_visual,
        'rayVisual': ray_visual,
        'counts': {'submittedFrames': len(records), 'visibleFrames': sum(row['visiblePixels'] > 0 for row in records),
                   'visibleInstances': len({(row['sourceEventId'],row['generation']) for row in records if row['visiblePixels'] > 0}),
                   'visibleCreatorChampions': sorted({row['creatorChampion'] for row in records if row['visiblePixels'] > 0 and row['creatorChampion'] is not None}),
                   'visibleDefinitions': len({row['definitionId'] for row in records if row['visiblePixels'] > 0})},
        'ownershipCoverage': summarize_raster_ownership(records, 'visiblePixels'),
        'scope': {'actualDecodedReplayRequests': True, 'offscreenGpuSubmission': True, 'suppliedProjection': True,
                  'nativeMatchAcceptance': None, 'nativeCacheReadiness': None, 'browserPlaybackObserved': False,
                  'completeEffectFidelity': False, 'provisionalSeedConvention': True,
                  'eachSampleIsOneIsolatedComponentSubmission': True,
                  'multipleComponentsCompositedTogether': False,
                  'animatedCaptureReproducesReplayClock': False}}
    output = cache / 'research/initial-resource-playback-offscreen.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'image': str(path), 'counts': result['counts']}))


if __name__ == '__main__':
    main()
