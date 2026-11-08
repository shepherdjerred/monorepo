"""Original RelativeTeamColors startup service used by appearance index lookup.

Option registration links the service to RelativeTeamColors; its formal C++
class name is stripped. Constructor defaults do not recover replay-client
settings. This module does not enable a mode or replace a lookup callback.
"""
from unicorn import x86_const as r
from vfx_spawn_native import ADDRESSES

SERVICE_GLOBAL = 0x246cae0
SECONDARY_GLOBAL = 0x2472430


def initialize_relative_team_colors(n):
    if n.q(n.base + SERVICE_GLOBAL) or n.q(n.base + SECONDARY_GLOBAL):
        raise ValueError('Original index-remapping service must be cold')
    stack = ADDRESSES['stack'] - 8
    n.put(stack, 'Q', ADDRESSES['stop'])
    n.call(0x665f08, {r.UC_X86_REG_RSP: stack}, 0x665f24)
    service, secondary = n.q(n.base + SERVICE_GLOBAL), n.q(n.base + SECONDARY_GLOBAL)
    if (n.allocations.get(service) != 0x40 or n.q(service) != n.base + 0x2316378 or
            n.allocations.get(secondary) != 0x98 or n.q(secondary) != n.base + 0x2316a78 or
            bytes(n.u.mem_read(service + 0x28, 3)) != bytes(3)):
        raise ValueError('Original index-remapping service allocation, class or defaults differ')
    before, heap = bytes(n.u.mem_read(service, 0x40)), n.next_heap
    defaults = []
    for entry in [0x2e1aa0, 0x2e1a90, 0x2e1a70]:
        n.call(entry, {r.UC_X86_REG_RDI: service})
        result = n.u.reg_read(r.UC_X86_REG_RAX) & 0xff
        if result != 0 or n.next_heap != heap or bytes(n.u.mem_read(service, 0x40)) != before:
            raise ValueError('Original service getter changed default state or returned nonzero')
        defaults.append({'entryRva': entry, 'result': result})
    return {'object': service, 'secondaryObject': secondary,
            'originalInlineBlock': [0x665f08, 0x665f24], 'constructorRva': 0x2e1820,
            'globalRva': SERVICE_GLOBAL, 'secondaryGlobalRva': SECONDARY_GLOBAL,
            'headerHex': before.hex(), 'getters': defaults,
            'defaultFlagsSuppliedByHost': False, 'lookupCallbacksReplaced': False,
            'optionName': 'RelativeTeamColors', 'formalClassNameRecovered': False,
            'replaySettingsRecovered': False, 'runtimeOverridesRecovered': False,
            'optionRegistrationRva': 0xd0ca13, 'optionCallbackRva': 0xd123b0,
            'acceptedReplayEntities': False}
