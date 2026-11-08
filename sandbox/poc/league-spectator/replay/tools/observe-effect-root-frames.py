"""Observe complete frames for every requested root with prepared GPU bindings.

The cohort follows capabilities, without a per-champion cap. Inputs are supplied
component clocks/seeds/cameras; these are not reconstructed replay lifecycles.
"""
import argparse
import ctypes as C
import importlib.util
import inspect
import json
from pathlib import Path
import time
from unicorn import x86_const as r
from native_vfx_fixture import NativeVfxFixture
from parent_placement_native import NativeParentPlacement
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_parent_frames_native import f32
from vfx_spawn_native import sha

spec = importlib.util.spec_from_file_location('parent_frames_observer', Path(__file__).with_name('observe-parent-frames.py'))
frames = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frames)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        p.add_argument(name, type=Path)
    p.add_argument('--steps', type=int, default=30)
    args = p.parse_args()
    if not 13 <= args.steps <= 120:
        raise ValueError('Root frames require 13..120 updates')
    fixture = NativeVfxFixture(args.cache)
    activation_path = fixture.cache / 'research/effect-root-activation.json'
    discovery = fixture.read(activation_path)
    if discovery['scope']['partialSelection'] or discovery['build'] != '16.21.829.8620':
        raise ValueError('Full matching activation sweep required')
    for name, digest in discovery['sources'].items():
        if sha(fixture.raw(Path(__file__).with_name(name))) != digest:
            raise ValueError('Activation source changed: ' + name)
    for path, digest in discovery['inputs'].items():
        if sha(fixture.raw(Path(path))) != digest:
            raise ValueError('Activation input changed: ' + path)
    gpu = [fixture.read(fixture.assets / name) for name in [
        'latest-complete-quad-gpu/package.json', 'latest-trail-particles/gpu.json',
        'latest-quad-erosion-gpu/package.json']]
    bindings = {(e['effectId'], e['emitterIndex']): e for pack in gpu for e in pack['emitters']}
    if len(bindings) != sum(len(pack['emitters']) for pack in gpu):
        raise ValueError('Ambiguous effect-root GPU bindings')
    selected = [c for c in discovery['cases'] if c['status'] == 'native-parent-activated'
                and not c['unsupportedGeometry']
                and all((c['effectId'], a['emitterIndex']) in bindings for a in c['ownership']['actors'])]
    directory = fixture.assets / 'latest-effect-root-frame-caches'
    directory.mkdir(exist_ok=True)
    device = GraphicsTextureDevice(args.angle)
    n = NativeParentPlacement(fixture.assets/'decoder-16.21-macos', args.client, device=device)
    cases, caches, blocks = [], [], {}
    began = time.monotonic()
    try:
        for item in selected:
            shader = GraphicsShaderCatalog(fixture.assets/'latest-shaders', device)
            n.shader_catalog = shader
            texture_start = len(device.textures)
            case = {'effectId': item['effectId'], 'name': item['name'], 'status': 'boundary', 'frames': []}
            try:
                warm = fixture.activate(n, item['effectId'], 12345,
                    {'ticks': [1000000000]*3, 'mode': 0, 'timebase': [1, 1]}, 0, False)
                n.own_parent(warm['object'])
                n.render_parent(frames.CAMERA)
                n.suspend_parent(True)
                cache_ref = frames.export_cache(n, warm, frames.CAMERA, directory)
                clock = {'ticks': [2000000000]*3, 'mode': 0, 'timebase': [1, 1]}
                n.supply_clock_inputs(clock['ticks'], clock['mode'], clock['timebase'])
                seed = n.set_random_seed(9876)
                obj = n.create_object()
                n.set_scalars(obj, 0x3f800000, 0x3f800000)
                n.mark_ready(obj)
                n.call(0x1765960, {r.UC_X86_REG_RDI: obj})
                owned = n.own_parent(obj)
                case.update(ownership=owned, randomSeed=seed, clockInput=clock,
                            cache=cache_ref, initialState=n.parent_state())
                for tick in range(1, args.steps+1):
                    frame = n.tick_parent(f32(owned['initialTime']+tick/60), 20)
                    frame.update(tick=tick, geometry=n.render_parent(frames.CAMERA))
                    frame['stateAndGeometrySha256'] = frames.frame_digest(frame)
                    case['frames'].append(frame)
                    if tick == 12:
                        checkpoint = n.checkpoint_parent()
                final = n.parent_memory_digest()
                n.restore_parent(checkpoint)
                case['seekChecks'] = []
                for tick in range(13, args.steps+1):
                    frame = n.tick_parent(f32(owned['initialTime']+tick/60), 20)
                    frame['geometry'] = n.render_parent(frames.CAMERA)
                    actual = frames.frame_digest(frame)
                    if actual != case['frames'][tick-1]['stateAndGeometrySha256']:
                        raise ValueError('Requested-root checkpoint continuation differs')
                    case['seekChecks'].append({'tick': tick, 'sha256': actual})
                if final != n.parent_memory_digest():
                    raise ValueError('Requested-root restored CPU world differs')
                n.release_parent_checkpoint(checkpoint)
                case['finalCpuWorldSha256'] = final
                case['status'] = 'frames-returned'
                caches.append(cache_ref)
            except Exception as error:
                case.update(error=str(error), instructionRva=n.u.reg_read(r.UC_X86_REG_RIP)-n.base)
            finally:
                blocks.update(n.blocks)
                for path, digest in shader.inputs.items():
                    if sha(fixture.raw(Path(path))) != digest:
                        raise ValueError('Root shader changed')
                if n.material_backend is not None:
                    n.material_backend.close()
                n.mesh_backend.close()
                shader.close()
                for handle in device.textures[texture_start:]:
                    device.gl.glDeleteTextures(1, C.byref(handle))
                del device.textures[texture_start:]
            cases.append(case)
            print(json.dumps({'index': len(cases), 'total': len(selected), 'effectId': item['effectId'],
                'status': case['status'], 'error': case.get('error'), 'elapsedSeconds': time.monotonic()-began}), flush=True)
        paths = {Path(__file__), Path(frames.__file__), Path(__file__).with_name('native_vfx_fixture.py'),
                 Path(inspect.getfile(GraphicsTextureDevice)), Path(inspect.getfile(GraphicsShaderCatalog))}
        paths.update(Path(inspect.getfile(c)) for c in NativeParentPlacement.__mro__ if c is not object)
        result = {'schema': 1, 'kind': 'requested-root-native-frame-observations',
            'build': discovery['build'], 'protocol': discovery['protocol'],
            'decoderImageSha256': sha(n.image), 'activationSha256': sha(activation_path.read_bytes()),
            'inputs': fixture.inputs, 'sources': {v.name: sha(v.read_bytes()) for v in paths},
            'originalBlocks': list(blocks.values()), 'camera': frames.CAMERA, 'cases': cases,
            'counts': {'roots': len(cases), 'returningRoots': len(caches),
                'frames': sum(len(c['frames']) for c in cases),
                'restoreFrames': sum(len(c.get('seekChecks', [])) for c in cases)},
            'scope': {'allCurrentlyBindableRequestedRoots': True, 'componentInputsSupplied': True,
                'originalActivationAndTick': True, 'matchLifecycleMapping': False,
                'browserRun': False, 'referenceCompared': False}}
        encoded = json.dumps(result, indent=2).encode()
        output = fixture.cache/'research/effect-root-frames-native.json'
        output.write_bytes(encoded)
        package = {'schema': 1, 'kind': 'prepared-requested-root-parent-caches',
            'build': result['build'], 'protocol': result['protocol'],
            'decoderImageSha256': result['decoderImageSha256'], 'observationSha256': sha(encoded),
            'caches': caches, 'sources': result['sources'],
            'scope': {'staticBuildPreparation': True, 'containsReplayEvents': False,
                'portableBrowserGraphicsHandles': False, 'browserRun': False}}
        data = json.dumps(package, indent=2).encode()
        (directory/'package.json').write_bytes(data)
        print(json.dumps({'output': str(output), 'packageSha256': sha(data), 'counts': result['counts']}))
    finally:
        device.close()


if __name__ == '__main__':
    main()
