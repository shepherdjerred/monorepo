"""Observe typed root flags and exact original parent/boolean-input behavior.

Flag variants are isolated supplied controls over the same complete no-child
root. Wrapper visibility inputs, callbacks and audio handles are not invented.
"""
import argparse
import ctypes as C
import inspect
import json
from pathlib import Path
import struct

import unicorn
from unicorn import x86_const as r

from collections import Counter
from parent_placement_native import NativeParentPlacement
from native_vfx_fixture import NativeVfxFixture
from graphics_texture_device import GraphicsTextureDevice
from graphics_shader_catalog import GraphicsShaderCatalog
from vfx_system_asset_native import NativeVfxSystemAssets
from vfx_spawn_native import ADDRESSES as A, sha


class RootFlagsControl(NativeParentPlacement):
    def __init__(self, *args, **kwargs):
        self.supplied_flags = None
        self.flag_reads = Counter()
        super().__init__(*args, **kwargs)
        self.u.hook_add(unicorn.UC_HOOK_MEM_READ, self.read_flags,
                        begin=A['definition'] + 0xc2, end=A['definition'] + 0xc3)

    def read_flags(self, uc, access, address, size, value, user):
        self.flag_reads[(uc.reg_read(r.UC_X86_REG_RIP) - self.base, size)] += 1

    def load_prepared_system(self, graph):
        super().load_prepared_system(graph)
        if self.supplied_flags is None:
            raise ValueError('Root flag control requires explicit flags')
        self.put(A['definition'] + 0xc2, 'H', self.supplied_flags)
        self.flag_reads.clear()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def actor_records(state):
    return [{'emitterIndex': a['emitterIndex'], 'pointer': a['pointer'],
             'bytesHex': a['bytesHex'], 'poolHex': a['poolHex'], 'vectors': a['vectors']}
            for a in state['actors']]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'angle']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    cache = args.cache.resolve()
    fixture = NativeVfxFixture(cache)
    baseline_path = cache / 'research/direct-root-identity-activation-native.json'
    baseline_report = fixture.read(baseline_path)
    for path, digest in baseline_report['inputs'].items():
        if sha(fixture.raw(Path(path))) != digest:
            raise ValueError('Original baseline static input changed')
    for name, digest in baseline_report['sources'].items():
        if sha(fixture.raw(Path(__file__).with_name(name))) != digest:
            raise ValueError('Original parent baseline producer changed: ' + name)
    if baseline_report['mismatches']:
        raise ValueError('Root flag baseline has unresolved identity mismatches')
    baseline = next(c for c in baseline_report['cases'] if c['suppliedIdentity'] == 0x9fbafd14)
    systems = fixture.systems
    manifest = fixture.read(fixture.assets / 'latest-effects/manifest.json')
    inventory = []
    for effect_id, ref in systems['systems'].items():
        graph = fixture.read(fixture.assets / 'latest-vfx-system-assets' / ref['file'])
        authored_ref = manifest['definitions'][effect_id]
        authored = fixture.read(fixture.assets / 'latest-effects' / authored_ref['file'])['definition']
        flags = authored.get('flags', 212)
        if type(flags) is not int or not 0 <= flags <= 65535:
            raise ValueError('Root flag field is not a uint16')
        observed = struct.unpack_from('<H', bytes.fromhex(graph['objectHex']), 0xc2)[0]
        if observed != flags:
            raise ValueError('Original complete root flags differ from serialized source')
        fields = [f for f in ref['fields'] if f['hash'] == 0x9c677a2c]
        if 'flags' in authored and (len(fields) != 1 or fields[0]['type'] != 5 or fields[0]['bytes'] != 7):
            raise ValueError('Root flags are not the original typed uint16 field')
        inventory.append({'effectId': effect_id, 'authored': 'flags' in authored, 'flags': flags})
    typed = NativeVfxSystemAssets(fixture.assets / 'decoder-16.21-macos', args.client)
    typed_controls = []
    for supplied in [None, 0, 132, 196, 197, 198, 212, 65535]:
        before = typed.load_system([] if supplied is None else [struct.pack('<IBH', 0x9c677a2c, 5, supplied)])
        after = typed.postload_system()
        observed = struct.unpack_from('<H', bytes.fromhex(after['objectHex']), 0xc2)[0]
        if observed != (212 if supplied is None else supplied) or before['objectHex'] != after['objectHex']:
            raise ValueError('Original typed uint16/postload did not preserve root flags')
        typed_controls.append({'supplied': supplied, 'observed': observed})
        typed.restore_preload_arena()
    device = GraphicsTextureDevice(args.angle)
    n = RootFlagsControl(fixture.assets / 'decoder-16.21-macos', args.client, device=device)
    cases, blocks = [], {}
    try:
        for flags in [212, 132, 196, 197, 198, 213, 214, 148]:
            n.supplied_flags = flags
            shaders = GraphicsShaderCatalog(fixture.assets / 'latest-shaders', device)
            n.shader_catalog = shaders
            texture_start = len(device.textures)
            try:
                active = fixture.activate(n, baseline_report['effectId'], baseline_report['seed'],
                                          baseline_report['clock'], 0, False)
                ownership = n.own_parent(active['object'])
                parent, obj = ownership['parent'], active['object']
                if n.u32(parent + 0xe0) != 0:
                    raise ValueError('Boolean root control requires an empty original callback queue')
                boolean_controls = []
                for arg_esi, arg_dl in [(0, 0), (1, 0), (0, 1), (1, 1)]:
                    before = bytes(n.u.mem_read(parent, 0x2c0))
                    n.call(0x1762d90, {r.UC_X86_REG_RDI: parent, r.UC_X86_REG_RSI: arg_esi,
                                      r.UC_X86_REG_RDX: arg_dl})
                    after = bytes(n.u.mem_read(parent, 0x2c0))
                    expected_bit = bool(arg_esi and not flags & 2 or arg_dl and not flags & 4)
                    observed_bit = bool(n.u32(parent + 0xf8) & 8)
                    changed = [i for i, (a, b) in enumerate(zip(before, after)) if a != b]
                    if observed_bit != expected_bit or any(i not in range(0xf8, 0xfc) for i in changed):
                        raise ValueError('Original root boolean control differs from decoded bit branches')
                    boolean_controls.append({'argEsi': arg_esi, 'argDl': arg_dl,
                                             'parentFlag8': observed_bit, 'changedOffsets': changed})
                    # Restore the same clear condition with the original function.
                    n.call(0x1762d90, {r.UC_X86_REG_RDI: parent, r.UC_X86_REG_RSI: 0, r.UC_X86_REG_RDX: 0})
                summaries, differences = [], []
                first_mismatch = None
                for tick, reference in enumerate(baseline['frames']):
                    if tick in [30, 45]:
                        n.suspend_parent(tick == 30)
                    n.apply_placement(obj, {'position': [100 + tick * 2, 40, 200 + tick]})
                    n.synchronize_placement(obj)
                    frame = n.tick_parent(reference['time'], 20)
                    state = frame['state']
                    actual = {'time': frame['time'], 'substeps': frame['substeps'],
                              'rngHex': state['rngHex'], 'parentHex': state['parentHex'],
                              'objectHex': bytes(n.u.mem_read(obj, 0x238)).hex(),
                              'actors': actor_records(state), 'draws': n.render_parent(baseline_report['camera'])}
                    changed_fields = [k for k in actual if actual[k] != reference[k]]
                    if changed_fields:
                        differences.append({'tick': tick, 'time': frame['time'], 'fields': changed_fields})
                        if first_mismatch is None:
                            first_mismatch = {'tick': tick, 'expected': reference, 'actual': actual}
                    summaries.append({'tick': tick, 'time': frame['time'],
                                      'substeps': frame['substeps'], 'rngHex': state['rngHex'],
                                      'geometrySha256': sha(encoded(actual['draws'])),
                                      'actorStateSha256': sha(encoded(actual['actors'])),
                                      'parentStateSha256': sha(bytes.fromhex(state['parentHex'])),
                                      'particles': [a['vectors']['life']['count'] for a in state['actors']],
                                      'differences': changed_fields})
                case = {'flags': flags, 'object': obj, 'parent': parent, 'actors': len(ownership['actors']),
                        'frames': summaries, 'differences': differences, 'firstMismatch': first_mismatch,
                        'booleanControls': boolean_controls,
                        'flagReads': [{'instructionRva': ip, 'bytes': size, 'count': count}
                                      for (ip, size), count in sorted(n.flag_reads.items())]}
                cases.append(case)
                print(json.dumps({'flags': flags, 'frames': len(summaries), 'differentFrames': len(differences),
                                  'firstDifference': differences[:1]}), flush=True)
            finally:
                blocks.update(n.blocks)
                for path, digest in shaders.inputs.items():
                    if sha(fixture.raw(Path(path))) != digest:
                        raise ValueError('Root flag shader input changed')
                if n.material_backend is not None:
                    n.material_backend.close()
                n.mesh_backend.close()
                shaders.close()
                for handle in device.textures[texture_start:]:
                    device.gl.glDeleteTextures(1, C.byref(handle))
                del device.textures[texture_start:]
        if cases[0]['differences']:
            raise ValueError('Default root flag control differs from the independent native baseline')
        paths = {Path(__file__), Path(inspect.getfile(NativeVfxFixture)),
                 Path(inspect.getfile(GraphicsTextureDevice)), Path(inspect.getfile(GraphicsShaderCatalog)),
                 *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
        result = {'schema': 1, 'kind': 'native-root-flag-typed-parent-boolean-controls',
                  'build': manifest['build'], 'protocol': manifest['protocol'],
                  'baselineSha256': sha(baseline_path.read_bytes()), 'baselineEffectId': baseline_report['effectId'],
                  'inventory': inventory, 'typedControls': typed_controls, 'cases': cases,
                  'originalBlocks': list(blocks.values()), 'inputs': fixture.inputs,
                  'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
                  'scope': {'originalTypedUint16Reader': True, 'completeRootInventoryChecked': True,
                            'originalParentActivationAndScheduling': True, 'isolatedSuppliedRootFlags': True,
                            'booleanFunction1762d90Executed': True, 'originalCallbackQueueEmpty': True,
                            'wrapperVisibilityInputsMapped': False, 'audioHandlesPresent': False,
                            'compilerAdmissionChanged': False, 'matchCoverage': False, 'gpuSubmitted': False}}
        output = cache / 'research/direct-root-flags-native.json'
        output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
        print(json.dumps({'output': str(output), 'roots': len(inventory), 'typedControls': len(typed_controls),
                          'parentCases': len(cases), 'frames': sum(len(c['frames']) for c in cases)}))
    finally:
        device.close()


if __name__ == '__main__':
    main()
