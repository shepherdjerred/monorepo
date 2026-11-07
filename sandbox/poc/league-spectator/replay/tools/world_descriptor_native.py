"""Complete original descriptor factory over explicit detached input fixtures.

Character contexts and their one-entry definition maps are supplied. No decoded
entity ID is erased, no live unit stack is inferred, and no game callback is
replaced. Only the libc++ shared ownership imports are modeled here.
"""
import struct
from unicorn import x86_const as r
from world_effect_native import NativeWorldEffects
from vfx_spawn_native import ADDRESSES as A

DESCRIPTOR, AUXILIARIES, OUTPUT = 0x100ec000, 0x100ec100, 0x100ec200
TEXT, STRINGS, FRAME = 0x100ed000, 0x100ed400, 0x100ed800
SHARED_IMPORTS = {
    0x1fee4ec: '__ZNSt3__119__shared_weak_count4lockEv',
    0x1fee4e6: '__ZNSt3__119__shared_weak_count14__release_weakEv',
}


class NativeWorldDescriptors(NativeWorldEffects):
    def __init__(self, *args, **kwargs):
        self.shared_calls = []
        super().__init__(*args, **kwargs)
        for at, symbol in SHARED_IMPORTS.items():
            if self.source.imports[at] != symbol:
                raise ValueError('Descriptor standard-library binding differs')

    def original_string(self, address, value):
        if not isinstance(value, str) or not value or '\0' in value or len(value.encode('ascii')) > 1024:
            raise ValueError('A bounded ASCII context string is required')
        self.u.mem_write(TEXT, value.encode('ascii')+b'\0')
        self.u.mem_write(address, bytes(24))
        self.call(0x11fe0, {r.UC_X86_REG_RDI: address, r.UC_X86_REG_RSI: TEXT,
            r.UC_X86_REG_RDX: len(value)})

    def character_context(self, name, skin):
        if type(skin) is not int or not 0 <= skin <= 0xffffffff:
            raise ValueError('An unsigned skin identity is required')
        self.original_string(STRINGS, name)
        self.original_string(STRINGS+0x20, 'characters')
        obj = self.allocate(0x90, 0xa5)
        self.fragment(0x351910, 0x3519e7, {r.UC_X86_REG_RDI: obj,
            r.UC_X86_REG_RSI: STRINGS, r.UC_X86_REG_RDX: skin,
            r.UC_X86_REG_RCX: STRINGS+0x20, r.UC_X86_REG_R8: 0})
        decimal = str(skin).encode('ascii')
        self.u.mem_write(TEXT, decimal+b'\0')
        self.u.mem_write(FRAME-0x300, bytes(0x300))
        self.put(FRAME-0x260, 'Q', TEXT)
        self.fragment(0x351af4, 0x351b46, {r.UC_X86_REG_RBP: FRAME, r.UC_X86_REG_RBX: obj})
        return {'name': name, 'skinId': skin, 'namespace': 'characters',
            'identity': self.u32(obj+0x48), 'object': obj,
            'objectHex': bytes(self.u.mem_read(obj, 0x90)).hex(),
            'decimalAscii': decimal.decode('ascii')}

    def imported(self, uc, address, size, user):
        at = address-self.base
        if at not in SHARED_IMPORTS:
            return super().imported(uc, address, size, user)
        control = self.u.reg_read(r.UC_X86_REG_RDI)
        if self.allocations.get(control) != 0x20:
            raise ValueError('Shared ownership import requires an owned control block')
        offset = 8 if at == 0x1fee4ec else 16
        owners = struct.unpack('<q', self.u.mem_read(control+offset, 8))[0]
        if not -1 <= owners <= 65536:
            raise ValueError('Unbounded shared ownership count')
        record = {'name': SHARED_IMPORTS[at], 'control': control, 'owners': owners}
        if at == 0x1fee4ec:
            if owners != -1:
                self.put(control+8, 'q', owners+1)
            result = control if owners != -1 else 0
            self.u.reg_write(r.UC_X86_REG_RAX, result)
            record['result'] = result
            self.ret()
        elif owners > 0:
            self.put(control+16, 'q', owners-1)
            self.ret()
        elif owners == 0:
            # +18 is __get_deleter in this libc++ ABI. The final weak
            # destructor is the following virtual slot, as in the original
            # game's five-entry control-block tables.
            callback = self.q(self.q(control)+0x20)
            if not self.base <= callback < self.base+len(self.image):
                raise ValueError('Shared ownership destructor is outside original image')
            # Tail-call the original destructor with the original return address.
            record['destructorRva'] = callback-self.base
            self.u.reg_write(r.UC_X86_REG_RIP, callback)
        else:
            raise ValueError('Released weak control block reused')
        self.shared_calls.append(record)

    def initialize_descriptor_factory(self):
        world = self.initialize_world_factory()
        visibility = self.allocate(0x1c0, 0xa5)
        self.call(0x624060, {r.UC_X86_REG_RDI: visibility})
        if self.q(self.base+0x24705d0) != visibility:
            raise ValueError('Original visibility configuration was not published')
        return {**world, 'visibility': visibility,
            'visibilityHex': bytes(self.u.mem_read(visibility, 0x1c0)).hex()}

    def create_supplied_descriptor(self, name, skin, key, position, scale, rate, flags):
        self.descriptor_stage = 'context-construction'
        self.descriptor_creation = None
        if type(flags) is not int or flags & ~0xb0:
            raise ValueError('Detached descriptor fixture flags exceed observed branch scope')
        context = self.character_context(name, skin)
        resolver, table = self.allocate(24, 0xa5), self.allocate(16, 0xa5)
        self.call(0x16659b0, {r.UC_X86_REG_RDI: resolver})
        self.put(table, 'IIQ', key, 0, A['definition'])
        self.put(resolver+8, 'QII', table, 1, 1)
        self.put(context['object']+0x60, 'Q', resolver)
        self.u.mem_write(DESCRIPTOR, bytes(0xc0))
        self.put(DESCRIPTOR+8, 'I', key)
        self.put(AUXILIARIES, 'Q', context['object'])
        self.put(DESCRIPTOR+0x30, 'QQQ', AUXILIARIES, AUXILIARIES+8, AUXILIARIES+8)
        self.put(DESCRIPTOR+0x48, 'I', flags)
        self.put(DESCRIPTOR+0x54, 'fff', *position)
        self.put(DESCRIPTOR+0x78, 'ff', scale, rate)
        self.u.mem_write(OUTPUT, bytes(16))
        descriptor_hex = bytes(self.u.mem_read(DESCRIPTOR, 0xc0)).hex()
        self.shared_calls = []
        self.descriptor_stage = 'complete-factory'
        self.call(0x83ddc0, {r.UC_X86_REG_RDI: OUTPUT, r.UC_X86_REG_RSI: DESCRIPTOR})
        shared, control = self.q(OUTPUT), self.q(OUTPUT+8)
        if self.allocations.get(shared) != 8 or self.allocations.get(control) != 0x20:
            raise ValueError('Original descriptor factory did not return its owned shared pointer')
        wrapper = self.q(shared)
        obj = self.q(wrapper+0x178)
        if self.allocations.get(wrapper) != 0x268 or self.allocations.get(obj) != 0x238 or self.q(obj+0x48) != A['definition']:
            raise ValueError('Original descriptor factory created an unexpected wrapper/definition')
        if obj in self.object_addresses:
            raise ValueError('Descriptor factory reused a tracked particle object')
        self.object_addresses.append(obj)
        self.observe_objects()
        created = {'context': context, 'resolver': resolver, 'table': table,
            'descriptorHex': descriptor_hex, 'finalDescriptorHex': bytes(self.u.mem_read(DESCRIPTOR, 0xc0)).hex(),
            'shared': shared, 'control': control, 'wrapper': wrapper, 'object': obj,
            'wrapperHex': bytes(self.u.mem_read(wrapper, 0x268)).hex(),
            'objectHex': bytes(self.u.mem_read(obj, 0x238)).hex(),
            'controlHex': bytes(self.u.mem_read(control, 0x20)).hex(),
            'worldHex': bytes(self.u.mem_read(self.q(self.base+0x24722c0), 0x168)).hex(),
            'sharedCalls': list(self.shared_calls)}
        self.descriptor_creation = created
        self.descriptor_stage = 'activation'
        self.call(0x1765960, {r.UC_X86_REG_RDI: obj})
        self.descriptor_stage = 'ownership-and-placement'
        ownership = self.own_parent(obj)
        synchronization = self.synchronize_placement(obj)
        return {**created, 'ownership': ownership, 'synchronization': synchronization,
            'activatedWrapperHex': bytes(self.u.mem_read(wrapper, 0x268)).hex(),
            'initialState': self.parent_state()}
