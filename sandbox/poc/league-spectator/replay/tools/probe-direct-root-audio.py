"""Compare original parent visuals with typed root sound declarations.

This owns the original CPU audio facade/emitter service, not an audio device.
The full parent scheduler, particle kernels and original geometry writers run.
"""
import argparse
from collections import Counter
import ctypes as C
import inspect
import json
from pathlib import Path
import struct

import unicorn
from unicorn import x86_const as r

from ai_client_native import NativeAIClientInputs
from audio_emitter_service_native import initialize_audio_emitter_service, inspect_audio_emitter_registry
from graphics_shader_catalog import GraphicsShaderCatalog
from graphics_texture_device import GraphicsTextureDevice
from native_vfx_fixture import NativeVfxFixture
from parent_placement_native import NativeParentPlacement
from vfx_asset_native import WRAPPER, STREAM, VTABLE, CALLBACK, CONTEXT, CACHE
from vfx_spawn_native import ADDRESSES as A, name_hash, sha


FIELDS = {'soundOnCreateDefault': 0x78, 'soundPersistentDefault': 0x98}


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


class RootAudioControl(NativeParentPlacement):
    initialize_audio_facade = NativeAIClientInputs.initialize_audio_facade

    def __init__(self, *args, **kwargs):
        self.supplied_sounds = None
        self.sound_reads = Counter()
        self.audio_calls = []
        super().__init__(*args, **kwargs)
        self.u.hook_add(unicorn.UC_HOOK_MEM_READ, self.read_sound,
                        begin=A['definition'] + 0x78, end=A['definition'] + 0xb7)
        for at in [0x248410, 0x248430, 0x173a820, 0x173ab20, 0x173ae40, 0x173b590]:
            self.u.hook_add(unicorn.UC_HOOK_CODE, self.observe_audio,
                            begin=self.base + at, end=self.base + at)

    def read_sound(self, uc, access, address, size, value, user):
        self.sound_reads[(uc.reg_read(r.UC_X86_REG_RIP) - self.base,
                          address - A['definition'], size)] += 1

    def observe_audio(self, uc, address, size, user):
        ip = address - self.base
        extra = ({'soundName': self.cstring(self.q(uc.reg_read(r.UC_X86_REG_RDX))).decode('ascii')}
                 if ip in [0x173a820, 0x173ab20, 0x173ae40] else {})
        self.audio_calls.append({'rva': ip,
                                 'callerRva': self.q(uc.reg_read(r.UC_X86_REG_RSP)) - self.base,
                                 'facade': uc.reg_read(r.UC_X86_REG_RDI),
                                 'argument': uc.reg_read(r.UC_X86_REG_RSI), **extra})

    def load_prepared_system(self, graph):
        super().load_prepared_system(graph)
        if self.supplied_sounds is None:
            raise ValueError('Explicit typed root sound control required')
        self.u.mem_write(WRAPPER, bytes(0x500))
        self.put(WRAPPER, 'Q', STREAM)
        self.put(STREAM, 'Q', VTABLE)
        for i, offset in enumerate([0x10, 0x28, 0x30]):
            self.put(VTABLE + offset, 'Q', CALLBACK + i * 16)
        self.ignored, self.mismatched, self.stream_calls = [], [], []
        string_start = self.next_heap
        self.loading = True
        try:
            for name, value in self.supplied_sounds.items():
                if name not in FIELDS or not isinstance(value, str) or '\0' in value:
                    raise ValueError('Unsupported typed root audio field')
                data = value.encode('ascii')
                if len(data) > 4095:
                    raise ValueError('Control sound name exceeds owned string bound')
                field = struct.pack('<IBH', name_hash(name), 16, len(data)) + data
                self.input, self.cursor = field, 0
                self.put(CACHE, 'Q', 0)
                self.call(0x14bc830, {r.UC_X86_REG_RDI: CONTEXT,
                          r.UC_X86_REG_RSI: A['definition'], r.UC_X86_REG_RDX: self.system_type,
                          r.UC_X86_REG_RCX: WRAPPER, r.UC_X86_REG_R8: CACHE})
                if self.cursor != len(field) or self.ignored or self.mismatched:
                    raise ValueError('Original typed sound field was not consumed exactly')
        finally:
            self.loading = False
        # Keep all later native allocations at identical addresses while the
        # typed string reader consumes different amounts of this owned arena.
        # No pointer or particle byte is removed from the visual comparison.
        arena_end = (string_start + 0x2000 + 15) & ~15
        if self.next_heap >= arena_end:
            raise ValueError('Typed audio strings exceeded the control arena')
        self.string_arena = {'start': string_start, 'typedEnd': self.next_heap, 'end': arena_end}
        self.allocate(arena_end - self.next_heap)
        self.sound_reads.clear()
        self.audio_calls.clear()
        self.facade_record = self.initialize_audio_facade()
        self.service_record = initialize_audio_emitter_service(self)


