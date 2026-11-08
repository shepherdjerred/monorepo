import { rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { plexBindingFixture } from "#automation/plex-binding/test-fixture.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readCompletedAcquisitionPlexPublication } from "./publication-receipt.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof plexBindingFixture>>;
let originalEnvelope: z.infer<ReturnType<typeof z.json>>;
beforeAll(async () => {
  fixture = await plexBindingFixture(harness.database(), harness.context(), {
    publicationPending: true,
  });
  expect(
    await createPublicationActivities(fixture.context).publishMediaToPlex(
      fixture.published.input,
    ),
  ).toEqual({ status: "available", reason: null });
  originalEnvelope = await envelope();
}, 60_000);
afterAll(async () => {
  if (fixture !== undefined)
    await rm(fixture.files.directory, { recursive: true, force: true });
});

async function envelope() {
  const operation = await harness.database().operation.findUniqueOrThrow({
    where: { id: fixture.published.input.operationId },
  });
  return z.object({ acquisitionPlexReceipt: z.json() }).parse(operation.result)
    .acquisitionPlexReceipt;
}

test("actual publication receipt permits finish reason merge without changing literal completion", async () => {
  const db = harness.database();
  await createOutboxActivities(db, () =>
    Promise.resolve(),
  ).finishMediaOperation({
    operationId: fixture.published.input.operationId,
    status: "completed",
    reason: "publication acknowledged",
  });
  expect(await envelope()).toEqual(originalEnvelope);
  expect(
    await db.$transaction((tx) =>
      readCompletedAcquisitionPlexPublication(tx, fixture.published.input),
    ),
  ).toEqual({ status: "available", reason: null });
});

test("committed publication envelope cannot be deleted, nulled, or replaced", async () => {
  const db = harness.database();
  const id = fixture.published.input.operationId;
  await expect(
    db.$executeRaw`UPDATE "Operation" SET result=result-'acquisitionPlexReceipt' WHERE id=${id}`,
  ).rejects.toThrow("immutable");
  await expect(
    db.$executeRaw`UPDATE "Operation" SET result=jsonb_set(result,'{acquisitionPlexReceipt}','null'::jsonb) WHERE id=${id}`,
  ).rejects.toThrow("immutable");
  await expect(
    db.$executeRaw`UPDATE "Operation" SET result=jsonb_set(result,'{acquisitionPlexReceipt,receiptHash}',to_jsonb(${"f".repeat(64)}::text)) WHERE id=${id}`,
  ).rejects.toThrow("immutable");
  await expect(
    db.$executeRaw`DELETE FROM "Operation" WHERE id=${id}`,
  ).rejects.toThrow("immutable");
  expect(identityHash(await envelope())).toBe(identityHash(originalEnvelope));
});

test("receipt freezes the original command while unrelated result siblings remain mutable", async () => {
  const db = harness.database();
  const id = fixture.published.input.operationId;
  await expect(
    db.$executeRaw`UPDATE "Operation" SET payload=payload || '{"unexpected":true}'::jsonb WHERE id=${id}`,
  ).rejects.toThrow("immutable");
  await expect(
    db.$executeRaw`UPDATE "Operation" SET kind='restore_media' WHERE id=${id}`,
  ).rejects.toThrow("immutable");
  await db.$executeRaw`UPDATE "Operation" SET result=result || '{"reason":"same acknowledged command"}'::jsonb WHERE id=${id}`;
  expect(await envelope()).toEqual(originalEnvelope);
});
