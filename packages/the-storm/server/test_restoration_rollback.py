import io
import shutil
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import restoration_files as files
import restoration_rollback as rollback
from restoration_json import JsonObject

REQUEST = "6903b19f-f4d2-42a5-91ba-6ce046562c83"


class WholeRollbackTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.data, self.original, self.payload = (self.root / name for name in ("data", "original", "payload"))
        for directory in (self.data, self.original, self.payload):
            directory.mkdir()
        for name, value in (
            ("world/level.dat", b"original metadata"),
            (files.DATABASE, b"original identities"),
            ("plugins/OtherPlugin/state.db", b"original plugin state"),
            ("server.properties", b"original fixture configuration"),
        ):
            for directory in (self.data, self.original):
                self.write(directory, name, value)
        (self.original / "world").chmod(0o775)
        (self.original / "server.properties").chmod(0o600)
        self.proof = JsonObject(
            {
                "schemaVersion": 1, "status": "VERIFIED", "requestId": REQUEST,
                "backupUid": "backup", "sourceVolumeUid": "production", "restoredVolumeUid": "independent",
                "files": files.files(self.original),
            }
        )
        self.write(self.payload, "world/level.dat", b"historical metadata")
        self.write(self.payload, files.DATABASE, b"restored identities")
        for dimension in ("settlement", "rustworks", "rwf"):
            prefix = "world/dimensions/minecraft/" + dimension
            self.write(self.payload, prefix + "/data/paper/metadata.dat", b"dimension metadata")
            self.write(self.payload, prefix + "/region/r.0.0.mca", b"retained arena")
        files.stage(
            self.data, self.payload, files.files(self.payload), self.proof.strings("files"), REQUEST,
            "ghcr.io/shepherdjerred/the-storm-server:fixture@sha256:" + "a" * 64, "b" * 64, "backup",
        )
        files.commit(self.data, REQUEST)
        self.write(self.data, "server.properties", b"changed during private startup")
        self.write(self.data, "plugins/OtherPlugin/state.db", b"new plugin state")
        self.before = files.files(self.data, exclude_workspace=True)
        self.scratch = self.root / "rollback-source"

    def write(self, root: Path, name: str, value: bytes):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)

    def stream(self, extra: tarfile.TarInfo | None = None) -> io.BytesIO:
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w") as archive:
            archive.add(self.original, arcname=".")
            if extra is not None:
                archive.addfile(extra, io.BytesIO(b"x") if extra.isfile() else None)
        output.seek(0)
        return output

    def test_streamed_whole_volume_restores_configuration_and_other_plugins_and_retains_failed_activation(self):
        rollback.receive(self.scratch, self.proof, self.stream())
        self.assertEqual(files.files(self.scratch), self.proof.strings("files"))
        self.assertEqual((self.scratch / "server.properties").stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.scratch / "world").stat().st_mode & 0o777, 0o775)
        result = rollback.restore(self.data, self.scratch, self.proof)
        self.assertEqual(result["phase"], "WHOLE_VOLUME_RESTORED")
        self.assertEqual(result["rollbackPhase"], "RESTORED")
        self.assertEqual(files.files(self.data, exclude_workspace=True), self.proof.strings("files"))
        workspace = self.data / files.WORKSPACE / REQUEST
        self.assertEqual(files.files(workspace / "failed-activation"), self.before)
        shutil.rmtree(self.scratch)
        self.assertEqual(rollback.restore(self.data, self.scratch, self.proof), result)

    def test_unsafe_unverified_duplicate_and_linked_stream_entries_cannot_reach_live_data(self):
        for index, (name, kind) in enumerate(
            (("../escape", tarfile.REGTYPE), ("/escape", tarfile.REGTYPE), ("unverified", tarfile.REGTYPE),
             ("linked", tarfile.SYMTYPE), ("hard", tarfile.LNKTYPE), ("fifo", tarfile.FIFOTYPE),
             ("./server.properties", tarfile.REGTYPE))
        ):
            with self.subTest(name=name):
                entry = tarfile.TarInfo(name)
                entry.type, entry.size, entry.linkname = kind, 1 if kind == tarfile.REGTYPE else 0, "../escape"
                with self.assertRaisesRegex(ValueError, "unsafe or unverified"):
                    rollback.receive(self.root / f"scratch-{index}", self.proof, self.stream(entry))
                self.assertEqual(files.files(self.data, exclude_workspace=True), self.before)
        self.assertFalse((self.root / "escape").exists())

    def test_missing_or_corrupt_transfer_is_refused_and_partial_scratch_is_retained(self):
        for name in ("missing", "corrupt"):
            with self.subTest(name=name):
                output = io.BytesIO()
                with tarfile.open(fileobj=output, mode="w") as archive:
                    for path in self.original.rglob("*"):
                        if path.is_file() and (name != "missing" or path.name != "server.properties"):
                            entry = archive.gettarinfo(path, arcname=str(path.relative_to(self.original)))
                            value = b"x" if name == "corrupt" else path.read_bytes()
                            entry.size = len(value)
                            archive.addfile(entry, io.BytesIO(value))
                output.seek(0)
                source = self.root / name
                with self.assertRaisesRegex(ValueError, "scratch differs"):
                    rollback.receive(source, self.proof, output)
                self.assertTrue(source.is_dir())
                self.assertEqual(files.files(self.data, exclude_workspace=True), self.before)

    def test_failed_transfer_cannot_overwrite_existing_or_linked_scratch(self):
        self.scratch.mkdir()
        with self.assertRaisesRegex(ValueError, "fresh private scratch"):
            rollback.receive(self.scratch, self.proof, self.stream())
        self.scratch.rmdir()
        self.scratch.symlink_to(self.data)
        with self.assertRaisesRegex(ValueError, "fresh private scratch"):
            rollback.receive(self.scratch, self.proof, self.stream())
        self.assertEqual(files.files(self.data, exclude_workspace=True), self.before)

    def test_changed_original_proof_or_installation_identity_cannot_begin_rollback(self):
        journal_path = self.data / files.WORKSPACE / REQUEST / "journal.json"
        original = JsonObject.parse(journal_path.read_bytes())
        for change in ({"requestId": "foreign"}, {"original": {"world/level.dat": "f" * 64}}):
            files.save(journal_path, {**original, **change})
            with self.assertRaisesRegex(ValueError, "differs from"):
                rollback.restore(self.data, self.original, self.proof)
            self.assertEqual(files.files(self.data, exclude_workspace=True), self.before)

    def test_changed_independent_copy_cannot_begin_rollback(self):
        self.write(self.original, "server.properties", b"changed backup")
        with self.assertRaisesRegex(ValueError, "changed after byte verification"):
            rollback.restore(self.data, self.original, self.proof)
        self.assertEqual(files.files(self.data, exclude_workspace=True), self.before)

    def test_interrupted_commit_resumes_without_retransferring_the_original_volume(self):
        rename = Path.rename
        failed = False

        def interrupt(source: Path, destination: Path) -> Path:
            nonlocal failed
            if not failed and source == self.data / "plugins":
                failed = True
                raise RuntimeError("interrupted rollback")
            return rename(source, destination)

        with patch.object(Path, "rename", interrupt), self.assertRaisesRegex(RuntimeError, "interrupted"):
            rollback.restore(self.data, self.original, self.proof)
        self.assertEqual(rollback.summary(rollback.transaction(self.data, self.proof))["rollbackPhase"], "COMMITTING")
        result = rollback.restore(self.data, self.root / "no-longer-needed-source", self.proof)
        self.assertEqual(result["phase"], "WHOLE_VOLUME_RESTORED")
        self.assertEqual(files.files(self.data, exclude_workspace=True), self.proof.strings("files"))

    def test_incomplete_staging_requires_inspection_and_does_not_commit(self):
        with (
            patch.object(files, "preserve_metadata", side_effect=PermissionError("fixture failure")),
            self.assertRaises(PermissionError),
        ):
            rollback.restore(self.data, self.original, self.proof)
        with self.assertRaisesRegex(ValueError, "requires inspection"):
            rollback.restore(self.data, self.original, self.proof)
        self.assertEqual(files.files(self.data, exclude_workspace=True), self.before)


if __name__ == "__main__":
    unittest.main()
