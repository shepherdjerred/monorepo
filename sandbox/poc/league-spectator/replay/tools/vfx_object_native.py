"""Owned native VFX manager prefix and effect-object construction.

Darwin synchronization services have explicit single-thread ownership models.
No graphics, resource, world or game-loop function is replaced with a stub.
"""
import struct
import unicorn
from unicorn import x86_const as r

from vfx_system_asset_native import NativeVfxSystemAssets
from vfx_retirement_native import NativeVfxRetirement
from vfx_spawn_native import ADDRESSES as A

MANAGER = A['manager']
TASK_VALUE, TASK_ID = 0x100f8000, 1
MANAGER_PREFIX = (0x1745424, 0x17456cc)
TAG_STARTUP = (0x665f24, 0x665f51)
MUTEX_OFFSETS = {0x18, 0x190, 0x1e0, 0x240}
SEMAPHORE_OFFSETS = {0x2f8, 0x310, 0x314, 0x318, 0x31c, 0x320, 0x324, 0x328, 0x360, 0x398}
OWNED_MANAGER_BLOCKS = [
    (0x1745424, 0x1745440),  # singleton/vtable and supplied scene pointers
    (0x17454fb, 0x174552f),  # resource cache, active list and mutex
    (0x174552f, 0x174554e),  # retirement list and mutex
    (0x174554e, 0x1745581),  # pending/deferred lists, recursive mutex, tick rate
    (0x174565c, 0x1745687),  # original scalar flags, including field +0x349
    (0x17456b4, 0x17456cc),  # original pattern fill of all six multipliers
]


