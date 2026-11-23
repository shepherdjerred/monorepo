"""Observe original condition-clip preparation and branch selection.

The caller supplies updater values. Their live unit/buff/stat providers, child
runtime activation, blending and pose evaluation are deliberately not replaced.
"""
import argparse
import inspect
import json
import math
import struct
from pathlib import Path
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from libcpp_shared_native import NativeLibcppSharedOwnership
from vfx_spawn_native import sha, name_hash


class NativeBranches(NativeLibcppSharedOwnership, NativeCharacterAssets):
    pass


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'input', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--full-math-init', action='store_true')
    args = parser.parse_args()
    encoded = args.input.read_bytes()
    request = json.loads(encoded)
    source = Path(request['source']['file']).read_bytes()
    root = Path(__file__).resolve().parent
    if (request['kind'] != 'original-duplicate-bin-map-input' or
            request['build'] != '16.21.829.8620' or request['protocol'] != '20e09df23c66b85e' or
            sha(source) != request['source']['sha256'] or len(source) != request['source']['bytes'] or
            request['readerSha256'] != sha((root/'exact-map-bin.mjs').read_bytes()) or
            request['preparerSha256'] != sha((root/'prepare-native-bin-map-input.mjs').read_bytes())):
        raise ValueError('Exact original animation graph field-span input required')
    roots = [case for case in request['cases'] if case['classHash'] == 'f5fb07c7' and case['fieldHash'] == '45e122f8']
    if len(roots) != 1:
        raise ValueError('One original AnimationGraphData clip-map owner required')
    n = NativeBranches(args.cache/'public/decoder-16.21-macos', args.client)
    if args.full_math_init:
        n.call(0x14aa3bf, {}, 0x14aa5f9)
    n.initialize_character_types()
    fields = []
    for span in roots[0]['fields']:
        start, size = span['offset'], span['bytes']
        if start < 0 or size < 5 or start+size > len(source):
            raise ValueError('Original graph field escaped its source')
        raw = source[start:start+size]
        if sha(raw) != span['sha256'] or '%08x' % int.from_bytes(raw[:4], 'little') != span['fieldHash']:
            raise ValueError('Original graph field digest/hash differs')
        fields.append(raw)
    loaded = n.observe_actor_fields(name_hash('AnimationGraphData'), fields)
    if loaded['originalSkippedFields'] or loaded['pendingReferences']:
        raise ValueError('Original graph fields are not completely loaded')
    graph = loaded['object']
    n.call(0x15afe30, {r.UC_X86_REG_RDI: graph}, 0x15afffc)
    count, rows_at = n.u32(graph+0x10), n.q(graph+8)
    if not 0 < count <= 10000 or not n.library_pointer(rows_at, count*16):
        raise ValueError('Original animation clip map escaped owned bounds')
    rows = [{'index': index, 'key': n.u32(rows_at+index*16), 'object': n.q(rows_at+index*16+8)}
            for index in range(count)]
    cases, boundary, active = [], None, None
    try:
        for row in rows:
            data = row['object']
            if not n.library_pointer(data, 8):
                raise ValueError('Original animation node escaped owned storage')
            table = n.q(data)
            n.call(n.q(table+0x10)-n.base, {r.UC_X86_REG_RDI: data})
            type_hash = n.u32(n.u.reg_read(r.UC_X86_REG_RAX)+8)
            if type_hash not in [name_hash('ConditionBoolClipData'), name_hash('ConditionFloatClipData')]:
                continue
            active = {'index': row['index'], 'key': row['key'], 'classHash': '%08x' % type_hash}
            n.call(n.q(table+0x28)-n.base, {r.UC_X86_REG_RDI: data, r.UC_X86_REG_RSI: graph,
                                          r.UC_X86_REG_RDX: row['key'], r.UC_X86_REG_RCX: row['index']})
            boolean = type_hash == name_hash('ConditionBoolClipData')
            prepared = {'kind': 'boolean' if boolean else 'float', **active}
            if boolean:
                prepared['children'] = [{'truth': True, 'index': n.u32(data+0x50)},
                                        {'truth': False, 'index': n.u32(data+0x54)}]
                values = [-1.0, -0.0, 0.0, f32(1e-30), 1.0]
            else:
                pairs, length = n.q(data+0x48), n.u32(data+0x50)
                if not 0 < length <= 1024 or not n.library_pointer(pairs, length*20):
                    raise ValueError('Original float condition has no bounded authored pairs')
                prepared['pairs'] = [{'key': n.u32(pairs+i*20),
                    'threshold': struct.unpack('<f', n.u.mem_read(pairs+i*20+4, 4))[0],
                    'blendUp': struct.unpack('<f', n.u.mem_read(pairs+i*20+8, 4))[0],
                    'blendDown': struct.unpack('<f', n.u.mem_read(pairs+i*20+12, 4))[0],
                    'index': n.u32(pairs+i*20+16)} for i in range(length)]
                values = sorted({f32(value) for pair in prepared['pairs'] for value in
                                 [pair['threshold']-0.001, pair['threshold'], pair['threshold']+0.001]} | {-1.0, 0.0, 1.0})
            if any(not math.isfinite(value) for value in values):
                raise ValueError('Nonfinite original condition threshold')
            context, out = n.allocate(16), n.allocate(8)
            n.call(n.q(table+0x38)-n.base, {r.UC_X86_REG_RDI: out, r.UC_X86_REG_RSI: data,
                                          r.UC_X86_REG_RDX: context})
            runtime = n.q(out)
            expected_size = 0x60 if boolean else 0x68
            if n.allocations.get(runtime) != expected_size or n.q(runtime+0x28) != data:
                raise ValueError('Original condition runtime allocation/definition differs')
            initialized = bytes(n.u.mem_read(runtime, expected_size))
            samples = []
            for direction in [values, list(reversed(values))]:
                n.u.mem_write(runtime, initialized)
                for value in direction:
                    value_bits = int.from_bytes(struct.pack('<f', value), 'little')
                    start, end = (0x158bc97, 0x158bcac) if boolean else (0x158c86b, 0x158c874)
                    n.call(start, {r.UC_X86_REG_RDI: runtime, r.UC_X86_REG_XMM0: value_bits}, end)
                    n.call(0x158bd40 if boolean else 0x158c9e0, {r.UC_X86_REG_RDI: runtime})
                    selected = n.u.reg_read(r.UC_X86_REG_EAX)
                    if selected >= len(rows):
                        raise ValueError('Original condition selected an unresolved child index')
                    samples.append({'value': value, 'selectedIndex': selected, 'selectedKey': rows[selected]['key'],
                                    'stateHex': bytes(n.u.mem_read(runtime, expected_size)).hex()})
            prepared['samples'] = samples
            cases.append(prepared)
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error), 'active': active,
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base}
    paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
    result = {'schema': 1, 'kind': 'original-animation-condition-branch-controls',
              'build': request['build'], 'protocol': request['protocol'], 'decoderImageSha256': sha(n.image),
              'inputSha256': sha(encoded), 'sourceBinSha256': sha(source),
              'ownerPath': roots[0]['ownerPath'], 'loaded': loaded,
              'rows': rows, 'cases': cases, 'boundary': boundary,
              'originalBlocks': list(n.blocks.values()),
              'sources': {str(file.resolve()): sha(file.read_bytes()) for file in sorted(paths)},
              'scope': {'originalClipIndexPrefixExecuted': True, 'originalConditionPreparationExecuted': bool(cases),
                        'originalFullMathInitializerExecuted': args.full_math_init,
                        'originalRuntimeAllocationAndBranchGetterExecuted': boundary is None,
                        'updaterValuesSupplied': True, 'liveUnitStateProvidersRecovered': False,
                        'fullGraphPreparationExecuted': False, 'childActivationExecuted': False,
                        'blendingExecuted': False, 'nativeSpectatorAdmitted': False}}
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'cases': len(cases),
                      'samples': sum(len(case['samples']) for case in cases), 'boundary': boundary}), flush=True)
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
