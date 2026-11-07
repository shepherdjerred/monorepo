"""World helper creation, activation and seekable particle frames in native code."""
import argparse
import ctypes as C
import importlib.util
import inspect
import json
from pathlib import Path
import time
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from native_vfx_fixture import NativeVfxFixture
from world_effect_native import NativeWorldEffects
from vfx_parent_frames_native import f32
from vfx_spawn_native import sha

spec = importlib.util.spec_from_file_location('world_parent_frames', Path(__file__).with_name('observe-parent-frames.py'))
frames = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frames)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        p.add_argument(name, type=Path)
    p.add_argument('--effect')
    args = p.parse_args()
    fixture = NativeVfxFixture(args.cache)
    catalog = fixture.read(fixture.assets/'latest-parent-frame-caches/package.json')
    effects = fixture.read(fixture.assets/'latest-effects/manifest.json')
    selected = [c for c in catalog['caches'] if not args.effect or c['effectId'] == args.effect]
    if not selected:
        raise ValueError('Unknown prepared parent root')
    device = GraphicsTextureDevice(args.angle)
    n = NativeWorldEffects(fixture.assets/'decoder-16.21-macos', args.client, device=device)
    cases, blocks, started = [], {}, time.monotonic()
    try:
        for ref in selected:
            shader = GraphicsShaderCatalog(fixture.assets/'latest-shaders', device)
            n.shader_catalog = shader
            texture_start = len(device.textures)
            case = {'effectId': ref['effectId'], 'status': 'boundary', 'frames': []}
            try:
                warm = fixture.activate(n, ref['effectId'], 12345,
                    {'ticks': [1000000000]*3, 'mode': 0, 'timebase': [1,1]}, 0, False)
                n.own_parent(warm['object'])
                n.render_parent(frames.CAMERA)
                n.suspend_parent(True)
                cache_meta = fixture.read(fixture.assets/'latest-parent-frame-caches'/ref['file'])
                if n.next_heap != cache_meta['nextHeap'] or [list(v) for v in sorted(n.allocations.items())] != cache_meta['allocations']:
                    raise ValueError('Native world warm allocation history differs from the prepared parent cache')
                world = n.initialize_world_factory()
                clock = {'ticks': [2000000000]*3, 'mode': 0, 'timebase': [1,1]}
                n.supply_clock_inputs(clock['ticks'], clock['mode'], clock['timebase'])
                n.set_random_seed(9876)
                actor = '/'.join(ref['effectId'].split('/')[:3])
                key = next(int(k,16) for k,v in effects['actors'][actor]['resources'].items()
                    if v.get('effectId') == ref['effectId'])
                position = [6433, -118.30949401855469, 7017]
                creation = n.create_from_prepared_definition(key, position)
                case.update(world=world, clockInput=clock, seed=9876, creation=creation,
                    initialState=n.parent_state())
                initial = creation['ownership']['initialTime']
                checkpoint = None
                for tick in range(1,13):
                    frame = n.tick_parent(f32(initial+tick/60),20)
                    frame.update(tick=tick, geometry=n.render_parent(frames.CAMERA))
                    frame['stateAndGeometrySha256'] = frames.frame_digest(frame)
                    case['frames'].append(frame)
                    if tick == 6:
                        checkpoint = n.checkpoint_parent()
                case['seekChecks'] = []
                n.restore_parent(checkpoint)
                for tick in range(7,13):
                    frame = n.tick_parent(f32(initial+tick/60),20)
                    frame['geometry'] = n.render_parent(frames.CAMERA)
                    digest = frames.frame_digest(frame)
                    if digest != case['frames'][tick-1]['stateAndGeometrySha256']:
                        raise ValueError('World-created particle seek continuation differs')
                    case['seekChecks'].append({'tick': tick, 'sha256': digest})
                n.release_parent_checkpoint(checkpoint)
                case['status'] = 'world-created-and-framed'
            except Exception as error:
                case.update(error=str(error), instructionRva=n.u.reg_read(__import__('unicorn').x86_const.UC_X86_REG_RIP)-n.base)
            finally:
                blocks.update(n.blocks)
                for path,digest in shader.inputs.items():
                    if sha(fixture.raw(Path(path))) != digest:
                        raise ValueError('World helper shader input changed')
                if n.material_backend is not None:
                    n.material_backend.close()
                n.mesh_backend.close()
                shader.close()
                for handle in device.textures[texture_start:]:
                    device.gl.glDeleteTextures(1,C.byref(handle))
                del device.textures[texture_start:]
            cases.append(case)
            print(json.dumps({'effectId': case['effectId'], 'status': case['status'],
                'frames': len(case['frames']), 'error': case.get('error'),
                'elapsedSeconds': time.monotonic()-started}),flush=True)
        paths = {Path(__file__), Path(frames.__file__), Path(inspect.getfile(NativeVfxFixture)),
            Path(inspect.getfile(GraphicsTextureDevice)), Path(inspect.getfile(GraphicsShaderCatalog))}
        paths.update(Path(inspect.getfile(c)) for c in NativeWorldEffects.__mro__ if c is not object)
        result = {'schema': 1, 'kind': 'native-world-effect-helper-observations',
            'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
            'decoderImageSha256': sha(n.image), 'inputs': fixture.inputs,
            'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
            'originalBlocks': list(blocks.values()), 'camera': frames.CAMERA, 'cases': cases,
            'counts': {'roots': len(cases), 'returningRoots': sum(c['status']=='world-created-and-framed' for c in cases),
                'frames': sum(len(c['frames']) for c in cases),
                'restoredFrames': sum(len(c.get('seekChecks',[])) for c in cases)},
            'scope': {'partialActorSelection': bool(args.effect), 'originalWorldFactoryHelper': True,
                'originalWorldManagerAndWrapperRegistration': True, 'suppliedSingleDefinitionResolver': True,
                'unitContextsSuppliedEmpty': True, 'suppliedClockSeedAndPosition': True,
                'decodedDescriptorFinalization': False, 'entityBoneAttachments': False,
                'replayWorldStateRecovered': False, 'browserExecuted': False, 'referenceCompared': False}}
        output = fixture.cache/'research'/('world-effects-native-partial.json' if args.effect else 'world-effects-native.json')
        output.write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps({'output': str(output), 'counts': result['counts']}))
    finally:
        device.close()


if __name__ == '__main__':
    main()
