import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { decodeBlob } from "../fields.ts";
import { materializeMacArtifact } from "tasknotes-macos/scripts/apple-acceptance/mac-artifact.ts";
import { ownedLiveDirectory } from "./config.ts";
import { createGuestRuntime } from "./runtime.ts";

/** Fresh app authentication state; capture setup must use a separate local readiness UUID. */
export async function bootstrapLive(
  exportRoot: string,
  expectedConfigSHA: string,
): Promise<void> {
  const runtime = await createGuestRuntime(exportRoot, expectedConfigSHA),
    { config, paths } = runtime;
  await ownedLiveDirectory(config.packageRoot);
  for (const parent of [
    path.dirname(paths.evidenceDirectory),
    path.dirname(paths.stateDirectory),
  ]) {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await ownedLiveDirectory(parent);
  }
  await mkdir(paths.evidenceDirectory, { recursive: false, mode: 0o700 });
  await mkdir(paths.stateDirectory, { recursive: false, mode: 0o700 });
  await mkdir(paths.referenceDirectory, { recursive: false, mode: 0o700 });
  await mkdir(path.dirname(paths.products), { recursive: true, mode: 0o700 });
  await materializeMacArtifact(
    runtime.artifact,
    path.join(exportRoot, "products"),
    paths.products,
  );
  for (const [relative, blob] of Object.entries(config.seed)) {
    const destination = path.join(paths.referenceDirectory, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    assert.equal(
      await realpath(path.dirname(destination)),
      path.dirname(destination),
    );
    await writeFile(destination, decodeBlob(blob), { flag: "wx", mode: 0o600 });
  }
  const descriptor = {
    schemaVersion: 1,
    runID: config.runID,
    stateDirectory: paths.stateDirectory,
    allowedRemoteVaultID: null,
  };
  await writeFile(paths.descriptor, JSON.stringify(descriptor), {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(
    path.join(paths.evidenceDirectory, "vault-grant.json"),
    JSON.stringify(descriptor),
    { flag: "wx", mode: 0o600 },
  );
  await runtime.verify();
  // No stable Runner install, native test, local profile, account submission or app launch here.
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      runID: config.runID,
      container: paths.container,
      descriptor: paths.descriptor,
      stateDirectory: paths.stateDirectory,
    }),
  );
}
