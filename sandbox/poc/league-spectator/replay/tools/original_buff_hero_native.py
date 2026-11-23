"""Fresh original concrete hero ownership for scoped BuffManager controls."""
from types import SimpleNamespace
import unicorn
from unicorn import x86_const as r
from animation_provider_native import construct_animation_hero
from ai_hero_type_native import initialize_hero_client_types
from game_object_type_native import initialize_game_object_runtime_types
from ai_material_owner_type_native import initialize_ai_material_owner_type
from recorded_mode_constants_native import install_recorded_mode_constants, reject_unresolved_mode_reads
from vfx_spawn_native import ADDRESSES, sha


def initialize_original_buff_hero_context(fixture, mode_input):
    n = fixture.native
    mode = install_recorded_mode_constants(fixture, mode_input)
    setup = {'modeConstants': mode, 'gameObjectRuntimeTypes': initialize_game_object_runtime_types(n)}
    start, end = 0x13774f, 0x1377b4
    if n.image[start:end] != n.source.image[start:end]:
        raise ValueError('Original AI parent-runtime descriptor source block differs')
    reused = bool(n.u32(n.base+0x248e550+8))
    if not reused:
        n.call(start, {r.UC_X86_REG_RSP: ADDRESSES['stack']-8}, end=end)
    if (n.u32(n.base+0x248e550+8) != 0x2092043f or n.q(n.base+0x248e550+0x38) != n.base+0x24bdcd8 or
            n.q(n.base+0x248e550+0x40) != 0xb08):
        raise ValueError('Original AI parent-runtime descriptor identity/parent/extent differs')
    setup['aiParentRuntimeType'] = {'sourceBlock': [start, end], 'sourceSha256': sha(n.image[start:end]),
                                     'existingOriginalDescriptorRetained': reused}
    setup['aiMaterialOwnerType'] = initialize_ai_material_owner_type(n)
    setup['heroTypes'] = initialize_hero_client_types(n, reuse_existing=True)
    return setup


def construct_original_buff_hero(fixture, context):
    n = fixture.native
    with reject_unresolved_mode_reads(n, context['modeConstants']):
        unit = construct_animation_hero(SimpleNamespace(native=n))
    manager = unit+0x25b8
    # 831b00 clears +8. It is bound later by 831d80 through the original
    # world local-index lookup; the complete concrete constructor is not that
    # admission path and must not be advertised as an already bound owner.
    if n.q(manager)-n.base != 0x235a270 or n.q(manager+8):
        raise ValueError('Original cold concrete hero BuffManager class/empty owner differs')
    return {'object': unit, 'originalConstructorRva': 0x154c10, 'objectBytes': 0x49a0,
            'buffManager': manager, 'buffManagerVtableRva': n.q(manager)-n.base,
            'buffVectorEmpty': n.q(manager+0x18) == n.q(manager+0x20),
            'buffOwnerBound': False,
            'originalAnimationOwnerCastCompleted': True, 'snapshotRestored': False,
            'acceptedReplayEntity': False}


def bind_original_control_buff_hero(fixture, context, hero):
    """Original local admission and manager binding of an explicit cold control.

    This uses the original caller's local-ID and virtual-property loads. No
    recorded network identity or unit fields are supplied by the harness.
    """
    n = fixture.native
    unit, manager = hero['object'], hero['buffManager']
    if (n.q(n.base+0x24722c0) or n.q(manager+8) or n.u32(unit+0x20) or
            n.q(unit+0xe8) or n.u32(unit+0x78)):
        raise ValueError('Original world and cold control-unit identities must be unowned')
    spans = [(0x831b00, 0x831b4e), (0xbcfab, 0xbcfdb),
             (0xc8d37, 0xc8d58), (0x831d80, 0x831de0)]
    for start, end in spans:
        if n.image[start:end] != n.source.image[start:end]:
            raise ValueError('Original BuffManager construction/binding source differs')
    world = n.allocate(0x268)
    n.u.mem_write(world+0x168, b'\xa5'*0x100)
    with reject_unresolved_mode_reads(n, context['modeConstants']):
        n.call(0x54a4d0, {r.UC_X86_REG_RDI: world})
        if n.q(n.base+0x24722c0) != world:
            raise ValueError('Original local-world constructor did not publish its owner')
        n.call(0x549f30, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: unit})
        local_id = n.u32(unit+0x20)
        if not local_id or n.q(unit+0xe8) != world or n.u32(world+0x14) != 1:
            raise ValueError('Original control-unit local admission differs')
        n.call(0x54b0a0, {r.UC_X86_REG_RDI: world, r.UC_X86_REG_RSI: local_id})
        if n.u.reg_read(r.UC_X86_REG_RAX) != unit:
            raise ValueError('Original local-world lookup did not recover its control unit')
        # Observe the exact stop even inside a cached translated block. n.call
        # owns/reset its registers, so the caller's RBX is an explicit input.
        stop = n.base+0xc8d58
        hook = n.u.hook_add(unicorn.UC_HOOK_CODE,
                            lambda engine, address, size, user: engine.emu_stop(),
                            begin=stop, end=stop)
        try:
            n.call(0xc8d37, {r.UC_X86_REG_RBX: unit}, end=0xc8d58)
            if n.u.reg_read(r.UC_X86_REG_RIP) != stop:
                raise ValueError('Original BuffManager caller did not reach its exact boundary')
        finally:
            n.u.hook_del(hook)
    if (n.q(manager+8) != unit or n.u32(manager+0x10) != local_id or
            n.u32(unit+0x78) or bytes(n.u.mem_read(world+0x168, 0x100)) != b'\xa5'*0x100):
        raise ValueError('Original BuffManager owner/local identity or world guard differs')
    return {'world': world, 'unit': unit, 'manager': manager, 'localId': local_id,
            'worldConstructorRva': 0x54a4d0, 'localAdmissionRva': 0x549f30,
            'bindingCaller': [0xc8d37, 0xc8d58], 'bindingCalleeRva': 0x831d80,
            'registrationCalleeRva': 0x83f8b0,
            'sources': [{'startRva': start, 'endRva': end, 'sha256': sha(n.image[start:end])}
                        for start, end in spans],
            'networkIdentityAssigned': False, 'acceptedReplayEntity': False,
            'buffMembershipAdmitted': False}
