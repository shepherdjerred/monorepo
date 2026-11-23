import json
from pathlib import Path
import tempfile
import unittest
from scene_metadata_output import SceneMetadataOutput, digest


class SceneMetadataOutputTests(unittest.TestCase):
    def setUp(self):
        cache = (Path.cwd()/'.cache'/'scene-metadata-tests').resolve()
        cache.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=cache)
        if not Path(self.temporary.name).resolve().is_relative_to(cache):
            raise ValueError('Test temporary directory escaped its workspace cache')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.package, self.scene, self.output = [self.root/name for name in ['decoder', 'scene', 'derived']]
        self.package.mkdir()
        self.scene.mkdir()
        self.image = b'explicit test fixture image'
        (self.package/'image.bin').write_bytes(self.image)
        self.profile = json.dumps({'clientVersion': '16.21.829.8620', 'protocolDigest': '20e09df23c66b85e', 'decoderImageSha256': digest(self.image)}).encode()
        (self.package/'profile.json').write_bytes(self.profile)
        (self.scene/'manifest.json').write_text('{}')

    def writer(self):
        return SceneMetadataOutput(self.package, self.scene, self.output, self.output/'evidence.json')

    def test_writes_only_derived_definition_receipt_and_evidence(self):
        writer = self.writer()
        authority = writer.publish('animation-clock.json', b'{"derived":true}', 'atomic-clocks')
        writer.write_evidence(b'{"observations":[]}')
        self.assertEqual((self.package/'profile.json').read_bytes(), self.profile)
        self.assertEqual((self.package/'image.bin').read_bytes(), self.image)
        self.assertFalse((self.package/'animation-clock.json').exists())
        self.assertEqual(authority['baseProfileSha256'], digest(self.profile))
        self.assertEqual(authority['imageSha256'], digest(self.image))
        self.assertEqual((self.output/'evidence.json').read_bytes(), b'{"observations":[]}')

    def test_rejects_input_overlap_and_evidence_escape(self):
        for output in [self.package, self.package/'nested', self.root, self.scene/'nested']:
            with self.assertRaisesRegex(ValueError, 'disjoint'):
                SceneMetadataOutput(self.package, self.scene, output, output/'evidence.json')
        with self.assertRaisesRegex(ValueError, 'evidence'):
            SceneMetadataOutput(self.package, self.scene, self.output, self.package/'profile.json')

    def test_rejects_image_relabel_and_changed_consumed_inputs(self):
        writer = self.writer()
        graph = self.scene/'graph.json'
        graph.write_text('{"original":true}')
        writer.read(graph)
        graph.write_text('{"changed":true}')
        with self.assertRaisesRegex(ValueError, 'changed'):
            writer.publish('animation-clock.json', b'{}', 'atomic-clocks')
        (self.package/'image.bin').write_bytes(b'other image')
        with self.assertRaisesRegex(ValueError, 'authority differs'):
            self.writer()

    def test_rejects_native_inventory_mutation_and_stale_outputs(self):
        writer = self.writer()
        (self.package/'new.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'inventory changed'):
            writer.publish('animation-clock.json', b'{}', 'atomic-clocks')
        (self.package/'new.json').unlink()
        writer.publish('animation-clock.json', b'{}', 'atomic-clocks')
        with self.assertRaisesRegex(ValueError, 'already exists'):
            writer.publish('animation-clock.json', b'{}', 'atomic-clocks')

    def test_selected_scene_requires_its_exact_closed_resources(self):
        graph = self.scene/'graph.json'
        graph.write_bytes(b'{}')
        (self.scene/'manifest.json').write_text(json.dumps({'kind':'archived-map11-common-runtime-scene','files':[{'path':'graph.json','bytes':2,'sha256':digest(b'{}')}]}))
        writer = self.writer()
        self.assertEqual(writer.read_scene('graph.json'), b'{}')
        graph.write_bytes(b'[]')
        with self.assertRaisesRegex(ValueError, 'changed'):
            writer.read_scene('graph.json')
        with self.assertRaisesRegex(ValueError, 'escaped'):
            writer.read_scene('../decoder/profile.json')


if __name__ == '__main__':
    unittest.main()
