import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class AstroCheckConfigTests(unittest.TestCase):
    def test_concurrent_check_processes_get_different_vite_caches(self):
        result = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                "const { getAstroCacheDir } = await import('./src/astro-cache.mjs');"
                " console.log(JSON.stringify([getAstroCacheDir('/docs', 101),"
                " getAstroCacheDir('/docs', 202)]));",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        first, second = json.loads(result.stdout.strip().splitlines()[-1])

        self.assertEqual(first, "/docs/node_modules/.vite/astro-101")
        self.assertEqual(second, "/docs/node_modules/.vite/astro-202")
        self.assertNotEqual(first, second)

    def test_cleanup_removes_owned_and_abandoned_caches_but_preserves_live_caches(self):
        with tempfile.TemporaryDirectory() as root:
            cache_root = Path(root) / "node_modules/.vite"
            live_cache = cache_root / f"astro-{os.getpid()}"
            live_cache.mkdir(parents=True)
            (live_cache / "sentinel").write_text("live")
            shared_cache = cache_root / "deps"
            shared_cache.mkdir()
            (shared_cache / "sentinel").write_text("shared")
            dead = subprocess.run(
                ["node", "-e", "console.log(process.pid)"],
                check=True, capture_output=True, text=True, timeout=10,
            )
            abandoned = cache_root / f"astro-{int(dead.stdout.strip())}"
            abandoned.mkdir()
            (abandoned / "sentinel").write_text("abandoned")

            result = subprocess.run(
                [
                    "node", "--input-type=module", "-e",
                    "import { mkdirSync, writeFileSync } from 'node:fs';"
                    " import { createAstroCacheDir } from './src/astro-cache.mjs';"
                    " const cache = createAstroCacheDir(process.argv[1]);"
                    " mkdirSync(cache, { recursive: true });"
                    " writeFileSync(cache + '/sentinel', 'owned');"
                    " console.log(cache);",
                    root,
                ],
                check=True, capture_output=True, text=True, timeout=10,
            )
            owned = Path(result.stdout.strip())
            self.assertFalse(owned.exists(), "exiting process left its cache behind")
            self.assertFalse(abandoned.exists(), "dead process cache was not reclaimed")
            self.assertEqual((live_cache / "sentinel").read_text(), "live")
            self.assertEqual((shared_cache / "sentinel").read_text(), "shared")


if __name__ == "__main__":
    unittest.main()
