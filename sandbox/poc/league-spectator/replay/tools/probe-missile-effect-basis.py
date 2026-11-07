"""Original missile velocity callback and VFX direction basis over actual traces.

This observes a bounded presentation callback with owned weak/shared ABI objects.
It does not execute a native replay, collision dispatch, or a complete missile actor.
"""
import argparse
import inspect
import io
import json
import struct
import sys
from pathlib import Path
import cdtb.binfile as binfile
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from world_descriptor_native import NativeWorldDescriptors, SHARED_IMPORTS
from vfx_spawn_native import sha


class Control(NativeCharacterAssets):
    def __init__(self, *args):
        self.shared_calls = []
        super().__init__(*args)

    def imported(self, uc, address, size, user):
        if address-self.base in SHARED_IMPORTS:
            return NativeWorldDescriptors.imported(self, uc, address, size, user)
        return super().imported(uc, address, size, user)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    inputs = {}
    def raw(path):
        path = path.resolve()
        data = path.read_bytes()
        digest = sha(data)
        if str(path) in inputs and inputs[str(path)] != digest:
            raise ValueError('Basis input changed: ' + str(path))
        inputs[str(path)] = digest
        return data
    tools = Path(__file__).resolve().parent
    for module in tuple(sys.modules.values()):
        path = getattr(module, '__file__', None)
        if path and Path(path).suffix == '.py' and Path(path).resolve().is_relative_to(tools):
            raw(Path(path))
    raw(Path(__file__))
    raw(args.client)
    for name in ['profile.json', 'image.bin']:
        raw(cache / 'public/decoder-16.21-macos' / name)
    exported = json.loads(raw(cache / 'research/viewer-root-reconstruction.json'))
    control_bytes = raw(Path(exported['controlReportPath']))
    if sha(control_bytes) != exported['controlReportSha256']:
        raise ValueError('Ordinary reconstruction control changed')
    report = exported['report']
    traces = [row for row in json.loads(control_bytes)['fixedTimePresentationControl']['traces']
              if row['ownerCharacter'] == 'Maokai' and 69 <= row['startTime'] <= 99]
    if len(traces) != 6:
        raise ValueError('Expected the six actual admitted Maokai comparison-window traces')
    for dictionary in [value for key, value in vars(binfile).items() if key.startswith('hashfile_')]:
        dictionary.hashes = {}
    for dictionary, name in [(binfile.hashfile_binfields, 'binfields'), (binfile.hashfile_bintypes, 'bintypes')]:
        dictionary.hashes = {int(line.split()[0], 16): line.split(maxsplit=1)[1].strip()
                             for line in raw(cache / 'vfx' / ('hashes.' + name + '.txt')).decode().splitlines()}
    bin_path = cache / 'installed-assets/16.21.829.8620-6f8712cf8ff0/characters/maokai.bin'
    data = raw(bin_path)
    class Reader(binfile.BinReader):
        def __init__(self, *args):
            super().__init__(*args)
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
    by_name = {field.value: entry for entry in entries for field in entry.fields
               if str(field.name) == 'ObjectName' and isinstance(field.value, str)}
    n = Control(cache / 'public/decoder-16.21-macos', args.client)
    n.initialize_character_types()
    # This original Mach-O module initializer registers the actual missile
    # specification/movement/facing classes. Character startup does not own it.
    n.call(0x870ae0, {})
    registry, count = n.q(n.base+0x247b7c0), n.u32(n.base+0x247b7c8)
    n.types = {n.u32(n.q(registry+i*8)+8): n.q(registry+i*8) for i in range(count)}
    n.type_catalog = n.catalog()
    metadata = n.type_catalog['43368569']
    turn_fields = [field for field in metadata['properties'] if field['offset'] in [0x440, 0x444]]
    if len(turn_fields) != 2:
        raise ValueError('Original spell direction-turn fields differ')
    specs = {}
    consumer_hashes = {field['hash'] for field in turn_fields} | {binfile.compute_binhash('mMissileSpec')}
    for name in sorted({row['definitionName'] for row in traces}):
        entry = by_name[name]
        spell = next(field.value for field in entry.fields if str(field.name) == 'mSpell')
        selected_fields = spell.fields
        spans = [reader.spans[id(field)] for field in selected_fields]
        loaded = n.observe_actor_fields(spell.type.h, [data[a:b] for a, b in spans])
        obj = loaded['object']
        if spell.type.h != 0x43368569 or bytes(n.u.mem_read(obj + 0x440, 8)) != bytes(8):
            raise ValueError('Authored missile requires untranslated direction smoothing')
        missile_field = next(field for field in metadata['properties'] if field['hash'] == binfile.compute_binhash('mMissileSpec'))
        missile_spec = n.q(obj + missile_field['offset'])
        if not missile_spec or bytes(n.u.mem_read(missile_spec + 0x31, 1)) != bytes(1):
            raise ValueError('Native missile visibility callback requires a separate producer')
        specs[name] = {'object': obj, 'missileSpec': missile_spec, 'loaded': loaded,
                       'entryPathHash': entry.path.h, 'typeHash': spell.type.h,
                       'consumerFieldHashes': sorted(consumer_hashes),
                       'omittedUnconsumedFields': [{'hash': field.name.h, 'name': str(field.name)} for field in spell.fields if field not in selected_fields],
                       'fields': [{'offset': a, 'bytes': b-a, 'sha256': sha(data[a:b])} for a, b in spans]}
    actor, callback, holder, game_object, vfx_object, weak, descriptor, owner = [n.allocate(size) for size in [0x500, 0x38, 8, 0x200, 0x238, 0x20, 0x40, 0x100]]
    n.put(weak + 8, 'q', 1)
    n.put(weak + 16, 'q', 1)
    n.put(holder, 'Q', game_object)
    n.put(game_object + 0x178, 'Q', vfx_object)
    n.put(actor + 0x3f0, 'Q', callback)
    mask = (1 << 64) - 1
    ror = lambda value, count: ((value >> count) | (value << (64-count))) & mask
    n.put(descriptor + 8, 'Q', ror(owner ^ 0x3dc9cb21, 21))
    def initialize(name):
        n.call(0x892ea0, {r.UC_X86_REG_RDI: callback, r.UC_X86_REG_RSI: actor})
        n.put(owner + 0x80, 'Q', (ror(specs[name]['object'], 17)-0x80104765) & mask)
        n.fragment(0x892f00, 0x892f3c, {r.UC_X86_REG_RDI: callback, r.UC_X86_REG_RDX: descriptor})
        n.put(callback + 0x10, 'QQ', holder, weak)
        n.put(actor + 0x348, 'Q', specs[name]['missileSpec'])
        if bytes(n.u.mem_read(callback + 0x20, 8)) != bytes(8):
            raise ValueError('Original direction callback configuration differs')
    def apply(velocity, stopped=False, creation=False):
        n.put(actor + 0x58, 'fff', *velocity)
        n.put(actor + 0x3c8, '?', stopped)
        if creation:
            if not any(velocity):
                raise ValueError('Initial controller fallback direction is outside this admitted native slice')
            n.fragment(0x87a869, 0x87a8d1, {r.UC_X86_REG_R14: actor})
        else:
            n.fragment(0x87bb93, 0x87bbd9 if stopped else 0x87bbac, {r.UC_X86_REG_RBX: actor})
        return {'inputVelocity': velocity, 'stopped': stopped, 'creation': creation, 'direction': list(struct.unpack('<fff', n.u.mem_read(callback, 12))),
                'matrix': list(struct.unpack('<16f', n.u.mem_read(vfx_object + 0x120, 64))),
                'matrixHex': bytes(n.u.mem_read(vfx_object + 0x120, 64)).hex(),
                'weakOwners': struct.unpack('<q', n.u.mem_read(weak+8, 8))[0]}
    cases = []
    for trace in traces:
        initialize(trace['definitionName'])
        samples = []
        for index, state in enumerate(trace['states']):
            samples.append({'time': state['time'], 'position': state['position'], **apply(state['velocity'], state['stopped'], index == 0)})
        cases.append({'sourceEventId': trace['sourceEventId'], 'sequence': trace['sequence'],
                      'definitionName': trace['definitionName'], 'samples': samples})
    controls = []
    for velocity in [[0,0,0], [1,0,0], [0,0,1], [0,1,0], [0,-1,0], [1,2,3], [-4,-3,-2], [0.00001,1,0], [0.001,1,0], [0.01,1,0], [1e-6,0,0]]:
        initialize(traces[0]['definitionName'])
        controls.append(apply(velocity))
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Basis source changed: ' + path)
    result = {'schema': 1, 'kind': 'original-missile-velocity-effect-basis', 'build': report['build'],
              'protocol': report['protocol'], 'replaySha256': report['replaySha256'], 'inputs': inputs,
              'turnFields': turn_fields, 'spells': specs, 'cases': cases, 'controls': controls,
              'blocks': list(n.blocks.values()),
              'scope': {'originalTypedConsumerSpellFields': True, 'allAuthoredSpellFieldsPassedToOriginalReader': True, 'originalReaderUnknownFieldsRemainExplicit': True, 'originalMissileModuleInitializer': 0x870ae0, 'originalCallbackConstructor': True,
                        'originalSpellConfigurationPrefix': [0x892f00,0x892f3c],
                        'originalConcreteFrameCallbackPrefix': [0x87bb93,0x87bbac],
                        'originalCreationDirectionPrefix': [0x87a869,0x87a8d1],
                        'originalStoppedFrameBranchEndpoint': 0x87bbd9,
                        'fullOriginalDirectionCallback': True, 'fullOriginalVfxDirectionSetter': True,
                        'suppliedOwnedWeakHolderObjects': True, 'actualDecodedMovementTraceInputs': True,
                        'fullOriginalMissileFrame': False, 'browserPlaybackObserved': False,
                        'nativeMatchAcceptance': None}}
    output = cache / 'research/missile-effect-basis-native.json'
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(output), 'cases': len(cases), 'samples': sum(len(case['samples']) for case in cases), 'controls': len(controls)}))


if __name__ == '__main__':
    main()
