"""Original tracking FixedSpeed VFX basis over admitted replay presentation inputs.

This supplied weak-holder callback fixture is not a native missile actor/world.
It leaves production admission and all historical observations unchanged.
"""
import argparse
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys

import cdtb.binfile as binfile
from unicorn import x86_const as r
from vfx_spawn_native import sha

_spec = importlib.util.spec_from_file_location(
    'tracking_basis_original_callback', Path(__file__).with_name('probe-missile-effect-basis.py'))
_module = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _module
_spec.loader.exec_module(_module)
Control = _module.Control


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache, inputs = args.cache.resolve(), {}

    def raw(path):
        path = Path(path).resolve()
        data = path.read_bytes()
        digest = sha(data)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Tracking basis input changed: ' + str(path))
        inputs[str(path)] = digest
        return data

    def read(path):
        return json.loads(raw(path))

    session = read(cache / 'research/direct-session-selected-control.json')
    report = read(cache / 'research/selected-ordinary-reconstruction.json')
    if session['summary']['contract']['replayHash'] != report['replaySha256']:
        raise ValueError('Exact current session/replay identity required')
    for path, digest in session['inputs'].items():
        if sha(raw(path)) != digest:
            raise ValueError('Current ordinary session prerequisite changed: ' + path)
    traces = [row for row in session['diagnostic']['targetedMissilePresentation']['traces']
              if row['definitionName'] == 'AkshanEAttack' and 69 <= row['startTime'] <= 99]
    if [row['sequence'] for row in traces] != [2977, 3830, 3845, 3880]:
        raise ValueError('Expected four current admitted tracking FixedSpeed fixture traces')
    for trace in traces:
        packet = next(row for row in report['missiles'] if row['sequence'] == trace['sequence'])
        if (packet['entityId'] != trace['entityId'] or packet['time'] != trace['startTime'] or
                packet['cast']['ownerId'] != trace['ownerId'] or
                packet['cast']['spellHash'] != trace['spellHash'] or
                ('effectBasisProgram' in trace and trace['effectBasisProgram'] is not None)):
            raise ValueError('Trace must retain exact decoded packet identity and unadmitted basis')
    for dictionary in [v for k, v in vars(binfile).items() if k.startswith('hashfile_')]:
        dictionary.hashes = {}
    for dictionary, name in [(binfile.hashfile_binfields, 'binfields'), (binfile.hashfile_bintypes, 'bintypes')]:
        dictionary.hashes = {int(line.split()[0], 16): line.split(maxsplit=1)[1].strip()
                             for line in raw(cache / 'vfx' / ('hashes.' + name + '.txt')).decode().splitlines()}
    data = raw(cache / 'installed-assets/16.21.829.8620-6f8712cf8ff0/characters/akshan.bin')

    class Reader(binfile.BinReader):
        def __init__(self, *a):
            super().__init__(*a)
            self.spans = {}

        def read_field(self, kind):
            start = self.f.tell()
            field = super().read_field(kind)
            self.spans[id(field)] = (start, self.f.tell())
            return field

    stream = io.BytesIO(data)
    if stream.read(4) != b'PROP':
        raise ValueError('Original typed spell BIN required')
    reader = Reader(stream)
    _, _, types = reader.read_binfile_header()
    entries = [reader.read_binfile_entry(kind) for kind in types]
    entry = next(entry for entry in entries for field in entry.fields
                 if str(field.name) == 'ObjectName' and field.value == 'AkshanEAttack')
    spell = next(field.value for field in entry.fields if str(field.name) == 'mSpell')
    source_missile = next(field.value for field in spell.fields if str(field.name) == 'mMissileSpec')
    source_movement = next(field.value for field in source_missile.fields if str(field.name) == 'movementComponent')
    if source_movement.type.h != binfile.compute_binhash('FixedSpeedMovement'):
        raise ValueError('Original source movement must be FixedSpeed')
    n = Control(cache / 'public/decoder-16.21-macos', args.client)
    n.initialize_character_types()
    n.call(0x870ae0, {})
    registry, count = n.q(n.base + 0x247b7c0), n.u32(n.base + 0x247b7c8)
    n.types = {n.u32(n.q(registry + i * 8) + 8): n.q(registry + i * 8) for i in range(count)}
    n.type_catalog = n.catalog()
    metadata = n.type_catalog['43368569']
    turn_fields = [field for field in metadata['properties'] if field['offset'] in [0x440, 0x444]]
    spans = [reader.spans[id(field)] for field in spell.fields]
    loaded = n.observe_actor_fields(spell.type.h, [data[a:b] for a, b in spans])
    obj = loaded['object']
    if spell.type.h != 0x43368569 or len(turn_fields) != 2 or bytes(n.u.mem_read(obj + 0x440, 8)) != bytes(8):
        raise ValueError('Actual spell must have original zero direction-turn settings')
    missile_field = next(field for field in metadata['properties'] if field['hash'] == binfile.compute_binhash('mMissileSpec'))
    missile_spec = n.q(obj + missile_field['offset'])
    if not missile_spec or bytes(n.u.mem_read(missile_spec + 0x31, 1)) != bytes(1):
        raise ValueError('Untranslated native missile visibility producer')
    missile_metadata = n.type_catalog[f'{source_missile.type.h:08x}']
    movement_field = next(field for field in missile_metadata['properties'] if field['hash'] == binfile.compute_binhash('movementComponent'))
    movement_spec = n.q(missile_spec + movement_field['offset'])
    descriptor = n.types[source_movement.type.h]
    default = n.allocate(n.q(descriptor + 0x40))
    n.call(n.q(descriptor + 0x20) - n.base, {r.UC_X86_REG_RDI: default})
    if n.q(movement_spec) != n.q(default) or bytes(n.u.mem_read(movement_spec + 0xa, 1)) != b'\x01':
        raise ValueError('Original tracking FixedSpeed class/default differs')
    movement = {'typeHash': source_movement.type.h, 'vtableRva': n.q(movement_spec) - n.base,
                'mTracksTarget': True, 'mSpeed': struct.unpack('<f', n.u.mem_read(movement_spec + 0x5c, 4))[0]}
    controller, initial_target = n.allocate(0x200), n.allocate(12)
    actor, callback, holder, game_object, vfx_object, weak, descriptor, owner = [n.allocate(size) for size in [0x500, 0x38, 8, 0x200, 0x238, 0x20, 0x40, 0x100]]
    n.put(weak + 8, 'q', 1)
    n.put(weak + 16, 'q', 1)
    n.put(holder, 'Q', game_object)
    n.put(game_object + 0x178, 'Q', vfx_object)
    n.put(actor + 0x3f0, 'Q', callback)
    mask = (1 << 64) - 1
    ror = lambda value, count: ((value >> count) | (value << (64 - count))) & mask
    n.put(descriptor + 8, 'Q', ror(owner ^ 0x3dc9cb21, 21))

    def initialize():
        n.call(0x892ea0, {r.UC_X86_REG_RDI: callback, r.UC_X86_REG_RSI: actor})
        n.put(owner + 0x80, 'Q', (ror(obj, 17) - 0x80104765) & mask)
        n.fragment(0x892f00, 0x892f3c, {r.UC_X86_REG_RDI: callback, r.UC_X86_REG_RDX: descriptor})
        n.put(callback + 0x10, 'QQ', holder, weak)
        n.put(actor + 0x348, 'Q', missile_spec)
        if bytes(n.u.mem_read(callback + 0x20, 8)) != bytes(8):
            raise ValueError('Original direction callback configuration differs')

    def initial_velocity(trace):
        packet = next(row for row in report['missiles'] if row['sequence'] == trace['sequence'])
        state = trace['states'][0]
        if packet['elapsedSeconds'] != 0 or state['velocity'] != [0, 0, 0] or state['stopped']:
            raise ValueError('Expected exact zero-age pre-initializer presentation row')
        # This is the existing causal retained target-view projection. Native
        # registry acceptance and the preceding original target query are not
        # re-created by supplying these already-resolved position fields.
        n.put(actor + 0x15c, 'fff', *state['position'])
        n.put(initial_target, 'fff', *state['targetPosition'])
        n.fragment(0x88a02b, 0x88a16b, {
            r.UC_X86_REG_RDI: controller, r.UC_X86_REG_RSI: actor,
            r.UC_X86_REG_RDX: 0, r.UC_X86_REG_RCX: initial_target,
            r.UC_X86_REG_R8: movement_spec})
        constructor_cached = bytes(n.u.mem_read(controller + 0x88, 12)).hex()
        # Reapply the retained post-query endpoint: the original query in
        # 88a770 is separately verified; this fixture isolates its consumer.
        n.put(controller + 0x7c, 'fff', *state['targetPosition'])
        n.put(controller + 0xa0, 'f', packet['movementSpeed'])
        n.fragment(0x87f48e, 0x87f4c7, {r.UC_X86_REG_RBX: controller})
        speed_bits = int.from_bytes(struct.pack('<f', packet['movementSpeed']), 'little')
        n.call(0x148ddc0, {r.UC_X86_REG_RDI: actor + 0x58, r.UC_X86_REG_XMM0: speed_bits})
        velocity = list(struct.unpack('<3f', n.u.mem_read(actor + 0x58, 12)))
        return velocity, {'policy': 'supplied-causal-retained-target-position-consumer-only',
                          'position': state['position'], 'targetPosition': state['targetPosition'],
                          'movementSpeed': packet['movementSpeed'],
                          'constructorCachedAimOffsetHex': constructor_cached,
                          'originalInitializerVelocity': velocity,
                          'originalInitializerVelocityHex': bytes(n.u.mem_read(actor + 0x58, 12)).hex(),
                          'preInitializerPresentationVelocity': state['velocity'],
                          'targetRegistryAndQueryReexecuted': False}

    def apply(velocity, stopped=False, creation=False):
        n.put(actor + 0x58, 'fff', *velocity)
        n.put(actor + 0x3c8, '?', stopped)
        if creation:
            if not any(velocity) or stopped:
                raise ValueError('Unproved zero/stopped initial direction')
            n.fragment(0x87a869, 0x87a8d1, {r.UC_X86_REG_R14: actor})
        else:
            n.fragment(0x87bb93, 0x87bbd9 if stopped else 0x87bbac, {r.UC_X86_REG_RBX: actor})
        return {'inputVelocity': velocity, 'creation': creation, 'stopped': stopped,
                'direction': list(struct.unpack('<3f', n.u.mem_read(callback, 12))),
                'matrix': list(struct.unpack('<16f', n.u.mem_read(vfx_object + 0x120, 64))),
                'matrixHex': bytes(n.u.mem_read(vfx_object + 0x120, 64)).hex(),
                'weakOwners': struct.unpack('<q', n.u.mem_read(weak + 8, 8))[0]}

    cases, controls = [], []
    for trace in traces:
        initialize()
        first_velocity, initializer = initial_velocity(trace)
        samples = [{'time': state['time'], 'position': state['position'],
                    **apply(first_velocity if i == 0 else state['velocity'], state['stopped'], i == 0)}
                   for i, state in enumerate(trace['states'])]
        cases.append({'sourceEventId': trace['sourceEventId'], 'instanceId': trace['instanceId'],
                      'ownerId': trace['ownerId'], 'entityId': trace['entityId'], 'sequence': trace['sequence'],
                      'definitionName': trace['definitionName'], 'initializer': initializer, 'samples': samples})
    for velocity in [[1, 0, 0], [0, 0, 1], [0, 1, 0], [0, -1, 0], [1, 2, 3], [-4, -3, -2],
                     [1.25, -3.5, 7.75], [.00001, 1, 0], [.001, 1, 0], [.01, 1, 0], [1e-6, 0, 0]]:
        initialize()
        samples = [apply(velocity, creation=True), apply([0, 0, 0]), apply(velocity), apply([0, 0, 0], stopped=True)]
        controls.append({'initialVelocity': velocity, 'samples': samples})
    raw(args.client)
    for name in ['profile.json', 'image.bin']:
        raw(cache / 'public/decoder-16.21-macos' / name)
    tools = Path(__file__).resolve().parent
    for module in tuple(sys.modules.values()):
        path = getattr(module, '__file__', None)
        if path and Path(path).suffix == '.py' and Path(path).resolve().is_relative_to(tools):
            raw(path)
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Tracking basis proof input drifted: ' + path)
    output = cache / 'research/tracking-fixed-speed-basis-native-v38.json'
    candidates = [row for row in report['missiles'] if row['cast']['ownerId'] == traces[0]['ownerId']
                  and row['cast']['spellHash'] == traces[0]['spellHash'] and 69 <= row['time'] <= 99]
    excluded = []
    for packet in candidates:
        if packet['sequence'] in [row['sequence'] for row in traces]:
            continue
        ledger = next(row for row in session['completeCoverage']['rows']
                      if row['origin'] == 'missile' and row['entityId'] == packet['entityId'])
        excluded.append({'sequence': packet['sequence'], 'entityId': packet['entityId'],
                         'reasons': ledger['reasons']})
    if len(candidates) != 18 or len(excluded) != 14:
        raise ValueError('All eighteen packet candidates must remain accounted for')
    result = {'schema': 1, 'kind': 'original-tracking-fixed-speed-source-basis-controls', 'artifactVersion': 38,
              'build': report['build'], 'protocol': report['protocol'], 'replaySha256': report['replaySha256'],
              'inputs': inputs, 'cases': cases, 'controls': controls, 'excludedCandidates': excluded,
              'blocks': list(n.blocks.values()),
              'sourceSpell': {'name': 'AkshanEAttack', 'entryPathHash': entry.path.h, 'typeHash': spell.type.h,
                              'fields': [{'offset': a, 'bytes': b-a, 'sha256': sha(data[a:b])} for a, b in spans],
                              'allAuthoredFieldsPassedToOriginalReader': True, 'originalLoaded': loaded,
                              'originalLoadedMovement': movement, 'turnFields': turn_fields,
                              'turnBytesHex': bytes(n.u.mem_read(obj + 0x440, 8)).hex()},
              'scope': {'originalTypedSourceReader': True, 'originalCreationLiveAndStoppedCallbacks': True,
                        'fullOriginalDirectionAndVfxSetter': True, 'actualRetainedPresentationVelocityInputs': True,
                        'initialVelocityCorrectedByOriginalInitializerConsumer': True,
                        'originalTrackingTargetQueryReexecuted': False,
                        'suppliedOwnedWeakHolderObjects': True, 'fullNativeMissileActorOrWorld': False,
                        'nativeMatchAcceptance': None, 'activeFamilyAdmissionChanged': False,
                        'arbitraryRotationProvedByThisArtifact': False, 'gpuSubmitted': False}}
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases), 'samples': sum(len(c['samples']) for c in cases),
                      'controls': len(controls), 'controlSamples': sum(len(c['samples']) for c in controls)}))


if __name__ == '__main__':
    main()
