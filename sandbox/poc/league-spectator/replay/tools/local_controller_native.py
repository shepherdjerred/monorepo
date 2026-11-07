"""Original local-controller construction with an explicit disk-log policy."""
import unicorn
from unicorn import x86_const as r

COMPLETE_STARTUP = 'complete-startup'
CONSTRUCTOR_WITHOUT_LOG_WORKERS = 'constructor-without-disk-log-workers'


def guard_local_controller_log_queues(n, controller):
    if n.allocations.get(controller) != 0x640:
        raise ValueError('Owned constructed controller storage required for log guard')
    begin, end = controller + 0x248, controller + 0x3d8
    read, write = n.u.mem_read, n.u.mem_write
    n.local_controller_log_accesses = []

    def reject(operation, address, size):
        if size and address < end and address + size > begin:
            n.local_controller_log_accesses.append({'operation': operation,
                'address': address, 'bytes': size,
                'instructionRva': n.u.reg_read(r.UC_X86_REG_RIP) - n.base})
            raise ValueError('Native dependency accessed controller disk-log queues without post-init')

    def guarded_read(address, size):
        reject('host-read', address, size)
        return read(address, size)

    def guarded_write(address, data):
        reject('host-write', address, len(data))
        return write(address, data)

    def guest_access(engine, access, address, size, value, user):
        reject('guest-read' if access == unicorn.UC_MEM_READ else 'guest-write', address, size)

    # Host ABI adapters bypass guest hooks. Ranged guest hooks also match the
    # access start, so observe the whole object, including accesses that start
    # before a queue and straddle its boundary. The callback tests full overlap.
    n.u.mem_read, n.u.mem_write = guarded_read, guarded_write
    for mode in [unicorn.UC_HOOK_MEM_READ, unicorn.UC_HOOK_MEM_WRITE]:
        n.u.hook_add(mode, guest_access, begin=controller, end=controller + 0x640 - 1)
    return {'begin': begin, 'endExclusive': end,
            'observedGuestObjectBegin': controller,
            'observedGuestObjectEndExclusive': controller + 0x640,
            'guestAndHostMemoryAccessRejected': True}


def initialize_local_controller(n, *, policy=COMPLETE_STARTUP):
    if policy not in [COMPLETE_STARTUP, CONSTRUCTOR_WITHOUT_LOG_WORKERS]:
        raise ValueError('Explicit original local-controller startup policy required')
    archives = n.q(n.base + 0x246d7b0)
    if n.q(n.base + 0x2470b70) or n.q(n.base + 0x24713b8) or not archives or not n.u32(archives + 0x50):
        raise ValueError('Original local-controller startup requires cold globals')
    full = policy == COMPLETE_STARTUP
    # The complete constructor and original global publication precede the
    # component's disk-log post-init. This is an explicit observation boundary,
    # never a substituted return or a successful log/job readiness result.
    n.call(0x6ff430, {}, None if full else 0x6ff46f)
    controller, settings = n.q(n.base + 0x2470b70), n.q(n.base + 0x24713b8)
    if (n.allocations.get(controller) != 0x640 or n.allocations.get(settings) != 0x48 or
            n.q(controller) != n.base + 0x234c570 or n.q(settings) != n.base + 0x234b9e8 or
            n.u.mem_read(controller + 0x44b, 1)[0] != n.u.mem_read(n.base + 0x2566b30, 1)[0]):
        raise ValueError('Original local-controller startup allocation/publication differs')
    header = bytes(n.u.mem_read(controller, 0x640)).hex()
    n.local_controller_log_accesses = []
    guard = None
    if not full:
        guard = guard_local_controller_log_queues(n, controller)
    return {'object': controller, 'settings': settings, 'policy': policy,
            'originalStartupRva': 0x6ff430, 'originalConstructorRva': 0x6fb580,
            'originalSettingsConstructorRva': 0x6b6b50,
            'originalComponentPostInitializerRva': 0x6fbd70,
            'selectedSlotByte': n.u.mem_read(controller + 0x44b, 1)[0],
            'constructorSlotSourceRva': 0x2566b30,
            'headerHex': header,
            'settingsHex': bytes(n.u.mem_read(settings, 0x48)).hex(),
            'gameFieldsSupplied': False, 'fullPostInitializationExecuted': full,
            'originalConstructorAndPublicationExecuted': True,
            'originalPrefixEndRva': None if full else 0x6ff46f,
            'omittedLogQueueGuard': guard,
            'omissions': [] if full else ['local-controller:disk-log-worker-post-init-not-executed'],
            'replayClientSelectionRecovered': False, 'acceptedReplayEntities': False}
