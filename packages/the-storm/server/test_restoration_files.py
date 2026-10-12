import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import restoration_files as install
from restoration_json import JsonObject

REQUEST = "6903b19f-f4d2-42a5-91ba-6ce046562c83"
IMAGE = "ghcr.io/shepherdjerred/the-storm-server:fixture@sha256:" + "a" * 64
JAR = "b" * 64


class RestorationFilesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data, self.payload = self.root / "data", self.root / "payload"
        self.data.mkdir()
        self.payload.mkdir()
        self.write(self.data, "world/level.dat", b"modern metadata")
        self.write(self.data, "world/region/r.0.0.mca", b"modern terrain")
        self.write(self.data, "world/session.lock", b"transient lock")
        self.write(self.data, install.DATABASE, b"modern identities")
        self.write(self.data, install.DATABASE + "-wal", b"")
        self.write(self.data, "plugins/CoreProtect/database.db", b"old block logging")
        self.write(self.data, "plugins/CoreProtect/config.yml", b"logging config")
        self.write(self.data, "bluemap/web/maps/world/tile", b"old render")
        self.write(self.data, "server.properties", b"preserved runtime bootstrap")
        self.write(self.data, ".the-storm-progression-v1.json", b'{"version":1,"status":"complete"}')
        self.write(self.payload, "world/level.dat", b"historical metadata")
        self.write(self.payload, "world/region/r.0.0.mca", b"historical terrain")
        self.write(self.payload, install.DATABASE, b"restored identities")
        self.write(self.payload, "native-verification.log", b"private evidence, not deployed")
        for dimension in ("settlement", "rustworks", "rwf"):
            prefix = "world/dimensions/minecraft/" + dimension
            self.write(self.payload, prefix + "/data/paper/metadata.dat", dimension.encode())
            self.write(self.payload, prefix + "/region/r.0.0.mca", b"retained arena")
        self.original, self.manifest = install.files(self.data), install.files(self.payload)

    def write(self, root: Path, name: str, value: bytes):
        file = root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(value)

    def stage(self) -> Path:
        return install.stage(self.data, self.payload, self.manifest, self.original, REQUEST, IMAGE, JAR, "backup-uid")

    def independent_restore(self) -> Path:
        restored = self.root / "independent-restore"
        restored.mkdir()
        for name in self.original:
            self.write(restored, name, (self.data / name).read_bytes())
        self.write(restored, "world/session.lock", b"independent transient lock")
        (restored / "world").chmod(0o775)
        return restored

    def test_preparation_changes_no_live_data_and_copies_only_installation_inputs(self):
        root = self.stage()
        self.assertEqual(install.files(self.data, exclude_workspace=True), self.original)
        self.assertEqual(install.files(self.payload), self.manifest)
        self.assertEqual(install.files(root / "staged"), install.installation_manifest(self.manifest))
        self.assertFalse((root / "staged/native-verification.log").exists())
        for directory in (root / "staged").rglob("*"):
            if directory.is_dir():
                self.assertEqual(directory.stat().st_mode & 0o2777, 0o2775)
        receipt = JsonObject.parse((root / "journal.json").read_bytes())
        self.assertEqual(receipt["phase"], "STAGED")
        self.assertEqual(receipt["candidateImage"], IMAGE)
        self.assertEqual(receipt["candidateJarSha256"], JAR)
        self.assertEqual(receipt["backupUid"], "backup-uid")

    def test_commit_preserves_originals_configuration_and_starts_new_logging_epoch(self):
        root = self.stage()
        receipt = install.commit(self.data, REQUEST)
        self.assertEqual(receipt["phase"], "INSTALLED")
        self.assertEqual(receipt["coreProtectEpoch"], REQUEST)
        self.assertEqual(receipt["privateStartup"], "PENDING")
        self.assertEqual(receipt["rollback"], "REQUIRES_WHOLE_VOLUME_AND_ROLLBACK_IMAGE")
        for name, checksum in install.installation_manifest(self.manifest).items():
            self.assertEqual(install.digest(self.data / name), checksum)
        for name in ("server.properties", ".the-storm-progression-v1.json", "plugins/CoreProtect/config.yml"):
            self.assertEqual(install.digest(self.data / name), self.original[name])
        for name in (install.DATABASE + "-wal", "plugins/CoreProtect/database.db", "bluemap/web/maps/world/tile"):
            self.assertFalse((self.data / name).exists())
            self.assertEqual(install.digest(root / "original" / name), self.original[name])
        self.assertEqual((root / "original/world/session.lock").read_bytes(), b"transient lock")
        self.assertFalse((self.data / "world/session.lock").exists())
        self.assertEqual(install.files(self.payload), self.manifest)
        self.assertEqual(install.commit(self.data, REQUEST), receipt)

    def test_interrupted_renames_resume_with_exact_original_and_new_data(self):
        rename = Path.rename
        for failed_target in ("world", install.DATABASE, "plugins/CoreProtect/database.db", "bluemap"):
            with self.subTest(target=failed_target), tempfile.TemporaryDirectory() as directory:
                data = Path(directory) / "data"
                data.mkdir()
                for name in self.original:
                    self.write(data, name, (self.data / name).read_bytes())
                self.write(data, "world/session.lock", b"transient lock")
                root = install.stage(data, self.payload, self.manifest, self.original, REQUEST, IMAGE, JAR, "backup")
                failed = False
                failed_path = (data / failed_target).resolve()

                def interrupted(source: Path, destination: Path, target: Path = failed_path) -> Path:
                    nonlocal failed
                    if not failed and source == target:
                        failed = True
                        raise RuntimeError("interrupted filesystem rename")
                    return rename(source, destination)

                with patch.object(Path, "rename", interrupted), self.assertRaisesRegex(RuntimeError, "interrupted"):
                    install.commit(data, REQUEST)
                self.assertEqual(JsonObject.parse((root / "journal.json").read_bytes())["phase"], "COMMITTING")
                self.assertEqual(install.commit(data, REQUEST)["phase"], "INSTALLED")
                self.assertEqual(install.files(root / "staged"), {})

    def test_interrupted_new_target_installation_resumes(self):
        root = self.stage()
        rename = Path.rename

        def interrupted(source: Path, destination: Path) -> Path:
            if source == root / "staged" / install.DATABASE:
                raise RuntimeError("interrupted new database")
            return rename(source, destination)

        with patch.object(Path, "rename", interrupted), self.assertRaisesRegex(RuntimeError, "interrupted"):
            install.commit(self.data, REQUEST)
        self.assertEqual(install.commit(self.data, REQUEST)["phase"], "INSTALLED")

    def test_corruption_of_original_staged_archived_and_installed_files_is_refused(self):
        for target in ("original", "staged", "archived", "installed"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                data = Path(directory) / "data"
                data.mkdir()
                for name in self.original:
                    self.write(data, name, (self.data / name).read_bytes())
                root = install.stage(data, self.payload, self.manifest, self.original, REQUEST, IMAGE, JAR, "backup")
                if target in ("archived", "installed"):
                    install.commit(data, REQUEST)
                file = {
                    "original": data / "server.properties",
                    "staged": root / "staged/world/level.dat",
                    "archived": root / "original/world/level.dat",
                    "installed": data / "world/level.dat",
                }[target]
                file.write_bytes(b"unexpected change")
                with self.assertRaises(ValueError):
                    install.commit(data, REQUEST)

    def test_changed_source_volume_payload_and_missing_dimension_never_create_a_workspace(self):
        for change in ("source", "payload", "dimension"):
            with self.subTest(change=change):
                file = self.data / "server.properties" if change == "source" else self.payload / "world/level.dat"
                before = file.read_bytes()
                if change == "dimension":
                    manifest = {key: value for key, value in self.manifest.items() if "/rustworks/" not in key}
                else:
                    file.write_bytes(b"unexpected change")
                    manifest = self.manifest
                try:
                    with self.assertRaises(ValueError):
                        install.stage(self.data, self.payload, manifest, self.original, REQUEST, IMAGE, JAR, "backup")
                    self.assertFalse((self.data / install.WORKSPACE).exists())
                finally:
                    file.write_bytes(before)

    def test_overlapping_roots_symlinks_and_existing_workspace_are_refused(self):
        with self.assertRaisesRegex(ValueError, "independent"):
            install.stage(self.data, self.data, self.manifest, self.original, REQUEST, IMAGE, JAR, "backup")
        linked = self.payload / "linked"
        linked.symlink_to(self.data / "server.properties")
        with self.assertRaisesRegex(ValueError, "linked"):
            self.stage()
        linked.unlink()
        self.stage()
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.stage()

    def test_invalid_request_image_plugin_identity_and_manifest_are_refused(self):
        with self.assertRaises(ValueError):
            install.stage(self.data, self.payload, self.manifest, self.original, "not-uuid", IMAGE, JAR, "backup")
        for image, jar, backup in (("latest", JAR, "backup"), (IMAGE, "bad", "backup"), (IMAGE, JAR, "")):
            with self.assertRaises(ValueError):
                install.stage(self.data, self.payload, self.manifest, self.original, REQUEST, image, jar, backup)
        for name in ("../escape", "/escape", "world//escape"):
            with self.assertRaises(ValueError):
                install.checked_manifest({name: hashlib.sha256(b"test").hexdigest()})
        self.assertFalse((self.data / install.WORKSPACE).exists())

    def test_unverified_stage_and_foreign_or_unreviewed_transaction_cannot_commit(self):
        root = self.stage()
        file = root / "journal.json"
        original = JsonObject.parse(file.read_bytes())
        for change in ({"phase": "STAGING"}, {"requestId": "foreign"}, {"targets": ["server.properties"]}):
            file.write_text(json.dumps({**original, **change}), encoding="utf-8")
            with self.assertRaises(ValueError):
                install.commit(self.data, REQUEST)
        self.assertEqual(install.files(self.data, exclude_workspace=True), self.original)

    def test_whole_rollback_restores_other_plugins_and_configuration_after_private_startup(self):
        restored = self.independent_restore()
        root = self.stage()
        install.commit(self.data, REQUEST)
        self.write(self.data, "plugins/OtherPlugin/new-state.db", b"mutated after private startup")
        self.write(self.data, "plugins/CoreProtect/database.db", b"new logging epoch")
        self.write(self.data, "server.properties", b"rewritten by new image")
        self.write(self.data, "logs/new-activation.log", b"private activation output")
        before = install.files(self.data, exclude_workspace=True)
        prepared = install.stage_whole_rollback(self.data, restored, REQUEST)
        self.assertEqual(prepared.object("wholeRollback")["phase"], "STAGED")
        self.assertEqual(install.files(self.data, exclude_workspace=True), before)
        result = install.commit_whole_rollback(self.data, REQUEST)
        self.assertEqual(result["phase"], "WHOLE_VOLUME_RESTORED")
        self.assertEqual(result.object("wholeRollback")["restart"], "REQUIRES_RECORDED_ROLLBACK_IMAGE")
        self.assertEqual(install.files(self.data, exclude_workspace=True), self.original)
        self.assertEqual(install.files(root / "failed-activation"), before)
        self.assertEqual((self.data / "world").stat().st_mode & 0o777, 0o775)
        self.assertFalse((self.data / "logs/new-activation.log").exists())
        self.assertEqual(install.files(restored), self.original)
        self.assertEqual(install.commit_whole_rollback(self.data, REQUEST), result)

    def test_whole_rollback_resumes_interrupted_archive_and_restore_renames(self):
        restored = self.independent_restore()
        rename = Path.rename
        for failure in ("archive-world", "archive-plugins", "restore-world", "restore-plugins", "restore-bluemap"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                data = Path(directory).resolve() / "data"
                data.mkdir()
                for name in self.original:
                    self.write(data, name, (self.data / name).read_bytes())
                root = install.stage(data, self.payload, self.manifest, self.original, REQUEST, IMAGE, JAR, "backup")
                install.commit(data, REQUEST)
                install.stage_whole_rollback(data, restored, REQUEST)
                action, name = failure.split("-", 1)
                failed_path = (data if action == "archive" else root / "rollback-staged") / name
                raised = False

                def interrupted(source: Path, destination: Path, target: Path = failed_path) -> Path:
                    nonlocal raised
                    if not raised and source == target:
                        raised = True
                        raise RuntimeError("interrupted whole-volume rollback")
                    return rename(source, destination)

                with patch.object(Path, "rename", interrupted), self.assertRaisesRegex(RuntimeError, "interrupted"):
                    install.commit_whole_rollback(data, REQUEST)
                self.assertEqual(install.commit_whole_rollback(data, REQUEST)["phase"], "WHOLE_VOLUME_RESTORED")
                self.assertEqual(install.files(data, exclude_workspace=True), self.original)

    def test_rollback_cannot_use_a_changed_backup_or_overlapping_source(self):
        restored = self.independent_restore()
        self.stage()
        install.commit(self.data, REQUEST)
        with self.assertRaisesRegex(ValueError, "independently"):
            install.stage_whole_rollback(self.data, self.data, REQUEST)
        self.write(restored, "server.properties", b"changed backup")
        with self.assertRaisesRegex(ValueError, "changed"):
            install.stage_whole_rollback(self.data, restored, REQUEST)
        self.assertFalse((self.data / install.WORKSPACE / REQUEST / "rollback-staged").exists())

    def test_rollback_refuses_new_writes_between_staging_and_commit(self):
        restored = self.independent_restore()
        root = self.stage()
        install.commit(self.data, REQUEST)
        install.stage_whole_rollback(self.data, restored, REQUEST)
        self.write(self.data, "plugins/OtherPlugin/unexpected-state", b"late write")
        with self.assertRaisesRegex(ValueError, "changed"):
            install.commit_whole_rollback(self.data, REQUEST)
        self.assertFalse((root / "failed-activation").exists())

    def test_unverified_or_corrupted_whole_rollback_cannot_replace_data(self):
        restored = self.independent_restore()
        root = self.stage()
        install.commit(self.data, REQUEST)
        install.stage_whole_rollback(self.data, restored, REQUEST)
        self.write(root / "rollback-staged", "world/level.dat", b"corruption")
        with self.assertRaisesRegex(ValueError, "changed"):
            install.commit_whole_rollback(self.data, REQUEST)
        self.assertFalse((root / "failed-activation").exists())

    def test_rollback_metadata_failure_retains_failed_staging_and_never_changes_live_targets(self):
        restored = self.independent_restore()
        root = self.stage()
        install.commit(self.data, REQUEST)
        before = install.files(self.data, exclude_workspace=True)
        with (
            patch.object(install, "preserve_metadata", side_effect=PermissionError("ownership cannot be preserved")),
            self.assertRaises(PermissionError),
        ):
            install.stage_whole_rollback(self.data, restored, REQUEST)
        self.assertEqual(install.files(self.data, exclude_workspace=True), before)
        self.assertEqual(
            JsonObject.parse((root / "journal.json").read_bytes()).object("wholeRollback")["phase"], "STAGING"
        )
        with self.assertRaisesRegex(ValueError, "fully verified staging"):
            install.commit_whole_rollback(self.data, REQUEST)


if __name__ == "__main__":
    unittest.main()
