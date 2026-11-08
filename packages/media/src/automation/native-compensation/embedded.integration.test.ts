import { afterEach, beforeEach, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { automationTestHarness } from "#testing/automation.ts";
import { NativeCompensationCompletionSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";
import { nativeCompensationFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof nativeCompensationFixture>> | undefined;
beforeEach(async () => {
  fixture = await nativeCompensationFixture(
    harness.database(),
    harness.context().cipher,
    { embeddedSuccessor: true, stopAt: "sidecar_link" },
  );
});
afterEach(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});
test("sidecar-prefix compensation retains actual extracted successor bytes without inventing an installed or validated database row", async () => {
  const f = fixture;
  if (f === undefined) throw new Error("Embedded compensation fixture missing");
  const db = harness.database();
  const entry = PublicationIntentSchema.parse(f.transition.intent).entries[0]
    ?.entry;
  expect(entry?.embeddedSubtitles).toHaveLength(1);
  const extracted = entry?.embeddedSubtitles[0];
  if (entry === undefined || extracted === undefined)
    throw new Error("Actual embedded extraction missing");
  const filename = path.join(
    f.file.context.roots[entry.libraryKind].control,
    extracted.relativePath,
  );
  const bytes = await readFile(filename);
  expect(bytes.toString()).toContain("Actual extracted successor caption.");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    extracted.checksum,
  );
  await f.prepare();
  const input = await f.apply();
  await f.observe(input);
  expect(await f.activities.compensateNativePublicationFiles(input)).toEqual({
    status: "compensated",
    reason: null,
  });
  const row =
    await db.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
    });
  const completion = NativeCompensationCompletionSchema.parse(row.completion);
  expect(
    completion.retainedArtifacts.find(
      (item) => item.subtitleId === extracted.id,
    ),
  ).toMatchObject({
    role: "extracted",
    physical: { state: "present", sha256: extracted.checksum },
  });
  expect(await readFile(filename)).toEqual(bytes);
  expect(await db.subtitleAsset.count({ where: { id: extracted.id } })).toBe(0);
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: f.transition.id },
    }),
  ).toEqual(f.beforeRestore.transition);
});