class NativeVfxObjects(NativeVfxSystemAssets):
    def __init__(self, *args):
        self.object_attrs, self.object_mutexes, self.object_semaphores = {}, {}, {}
        self.object_os_calls = []
        self.object_runtime_active, self.object_image_pages = False, {}
        super().__init__(*args)
        if self.source.data_imports.get(0x22e03f8) != '_mach_task_self_':
            raise ValueError('Darwin task data import changed')
        self.put(self.base + 0x22e03f8, 'Q', TASK_VALUE)
        self.put(TASK_VALUE, 'I', TASK_ID)
        self.u.hook_add(unicorn.UC_HOOK_MEM_WRITE, self.object_image_write,
            begin=self.base, end=self.base + len(self.image) - 1)

    def object_image_write(self, uc, access, address, size, value, user):
        if not self.object_runtime_active: return
        for page in range(address & ~4095, (address + size + 4095) & ~4095, 4096):
            if page not in self.object_image_pages:
                self.object_image_pages[page] = bytes(self.u.mem_read(page, min(4096, self.base + len(self.image) - page)))

    def load_prepared_system(self, graph):
        self.object_runtime_active = False
        for page, data in self.object_image_pages.items(): self.u.mem_write(page, data)
        self.object_image_pages = {}
        self.object_attrs, self.object_mutexes, self.object_semaphores, self.object_os_calls = {}, {}, {}, []
        self.load_system([])
        root, heap = bytes.fromhex(graph['objectHex']), bytes.fromhex(graph['heapHex'])
        start = graph['heapStart']
        if (graph['rootType'] != 0x45cd899f or len(root) != 0x160 or start != self.baseline_heap or
                start + len(heap) > 0x12000000 or graph['pendingLinkFixups'] or graph['ignored'] or graph['mismatched'] or graph['mathCalls']):
            raise ValueError('Unsupported complete root for object factory')
        self.u.mem_write(A['definition'], root)
        self.u.mem_write(start, heap)
        self.next_heap = start + len(heap)
        self.object_runtime_active = True
        self.object_addresses = []

    def create_object(self):
        self.call(0x174b760, {r.UC_X86_REG_RDI: MANAGER, r.UC_X86_REG_RSI: A['definition'], r.UC_X86_REG_RDX: 0})
        address = self.u.reg_read(r.UC_X86_REG_RAX)
        if self.allocations.get(address) != 0x238: raise ValueError('Original effect object allocation changed')
        self.object_addresses.append(address)
        return address

    def set_scalars(self, address, first_bits, second_bits):
        if address not in self.object_addresses: raise ValueError('Unowned effect object')
        for at, value in [(0x1767120, first_bits), (0x1755ea0, second_bits)]:
            self.call(at, {r.UC_X86_REG_RDI: address, r.UC_X86_REG_XMM0: value})

    def mark_ready(self, address):
        if address not in self.object_addresses: raise ValueError('Unowned effect object')
        self.call(0x1765950, {r.UC_X86_REG_RDI: address})

    def observe_objects(self):
        pointer, count, capacity = struct.unpack('<QII', self.u.mem_read(MANAGER + 0x230, 16))
        queued = list(struct.unpack('<' + 'Q' * count, self.u.mem_read(pointer, count * 8))) if count else []
        if queued != self.object_addresses or capacity < count or any(value['depth'] for value in self.object_mutexes.values()):
            raise ValueError('Effect object queue or synchronization differs')
        return {'managerHex': bytes(self.u.mem_read(MANAGER, 0x3a8)).hex(), 'queue': queued, 'capacity': capacity,
            'objects': [{'address': address, 'bytesHex': bytes(self.u.mem_read(address, 0x238)).hex()} for address in queued],
            'osCalls': list(self.object_os_calls), 'mutexes': self.object_mutexes}

    def imported(self, uc, address, size, user):
        name = self.source.imports[address - self.base]
        first = self.u.reg_read(r.UC_X86_REG_RDI)
        second = self.u.reg_read(r.UC_X86_REG_RSI)
        call = {'name': name}
        if name == '_memset_pattern16':
            count = self.u.reg_read(r.UC_X86_REG_RDX)
            if count > 0x100000 or not 0x10000000 <= first <= 0x12000000 - count or not self.library_pointer(second, 16):
                raise ValueError('Pattern fill exceeds owned memory')
            pattern = bytes(self.u.mem_read(second, 16))
            if count: self.u.mem_write(first, (pattern * ((count + 15) // 16))[:count])
            call.update({'destination': first, 'source': second, 'count': count, 'patternHex': pattern.hex()})
        elif name in ['_pthread_mutexattr_init', '_pthread_mutexattr_settype', '_pthread_mutexattr_destroy']:
            if not A['stack'] - 0x8000 <= first <= A['stack'] - 8:
                raise ValueError('Unowned mutex attribute storage')
            if name == '_pthread_mutexattr_init':
                if first in self.object_attrs: raise ValueError('Duplicate live mutex attributes')
                self.object_attrs[first] = 0
            elif first not in self.object_attrs:
                raise ValueError('Mutex attributes not initialized')
            elif name == '_pthread_mutexattr_settype':
                if second != 2: raise ValueError('Unadmitted Darwin mutex type')
                self.object_attrs[first] = 2
            else:
                del self.object_attrs[first]
            call.update({'attributes': first, 'argument': second})
        elif name in ['_pthread_mutex_init', '_pthread_mutex_lock', '_pthread_mutex_unlock'] and first - MANAGER in MUTEX_OFFSETS:
            if name == '_pthread_mutex_init':
                if first in self.object_mutexes or (second and second not in self.object_attrs):
                    raise ValueError('Invalid manager mutex initialization')
                self.object_mutexes[first] = {'recursive': bool(second and self.object_attrs[second] == 2), 'depth': 0}
            else:
                if first not in self.object_mutexes: raise ValueError('Uninitialized manager mutex')
                mutex = self.object_mutexes[first]
                if name == '_pthread_mutex_lock':
                    if mutex['depth'] and not mutex['recursive']: raise ValueError('Nonrecursive mutex reentry')
                    mutex['depth'] += 1
                else:
                    if mutex['depth'] == 0: raise ValueError('Unlock of unowned manager mutex')
                    mutex['depth'] -= 1
            call.update({'mutex': first, 'depth': self.object_mutexes[first]['depth']})
        elif name == '_semaphore_create':
            policy = self.u.reg_read(r.UC_X86_REG_RDX)
            initial = self.u.reg_read(r.UC_X86_REG_RCX)
            if first != TASK_ID or second - MANAGER not in SEMAPHORE_OFFSETS or second in self.object_semaphores or policy != 0 or initial != 0:
                raise ValueError(f'Unadmitted owned semaphore creation: task={first:x}, offset={second-MANAGER:x}, policy={policy}, count={initial}')
            token = 0x70000001 + len(self.object_semaphores)
            self.object_semaphores[second] = {'token': token, 'count': initial}
            self.put(second, 'I', token)
            call.update({'taskInput': first, 'destination': second, 'policy': policy, 'initialCount': initial, 'token': token})
        else:
            return super().imported(uc, address, size, user)
        self.object_os_calls.append(call)
        self.u.reg_write(r.UC_X86_REG_RAX, 0)
        self.ret()

    def fragment(self, start, end, registers):
        return NativeVfxRetirement.fragment(self, start, end, registers)

    def initialize_manager_prefix(self, scene_input=0):
        if self.object_mutexes or self.object_semaphores or self.object_attrs:
            raise ValueError('Manager prefix already initialized')
        self.u.mem_write(MANAGER, bytes([0xa5]) * 0x3a8)
        self.fragment(*TAG_STARTUP, {})
        self.fragment(*MANAGER_PREFIX, {r.UC_X86_REG_RDI: MANAGER, r.UC_X86_REG_RSI: scene_input,
            r.UC_X86_REG_RBP: A['stack'] - 8, r.UC_X86_REG_RSP: A['stack'] - 0xe8})
        if self.object_attrs or any(value['depth'] for value in self.object_mutexes.values()):
            raise ValueError('Manager initialization leaked synchronization ownership')
        return {'managerHex': bytes(self.u.mem_read(MANAGER, 0x3a8)).hex(), 'osCalls': list(self.object_os_calls),
            'mutexes': self.object_mutexes, 'semaphores': self.object_semaphores}

    def initialize_owned_manager(self, quality, graphics34b, scene_input=0):
        if self.object_mutexes or self.object_semaphores or self.object_attrs:
            raise ValueError('Owned manager components already initialized')
        if quality not in [0, 1, 2, 3] or type(graphics34b) is not bool:
            raise ValueError('Explicit manager quality and graphics field required')
        self.u.mem_write(MANAGER, bytes([0xa5]) * 0x3a8)
        self.fragment(*TAG_STARTUP, {})
        for block in OWNED_MANAGER_BLOCKS:
            self.fragment(*block, {r.UC_X86_REG_RDI: MANAGER, r.UC_X86_REG_RSI: scene_input,
                r.UC_X86_REG_RBX: MANAGER, r.UC_X86_REG_XMM0: 0,
                r.UC_X86_REG_RBP: A['stack'] - 8, r.UC_X86_REG_RSP: A['stack'] - 0xe8})
        self.put(MANAGER + 0x29c, 'B', quality)
        self.put(MANAGER + 0x34b, 'B', graphics34b)
        if self.object_attrs or any(value['depth'] for value in self.object_mutexes.values()):
            raise ValueError('Owned manager components leaked synchronization ownership')
        return {'managerHex': bytes(self.u.mem_read(MANAGER, 0x3a8)).hex(), 'osCalls': list(self.object_os_calls),
            'mutexes': self.object_mutexes, 'semaphores': self.object_semaphores,
            'completeManagerConstructorExecuted': False, 'workerPoolExecuted': False}
