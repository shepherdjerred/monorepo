"""Original projected endpoint and exact decoded slot controls; no admission."""
import argparse
import json
from pathlib import Path
import struct
import sys
import unicorn
from unicorn import x86_const as r
from vfx_spawn_native import NativeSpawn, sha


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
            raise ValueError('Endpoint input changed: '+str(path))
        inputs[str(path)] = digest
        return data

    def read(path):
        return json.loads(raw(path))

    n = NativeSpawn(cache/'public/decoder-16.21-macos', args.client)
    u32 = lambda at: struct.unpack('<I', n.u.mem_read(at, 4))[0]
    report = read(cache/'research/viewer-root-reconstruction.json')['report']
    observations = read(cache/'research/projectile-combat-native.json')
    if (report['build'] != n.profile['clientVersion'] or report['protocol'] != n.profile['protocolDigest'] or
            report['decoderImageSha256'] != n.profile['decoderImageSha256'] or
            report['fieldCodecsSha256'] != n.profile['fieldCodecsSha256'] or
            report['constructorImageSha256'] != n.profile['constructorImageSha256'] or
            observations['clientVersion'] != n.profile['clientVersion'] or
            observations['decoderImageSha256'] != n.profile['decoderImageSha256'] or
            observations['constructorImageSha256'] != n.profile['constructorImageSha256']):
        raise ValueError('Exact original packet/decoder/build identities required')
    packets = {row['payloadSha256']: row for row in observations['observations'].values()
               if row['opcode'] == 28 and row['status'] == 'complete'}
    scene = read(cache/'public/latest-scene/manifest.json')
    hero = next(row for row in report['heroes'] if row['champion'] == 'Akshan')
    catalog_path = cache/'public/latest-scene'/scene['champions'][f"akshan/{hero['skinId']}"]['spellCatalog']
    catalog = read(catalog_path)
    records = [row for row in report['missiles'] if row['cast']['ownerId'] == hero['entityId'] and
               catalog['spells'].get(str(row['cast']['spellHash']), {}).get('name') == 'AkshanEMissile']
    if [row['sequence'] for row in records] != [2843, 3676, 4141, 4313]:
        raise ValueError('Four exact current decoded source packets required')
    packet, output = n.allocate(0x300), n.allocate(0x200)
    column = []
    for value in range(256):
        n.put(packet+0xae, 'B', value)
        n.call(0x82b563, {r.UC_X86_REG_R14: packet, r.UC_X86_REG_R10: output,
                         r.UC_X86_REG_RBX: n.base+0x20d7800}, 0x82b584)
        column.append(u32(output+0x154))
    if sorted(column) != list(range(256)):
        raise ValueError('Original slot field is not a byte bijection')
    cases = []
    for record in records:
        observation = packets[record['payloadSha256']]
        original_object = bytes.fromhex(observation['object'])
        if len(original_object) != 632:
            raise ValueError('Exact original missile packet object layout required')
        n.u.mem_write(packet,original_object[168:])
        encoded = original_object[168+0xae]
        n.call(0x82b563, {r.UC_X86_REG_R14: packet, r.UC_X86_REG_R10: output,
                         r.UC_X86_REG_RBX: n.base+0x20d7800}, 0x82b584)
        value = u32(output+0x154)
        if value != column[encoded]:
            raise ValueError('Original actual packet slot mismatch')
        n.call(0x82a1c8,{r.UC_X86_REG_R14:packet,r.UC_X86_REG_RBX:output,
                        r.UC_X86_REG_R15:n.base+0x20d7800},0x82a22e)
        level = struct.unpack('<i',n.u.mem_read(output+0x90,4))[0]
        if level != record['cast']['spellLevel']:
            raise ValueError('Original actual cast-level conversion differs')
        cases.append({'sequence': record['sequence'], 'sourceEventId':
                      f"packet:{record['transportSequence']}:entry:{record.get('entryOrder',0)}:missile:{record['entityId']}",
                      'ownerId': record['cast']['ownerId'], 'spellHash': record['cast']['spellHash'],
                      'spellLevel': level, 'rawByteOffset': 168+0xae,
                      'rawByte': encoded, 'normalizedSlot154': value,
                      'originalSpellbookLookupIndex': value if value < 64 else 0,
                      'sourceCast': record['cast']})
    extra_slot_mapping = []
    for index in range(16):
        n.call(0x8b0306,{r.UC_X86_REG_R13:index},0x8b030a)
        selected = n.u.reg_read(r.UC_X86_REG_ESI)
        if selected != index+45:
            raise ValueError('Original extra spell slot mapping changed')
        extra_slot_mapping.append({'extraSpellIndex':index,'originalSpellbookSlot':selected})
    character_record = catalog['records']['Characters/Akshan/CharacterRecords/Root']['data']
    initial_assignment_observation = {
        'decodedSlot':51,'originalExtraSpellIndex':6,
        'authoredLegacyExtraSpell':character_record['extraSpells'][6],
        'authoredListExtraSpell':character_record['extraSpellsList'][6],
        'sourceAssignmentConsumerRva':0x8b01d0,
        'sourceExtraSpellGetterRva':0x2a8060,
        'sourceEmptyAssignmentGuardRva':0x8b02fd,
        'fullOriginalCharacterAssignmentExecuted':False,
        'subsequentLiveAssignmentsRecovered':False,
    }
    # This numeric control deliberately takes the original explicit override
    # branch. It does not assert the actual caster's slot51 state or range.
    heights = raw(cache/'public/latest-scene/heights.bin')
    manager, grid, height_at = n.allocate(0x20), n.allocate(0x200), n.allocate(len(heights))
    n.put(manager+8, 'Q', grid)
    n.put(n.base+0x246c948, 'Q', manager)
    n.put(grid+0xbc, 'fff', *scene['map']['min'])
    n.put(grid+0xc8, 'fff', *scene['map']['max'])
    n.put(grid+0xf8, 'Q', height_at)
    dimensions = scene['map']['heightGrid']
    n.put(grid+0x100, 'IIff', dimensions['x'], dimensions['z'], *dimensions['step'])
    n.u.mem_write(height_at, heights)
    n.call(0x16b6f6c, {r.UC_X86_REG_R12: grid}, 0x16b6fc9)
    descriptor, cast, resource, handle, target = [n.allocate(0x1000) for _ in range(5)]
    mask = (1 << 64)-1
    ror = lambda value, count: ((value >> count) | (value << (64-count))) & mask
    n.put(cast+8, 'Q', ror(handle ^ 0x3dc9cb21, 21))
    n.put(handle+0x80, 'Q', (ror(resource,17)-0x80104765) & mask)
    n.put(cast+0x14d, 'B', 1)
    n.put(descriptor, 'BBBB', 0, 1, 0, 0)
    n.put(resource+0x764, '7f', *([750.]*7))
    slot = n.allocate(0x150)
    n.call(0x84b390, {r.UC_X86_REG_RDI: slot, r.UC_X86_REG_RSI: 51,
                     r.UC_X86_REG_RDX: 0})
    encoded_null = bytes(n.u.mem_read(slot+0x140,8)).hex()
    def slot_identity():
        n.call(0x8490b0, {r.UC_X86_REG_RDI: slot, r.UC_X86_REG_RSI: handle})
        return bool(n.u.reg_read(r.UC_X86_REG_AL))
    def bind_control(pointer):
        # Explicit controlled state for the original getter. No native slot
        # assignment or recorded spellbook mutation is asserted by this write.
        encoded = ror((((pointer ^ 0x496e69c7)+0x80104765) & mask) ^ 0x93e17d08,1)
        n.put(slot+0x140,'Q',encoded)
    getter_controls = [{'label': 'original-constructed-slot51-unbound', 'matchesCastResource': slot_identity(),
                        'encodedResourceHex': encoded_null}]
    other = n.allocate(0x100)
    bind_control(other)
    getter_controls.append({'label': 'supplied-different-resource-binding', 'matchesCastResource': slot_identity()})
    bind_control(handle)
    for override in [0.,900.]:
        n.put(slot+0x8c,'f',override)
        matches = slot_identity()
        n.call(0x8489a0, {r.UC_X86_REG_RDI: slot, r.UC_X86_REG_ESI: 0xffffffff})
        value = struct.unpack('<f',struct.pack('<I',n.u.reg_read(r.UC_X86_REG_XMM0)&0xffffffff))[0]
        getter_controls.append({'label': 'supplied-matching-resource-binding', 'matchesCastResource': matches,
                                'suppliedPositiveRangeOverride': override, 'originalGetterRange': value})
    if ([row['matchesCastResource'] for row in getter_controls] != [False,False,True,True] or
            [row['originalGetterRange'] for row in getter_controls[2:]] != [750.,900.]):
        raise ValueError('Original slot identity/dynamic range controls differ')
    projection_cases = []
    for record in records:
        for supplied_range in [-10., 0., 250., 750., 1250., 1000000.]:
            for use_ground in [False, True]:
                for target_y_delta in [0., 137.]:
                    source = record['cast']['sourcePosition']
                    endpoint = list(record['cast']['targetPosition'])
                    endpoint[1] += target_y_delta
                    n.put(cast+0xc8, 'fff', *source)
                    n.put(cast+0x90, 'i', record['cast']['spellLevel'])
                    n.put(resource+0x764, '7f', *([supplied_range]*7))
                    n.put(descriptor+3, '?', use_ground)
                    n.put(target, 'fff', *endpoint)
                    n.call(0x873e70, {r.UC_X86_REG_RDI: descriptor,
                                     r.UC_X86_REG_RSI: target, r.UC_X86_REG_RDX: cast})
                    projection_cases.append({'sequence': record['sequence'], 'sourcePosition': source,
                                             'targetPosition': endpoint, 'suppliedRange': supplied_range,
                                             'castLevel': record['cast']['spellLevel'],
                                             'explicitRangeOverrideFlag14d': 1,
                                             'mUseGroundHeightAtTarget': use_ground,
                                             'positionHex': bytes(n.u.mem_read(target,12)).hex()})
    for offset in range(0, len(projection_cases), 4):
        if len({row['positionHex'] for row in projection_cases[offset:offset+4]}) != 1:
            raise ValueError('Initial endpoint unexpectedly consumed target Y or ground flag')
    rank_controls, rank_observations = [], []
    range_values = [101.,203.,307.,409.,503.,607.,709.]
    n.put(resource+0x764,'7f',*range_values)
    def observe_rank(engine,address,size,user):
        if engine.reg_read(r.UC_X86_REG_R15) != cast:
            raise ValueError('Range-load observation escaped supplied cast')
        rank_observations.append(struct.unpack('<f',struct.pack('<I',engine.reg_read(r.UC_X86_REG_XMM0)&0xffffffff))[0])
    observer = n.u.hook_add(unicorn.UC_HOOK_CODE,observe_rank,
                            begin=n.base+0x873f2d,end=n.base+0x873f2d)
    try:
        for level in [-1,0,2,6]:
            n.put(cast+0x90,'i',level)
            n.put(target,'fff',*records[0]['cast']['targetPosition'])
            rank_observations.clear()
            n.call(0x873e70,{r.UC_X86_REG_RDI:descriptor,r.UC_X86_REG_RSI:target,r.UC_X86_REG_RDX:cast})
            expected = range_values[max(level,0)]
            if rank_observations != [expected]:
                raise ValueError('Original cast level did not select expected original range lane')
            rank_controls.append({'castLevel':level,'selectedArrayIndex':max(level,0),
                                  'suppliedRangeArray':range_values,'originalLoadedRange':rank_observations[0]})
    finally:
        n.u.hook_del(observer)
    height_offset_cases = []
    controller, constructor_spec = n.allocate(0x200), n.allocate(0x100)
    for base in [row for row in projection_cases if row['suppliedRange'] == 750.]:
        for height_offset in [-37.25,37.25]:
            n.u.mem_write(controller+0x7c,bytes.fromhex(base['positionHex']))
            n.put(constructor_spec+0x10,'f',height_offset)
            n.call(0x88a155,{r.UC_X86_REG_RBX:controller,r.UC_X86_REG_R15:constructor_spec},0x88a16b)
            height_offset_cases.append({**base,'initialTargetHeightOffset':height_offset,
                                        'positionHex':bytes(n.u.mem_read(controller+0x7c,12)).hex()})
    if bytes(n.u.mem_read(height_at,len(heights))) != heights:
        raise ValueError('Original endpoint altered installed navgrid samples')
    blocks = []
    for start, end in [(0x82ad3c,0x82ad43),(0x82b3af,0x82b3b2),(0x82b563,0x82b584),
                       (0x82a1c8,0x82a22e),(0x8b01d0,0x8b0460),(0x2a8060,0x2a809e),
                       (0x873e70,0x874080),(0x8489a0,0x8489f6),(0x8490b0,0x8490e2),
                       (0x8b1e70,0x8b1e89),(0x88a020,0x88a18c),(0x88a770,0x88a88c),
                       (0x148a750,0x148a7ae),(0x16ba3b0,0x16ba419),
                       (0x20ca4a8,0x20ca4ac),(0x20ca4d0,0x20ca4d4),
                       (0x84b390,0x84b4cb),(0x84c150,0x84c164),(0x84b640,0x84b66b),
                       (0x8b247c,0x8b24f3)]:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Original endpoint source bytes differ')
        blocks.append({'startRva': start, 'endRva': end, 'sha256': sha(n.image[start:end])})
    for module in tuple(sys.modules.values()):
        path = getattr(module, '__file__', None)
        if path and Path(path).suffix == '.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):
            raw(path)
    raw(args.client)
    raw(cache/'public/decoder-16.21-macos/profile.json')
    raw(cache/'public/decoder-16.21-macos/image.bin')
    for path, digest in inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Endpoint input drift: '+path)
    result = {'schema': 1, 'kind': 'original-projected-endpoint-source-input-research',
              'build': report['build'], 'protocol': report['protocol'], 'inputs': inputs,
              'cases': cases, 'slotDecode': column, 'originalBlocks': blocks,
              'projectionCases': projection_cases,
              'heightOffsetCases': height_offset_cases,
              'rankControls': rank_controls,
              'extraSpellSlotMapping': extra_slot_mapping,
              'initialAssignmentCatalogObservation':initial_assignment_observation,
              'slotRangeGetterControls': getter_controls,
              'slotRangeGetterScope': {'originalSlotConstructorCompleted': True,
                                       'originalMatcherAndGetterReturned': True,
                                       'matchingAndMismatchingBindingsSupplied': True,
                                       'recordedLiveSlotBindingRecovered': False,
                                       'positiveDynamicRangeOverrideChangesResult': True},
              'originalMinimumRange': struct.unpack_from('<f',n.image,0x20ca4a8)[0],
              'originalNormalizationThreshold': struct.unpack_from('<f',n.image,0x20ca4d0)[0],
              'projectionScope': {'explicitSuppliedRangeControl': True, 'originalFullHelperReturned': True,
                                  'suppliedDescriptorOverridesMatchPackets': False,
                                  'actualCasterSpellbookStateRecovered': False,
                                  'initialTerrainHeightQueryExecuted': True,
                                  'falseGroundFlagAndAuthoredTargetYDoNotBypassInitialTerrain': True},
              'scope': {'actualPacketSlotCompared': True, 'dynamicSpellRangeGetterRecovered': False,
                        'projectionFormulaCompared': False, 'actualEndpointAdmitted': False,
                        'nativeMatchAcceptance': None, 'browserObserved': False}}
    target = cache/'research/projected-missile-endpoint-native-v35.json'
    target.write_text(json.dumps(result, indent=2))
    print(json.dumps({'output': str(target), 'slots': [{'sequence': row['sequence'],
          'normalizedSlot154': row['normalizedSlot154'], 'spellbookIndex': row['originalSpellbookLookupIndex']}
          for row in cases], 'projectionControls': len(projection_cases), 'inputs': len(inputs)}), flush=True)


if __name__ == '__main__':
    main()
