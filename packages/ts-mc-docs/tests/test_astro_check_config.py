import json
import subprocess
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


if __name__ == "__main__":
    unittest.main()
