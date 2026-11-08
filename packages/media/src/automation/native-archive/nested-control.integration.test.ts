import path from "node:path";
import { rename, rm, writeFile } from "node:fs/promises";
import { afterAll, expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeArchiveFixture } from "./test-fixture.ts";
import { verifyArchiveOriginalJournals } from "./files.ts";
import { NativeArchiveScopeSchema } from "#shared/native-recovery/archive.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("actual original import journals remain verifiable with nested control roots and fresh PG exclusion proofs", async () => {
  const f = await nativeArchiveFixture(harness.database(), harness.cipher, {
    chain: 2,
  });
  directories.push(f.file.directory);
  // Before any native physical observation, map the same actual fixture mount into
  // production's nested layout. Import manifests reference downloads/library only;
  // no manifest, DB path, reviewed proof or receipt is rewritten.
  for (const kind of ["movies", "tv"] as const) {
    const roots = f.context.files.roots[kind];
    const nested = path.join(roots.library, ".media-control");
    await rename(roots.control, nested);
    roots.control = nested;
    roots.controlPolicy = "plex-excluded";
  }
  const proof = await f.prepare();
  await f.apply();
  await expect(
    verifyArchiveOriginalJournals(f.context, proof.scope),
  ).resolves.toBeUndefined();
  const unsafe = { ...f.context, files: { ...f.context.files } };
  delete unsafe.files.verifyPlexExclusion;
  await expect(
    verifyArchiveOriginalJournals(unsafe, proof.scope),
  ).rejects.toThrow("verified Plex");
  await writeFile(
    path.join(f.context.files.roots.movies.control, ".plexignore"),
    "changed marker\n",
  );
  await expect(
    f.context.files.verifyPlexExclusion?.(f.context.files.roots.movies),
  ).rejects.toThrow("marker changed");
  // The exact immutable scope remains the producer's stored scope after proof/apply.
  const plan = await harness
    .database()
    .nativeRecoveryPlan.findUniqueOrThrow({ where: { id: f.planId } });
  expect(NativeArchiveScopeSchema.parse(plan.scope)).toEqual(proof.scope);
});
