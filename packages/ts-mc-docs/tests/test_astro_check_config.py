import json
import subprocess
import unittest


class AstroCheckConfigTests(unittest.TestCase):
    def test_concurrent_check_processes_get_different_vite_caches(self):
        result = subprocess.run(
            [
                "bun",
                "-e",
                "const { getAstroCheckCacheDir } = await import('./src/astro-check.config.mjs');"
                " console.log(JSON.stringify([getAstroCheckCacheDir('/docs', 101),"
                " getAstroCheckCacheDir('/docs', 202)])); process.exit(0);",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        first, second = json.loads(result.stdout.strip().splitlines()[-1])

        self.assertEqual(first, "/docs/node_modules/.vite/astro-check-101")
        self.assertEqual(second, "/docs/node_modules/.vite/astro-check-202")
        self.assertNotEqual(first, second)


if __name__ == "__main__":
    unittest.main()
