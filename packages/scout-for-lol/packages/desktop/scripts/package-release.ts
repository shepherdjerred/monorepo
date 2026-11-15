// Builds the signed NSIS installer for one channel, on the Windows host:
//
//   bun run release:package:stable
//   bun run release:package:beta
//
// `cargo packager` signs the installer (minisign) when it finds the channel's
// private key and password in its environment; `with-release-credentials.ts`
// injects them from 1Password for this process only. The installer and its
// `.sig` land in `dist/<channel>/`, which `release:publish:<channel>` reads.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const channel = process.argv[2];
if (channel !== "stable" && channel !== "beta") {
  throw new Error("usage: package-release.ts stable|beta");
}
if (process.platform !== "win32") {
  throw new Error(
    "Build the NSIS installer on the Windows host; other platforms do not produce an update artifact",
  );
}
for (const name of [
  "CARGO_PACKAGER_SIGN_PRIVATE_KEY",
  "CARGO_PACKAGER_SIGN_PRIVATE_KEY_PASSWORD",
]) {
  if (!process.env[name]) {
    throw new Error(
      `${name} is not set; run through with-release-credentials.ts so the key is injected`,
    );
  }
}

// sherpa-onnx-sys downloads its native library at build time unchecked. Fetch
// the pinned archives, verify their SHA-256, and point the build at them.
const sherpaArchives = join(root, "target", "sherpa-onnx-archives");
const fetchSherpa = Bun.spawn(
  ["bun", "scripts/fetch-sherpa-libs.ts", sherpaArchives],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
if ((await fetchSherpa.exited) !== 0) {
  throw new Error("fetching the pinned sherpa-onnx archives failed");
}

const packager = Bun.spawn(
  [
    "mise",
    "exec",
    "--",
    "cargo",
    "packager",
    "--release",
    "--config",
    `packaging/${channel}.json`,
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      SCOUT_DESKTOP_PROFILE: channel,
      SHERPA_ONNX_ARCHIVE_DIR: sherpaArchives,
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);
if ((await packager.exited) !== 0) {
  throw new Error("cargo packager failed");
}

const outputs = await readdir(join(root, "dist", channel));
if (!outputs.some((name) => name.endsWith("_x64-setup.exe.sig"))) {
  throw new Error(
    "cargo packager wrote no signature; the update key was not applied",
  );
}
console.log(`Signed ${channel} installer is in dist/${channel}/.`);
