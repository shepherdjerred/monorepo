"""Observe exact duplicate-key fields through original constructors and readers.

This records original map storage and skipped fields. A storage observation does
not, by itself, choose duplicate semantics for a runtime lookup consumer.
"""
import argparse
import inspect
import json
import struct
from collections import deque
import unicorn
from pathlib import Path
from unicorn import x86_const as r
from character_asset_native import NativeCharacterAssets
from vfx_spawn_native import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['cache', 'client', 'input', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    encoded = args.input.read_bytes()
    request = json.loads(encoded)
    source = Path(request['source']['file']).read_bytes()
    root = Path(__file__).resolve().parent
    if (request['schema'] != 1 or request['kind'] != 'original-duplicate-bin-map-input' or
            request['build'] != '16.21.829.8620' or request['protocol'] != '20e09df23c66b85e' or
            len(source) != request['source']['bytes'] or sha(source) != request['source']['sha256'] or
            request['preparerSha256'] != sha((root/'prepare-native-bin-map-input.mjs').read_bytes()) or
            request['readerSha256'] != sha((root/'exact-map-bin.mjs').read_bytes())):
        raise ValueError('Exact original BIN field-span input required')
    n = NativeCharacterAssets(args.cache/'public/decoder-16.21-macos', args.client)
    n.initialize_character_types()
    catalog = n.catalog()
    cases, boundary, active = [], None, None
    recent = deque(maxlen=24)
    try:
        for case in request['cases']:
            class_hash = int(case['classHash'], 16)
            if class_hash not in n.types:
                raise ValueError('Original field owner class is not registered')
            fields = []
            for span in case['fields']:
                start, size = span['offset'], span['bytes']
                if start < 0 or size < 5 or start+size > len(source):
                    raise ValueError('Original serialized field escaped source')
                raw = source[start:start+size]
                if sha(raw) != span['sha256'] or '%08x' % int.from_bytes(raw[:4], 'little') != span['fieldHash']:
                    raise ValueError('Original serialized field digest/hash differs')
                fields.append(raw)
            observed = n.observe_actor_fields(class_hash, fields)
            descriptor = catalog[case['classHash']]
            properties, parents, current = [], set(), descriptor
            while current:
                if current['rva'] in parents or len(parents) > 32:
                    raise ValueError('Original property inheritance is cyclic or excessive')
                parents.add(current['rva'])
                properties.extend(current['properties'])
                parent = current['baseTypeRva']
                current = next((value for value in catalog.values() if value['rva'] == parent), None) if parent else None
            matches = [field for field in properties if field['hash'] == int(case['fieldHash'], 16)]
            if len(matches) > 1:
                raise ValueError('Original property descriptor is ambiguous')
            result = {'ownerPath': case['ownerPath'], 'trail': case['trail'],
                      'classHash': case['classHash'], 'fieldHash': case['fieldHash'],
                      'originalEntries': case['entries'], 'originalDuplicateEntries': case['matchingEntries'],
                      'loaded': observed, 'propertyDescriptor': matches[0] if matches else None,
                      'lookupConsumerExecuted': False}
            if matches:
                field = matches[0]
                offset = field['offset']
                if field['type'] != 0x86 or offset+16 > observed['size']:
                    raise ValueError('Original property is not a bounded map header')
                pointer = n.q(observed['object']+offset)
                count, capacity = struct.unpack('<II', n.u.mem_read(observed['object']+offset+8, 8))
                allocation = n.allocations.get(pointer)
                if not 0 <= count <= capacity <= 100000 or not pointer or not allocation:
                    raise ValueError('Original map storage is not an owned bounded allocation')
                result['storage'] = {'objectOffset': offset, 'pointer': pointer, 'count': count,
                                     'capacity': capacity, 'allocationBytes': allocation,
                                     'firstBytesHex': bytes(n.u.mem_read(pointer, min(1024, allocation))).hex()}
                if allocation != capacity*16 or count != case['entries']:
                    raise ValueError('Observed map entry allocation/count differs from its original key/pointer pair layout')
                rows = []
                for index in range(count):
                    at = pointer+index*16
                    key, value = n.u32(at), n.q(at+8)
                    if not value:
                        type_hash, getter = 0, None
                    else:
                        if not n.library_pointer(value, 8):
                            raise ValueError('Native map value escaped its owned allocation')
                        table = n.q(value)
                        if not n.base <= table <= n.base+len(n.image)-0x18:
                            raise ValueError('Native map value vtable escaped the original image')
                        getter = n.q(table+0x10)-n.base
                        if not 0 <= getter < len(n.image):
                            raise ValueError('Original map value type getter escaped the image')
                        active = {'phase': 'original-value-type-getter', 'index': index, 'key': key,
                                  'vtableRva': table-n.base, 'getterRva': getter}
                        n.call(getter, {r.UC_X86_REG_RDI: value})
                        native_descriptor = n.u.reg_read(r.UC_X86_REG_RAX)
                        if not n.base+0x1fef000 <= native_descriptor <= n.base+len(n.image)-0x88:
                            raise ValueError('Original value type getter returned an unowned descriptor')
                        type_hash = n.u32(native_descriptor+8)
                    rows.append({'index': index, 'key': key, 'object': value,
                                 'classHash': '%08x' % type_hash, 'typeGetterRva': getter})
                expected = sorted((entry['key'], entry['classHash']) for entry in case['originalEntries'])
                actual = sorted((row['key'], row['classHash']) for row in rows)
                if expected != actual or any(rows[index-1]['key'] > rows[index]['key'] for index in range(1, count)):
                    raise ValueError('Native typed map keys/classes differ from original entries or sorted order')
                result['nativeRows'] = rows
                result['nativeDuplicateRows'] = [row for row in rows if row['key'] == request['key']]
                if case['classHash'] == 'f5fb07c7' and case['fieldHash'] == '45e122f8':
                    graph = observed['object']
                    if offset != 8 or observed['size'] != 0x98 or n.q(graph+0x80):
                        raise ValueError('Original graph clip-index cache is not cold')
                    # Complete original clip-key/index construction prefix. Stop
                    # before default-clip setup, virtual preparation and I/O.
                    active = {'phase': 'original-clip-index-construction'}
                    n.call(0x15afe30, {r.UC_X86_REG_RDI: graph}, 0x15afffc)
                    cached = n.q(graph+0x80)
                    query_row = result['nativeDuplicateRows'][0]
                    # Re-enter the original source callsite before its index
                    # assignment. Existing-key lookup runs unchanged and does
                    # not replace the index created by the preceding prefix.
                    n.u.reg_write(r.UC_X86_REG_RBX, query_row['index']*16+8)
                    n.u.reg_write(r.UC_X86_REG_R14, graph+0x68)
                    active = {'phase': 'original-existing-key-query', 'row': query_row,
                              'frame': n.u.reg_read(r.UC_X86_REG_RBP), 'stack': n.u.reg_read(r.UC_X86_REG_RSP),
                              'frameGraph': n.q(n.u.reg_read(r.UC_X86_REG_RBP)-0x50)}
                    def query_instruction(uc, address, size, user):
                        recent.append(address-n.base)
                        if address == n.base+0x15aff73:
                            uc.emu_stop()
                    trace = n.u.hook_add(unicorn.UC_HOOK_CODE, query_instruction,
                                         begin=n.base, end=n.base+len(n.image)-1)
                    n.u.ctl_remove_cache(n.base+0x15aff41, n.base+0x15aff73)
                    try:
                        n.u.emu_start(n.base+0x15aff41, n.base+0x15aff73, count=5000000)
                    finally:
                        n.u.hook_del(trace)
                    if n.u.reg_read(r.UC_X86_REG_RIP) != n.base+0x15aff73:
                        raise ValueError('Original clip-key lookup exceeded its instruction bound')
                    node = n.u.reg_read(r.UC_X86_REG_RAX)
                    if not n.library_pointer(node, 0x18) or n.u32(node+0x10) != request['key'] or n.q(graph+0x80) != cached:
                        raise ValueError('Original lookup did not preserve the existing clip-key cache')
                    index = n.u32(node+0x14)
                    if index >= len(rows) or rows[index]['key'] != request['key']:
                        raise ValueError('Original cached clip index does not reference the recorded key')
                    result['lookupConsumerExecuted'] = True
                    result['lookup'] = {'constructionPrefix': [0x15afe30, 0x15afffc],
                                        'queryCallsite': [0x15aff41, 0x15aff73], 'queryHelperRva': 0xa1670,
                                        'cacheEntries': cached, 'selectedIndex': index, 'selectedClassHash': rows[index]['classHash'],
                                        'selectedObject': rows[index]['object'], 'existingCacheUnchanged': True,
                                        'fullGraphPreparationExecuted': False}
                elif case['classHash'] == '5bd9a1e6' and case['fieldHash'] == 'f598463e':
                    # Execute the original AtomicClipData preparation method
                    # with an original empty GraphData constructor as an
                    # explicit context control. No map rows, callbacks or
                    # readiness bits are supplied by the adapter.
                    graph = n.observe_actor_fields(0xf5fb07c7, [])['object']
                    calls = []
                    allowed = {row['object']: row for row in rows}
                    def event_prepare_call(uc, address, size, user):
                        owner = uc.reg_read(r.UC_X86_REG_RDI)
                        row = allowed.get(owner)
                        if row is None or uc.reg_read(r.UC_X86_REG_RSI) != graph:
                            raise ValueError('Original event preparation escaped its authored rows/context')
                        key = uc.reg_read(r.UC_X86_REG_EDX)
                        if key != row['key']:
                            raise ValueError('Original event preparation changed the authored key')
                        calls.append({'index': row['index'], 'key': key, 'classHash': row['classHash'],
                                      'callbackRva': address-n.base})
                    hooks = []
                    for value in sorted(allowed):
                        callback = n.q(n.q(value)+0x28)
                        if not n.base <= callback < n.base+len(n.image):
                            raise ValueError('Original event preparation callback escaped its image')
                        if callback not in [item[0] for item in hooks]:
                            hooks.append((callback, n.u.hook_add(unicorn.UC_HOOK_CODE, event_prepare_call,
                                                               begin=callback, end=callback)))
                    active = {'phase': 'original-atomic-event-preparation', 'context': 'original-empty-graph-constructor'}
                    try:
                        n.call(0x15b7050, {r.UC_X86_REG_RDI: observed['object'], r.UC_X86_REG_RSI: graph,
                                          r.UC_X86_REG_EDX: 0, r.UC_X86_REG_ECX: 0})
                    finally:
                        for callback, hook in hooks:
                            n.u.hook_del(hook)
                    if [call['index'] for call in calls] != list(range(count)):
                        raise ValueError('Original Atomic preparation did not visit every native event row exactly once')
                    result['eventPreparation'] = {'originalMethodRva': 0x15b7050,
                                                  'iterationBlock': [0x15b7216, 0x15b7249],
                                                  'calls': calls, 'originalCallbacksExecuted': True,
                                                  'context': 'original-empty-graph-constructor',
                                                  'animationResourceLookupExecuted': False,
                                                  'eventSchedulingExecuted': False,
                                                  'fullGraphPreparationExecuted': False}
            else:
                if not any(field.get('ownerTypeHash') == class_hash and field['hash'] == int(case['fieldHash'], 16)
                           for field in observed['originalSkippedFields']):
                    raise ValueError('Absent property lacks an original scoped skip observation')
                result['originalPropertySkipped'] = True
            cases.append(result)
    except Exception as error:
        boundary = {'kind': type(error).__name__, 'message': str(error),
                    'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP)-n.base, 'active': active,
                    'recentInstructions': list(recent)}
    paths = {Path(__file__), *[Path(inspect.getfile(cls)) for cls in type(n).__mro__ if cls is not object]}
    report = {'schema': 1, 'kind': 'original-duplicate-bin-map-observations',
              'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
              'decoderImageSha256': sha(n.image), 'inputSha256': sha(encoded),
              'sourceBinSha256': sha(source), 'cases': cases, 'boundary': boundary,
              'originalBlocks': list(n.blocks.values()),
              'sources': {str(path.resolve()): sha(path.read_bytes()) for path in sorted(paths)},
              'scope': {'originalTypedReaderExecuted': True, 'runtimeLookupSemanticsAdmitted': False,
                        'animationGraphPrepared': False, 'nativeSpectatorEquivalent': False}}
    args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'cases': [{key: value for key, value in case.items()
        if key not in ['loaded', 'originalDuplicateEntries', 'trail', 'nativeRows', 'storage']} for case in cases], 'boundary': boundary}), flush=True)
    if boundary:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
