import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from maintenance import files, skylands_transfer as transfer
from maintenance.skylands import MARKER


class SkylandsTransferTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.data = Path(temporary.name).resolve()
        fixture = {
            "world/level.dat": b"production metadata",
            str(transfer.DIMENSION / "data/minecraft/world_gen_settings.dat"): b"native settings",
            str(transfer.DIMENSION / "region/r.0.0.mca"): b"original terrain",
            str(transfer.DIMENSION / "entities/r.0.0.mca"): b"native entities",
            str(transfer.DIMENSION / "poi/r.0.0.mca"): b"native poi",
            str(transfer.DIMENSION / "session.lock"): b"lock",
            "world/playerdata/player.dat": b"real inventory",
            "world/dimensions/minecraft/frontier/region/r.0.0.mca": b"frontier",
            "plugins/TheStorm/the-storm.db": b"real database",
        }
        for name, value in fixture.items():
            path = self.data / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(value)
        (self.data / MARKER).write_text(json.dumps({"world": "skylands", "seed": 1731, "format": "layered-v1"}))

    def candidate(self):
        payload = transfer.export_world(self.data, "candidate")
        (payload / transfer.DIMENSION / "region/r.0.0.mca").write_bytes(b"finished towers")
        return payload, transfer.manifest_digest(transfer.validate_payload(payload))

    def test_export_is_complete_and_excludes_other_worlds_and_inventories(self):
        payload = transfer.export_world(self.data, "export")
        names = transfer.validate_payload(payload)
        self.assertIn(str(transfer.DIMENSION / "poi/r.0.0.mca"), names)
        self.assertIn(str(transfer.DIMENSION / "entities/r.0.0.mca"), names)
        self.assertFalse(any("frontier" in name or "playerdata" in name or "session.lock" in name or name.endswith(".db") for name in names))
        before = files.files(payload)
        transfer.export_world(self.data, "export")
        self.assertEqual(files.files(payload), before)

    def test_install_preserves_everything_outside_skylands_and_keeps_original(self):
        payload, digest = self.candidate()
        (payload / "world/level.dat").write_bytes(b"local parent settings must not be installed")
        digest = transfer.manifest_digest(transfer.validate_payload(payload))
        before = files.files(self.data / "world/playerdata")
        transfer.install_world(self.data, "candidate", digest)
        self.assertEqual((self.data / transfer.DIMENSION / "region/r.0.0.mca").read_bytes(), b"finished towers")
        self.assertEqual((self.data / "world/level.dat").read_bytes(), b"production metadata")
        self.assertEqual(files.files(self.data / "world/playerdata"), before)
        self.assertEqual((self.data / "plugins/TheStorm/the-storm.db").read_bytes(), b"real database")
        self.assertEqual((self.data / "world/dimensions/minecraft/frontier/region/r.0.0.mca").read_bytes(), b"frontier")
        self.assertEqual((transfer.transfer_root(self.data, "candidate") / "original-dimension/region/r.0.0.mca").read_bytes(), b"original terrain")
        # A reboot must not reinstall the candidate over subsequent live edits.
        (self.data / transfer.DIMENSION / "region/r.0.0.mca").write_bytes(b"later live edits")
        transfer.install_world(self.data, "candidate", digest)
        self.assertEqual((self.data / transfer.DIMENSION / "region/r.0.0.mca").read_bytes(), b"later live edits")
        # A completed request must remain inert when the incoming payload is retired.
        (payload / transfer.DIMENSION / "region/r.0.0.mca").unlink()
        transfer.install_world(self.data, "candidate", digest)
        self.assertEqual((self.data / transfer.DIMENSION / "region/r.0.0.mca").read_bytes(), b"later live edits")

        (self.data / transfer.DIMENSION / "data/minecraft/world_gen_settings.dat").unlink()
        with self.assertRaisesRegex(ValueError, "refuse regeneration"):
            transfer.install_world(self.data, "candidate", digest)

    def test_bad_digest_or_payload_cannot_change_live_world(self):
        payload, digest = self.candidate()
        with self.assertRaisesRegex(ValueError, "reviewed manifest"):
            transfer.install_world(self.data, "candidate", "0" * 64)
        (payload / transfer.DIMENSION / "region/r.0.0.mca").write_bytes(b"unreviewed edits")
        with self.assertRaisesRegex(ValueError, "reviewed manifest"):
            transfer.install_world(self.data, "candidate", digest)
        self.assertEqual((self.data / transfer.DIMENSION / "region/r.0.0.mca").read_bytes(), b"original terrain")

    def test_interrupted_rename_resumes_without_losing_original(self):
        _, digest = self.candidate()
        rename = Path.rename

        def interrupt(source, destination):
            if source.name == ".skylands-candidate":
                raise OSError("interrupted after original was retained")
            return rename(source, destination)

        with patch.object(Path, "rename", interrupt), self.assertRaisesRegex(OSError, "interrupted"):
            transfer.install_world(self.data, "candidate", digest)
        self.assertFalse((self.data / transfer.DIMENSION).exists())
        transfer.install_world(self.data, "candidate", digest)
        self.assertEqual((self.data / transfer.DIMENSION / "region/r.0.0.mca").read_bytes(), b"finished towers")

    def test_rejects_links_traversal_and_unexpected_files(self):
        with self.assertRaisesRegex(ValueError, "request ID"):
            transfer.export_world(self.data, "../outside")
        payload, _ = self.candidate()
        (payload / "world/playerdata").mkdir()
        (payload / "world/playerdata/test.dat").write_bytes(b"test player")
        with self.assertRaisesRegex(ValueError, "outside Skylands"):
            transfer.validate_payload(payload)
        link = self.data / transfer.DIMENSION / "region/link.mca"
        link.symlink_to(self.data / "world/level.dat")
        with self.assertRaisesRegex(ValueError, "linked"):
            transfer.export_world(self.data, "linked-export")

    def test_request_is_strict_and_none_does_not_create_anything(self):
        request = self.data / "request.json"
        request.write_text('{"operation":"none"}')
        transfer.run_request(self.data, request)
        self.assertFalse((self.data / files.WORKSPACE).exists())
        request.write_text('{"operation":"export","id":"x","extra":true}')
        with self.assertRaisesRegex(ValueError, "Unknown"):
            transfer.run_request(self.data, request)

    def test_export_request_only_runs_on_its_identified_volume(self):
        marker = self.data / ".the-storm-retired-worlds.json"
        marker.write_bytes(b"production volume identity")
        request = self.data / "request.json"
        value = {"operation": "export", "id": "scoped", "volumeDigest": "0" * 64}
        request.write_text(json.dumps(value))
        transfer.run_request(self.data, request)
        self.assertFalse((self.data / files.WORKSPACE).exists())
        value["volumeDigest"] = files.digest(marker)
        request.write_text(json.dumps(value))
        transfer.run_request(self.data, request)
        self.assertTrue((transfer.transfer_root(self.data, "scoped") / "export.json").is_file())


if __name__ == "__main__":
    unittest.main()
