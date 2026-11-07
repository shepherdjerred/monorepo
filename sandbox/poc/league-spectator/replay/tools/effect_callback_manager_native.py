"""Original map-scoped effect callback manager construction and post-init."""
from unicorn import x86_const as r


def initialize_effect_callback_manager(n, startup):
    config = n.q(n.base + 0x246d020)
    skin = n.q(n.base + 0x246cc38)
    archives = n.q(n.base + 0x246d7b0)
    if (not startup or not startup['scope']['actualRecordedPacket'] or
            startup['configurationObject'] != config or not config or not skin or
            n.q(n.base + 0x246cb48) or not archives or not n.u32(archives + 0x50)):
        raise ValueError('Cold callback manager, original recorded map configuration/skin and registered archives required')
    n.call(0x620900, {r.UC_X86_REG_RDI: config})
    map_id = n.u.reg_read(r.UC_X86_REG_EAX)
    if map_id != startup['mapId'] or n.u32(skin + 0x20) != map_id:
        raise ValueError('Original callback manager map argument differs from recorded configuration')
    # Exact map-bootstrap allocation, constructor, publication, and complete
    # post-init sequence. The original functions populate rules/listeners; no
    # empty tables or callbacks are supplied in place of authored map inputs.
    n.call(0x60c601, {r.UC_X86_REG_R13: map_id}, 0x60c628)
    manager = n.q(n.base + 0x246cb48)
    if (n.allocations.get(manager) != 0xf0 or
            n.q(manager) != n.base + 0x231c1e8 or
            n.u32(manager + 0x18) != map_id or
            n.q(manager + 0x30) > 4096 or
            n.q(manager + 0xd8) or n.q(manager + 0xe0) or n.q(manager + 0xe8)):
        raise ValueError('Original callback manager publication/layout differs')
    rule_count = n.q(manager + 0x30)
    if ((not rule_count and (n.q(manager + 0x20) != manager + 0x28 or n.q(manager + 0x28))) or
            rule_count and not n.library_pointer(n.q(manager + 0x28), 0x40)):
        raise ValueError('Original authored callback rule tree escaped its bounded storage')
    for cell_offset, owner_offset, target in [(8, 0x10, manager), (0x68, 0x70, manager + 0x68)]:
        cell, owner = n.q(manager + cell_offset), n.q(manager + owner_offset)
        if (n.allocations.get(cell) != 8 or n.q(cell) != target or
                n.allocations.get(owner) != 0x20 or n.q(owner + 0x18) != cell):
            raise ValueError('Original callback manager shared owner differs')
    return {'object': manager, 'bytes': 0xf0, 'mapId': map_id,
            'configurationObject': config, 'mapSkinContext': skin,
            'archiveManager': archives,
            'originalMapGetterRva': 0x620900,
            'originalStartupBlock': [0x60c601, 0x60c628],
            'originalConstructorRva': 0x36c110,
            'originalConstructorThunkRva': 0x36c2d0,
            'originalCompletePostInitializerRva': 0x36c2e0,
            'originalEnqueueRva': 0x36cfc0,
            'fullPostInitializationExecuted': True,
            'ruleCount': n.q(manager + 0x30),
            'filterCount': n.u32(manager + 0x40),
            'listenerCount': n.q(manager + 0x88),
            'pendingListenerRegistrationCount': (n.q(manager + 0x98) - n.q(manager + 0x90)) // 0x28,
            'headerHex': bytes(n.u.mem_read(manager, 0xf0)).hex(),
            'gameFieldsSupplied': False, 'callbackSubstituted': False,
            'queuedCallbacksExecuted': False, 'acceptedReplayState': False}
