"""Synthetic boundary controls; the actual16.21 binding inventory is separate."""
import struct
import unittest
from macho_pointer_bindings import pointer_bindings


def uleb(value):
    data = bytearray()
    while True:
        byte, value = value & 127, value >> 7
        data.append(byte | (128 if value else 0))
        if not value:
            return bytes(data)


def source(stream):
    header = struct.pack('<IiiIIIII', 0xfeedfacf, 0x1000007, 3, 2, 2, 120, 0, 0)
    segment = struct.pack('<II16sQQQQiiII', 0x19, 72, b'__DATA', 0x100000000, 0x1000, 0, 0, 3, 3, 0, 0)
    dyld = struct.pack('<12I', 0x80000022, 48, 0, 0, 152, len(stream), 0, 0, 0, 0, 0, 0)
    return header+segment+dyld+stream


class MachPointerBindings(unittest.TestCase):
    def test_symbol_addend_and_native_uint64_address_wrap_are_retained(self):
        stream = b'\x51\x70'+uleb(0x80)+b'\x40first\0\x90\x80'+uleb((1 << 64)-0x80)
        stream += b'\x40second\0\x60\x7f\x90\0'
        rows = pointer_bindings(source(stream))
        self.assertEqual(rows, {0x100000080: {'symbol': 'first', 'addend': 0},
                                0x100000008: {'symbol': 'second', 'addend': -1}})

    def test_duplicate_addresses_and_outside_segment_fail(self):
        prefix = b'\x51\x70\x10\x40a\0\x90'
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            pointer_bindings(source(prefix+b'\x70\x10\x90\0'))
        with self.assertRaisesRegex(ValueError, 'escapes segment'):
            pointer_bindings(source(b'\x51\x70'+uleb(0xff9)+b'\x40a\0\x90\0'))

    def test_truncated_and_unknown_records_fail(self):
        for stream in [b'\x51\x70\x80', b'\x40unterminated', b'\xd0', b'\x70'+b'\x80'*11]:
            with self.subTest(stream=stream), self.assertRaises(ValueError):
                pointer_bindings(source(stream))
        with self.assertRaisesRegex(ValueError, 'Missing.*terminator'):
            pointer_bindings(source(b'\x51\x70\x10\x40a\0\x90'))


if __name__ == '__main__':
    unittest.main()
