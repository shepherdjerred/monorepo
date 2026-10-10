import { readProfile } from "./release-profile.ts";
// Run with the repository's explicit 1Password grants; never print private keys.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const profile = await readProfile(root);
const version = (await Bun.file(path.join(root, "Cargo.toml")).text()).match(
  /^version = "([0-9]+\.[0-9]+\.[0-9]+)"/m,
)?.[1];
if (
  !version ||
  profile.schema !== 1 ||
  !["stable", "preview"].includes(profile.channel) ||
  !profile.publisher ||
  !profile.public_keys?.length
)
  throw new Error(
    "Configure the release publisher and pinned public keys before publishing",
  );
const privatePem = process.env["GLITTER_BOYS_UPDATE_SIGNING_KEY"];
const thumbprint = process.env["WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT"];
if (!privatePem || !thumbprint || !/^[a-f0-9]{40}$/i.test(thumbprint))
  throw new Error("Release signing credentials are unavailable");
const key = createPrivateKey(privatePem);
if (key.asymmetricKeyType !== "ed25519")
  throw new Error("Update signing requires an Ed25519 key");
const publicKey = createPublicKey(key)
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("hex");
if (!profile.public_keys.includes(publicKey))
  throw new Error(
    "Update signing key does not match the pinned release profile",
  );
async function run(args: string[]) {
  const child = Bun.spawn(args, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0) throw new Error(`${args[0]} failed`);
}
await run(["cargo", "packager", "--release", "--packages", "glitter-boys-app"]);
const installer = path.join(
  root,
  "dist",
  `glitter-boys_${version}_x64-setup.exe`,
);
await run([
  "signtool.exe",
  "sign",
  "/sha1",
  thumbprint,
  "/fd",
  "SHA256",
  "/tr",
  "http://timestamp.digicert.com",
  "/td",
  "SHA256",
  installer,
]);
await run(["signtool.exe", "verify", "/pa", "/all", installer]);
await run([
  "powershell.exe",
  "-NoProfile",
  "-NonInteractive",
  "-File",
  path.join(root, "scripts", "verify-signature.ps1"),
  "-Path",
  installer,
  "-Publisher",
  profile.publisher,
]);
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
  "powershell.exe",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  `Compress-Archive -LiteralPath ${psLiteral(binary)} -DestinationPath ${psLiteral(zip)} -Force`,
]);
const archiveBytes = await Bun.file(zip).arrayBuffer();
const expanded = Bun.file(binary).size;
const manifest = JSON.stringify({
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
});
await Bun.write(
  path.join(root, "dist", "release", `${profile.channel}.json`),
  JSON.stringify({
    payload: manifest,
    signature: sign(
      null,
      Buffer.from(`glitter-boys-release-v1\n${manifest}`),
      key,
    ).toString("hex"),
  }),
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
