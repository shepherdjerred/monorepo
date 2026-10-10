"""LiveMap frontend packaging and persistent webroot installation contracts."""

import hashlib
import io
import json
import os
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

SERVER = Path(__file__).resolve().parent


class LiveMapTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.jar = self.root / "BlueMap.jar"
        self.output = self.root / "frontend"
        self.script = (
            'window.BlueMap={};fetch("./lang/settings.conf");fetch(`./lang/${locale}.conf`);'
            'const message="Failed to load BlueMap webapp!",alt="bluemap logo";'
            'const filename="bluemap-screenshot.png";'
        )

    def fixture(self, script=None):
        inner = io.BytesIO()
        with zipfile.ZipFile(inner, "w") as web:
            web.writestr(
                "index.html",
                '<title>BlueMap</title><meta name="og:title" content="BlueMap">'
                '<meta name="og:image" content="https://avatars.githubusercontent.com/u/42522657?s=200&v=4">'
                '<link rel="icon" href="./assets/favicon-original.png">'
                '<script src="./assets/index-original.js"></script>'
                '<link rel="manifest" href="./assets/manifest-original.webmanifest">',
            )
            web.writestr("assets/index-original.js", self.script if script is None else script)
            web.writestr("assets/manifest-original.webmanifest", json.dumps({"name": "BlueMap"}))
            for locale in ("en", "de"):
                web.writestr(
                    f"lang/{locale}.conf",
                    '  pageTitle: "BlueMap - {map}"\ninfo: { content: "Generated using BlueMap" }',
                )
            web.writestr("lang/settings.conf", 'default: "en"')
            web.writestr("sql.php", "not a static asset")
            web.writestr("settings.json", "not owned by the frontend")
            web.writestr("maps/world/tile.png", "runtime terrain")
        with zipfile.ZipFile(self.jar, "w") as jar:
            jar.writestr("de/bluecolored/bluemap/webapp.zip", inner.getvalue())

    def build(self, output=None):
        return subprocess.run(
            ["bash", str(SERVER / "build-livemap.sh"), str(self.jar), str(output or self.output)],
            capture_output=True, text=True, timeout=10,
        )

    def install(self, target, volume=None, **identity):
        # Load the real entrypoint functions without running its production main.
        definitions = (SERVER / "storm-entrypoint.sh").read_text().split("\nrequire_progression_preparation\n")[0]
        metadata = (volume or self.root).stat()
        return subprocess.run(
            ["bash", "-c", definitions + '\ninstall_livemap "$1" "$2" "$3" "$4"',
             "test", str(self.output), str(target), str(metadata.st_uid), str(metadata.st_gid)],
            capture_output=True, text=True, timeout=10, **identity,
        )

    def test_brands_static_assets_preserving_plugin_api_and_attribution(self):
        self.fixture()
        jar_hash = hashlib.sha256(self.jar.read_bytes()).hexdigest()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        html = (self.output / "index.html").read_text()
        self.assertNotIn("BlueMap", html)
        self.assertNotIn("avatars.githubusercontent.com", html)
        icon = next((self.output / "assets").glob("livemap-icon-*.svg"))
        preview = next((self.output / "assets").glob("livemap-preview-*.png"))
        self.assertIn(icon.name, html)
        self.assertIn(preview.name, html)
        self.assertEqual(icon.read_bytes(), (SERVER / "livemap/favicon.svg").read_bytes())
        self.assertEqual(preview.read_bytes(), (SERVER / "livemap/social.png").read_bytes())
        entry = next((self.output / "assets").glob("livemap-*.js"))
        self.assertIn(entry.name, html)
        self.assertIn("window.BlueMap={}", entry.read_text())
        self.assertIn("Failed to load LiveMap!", entry.read_text())
        self.assertIn("livemap-screenshot.png", entry.read_text())
        translations = next(self.output.glob("livemap-lang-*"))
        self.assertIn(translations.name, entry.read_text())
        for locale in ("en", "de"):
            text = (translations / f"{locale}.conf").read_text()
            self.assertIn('pageTitle: "LiveMap - {map}"', text)
            self.assertIn("Generated using BlueMap", text)
        manifest = next((self.output / "assets").glob("*.webmanifest"))
        self.assertEqual(json.loads(manifest.read_text())["name"], "LiveMap")
        self.assertEqual(json.loads(manifest.read_text())["icons"], [
            {"src": icon.name, "sizes": "any", "type": "image/svg+xml"},
        ])
        self.assertIn(manifest.name, html)
        for path in ("sql.php", "settings.json", "maps"):
            self.assertFalse((self.output / path).exists())
        self.assertEqual(hashlib.sha256(self.jar.read_bytes()).hexdigest(), jar_hash)

    def test_build_is_deterministic_and_rejects_existing_output(self):
        self.fixture()
        first = self.build()
        self.assertEqual(first.returncode, 0, first.stderr)
        second = self.root / "second"
        result = self.build(second)
        self.assertEqual(result.returncode, 0, result.stderr)

        def contents(root):
            return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}

        self.assertEqual(contents(self.output), contents(second))
        retry = self.build()
        self.assertNotEqual(retry.returncode, 0)
        self.assertIn("output directory must be empty", retry.stderr)

    def test_changed_upstream_contract_fails(self):
        self.fixture(self.script.replace("./lang/", "./locales/"))
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unexpected language loader", result.stderr)

    def test_fresh_install_has_writable_data_volume_permissions(self):
        self.fixture()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        target = self.root / "bluemap" / "web"
        # Root-run Linux CI also exercises a different Minecraft/data owner.
        ownership = (1000, 1000) if os.getuid() == 0 else (os.getuid(), os.getgid())
        if os.getuid() == 0:
            os.chown(self.root, *ownership)
        result = self.install(target)
        self.assertEqual(result.returncode, 0, result.stderr)
        for path in (target.parent, target, *target.rglob("*")):
            stat = path.stat()
            self.assertEqual((stat.st_uid, stat.st_gid), ownership)
            self.assertEqual(stat.st_mode & 0o7777, 0o2775 if path.is_dir() else 0o664)

    @unittest.skipUnless(os.getuid() == 0, "requires root to model a Kubernetes fsGroup mount")
    def test_nonroot_install_on_root_owned_group_writable_volume(self):
        self.fixture()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.root.chmod(0o755)
        # The Docker fetch stage makes its final /out tree readable by runtime
        # users; zipfile's synthetic entries otherwise extract with mode 0600.
        for path in self.output.rglob("*"):
            path.chmod(0o755 if path.is_dir() else 0o644)
        volume = self.root / "volume"
        volume.mkdir()
        os.chown(volume, 0, 2000)
        volume.chmod(0o2770)
        target = volume / "bluemap" / "web"
        result = self.install(target, volume, user=1000, group=1000, extra_groups=[2000])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(volume.stat().st_uid, 0)
        for path in (target.parent, target, *target.rglob("*")):
            stat = path.stat()
            self.assertEqual((stat.st_uid, stat.st_gid), (1000, 2000))
            self.assertEqual(stat.st_mode & 0o7777, 0o2775 if path.is_dir() else 0o664)

    def test_install_preserves_live_settings_maps_and_cached_assets_across_boots(self):
        self.fixture()
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        target = self.root / "web"
        retained = {"settings.json": b"live settings", "maps/world/tile": b"terrain", "assets/old.js": b"cached"}
        for path, data in retained.items():
            file = target / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
        for _ in range(2):
            (target / "index.html").write_text("default viewer")
            result = self.install(target)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((target / "index.html").read_bytes(), (self.output / "index.html").read_bytes())
            self.assertEqual((target / "index.html").stat().st_uid, os.getuid())
            self.assertEqual((target / "index.html").stat().st_gid, os.getgid())
            for path, data in retained.items():
                self.assertEqual((target / path).read_bytes(), data)


if __name__ == "__main__":
    unittest.main()
