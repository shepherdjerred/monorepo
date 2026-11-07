"""Original appearance-message argument decoding before unit callbacks.

The unit is an owned routing control. No appearance/resource callback is
substituted or executed; the message prefix stops before the virtual call.
"""
import struct
from unicorn import x86_const as r
from unit_base_context_native import NativeUnitBaseContexts

PACKET, FRAME = 0x10200000, 0x100f5000
SPECS = {
    984: {'start': 0xf7721, 'end': 0xf7b72, 'objectSize': 136,
          'fields': {
              'entryId': (0x80, 4, 'RSI'), 'skinId': (0x68, 4, 'RCX'),
              'alternateSkinA': (0x78, 4, 8), 'alternateSkinB': (0x70, 4, 10),
              'gearIndex': (0x6d, 1, 6), 'overrideMask': (0x7c, 1, 11),
              'flagR8': (0x74, 1, 'R8'), 'flagR9': (0x6f, 1, 'R9'),
              'flagStack0': (0x10, 1, 0), 'preloadFlag': (0x6c, 1, 1),
              'flagStack2': (0x7d, 1, 2), 'flagStack3': (0x6e, 1, 3)}},
    459: {'start': 0xf7b94, 'end': 0xf7c6d, 'objectSize': 24,
          'fields': {'entryId': (0x14, 4, 'RSI'), 'popFlagR8': (0x10, 1, 'R8')}},
    1045: {'start': 0xf7c84, 'end': 0xf7ca8, 'objectSize': 20,
           'fields': {'clearFlag': (0x10, 1, 'RSI')}},
    965: {'start': 0xf7cca, 'end': 0xf7d19, 'objectSize': 20,
          'fields': {'sourceEntityId': (0x10, 4, 'RSI')}},
}
BOOLEANS = {'flagR8', 'flagR9', 'flagStack0', 'preloadFlag', 'flagStack2',
            'flagStack3', 'popFlagR8', 'clearFlag'}


class NativeAppearanceStackInputs(NativeUnitBaseContexts):
    def __init__(self, *args):
        super().__init__(*args)
        self.routing_unit = self.create_unit()['object']

    def arguments(self, opcode, data):
        spec = SPECS[opcode]
        if len(data) != spec['objectSize']:
            raise ValueError('Exact appearance packet object size required')
        self.u.mem_write(PACKET, data)
        self.u.mem_write(FRAME-0x100, bytes(0x100))
        self.put(FRAME-0x50, 'Q', self.routing_unit)
        self.call(spec['start'], {r.UC_X86_REG_R14: PACKET, r.UC_X86_REG_RSI: PACKET,
                                r.UC_X86_REG_RDI: self.routing_unit, r.UC_X86_REG_RBP: FRAME}, spec['end'])
        stack = self.u.reg_read(r.UC_X86_REG_RSP)
        fields = {}
        for name, (offset, width, output) in spec['fields'].items():
            value = self.u.reg_read(getattr(r, 'UC_X86_REG_'+output)) if isinstance(output, str) else self.q(stack+output*8)
            fields[name] = bool(value & 255) if name in BOOLEANS else value & ((1 << (8*width))-1)
        return fields

    def string(self, pointer, length, heap_length):
        if not 0 <= length <= 4096:
            raise ValueError('Appearance string length exceeds explicit bound')
        if 0x10200000 <= pointer and pointer+length+1 <= 0x10200000+heap_length:
            source = bytes(self.u.mem_read(pointer, length+1))
        elif length == 0 and self.base <= pointer < self.base+len(self.image):
            source = bytes(self.u.mem_read(pointer, 1))
        else:
            raise ValueError('Appearance string outside original decoded arena/static empty string')
        if not source or source[-1] != 0 or b'\0' in source[:-1]:
            raise ValueError('Appearance string terminator differs')
        return source[:-1].decode('utf-8', errors='strict')

    def record(self, opcode, observation):
        obj, heap = bytes.fromhex(observation['object']), bytes.fromhex(observation['heap'])
        if (observation['status'] != 'complete' or len(obj) != SPECS[opcode]['objectSize'] or
                struct.unpack_from('<H', obj, 8)[0] != opcode or heap[:len(obj)] != obj):
            raise ValueError('Complete original appearance packet required')
        self.u.mem_write(PACKET, heap)
        result = self.arguments(opcode, obj)
        if opcode == 984:
            result['strings'] = {}
            for name, offset in [('character', 0x18), ('alternateCharacterA', 0x38),
                                 ('namespace', 0x48), ('alternateCharacterB', 0x58)]:
                pointer, length = struct.unpack_from('<QI', obj, offset)
                result['strings'][name] = self.string(pointer, length, len(heap))
            pointer, count = struct.unpack_from('<QI', obj, 0x28)
            if count > 256 or count and not 0 <= pointer-PACKET <= len(heap)-count*16:
                raise ValueError('Appearance modifier vector exceeds decoded arena')
            result['modifierNames'] = []
            for index in range(count):
                text, length = struct.unpack('<QI', self.u.mem_read(pointer+index*16, 12))
                result['modifierNames'].append(self.string(text, length, len(heap)))
        return result
