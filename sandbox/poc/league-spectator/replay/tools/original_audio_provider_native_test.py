"""Preserve already-owned presentation state at native startup boundaries."""
from types import SimpleNamespace
import unittest
from original_audio_provider_native import initialize_original_audio_configuration, initialize_original_audio_providers


class OriginalAudioStartupOwnership(unittest.TestCase):
    def test_configuration_rejects_existing_ui_or_audio_before_mutation(self):
        for offset in [0x246d010, 0x246d500]:
            with self.subTest(offset=offset):
                reads = []
                def read(at):
                    reads.append(at)
                    if at not in [0x246d010, 0x246d500]:
                        raise AssertionError('Read past existing native owner')
                    return 0x20000000 if at == offset else 0
                native = SimpleNamespace(base=0, q=read)
                output = {}
                with self.assertRaisesRegex(ValueError, 'naturally cold UI and audio'):
                    initialize_original_audio_configuration(native, output)
                self.assertEqual(output, {})
                self.assertIn(offset, reads)

    def test_provider_rejects_missing_complete_configuration_before_facade_access(self):
        native = SimpleNamespace(base=0)
        output = {}
        with self.assertRaisesRegex(ValueError, 'Complete original configuration'):
            initialize_original_audio_providers(native, output)
        self.assertEqual(output, {})


if __name__ == '__main__':
    unittest.main()
