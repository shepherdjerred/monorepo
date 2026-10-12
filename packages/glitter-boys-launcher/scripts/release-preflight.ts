import path from "node:path";
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { readProfile, type ReleaseProfile } from "./release-profile.ts";
import { readUpdateKey } from "./provision-update-key.ts";
import { powershell, run } from "./windows-tools.ts";
import { versionParts } from "./release-manifest.ts";
export async function signingKey(profile: ReleaseProfile): Promise<KeyObject> {
  const key = createPrivateKey(
    process.env["GLITTER_BOYS_UPDATE_SIGNING_KEY"] ?? (await readUpdateKey()),
  );
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
  return key;
}
export async function releasePreflight(root: string) {
  if (process.platform !== "win32")
    throw new Error("Signed releases require Windows x64");
  if (process.arch !== "x64")
    throw new Error("Signed releases require Windows x64");
  for (const tool of ["cargo", "rustc", "cargo-packager", "op", "az.cmd"])
    if (!Bun.which(tool))
      throw new Error(`Required release tool is missing: ${tool}`);
  const profile = await readProfile(root);
  if (!profile.publisher || !profile.public_keys.length)
    throw new Error("Signed release trust is not configured");
  const version = (await Bun.file(path.join(root, "Cargo.toml")).text()).match(
    /^version = "([^"]+)"/m,
  )?.[1];
  if (!version) throw new Error("Missing launcher workspace version");
  versionParts(version);
  const key = await signingKey(profile);
  await run(
    [
      await powershell(),
      "-NoProfile",
      "-NonInteractive",
      "-File",
      path.join(root, "scripts/preflight-signing.ps1"),
    ],
    root,
  );
  return { profile, version, key };
}
if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..");
  const { version } = await releasePreflight(root);
  console.log(
    `Release ${version}: signing preflight passed. No artifacts were signed or uploaded.`,
  );
}
