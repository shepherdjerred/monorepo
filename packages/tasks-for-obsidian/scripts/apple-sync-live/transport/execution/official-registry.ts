import assert from "node:assert/strict";
import { lstat, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { contentSHA, UuidSchema } from "../fields.ts";
import { readOwnedMacVMJSON } from "tasknotes-macos/scripts/apple-acceptance/mac-vm-export.ts";
import type { GuestRuntime } from "./runtime.ts";
import { writeGuestJSON } from "./state.ts";

export const OfficialRegistrySchema = z.strictObject({
  cli: z.literal(true),
  vaults: z.record(
    z.string().regex(/^[a-f0-9]{16}$/u),
    z.strictObject({
      path: z.string(),
      ts: z.number().int().nonnegative(),
      open: z.boolean().optional(),
    }),
  ),
});
/** Only the isolated guest's previously owned synthetic registrations may coexist. */
export function requireOwnedReferenceRegistration(
  reference: string,
  packageRoot: string,
  home: string,
): void {
  assert.equal(path.normalize(reference), reference);
  const prefixes = [
    path.join(packageRoot, ".build/live-sync"),
    path.join(
      home,
      "Library/Application Support/FacetAcceptanceHarness/Observations",
    ),
  ];
  const prefix = prefixes.find((candidate) =>
    reference.startsWith(candidate + "/"),
  );
  assert.ok(prefix, "Foreign official vault registration");
  const suffix = path.relative(prefix, reference).split(path.sep);
  assert.equal(suffix.length, 2);
  UuidSchema.parse(suffix[0]);
  assert.equal(suffix[1], "reference-vault");
}
export async function registerOfficialReference(
  runtime: GuestRuntime,
): Promise<void> {
  const home = os.homedir();
  const uid = process.getuid?.();
  assert.ok(uid !== undefined);
  const directory = path.join(home, "Library/Application Support/obsidian");
  assert.equal(await realpath(directory), directory);
  const metadata = await lstat(directory);
  assert.ok(
    metadata.isDirectory() &&
      !metadata.isSymbolicLink() &&
      metadata.uid === uid,
  );
  const file = path.join(directory, "obsidian.json");
  // CLI provisioning is an explicit guest prerequisite; never invent a registry variant or copy host state.
  const registry = OfficialRegistrySchema.parse(
    await readOwnedMacVMJSON(file, 65_536),
  );
  for (const entry of Object.values(registry.vaults)) {
    requireOwnedReferenceRegistration(
      entry.path,
      runtime.paths.packageRoot,
      home,
    );
    assert.equal(await realpath(entry.path), entry.path);
    const record = await lstat(entry.path);
    assert.ok(
      record.isDirectory() && !record.isSymbolicLink() && record.uid === uid,
    );
  }
  requireOwnedReferenceRegistration(
    runtime.paths.referenceDirectory,
    runtime.paths.packageRoot,
    home,
  );
  const id = contentSHA(new TextEncoder().encode(runtime.config.runID)).slice(
    0,
    16,
  );
  const existing = registry.vaults[id];
  if (existing !== undefined)
    assert.equal(
      existing.path,
      runtime.paths.referenceDirectory,
      "Registration identity collision",
    );
  for (const entry of Object.values(registry.vaults)) entry.open = false;
  registry.vaults[id] = {
    path: runtime.paths.referenceDirectory,
    ts: existing?.ts ?? Date.now(),
    open: true,
  };
  await writeGuestJSON(file, registry);
  assert.deepEqual(
    OfficialRegistrySchema.parse(await readOwnedMacVMJSON(file, 65_536)),
    registry,
  );
}