def visual_state(n, frame, camera):
    state = frame['state']
    actor_indices = {a['pointer']: a['emitterIndex'] for a in state['actors']}
    return {
        'time': frame['time'],
        'substeps': [{'emitterIndex': actor_indices[s['actor']], 'time': s['time']}
                     for s in frame['substeps']],
        'rngHex': state['rngHex'],
        'parentClocksHex': bytes(n.u.mem_read(n.frame_parent + 0x130, 0x20)).hex(),
        'actors': [{'emitterIndex': a['emitterIndex'],
                    'vectors': {name: {'count': v['count'], 'capacity': v['capacity'],
                                       'bytesHex': v['bytesHex']}
                                for name, v in a['vectors'].items()}}
                   for a in state['actors']],
        'draws': [{k: d[k] for k in ['emitterIndex', 'kind', 'particleCount', 'verticesHex', 'indicesHex']}
                  for d in n.render_parent(camera)]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--frames', type=int, default=61)
    args = parser.parse_args()
    if not 1 <= args.frames <= 121:
        raise ValueError('Explicit bounded frame count required')
    fixture = NativeVfxFixture(args.cache.resolve())
    baseline = fixture.read(fixture.cache / 'research/direct-root-identity-activation-native.json')
    manifest = fixture.read(fixture.assets / 'latest-effects/manifest.json')
    inventory = []
    for effect_id, ref in manifest['definitions'].items():
        authored = fixture.read(fixture.assets / 'latest-effects' / ref['file'])['definition']
        sounds = {name: authored[name] for name in FIELDS if name in authored}
        if sounds:
            if any(not isinstance(v, str) for v in sounds.values()):
                raise ValueError('Authored root audio field is not a string')
            inventory.append({'effectId': effect_id, 'sounds': sounds})
    create = next(c['sounds']['soundOnCreateDefault'] for c in inventory
                  if c['effectId'].endswith('/83cc5e24'))
    persistent = next(c['sounds']['soundPersistentDefault'] for c in inventory
                      if c['sounds'].get('soundPersistentDefault'))
    variants = [{}, {'soundOnCreateDefault': ''}, {'soundPersistentDefault': ''},
                {'soundOnCreateDefault': create}, {'soundPersistentDefault': persistent},
                {'soundOnCreateDefault': create, 'soundPersistentDefault': persistent}]
    device = GraphicsTextureDevice(args.angle)
    n = RootAudioControl(fixture.assets / 'decoder-16.21-macos', args.client, device=device)
    cases, blocks, boundary, reference = [], {}, None, None
    phase = 'typed-layout'
    try:
        properties = n.type_catalog['45cd899f']['properties']
        typed_fields = {}
        for name, offset in FIELDS.items():
            field = next(p for p in properties if p['hash'] == name_hash(name))
            if field['offset'] != offset or field['type'] != 16:
                raise ValueError('Original sound String field layout differs')
            typed_fields[name] = field
        for supplied in variants:
            n.supplied_sounds = supplied
            shaders = GraphicsShaderCatalog(fixture.assets / 'latest-shaders', device)
            n.shader_catalog = shaders
            texture_start = len(device.textures)
            try:
                phase = 'activation'
                active = fixture.activate(n, baseline['effectId'], baseline['seed'], baseline['clock'], 0, False)
                ownership = n.own_parent(active['object'])
                actual_root = n.q(n.q(active['parent'] + 0x1d8) + 0x38)
                if actual_root != A['definition']:
                    raise ValueError('Activated parent does not retain supplied original root')
                frames = []
                timeline_start = n.next_heap
                frame_arenas = []
                phase = 'original-parent-timeline'
                for tick in range(args.frames):
                    if tick in [30, 45]:
                        n.suspend_parent(tick == 30)
                    n.apply_placement(active['object'], {'position': [100 + tick * 2, 40, 200 + tick]})
                    n.synchronize_placement(active['object'])
                    n.call(0x17625f0, {r.UC_X86_REG_RDI: active['parent']})
                    # Native sound enqueue can allocate before particle birth.
                    # Reserve the unused remainder of the same bounded arena
                    # in every control so even pointer-bearing particle data
                    # remains directly byte comparable, without masking data.
                    arena_end = timeline_start + (tick + 1) * 0x20000
                    if n.next_heap >= arena_end:
                        raise ValueError('Audio/particle frame exceeded the paired control arena')
                    frame_arenas.append({'beforePadding': n.next_heap, 'end': arena_end})
                    n.allocate(arena_end - n.next_heap)
                    frame = n.tick_parent(ownership['initialTime'] + tick / 60, 20)
                    n.call(0x1762790, {r.UC_X86_REG_RDI: active['parent']})
                    frame['state'] = n.parent_state()
                    frames.append(visual_state(n, frame, baseline['camera']))
                differences = [] if reference is None else [
                    {'tick': i, 'fields': [k for k in actual if actual[k] != expected[k]]}
                    for i, (expected, actual) in enumerate(zip(reference, frames)) if actual != expected]
                if reference is None:
                    reference = frames
                expected_audio = ([(0x173a820, supplied['soundOnCreateDefault'])]
                                  if supplied.get('soundOnCreateDefault') else [])
                if supplied.get('soundPersistentDefault'):
                    expected_audio.append((0x173ab20, supplied['soundPersistentDefault']))
                observed_audio = [(a['rva'], a.get('soundName')) for a in n.audio_calls]
                if sorted(observed_audio) != sorted(expected_audio):
                    raise ValueError('Original authored sound enqueue calls differ from typed declarations')
                registry = inspect_audio_emitter_registry(n, n.service_record['service'])
                if registry['count'] or bytes(n.u.mem_read(n.service_record['service'] + 0x200, 0x100)) != b'\xa5' * 0x100:
                    raise ValueError('Unconsumed original sound queue changed CPU service or guard')
                cases.append({'supplied': supplied, 'frames': frames, 'differences': differences,
                              'initialPointerControls': [
                                  {'emitterIndex': a['emitterIndex'], 'primitiveVtableRva': a['primitiveVtableRva'],
                                   'pointer': pointer, 'allocationSize': n.allocations.get(pointer),
                                   'bytesHex': bytes(n.u.mem_read(pointer, min(n.allocations.get(pointer, 0), 256))).hex()}
                                  for a in n.parent_state()['actors']
                                  for offset in range(a['vectors']['initial']['count'])
                                  for pointer in [n.q(a['vectors']['initial']['address'] + offset * 0x70 + 0x68)]
                                  if pointer],
                              'audioFacade': n.facade_record, 'audioService': n.service_record,
                              'typedStringArena': n.string_arena,
                              'pairedFrameArenas': frame_arenas,
                              'rootSoundBytesHex': bytes(n.u.mem_read(actual_root + 0x78, 0x40)).hex(),
                              'audioRegistry': registry,
                              'audioCalls': list(n.audio_calls),
                              'soundReads': [{'instructionRva': ip, 'offset': offset, 'bytes': size, 'count': count}
                                             for (ip, offset, size), count in sorted(n.sound_reads.items())]})
                print(json.dumps({'supplied': supplied, 'frames': len(frames),
                                  'differences': differences[:1], 'audioCalls': len(n.audio_calls)}), flush=True)
            finally:
                blocks.update(n.blocks)
                for path, digest in shaders.inputs.items():
                    if sha(fixture.raw(Path(path))) != digest:
                        raise ValueError('Root audio shader input changed')
                if n.material_backend is not None:
                    n.material_backend.close()
                n.mesh_backend.close()
                shaders.close()
                for handle in device.textures[texture_start:]:
                    device.gl.glDeleteTextures(1, C.byref(handle))
                del device.textures[texture_start:]
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error), 'phase': phase,
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    finally:
        device.close()
    paths = {Path(__file__), Path(inspect.getfile(NativeVfxFixture)), Path(inspect.getfile(NativeAIClientInputs)),
             Path(inspect.getfile(initialize_audio_emitter_service)), Path(inspect.getfile(GraphicsTextureDevice)),
             Path(inspect.getfile(GraphicsShaderCatalog)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    result = {'schema': 1, 'kind': 'native-root-audio-parent-differential',
              'build': manifest['build'], 'protocol': manifest['protocol'],
              'effectId': baseline['effectId'], 'seed': baseline['seed'], 'clock': baseline['clock'],
              'typedFields': locals().get('typed_fields', {}), 'inventory': inventory,
              'cases': cases, 'boundary': boundary, 'inputs': fixture.inputs,
              'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
              'originalBlocks': list(blocks.values()),
              'scope': {'originalTypedRootStrings': True, 'originalCpuAudioFacadeAndEmitterService': True,
                        'originalParentSchedulingAndParticleKernels': True, 'originalGeometryWriters': True,
                        'originalAudioEnqueueHooksExecutedExplicitly': True,
                        'wrapperVisibilityAndAudioAdmissionConditionsRecovered': False,
                        'audioQueueConsumptionExecuted': False,
                        'suppliedClocksSeedsCameraAndPlacement': True, 'audioDeviceActivated': False,
                        'soundPlaybackVerified': False, 'matchCoverage': False, 'gpuSubmitted': False,
                        'compilerAdmissionChanged': False}}
    output = fixture.cache / 'research/direct-root-audio-native.json'
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases), 'boundary': boundary}))
    if boundary or any(c['differences'] for c in cases):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
