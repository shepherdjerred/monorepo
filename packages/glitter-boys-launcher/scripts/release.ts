import { packageSigned } from "./package-signed.ts";
import { powershell } from "./windows-tools.ts";
import { releasePreflight } from "./release-preflight.ts";
import {
  publicationPreflight,
  publishLauncher,
} from "../../../scripts/release/publish-launcher.ts";
// Run with the repository's explicit 1Password grants; never print private keys.
import { createHash } from "node:crypto";
import { signRelease, type Release } from "./release-manifest.ts";
import { readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { profile, version, key } = await releasePreflight(root);
await publicationPreflight(version);
async function run(args: string[]) {
  const child = Bun.spawn(args, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0) throw new Error(`${args[0]} failed`);
}
await run(["cargo", "fmt", "--all", "--", "--check"]);
await run(["cargo", "test", "--workspace", "--locked"]);
await run([
  "cargo",
  "clippy",
  "--workspace",
  "--all-targets",
  "--locked",
  "--",
  "-D",
  "warnings",
]);
await run([
  process.execPath,
  "--no-install",
  "--bun",
  "vitest",
  "--config",
  "../../vitest.config.ts",
  "run",
  "scripts",
]);
const installer = await packageSigned(root, version);
const binary = path.join(
  root,
  "target",
  "package-layout",
  "versions",
  version,
  "glitter-boys.exe",
);
const output = path.join(root, "dist", "release", version);
await mkdir(output, { recursive: true });
// Windows Compress-Archive emits the ZIP format accepted by the runtime.
const zip = path.join(output, "launcher.zip");
function psLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
await run([
  await powershell(),
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  `Compress-Archive -LiteralPath ${psLiteral(binary)} -DestinationPath ${psLiteral(zip)} -Force`,
]);
const archiveBytes = await Bun.file(zip).arrayBuffer();
const expanded = Bun.file(binary).size;
const manifest: Release = {
  schema: 1,
  version,
  channel: profile.channel,
  target: "x86_64-pc-windows-msvc",
  minimum_bootstrap: 1,
  expires: Math.floor(Date.now() / 1000) + 90 * 86400,
  expanded_bytes: expanded,
  executable_sha256: createHash("sha256")
    .update(new Uint8Array(await Bun.file(binary).arrayBuffer()))
    .digest("hex"),
  artifact: {
    file: "launcher.zip",
    url: `https://glitter-boys.com/launcher/releases/${version}/launcher.zip`,
    bytes: archiveBytes.byteLength,
    sha256: createHash("sha256")
      .update(new Uint8Array(archiveBytes))
      .digest("hex"),
  },
};
await Bun.write(
  path.join(root, "dist", "release", `${profile.channel}.json`),
  JSON.stringify(signRelease(manifest, key)),
);
await Bun.write(
  path.join(output, path.basename(installer)),
  Bun.file(installer),
);
const symbols = path.join(
  path.resolve(root, process.env["CARGO_TARGET_DIR"] ?? "target"),
  "release",
);
for (const name of await readdir(symbols))
  if (name.endsWith(".pdb"))
    await Bun.write(
      path.join(root, "dist", name),
      Bun.file(path.join(symbols, name)),
    );
console.log(
  `Signed release ${version} is ready in dist/release. Publish versioned artifacts before the channel manifest; retain PDBs privately.`,
);
await publishLauncher(true);
if (!process.argv.includes("--prepare-only")) await publishLauncher(false);
