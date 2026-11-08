"""Original network lookup and CastInfo target conversion on an owned AI unit.

The unit's network ID and visibility bytes are explicit controls. This is not
recorded entity acceptance; deferred targets stop at their original branch.
"""
import argparse
import inspect
import json
from pathlib import Path
import struct
import unicorn

from unicorn import x86_const as r
from native_ai_unit_fixture import NativeAIUnitFixture
from vfx_spawn_native import sha, ADDRESSES


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cache', type=Path)
    parser.add_argument('client', type=Path)
    args = parser.parse_args()
    fixture = NativeAIUnitFixture(args.cache, args.client)
    n = fixture.native
    for start, end in [(0x13774f, 0x1377b4), (0xdb497, 0xdb4fc)]:
        n.call(start, {r.UC_X86_REG_RSP: ADDRESSES['stack'] - 8}, end)
    unit = fixture.construct_ai()
    world = n.allocate(0x268)
    n.u.mem_write(world + 0x168, b'\xa5' * 0x100)
    n.call(0x54a4d0, {r.UC_X86_REG_RDI: world})
    visibility_configuration = n.allocate(0x1c0)
    n.call(0x624060, {r.UC_X86_REG_RDI: visibility_configuration})
    if n.q(n.base + 0x24705d0) != visibility_configuration or n.u32(visibility_configuration + 8) != 0:
        raise ValueError('Original visibility configuration default differs')
    network_id = 0x4000003d
    # Supply an explicit pre-registration network field. The full original
    # local/world registration owns both map insertion and generation handle.
    n.put(unit + 0x78, 'I', network_id)
    n.call(0x549f30, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: unit})
    internal_id = n.u32(unit + 0x20)
    if not internal_id or n.q(unit + 0xe8) != world:
        raise ValueError('Original owned AI world registration failed')
    for function, identity in [(0x548f00, network_id), (0x54b0a0, internal_id)]:
        n.call(function, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: identity})
        if n.u.reg_read(r.UC_X86_REG_RAX) != unit:
            raise ValueError('Original world network/local identity bridge differs')
    output, context = n.allocate(0x40), n.allocate(0x40)
    cast = n.allocate(0x200)
    n.put(cast + 0x108, 'Q', output)
    n.put(cast + 0x110, 'I', 1)
    clock_manager, clock_view = n.allocate(0x20), n.allocate(0x20)
    n.put(clock_manager + 0x10, 'Q', clock_view)
    n.put(n.base + 0x246d000, 'Q', clock_manager)
    clock_calls = []
    def clock_control(uc, address, size, user):
        if uc.reg_read(r.UC_X86_REG_RDI) != clock_view:
            raise ValueError('Target holder clock request escaped its owned input view')
        clock_calls.append({'rva': address - n.base, 'suppliedFloat32Time': 0.0})
        uc.reg_write(r.UC_X86_REG_XMM0, 0)
        n.ret()
    n.u.hook_add(unicorn.UC_HOOK_CODE, clock_control,
                 begin=n.base+0x15ed8e0, end=n.base+0x15ed8e0)
    flag_at = n.base + 0x2562969
    original_flag = bytes(n.u.mem_read(flag_at, 1))
    if original_flag != b'\x00':
        raise ValueError('Original ordinary target predicate control requires a clear bypass flag')
    predicate_control = None
    n.put(unit + 0x201, 'B', 1)
    n.put(unit + 0x208, 'B', 0)
    try:
        n.call(0xc9090, {r.UC_X86_REG_RDI: unit})
        predicate_control = {'completed': True, 'result': n.u.reg_read(r.UC_X86_REG_RAX) & 255}
    except Exception as error:
        predicate_control = {'completed': False, 'error': str(error),
            'rva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base}
    print(json.dumps({'originalPredicateControl': predicate_control}), flush=True)
    rows = []
    for visible in [0, 1]:
        n.put(unit + 0x201, 'B', visible)
        n.call(0xc9090, {r.UC_X86_REG_RDI: unit})
        predicate = bool(n.u.reg_read(r.UC_X86_REG_RAX) & 255)
        if predicate != bool(visible):
            raise ValueError('Original controlled ordinary target predicate differs')
        for identity in [network_id, 0, 0x80000001, 0xffffffff]:
            n.u.mem_write(output, bytes(0x40))
            status = fixture.run_to(0x82c850, 0x82c901,
                {r.UC_X86_REG_RDI: context, r.UC_X86_REG_RSI: identity,
                 r.UC_X86_REG_RDX: context, r.UC_X86_REG_RCX: output}, allow_return=True)
            accepted = status == 'handler-returned'
            if accepted != bool(identity == network_id and visible) or n.u32(output) != (internal_id if accepted else 0):
                raise ValueError('Original converter network-to-internal target result differs')
            if bytes(n.u.mem_read(output + 8, 16)) != bytes(16):
                raise ValueError('Original accepted target unexpectedly owns a weak reference')
            identity_hops = None
            if accepted:
                n.call(0x829cd0, {r.UC_X86_REG_RDI: cast})
                initial_id = n.u.reg_read(r.UC_X86_REG_EAX)
                n.call(0x829ca0, {r.UC_X86_REG_RDI: cast})
                selected_unit = n.u.reg_read(r.UC_X86_REG_RAX)
                if initial_id != internal_id or selected_unit != unit:
                    raise ValueError('Original converted CastInfo target selectors differ')
                controller, missile, frame = n.allocate(0xd8), n.allocate(0x400), n.allocate(0x300)
                pointer = controller ^ 0x453b8f8b
                pointer = ((((pointer << 53) | (pointer >> 11)) + 0x453b8f8b) & ((1 << 64)-1)) ^ 0x496e69c7
                n.put(missile + 0x340, 'Q', pointer)
                frame += 0x200
                n.put(frame - 0x48, 'Q', cast)
                n.call(0x87a311, {r.UC_X86_REG_RBP: frame, r.UC_X86_REG_R14: missile}, 0x87a38e)
                holder = n.q(controller + 0x28)
                if (n.u32(controller + 0xa8) != network_id or n.u32(controller + 0xa4) != internal_id or
                    n.allocations.get(holder) != 0x44 or n.u32(holder) != internal_id):
                    raise ValueError('Original replication target route differs from its accepted world identity')
                identity_hops = {'initialFactoryInternalId': initial_id, 'selectedUnit': selected_unit,
                    'replicationRequestedNetworkId': n.u32(controller + 0xa8),
                    'replicationAcceptedInternalId': n.u32(controller + 0xa4),
                    'holderInternalId': n.u32(holder), 'holder': holder}
            rows.append({'requestedNetworkId': identity, 'suppliedVisibilityByte201': visible,
                'originalPredicateResult': predicate, 'acceptedInternalId': n.u32(output),
                'status': status, 'outputHex': bytes(n.u.mem_read(output, 0x20)).hex(),
                'identityHops': identity_hops})
    fixture.check_guard(unit)
    if bytes(n.u.mem_read(world + 0x168, 0x100)) != b'\xa5' * 0x100:
        raise ValueError('Original world registration escaped its owned allocation')
    ranges = [(0x82c850, 0x82c901), (0x548f00, 0x548f4b),
              (0x54b0a0, 0x54b0ca), (0xc9090, 0xc9206),
              (0x54a4d0, 0x54a5d0), (0x549f30, 0x54a300), (0x624060, 0x6241d0),
              (0x829ca0, 0x829cec), (0x865b31, 0x865b7b), (0x87a311, 0x87a38e),
              (0x88c020, 0x88c0a4), (0x88fea0, 0x88ff98), (0xc8830, 0xc8839),
              (0x13774f, 0x1377b4), (0xdb497, 0xdb4fc)]
    for a,b in ranges:
        if n.image[a:b] != n.source.image[a:b]:
            raise ValueError('Original target bridge instructions differ')
    paths = {Path(__file__), Path(inspect.getfile(NativeAIUnitFixture)),
             *[Path(inspect.getfile(c)) for c in type(n).__mro__ if c is not object]}
    report = {'schema': 1, 'kind': 'original-missile-target-world-bridge-controls',
        'build': n.profile['clientVersion'], 'protocol': n.profile['protocolDigest'],
        'decoderImageSha256': sha(n.image), 'inputs': fixture.inputs,
        'sources': {p.name: sha(p.read_bytes()) for p in sorted(paths)},
        'ranges': [{'rva': a, 'bytes': b-a, 'sha256': sha(n.image[a:b])} for a,b in ranges],
        'unit': unit, 'world': world, 'networkId': network_id, 'internalId': internal_id,
        'visibilityConfiguration': {'object': visibility_configuration, 'constructorRva': 0x624060,
                                    'modeValue': n.u32(visibility_configuration + 8)},
        'originalPredicateControl': predicate_control,
        'clockControls': clock_calls,
        'unchangedPredicateBypassByte': {'rva': 0x2562969, 'originalValueHex': original_flag.hex()},
        'cases': rows, 'scope': {'originalAiConstructor': True, 'fullOriginalWorldRegistration': True,
            'suppliedPreRegistrationNetworkField': True, 'fullOriginalAcceptedTargetConverter': True,
            'originalRejectedBranchBoundaryOnly': True, 'fullOriginalOrdinaryTargetPredicate': True,
            'originalAcceptedReplicationFragment': True, 'convertedTargetSelectors': True,
            'controllerFieldViewOnly': True, 'suppliedHolderClock': True,
            'actualRecordedPredicateInputsRecovered': False,
            'deferredReferenceConstruction': False, 'actualReplayEntityAccepted': False,
            'actualMatchAdmissionChanged': False}}
    output_path = fixture.cache / 'research/missile-target-bridge-native.json'
    output_path.write_text(json.dumps(report, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output_path), 'cases': len(rows), 'networkId': network_id,
                      'internalId': internal_id}))


if __name__ == '__main__':
    main()
