import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from maintenance import files


class StoppedFilesTest(unittest.TestCase):
    def test_native_dimension_lock_prevents_offline_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            (data / "world/dimensions/minecraft/frontier").mkdir(parents=True)
            (data / "world/level.dat").write_bytes(b"native metadata")
            lock = data / "world/dimensions/minecraft/frontier/session.lock"
            lock.touch()
            script = (
                "import fcntl,sys; f=open(sys.argv[1],'r+b'); fcntl.lockf(f,fcntl.LOCK_EX);"
                "print('locked',flush=True); sys.stdin.read()"
            )
            process = subprocess.Popen([sys.executable, "-c", script, str(lock)],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            try:
                if process.stdout is None:
                    raise RuntimeError("Lock fixture did not start")
                self.assertEqual(process.stdout.readline().strip(), "locked")
                with self.assertRaisesRegex(ValueError, "world save lock"), files.stopped(data):
                    self.fail("A running dimension must prevent maintenance")
            finally:
                process.communicate(timeout=10)
            with files.stopped(data):
                self.assertEqual(files.files(data), {"world/level.dat": files.digest(data / "world/level.dat")})

    def test_linked_data_is_not_an_inventory_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "outside").write_bytes(b"untouched")
            (root / "link").symlink_to(root / "outside")
            with self.assertRaisesRegex(ValueError, "linked"):
                files.files(root)


if __name__ == "__main__":
    unittest.main()
