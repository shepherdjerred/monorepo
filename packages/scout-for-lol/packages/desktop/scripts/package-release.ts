// Builds the signed release outputs for one channel on the host that runs it:
//
//   bun run release:package:stable [-- --dry-run]
//   bun run release:package:beta   [-- --dry-run]
//
// On Windows: the NSIS installer and its `.sig` in `dist/<channel>/`.
// `cargo packager` signs the installer (minisign) when it finds the channel's
// private key and password in its environment; `with-release-credentials.ts`
// injects them from 1Password for this process only.
//
// On macOS: a universal app, Developer ID signed, notarized and stapled, as
// an update archive with its `.sig` and a disk image in
// `dist/<channel>/macos/` (see package-macos.ts). `--dry-run` builds them
// unsigned into `dist/<channel>/macos-dry-run/` without any credential.
//
// `release:publish:<channel>` reads whichever of these this host produced.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ScoutDesktopUpdateChannelSchema } from "../../data/src/scout-client/desktop-update-manifest.schema.ts";
import { packageMac } from "./package-macos.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const [channelArgument, ...flags] = process.argv.slice(2);
const parsedChannel =
  ScoutDesktopUpdateChannelSchema.safeParse(channelArgument);
if (!parsedChannel.success) {
  throw new Error("usage: package-release.ts stable|beta [--dry-run]");
}
const channel = parsedChannel.data;
const dryRun = flags.includes("--dry-run");
if (process.platform !== "win32" && process.platform !== "darwin") {
  throw new Error(
    `Release builds run on the Windows or macOS host; this is ${process.platform}`,
  );
}
if (dryRun && process.platform === "win32") {
  throw new Error(
    "--dry-run is the unsigned macOS build; on Windows use bun run package:<channel>",
  );
}
if (!dryRun) {
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

async function readJson(path: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(join(root, path), "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return Object.fromEntries(Object.entries(value));
}

function text(object: Record<string, unknown>, key: string, where: string) {
  const value = object[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`${where} has no ${key}`);
  }
  return value;
}

if (process.platform === "darwin") {
  const profile = await readJson(`release-profiles/${channel}.json`);
  const packaging = await readJson(`packaging/${channel}.json`);
  await packageMac({
    root,
    channel,
    version: text(packaging, "version", `packaging/${channel}.json`),
    productName: text(packaging, "productName", `packaging/${channel}.json`),
    binaryName: text(
      profile,
      "binary_name",
      `release-profiles/${channel}.json`,
    ),
    updatePublicKey: text(
      profile,
      "update_public_key",
      `release-profiles/${channel}.json`,
    ),
    sherpaArchives,
    dryRun,
  });
} else {
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
}
