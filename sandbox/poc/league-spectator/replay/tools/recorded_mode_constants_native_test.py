"""Boundary ownership tests; actual source/constructor controls remain separate."""
from types import SimpleNamespace
import unittest
import unicorn
from unicorn import x86_const as r
from recorded_mode_constants_native import install_recorded_mode_constants, reject_unresolved_mode_reads


class RecordedModeBoundaries(unittest.TestCase):
    def test_existing_provider_rejected_before_any_source_read(self):
        fixture = SimpleNamespace(native=SimpleNamespace(base=0x100000000, q=lambda at: 0x20000000))
        with self.assertRaisesRegex(ValueError, 'must be cold'):
            install_recorded_mode_constants(fixture, 'unread-input')

    def test_unresolved_host_read_rejects_overlap_and_restores_reader(self):
        engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
        engine.mem_map(0x1000, 0x2000)
        native = SimpleNamespace(u=engine)
        original = engine.mem_read
        selection = {'unresolvedModeReferences': [{'destination': 0x1800}]}
        with self.assertRaisesRegex(ValueError, 'unresolved'):
            with reject_unresolved_mode_reads(native, selection):
                self.assertEqual(bytes(engine.mem_read(0x17ff, 1)), b'\0')
                engine.mem_read(0x17ff, 2)
        self.assertEqual(engine.mem_read, original)
        self.assertEqual(bytes(engine.mem_read(0x1800, 8)), bytes(8))

    def test_original_guest_read_guard_remains_and_is_released_on_error(self):
        engine = unicorn.Uc(unicorn.UC_ARCH_X86, unicorn.UC_MODE_64)
        engine.mem_map(0x1000, 0x2000)
        # mov rax,[rdi], then a bounded stop. No modeled game instructions.
        engine.mem_write(0x1000, bytes.fromhex('488b0790'))
        engine.mem_write(0x1800, b'abcdefgh')
        engine.reg_write(r.UC_X86_REG_RDI, 0x1800)
        native = SimpleNamespace(u=engine)
        with self.assertRaisesRegex(ValueError, 'unresolved'):
            with reject_unresolved_mode_reads(native, {'unresolvedModeReferences': [{'destination': 0x1800}]}):
                engine.emu_start(0x1000, 0x1003)
        engine.emu_start(0x1000, 0x1003)
        self.assertEqual(engine.reg_read(r.UC_X86_REG_RAX), int.from_bytes(b'abcdefgh', 'little'))


if __name__ == '__main__':
    unittest.main()
