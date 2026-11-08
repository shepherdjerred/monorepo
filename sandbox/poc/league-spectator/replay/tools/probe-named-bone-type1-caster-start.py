"""Original type1 named-bone start using an explicit supplied pose-query view.

The full start helper, name hashing, installed rig construction/key lookup and
terrain queries execute original code. The live render-model lookup at118a50
is a controlled provider boundary; no native model-ready state is invented.
"""
import argparse
import json
import math
from pathlib import Path
import struct
import sys

import unicorn
from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from animation_rig_native import NativeAnimationRig, POSES, OUTPUT
from ai_hero_stack_native import NativeHeroStackProbe
from ai_client_native import NativeAIClientInputs
from libcpp_shared_native import NativeLibcppSharedOwnership
from ai_hero_type_native import initialize_hero_client_types
from mode_dependency_types_native import initialize_mode_dependency_types
from process_arguments_native import initialize_product_configuration
from vfx_spawn_native import sha, ADDRESSES


class Control(NativeHeroStackProbe, NativeLibcppSharedOwnership, NativeAIClientInputs):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    parser.add_argument('--fixture-cache', type=Path, default=Path('.cache/replay-spike'))
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.fixture_cache, args.client, Control)
    n, cache = fixture.native, args.cache.resolve()
    raw, read = fixture.raw, fixture.read
    source = read(cache/'research/named-bone-type1-caster-inputs-v37.json')
    if source['kind'] != 'current-causal-named-bone-type1-caster-inputs':
        raise ValueError('Current named-bone world query input required')
    for path, digest in source['inputs'].items():
        if sha(raw(Path(path))) != digest:
            raise ValueError('Current named-bone source changed: '+path)
    scene = read(cache/'public/latest-scene/manifest.json')
    heights = raw(cache/'public/latest-scene/heights.bin')
    n.initialize_character_types()
    n.call(0x665f24, {}, 0x665f51)
    n.initialize_audio_facade()
    n.initialize_ui_data_prefix()
    initialize_product_configuration(n, 'LoL')
    initialize_mode_dependency_types(n)
    initialize_hero_client_types(n, reuse_existing=True)
    unit, world = n.allocate(0x4aa0), n.allocate(0x268)
    n.call(0x154c10, {r.UC_X86_REG_RDI: unit})
    n.call(0x54a4d0, {r.UC_X86_REG_RDI: world})
    owner_id = source['cases'][0]['record']['cast']['ownerId']
    n.put(unit+0x78, 'I', owner_id)
    n.call(0x549f30, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: unit})
    internal = n.u32(unit+0x20)
    if not internal or n.q(n.base+0x24722c0) != world:
        raise ValueError('Original owned caster world registration failed')
    manager, grid, height_at = n.allocate(0x20), n.allocate(0x200), n.allocate(len(heights))
    n.put(manager+8, 'Q', grid)
    n.put(n.base+0x246c948, 'Q', manager)
    n.put(grid+0xbc, 'fff', *scene['map']['min'])
    n.put(grid+0xc8, 'fff', *scene['map']['max'])
    n.put(grid+0xf8, 'Q', height_at)
    dimensions = scene['map']['heightGrid']
    n.put(grid+0x100, 'IIff', dimensions['x'], dimensions['z'], *dimensions['step'])
    n.u.mem_write(height_at, heights)
    f = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]
    vector = lambda at: list(struct.unpack('<fff', n.u.mem_read(at, 12)))
    rig_row = next(row['rig'] for row in source['cases'] if row['pose']['resolved'])
    rig_raw = raw(cache/'public/latest-scene'/rig_row['rigFile'])
    if sha(rig_raw) != rig_row['rigSha256']:
        raise ValueError('Exact installed named rig bytes required')
    catalog_raw = raw(cache/'public/latest-scene'/rig_row['catalogFile'])
    if sha(catalog_raw) != rig_row['catalogSha256']:
        raise ValueError('Exact source rig catalog required')
    rig = NativeAnimationRig(cache/'public/decoder-16.21-macos', args.client)
    constructed = rig.prepare(rig_raw, json.loads(catalog_raw)['joints'])
    joint = next(joint for joint in constructed['joints'] if joint['resolvedBoneKey'] == source['cases'][0]['rig']['binding']['resolvedBoneKey'])
    supplied = {'present': True}
    provider_calls = []

    def pose_query(engine, address, size, user):
        if engine.reg_read(r.UC_X86_REG_RDI) != unit:
            raise ValueError('Original start queried a different supplied caster')
        key, output = engine.reg_read(r.UC_X86_REG_ESI), engine.reg_read(r.UC_X86_REG_RDX)
        rig.u.mem_write(OUTPUT, b'\xa5'*40)
        rig.call(0x157f590, {r.UC_X86_REG_RDI: ADDRESSES['actor'], r.UC_X86_REG_RSI: key, r.UC_X86_REG_RDX: OUTPUT})
        found = bool(rig.u.reg_read(r.UC_X86_REG_AL))
        transform = bytes(rig.u.mem_read(OUTPUT, 40))
        if found:
            engine.mem_write(output, transform[:12])
        elif transform != b'\xa5'*40:
            raise ValueError('Missing original rig key altered caller output')
        provider_calls.append({'providerBoundaryRva': address-n.base, 'key': key, 'found': found,
                               'nativeRigQueryRva': 0x157f590, 'transformHex': transform.hex() if found else None})
        engine.reg_write(r.UC_X86_REG_RAX, int(found))
        n.ret()

    n.u.hook_add(unicorn.UC_HOOK_CODE, pose_query, begin=n.base+0x118a50, end=n.base+0x118a50)
    visits = []

    def branch(engine, address, size, user):
        visits.append(address-n.base)

    for entry in [0x874dd0, 0x874e50, 0x874bb0]:
        n.u.hook_add(unicorn.UC_HOOK_CODE, branch, begin=n.base+entry, end=n.base+entry)
    cases = []
    mask = (1 << 64)-1
    ror = lambda value, shift: ((value >> shift) | (value << (64-shift))) & mask
    for row in source['cases']:
        if not row['pose']['resolved']:
            continue
        record, attachment = row['record'], row['pose']['attachments'][0]
        if record['cast']['ownerId'] != owner_id or row['rig']['binding']['resolvedBoneKey'] != joint['resolvedBoneKey'] or attachment['nativePoseIndex'] != joint['nativePoseIndex']:
            raise ValueError('Exact causal source rig/name/pose identity required')
        root, bone = row['root']['position'], attachment['position']
        controls = [
            ('actual-causal-pose', root, bone, row['sourceBoneName']),
            ('root-only-translation', [root[i]+[17,33,-29][i] for i in range(3)], bone, row['sourceBoneName']),
            ('bone-height-only', root, [bone[0], bone[1]+37, bone[2]], row['sourceBoneName']),
            ('root-and-bone-translation', [root[i]+[17,33,-29][i] for i in range(3)], [bone[i]+[17,33,-29][i] for i in range(3)], row['sourceBoneName']),
            ('missing-installed-bone', root, bone, '__missing_named_caster_bone__'),
        ]
        for angle in [-math.pi/2, math.pi/2]:
            moved = [root[i]+[17,33,-29][i] for i in range(3)]
            dx, dz = bone[0]-root[0], bone[2]-root[2]
            controls.append((f'supplied-root-and-pose-yaw-{angle}', moved,
                             [moved[0]+math.cos(angle)*dx+math.sin(angle)*dz, bone[1]+33,
                              moved[2]-math.sin(angle)*dx+math.cos(angle)*dz], row['sourceBoneName']))
        for label, supplied_root, supplied_bone, name in controls:
            supplied_root, supplied_bone = list(map(f, supplied_root)), list(map(f, supplied_bone))
            rig.put(POSES+joint['nativePoseIndex']*40, '10f', *supplied_bone, *attachment['quaternion'], *attachment['hierarchyScale'])
            n.put(unit+0x15c, 'fff', *supplied_root)
            cast, descriptor, string, resource, handle = n.allocate(0x200), n.allocate(0x40), n.allocate(0x40), n.allocate(0x900), n.allocate(0x100)
            n.put(cast+8, 'Q', ror(handle ^ 0x3dc9cb21, 21))
            n.put(handle+0x80, 'Q', (ror(resource, 17)-0x80104765) & mask)
            n.put(resource+0x3f0, 'I', row['settings']['castType'])
            n.put(resource+0x4b0, 'fff', *row['settings']['particleStartOffset'])
            n.put(cast+0x98, 'I', internal)
            n.put(cast+0xc8, 'fff', *record['cast']['sourcePosition'])
            n.put(cast+0xd4, 'fff', *record['cast']['targetPosition'])
            n.put(cast+0x134, 'f', record['cast']['overrideScalar134'])
            n.put(cast+0x14d, 'B', record['cast']['overrideFlag14d'])
            n.put(cast+0x150, 'B', int(record['cast']['forceRecordedSourcePosition']))
            n.call(0x8658e4, {r.UC_X86_REG_R14: cast, r.UC_X86_REG_R15: 0x80104765,
                             r.UC_X86_REG_R12: 0, r.UC_X86_REG_RBP: ADDRESSES['stack']+0x1000}, 0x86596b)
            ground_rebase, offset = bool(n.u.reg_read(r.UC_X86_REG_R12) & 255), n.u.reg_read(r.UC_X86_REG_RBX)
            if ground_rebase or vector(offset) != [0,0,0]:
                raise ValueError('Original type1 selector did not select no rebase and zero offset')
            n.call(0x14c2d60, {r.UC_X86_REG_RDI: string, r.UC_X86_REG_RSI: n.allocate_text(name)})
            n.call(0x874b30, {r.UC_X86_REG_RDI: descriptor, r.UC_X86_REG_RSI: int(ground_rebase), r.UC_X86_REG_RDX: string})
            visits.clear()
            provider_calls.clear()
            n.call(0x874b60, {r.UC_X86_REG_RDI: descriptor, r.UC_X86_REG_RSI: cast, r.UC_X86_REG_RDX: 0, r.UC_X86_REG_RCX: offset})
            if visits != [0x874dd0] or len(provider_calls) != 1:
                raise ValueError('Original named start branch/terrain path differs')
            if provider_calls[0]['found'] != (name == row['sourceBoneName']):
                raise ValueError('Original named rig lookup/missing-key control differs')
            cases.append({'sequence': row['sequence'], 'sourceEventId': row['sourceEventId'], 'label': label,
                          'root': supplied_root, 'bone': supplied_bone, 'boneName': name, 'record': record, 'settings': row['settings'],
                          'position': vector(descriptor), 'planeHeightOffset': struct.unpack('<f', n.u.mem_read(descriptor+12, 4))[0],
                          'attachmentHeightOffset': struct.unpack('<f', n.u.mem_read(descriptor+16, 4))[0],
                          'groundRebase': ground_rebase, 'providerCalls': list(provider_calls), 'originalBranches': list(visits)})
    blocks = []
    for start, end in [(0x8658e4,0x86599c),(0x874b30,0x874e99),(0x144b3a0,0x144b3f6),(0x157f590,0x157f7f0)]:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Original named start instruction bytes changed')
        blocks.append({'startRva':start,'endRva':end,'sha256':sha(n.image[start:end])})
    for module in tuple(sys.modules.values()):
        path = getattr(module, '__file__', None)
        if path and Path(path).suffix == '.py' and Path(path).resolve().is_relative_to(Path(__file__).resolve().parent):
            raw(Path(path))
    raw(args.client)
    for path, digest in fixture.inputs.items():
        if sha(Path(path).read_bytes()) != digest:
            raise ValueError('Named start proof input changed: '+path)
    output = cache/'research/named-bone-type1-caster-start-native-v37.json'
    output.write_text(json.dumps({'schema':1,'kind':'original-named-bone-type1-start-supplied-pose-controls',
        'build':source['build'],'protocol':source['protocol'],'inputs':fixture.inputs,'originalBlocks':blocks,
        'rig':{'rigFile':rig_row['rigFile'],'rigSha256':rig_row['rigSha256'],'joints':len(constructed['joints']),'joint':joint},
        'cases':cases,'omitted':[{'sequence':row['sequence'],'reasons':row['pose']['reasons']} for row in source['cases'] if not row['pose']['resolved']],
        'scope':{'fullOriginalStartHelperAndSelector':True,'originalNameHashExecuted':True,'originalInstalledRigKeyLookup':True,
        'originalCasterConstructorAndWorldRegistration':True,'suppliedCausalWorldBonePose':True,
        'controlledLiveModelQueryBoundaryRva':0x118a50,'nativeLiveModelLookupExecuted':False,'nativeLiveModelReady':False,
        'nativeRootOrientationProducerRecovered':False,'nativeMatchPoseRecovered':False,'activeFamilyAdmission':False}},indent=2))
    print(json.dumps({'output':str(output),'cases':len(cases),'found':sum(c['providerCalls'][0]['found'] for c in cases),'joints':len(constructed['joints'])}))


if __name__ == '__main__':
    main()
