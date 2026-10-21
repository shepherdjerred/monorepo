import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import creative_activation as activation
import creative_install
import restoration_backup
import restoration_files as storage
from restoration_json import JsonObject


class CreativeActivationTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.archive = self.root / "archive"
        (self.archive / "region").mkdir(parents=True)
        (self.archive / "level.dat").write_bytes(b"verified level metadata")
        region = self.archive / "region/r.0.-1.mca"
        region.write_bytes(b"verified region")
        (self.archive / "playerdata").mkdir()
        (self.archive / "playerdata/old.dat").write_bytes(b"must never import")
        self.before = self.root / "worlds.yml"
        self.before.write_text("world:\n  version: 1.3\n  auto-load: true\n")
        self.jar = self.root / "TheStorm.jar"
        self.jar.write_bytes(b"exact pinned candidate")
        proof = JsonObject(
            {
                "schemaVersion": 1,
                "status": "VERIFIED",
                "requestId": "3e5117f2-3f1b-46f6-a41c-2d9fb22026dc",
                "backupUid": "backup-uid",
                "sourceVolumeUid": "source-volume",
                "restoredVolumeUid": "independent-volume",
                "files": {
                    "world/level.dat": "a" * 64,
                    "plugins/TheStorm/the-storm.db": "b" * 64,
                    creative_install.REGISTRY: storage.digest(self.before),
                },
            }
        )
        self.proof = self.root / "whole-proof.json"
        self.proof.write_text(json.dumps(proof))
        self.control = JsonObject(
            {
                "phase": "LEASED_OFFLINE",
                "admissionProbes": "UPDATE_SCALE_AND_DELETE_DENIED",
                "requestId": proof.string("requestId"),
                "volumeUid": "source-volume",
                "candidateImage": "docker.io/shepherdjerred/the-storm-server:fixture@sha256:" + "a" * 64,
                "backup": {"uid": "backup-uid"},
                "restore": {
                    "phase": "Completed",
                    "byteVerification": "VERIFIED",
                    "volumeUid": "independent-volume",
                    "proofPath": str(self.proof),
                    "proofSha256": storage.digest(self.proof),
                },
            }
        )
        encoded = storage.digest(region) + "  r.0.-1.mca\n"
        constants = patch.multiple(
            activation,
            LEVEL_SHA256=storage.digest(self.archive / "level.dat"),
            REGIONS_SHA256=hashlib.sha256(encoded.encode()).hexdigest(),
            REGION_COUNT=1,
            REGION_BYTES=region.stat().st_size,
        )
        constants.start()
        self.addCleanup(constants.stop)
        self.staging = self.root / "staging"

    def prepare(self):
        return activation.prepare(self.staging, self.archive, self.before, self.control, self.jar)

    def test_plan_preserves_registry_and_excludes_old_player_data(self):
        plan = self.prepare()
        self.assertEqual(plan.string("scope"), "additive-creative")
        self.assertNotIn("creative/playerdata/old.dat", plan.strings("files"))
        after = activation.registry((self.staging / "payload" / creative_install.REGISTRY).read_bytes())
        self.assertEqual(after.object("world"), {"version": 1.3, "auto-load": True})
        self.assertEqual(after["creative"], activation.CREATIVE_ENTRY)
        self.assertEqual(after.object("creative").string("gamemode"), "creative")
        self.assertEqual(activation.plan(self.staging, self.control, self.jar), plan)

    def test_foreign_proof_pending_verification_and_missing_lease_refuse_a_plan(self):
        self.prepare()
        original = copy.deepcopy(self.control)
        for mutation in ("backup", "request", "verification", "lease"):
            self.control = copy.deepcopy(original)
            if mutation == "backup":
                self.control.object("backup")["uid"] = "foreign"
            elif mutation == "request":
                self.control["requestId"] = "foreign"
            elif mutation == "verification":
                self.control.object("restore")["byteVerification"] = "PENDING"
            else:
                self.control["admissionProbes"] = "UNVERIFIED"
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                activation.plan(self.staging, self.control, self.jar)

    def test_additive_install_preserves_other_worlds_without_authorizing_their_export(self):
        proof = JsonObject.parse(self.proof.read_bytes())
        retained = "world/dimensions/minecraft/frontier/region/r.0.0.mca"
        proof.strings("files")[retained] = "c" * 64
        self.proof.write_text(json.dumps(proof))
        self.control.object("restore")["proofSha256"] = storage.digest(self.proof)
        plan = self.prepare()
        self.assertEqual(plan.strings("originalFiles")[retained], "c" * 64)
        self.assertNotIn(retained, plan.strings("files"))
        with self.assertRaisesRegex(ValueError, "unreviewed native dimension"):
            restoration_backup.whole_proof(self.proof, storage.digest(self.proof))

    def test_additive_install_refuses_invalid_complete_file_manifest(self):
        proof = JsonObject.parse(self.proof.read_bytes())
        proof.strings("files")["../outside"] = "c" * 64
        self.proof.write_text(json.dumps(proof))
        self.control.object("restore")["proofSha256"] = storage.digest(self.proof)
        with self.assertRaisesRegex(ValueError, "Invalid sealed file"):
            self.prepare()

    def test_modified_terrain_or_removed_existing_world_is_refused(self):
        self.prepare()
        region = self.staging / "payload/creative/region/r.0.-1.mca"
        original = region.read_bytes()
        region.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "region inventory"):
            activation.plan(self.staging, self.control, self.jar)
        region.write_bytes(original)
        replacement = self.staging / "payload" / creative_install.REGISTRY
        replacement.write_text(json.dumps({"creative": activation.CREATIVE_ENTRY}))
        with self.assertRaisesRegex(ValueError, "preserve every existing world"):
            activation.plan(self.staging, self.control, self.jar)

    def test_linked_terrain_and_foreign_registry_export_are_refused(self):
        region = self.archive / "region/r.0.-1.mca"
        region.unlink()
        region.symlink_to(self.jar)
        with self.assertRaisesRegex(ValueError, "cannot be linked"):
            self.prepare()
        self.assertFalse(self.staging.exists())
        region.unlink()
        region.write_bytes(b"verified region")
        self.before.write_text("world: {}\n")
        with self.assertRaisesRegex(ValueError, "registry export"):
            self.prepare()

    def test_existing_seed_and_comments_are_preserved_byte_for_byte(self):
        original = b"# existing native world\nworld:\n  read-only:\n    seed: -7243611913275695533\n"
        self.before.write_bytes(original)
        proof = json.loads(self.proof.read_text())
        proof["files"][creative_install.REGISTRY] = storage.digest(self.before)
        self.proof.write_text(json.dumps(proof))
        self.control.object("restore")["proofSha256"] = storage.digest(self.proof)
        self.prepare()
        replacement = self.staging / "payload" / creative_install.REGISTRY
        self.assertTrue(replacement.read_bytes().startswith(original))
        self.assertIn(b"seed: -7243611913275695533\n", replacement.read_bytes())
        # These integers round to the same JavaScript Number; byte preservation
        # must reject the change even when the YAML parser cannot distinguish it.
        replacement.write_bytes(replacement.read_bytes().replace(b"-7243611913275695533", b"-7243611913275695534"))
        with self.assertRaisesRegex(ValueError, "preserve every existing world"):
            activation.plan(self.staging, self.control, self.jar)

    def test_existing_creative_and_non_appendable_registries_are_refused(self):
        for original in (b"creative: {}\n", b"minecraft:creative: {}\n"):
            with self.subTest(original=original), self.assertRaisesRegex(ValueError, "already declares creative"):
                activation.extended_registry(original)
        for original in (b'{"world": {}}\n', b"world: {}\n...\n"):
            with self.subTest(original=original), self.assertRaises(ValueError):
                activation.extended_registry(original)


if __name__ == "__main__":
    unittest.main()
