import { expect } from "vitest";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { prepareBoundRetention } from "#automation/retention/lifecycle.test-fixture.ts";
import { queueRetentionCheck } from "#automation/watch.ts";
import { createRetentionActivities } from "#automation/retention.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";

type Bound = Awaited<ReturnType<typeof prepareBoundRetention>>;

export async function captureWatchReset(bound: Bound) {
  const db = bound.files.context.db;
  const ids = [...bound.published.entry.mediaIds].sort();
  return {
    ids,
    intents: await db.mediaIntent.findMany({
      where: { mediaId: { in: ids }, edition: "default" },
      orderBy: { mediaId: "asc" },
    }),
    decisions: await db.retentionDecision.findMany({
      where: {
        mediaId: { in: ids },
        edition: "default",
        state: "grace_period",
      },
      orderBy: { mediaId: "asc" },
    }),
    requests: await db.mediaRequest.findMany({
      where: { mediaId: { in: ids } },
      orderBy: { id: "asc" },
    }),
    coverage: await db.assetCoverage.findMany({
      where: { assetId: bound.asset.id },
      orderBy: { mediaId: "asc" },
    }),
    asset: await db.libraryAsset.findUniqueOrThrow({
      where: { id: bound.asset.id },
    }),
  };
}

/** An actual false observation cancels old grace; true needs a newly queued command and warning. */
export async function assertWatchResetAndNewWarning(
  bound: Bound,
  before: Awaited<ReturnType<typeof captureWatchReset>>,
) {
  const db = bound.files.context.db;
  expect(before.decisions.map((row) => row.mediaId)).toEqual(before.ids);
  const intents = await db.mediaIntent.findMany({
    where: { mediaId: { in: before.ids }, edition: "default" },
    orderBy: { mediaId: "asc" },
  });
  expect(
    intents.map((row) => ({
      mediaId: row.mediaId,
      generation: row.generation,
    })),
  ).toEqual(
    before.intents.map((row) => ({
      mediaId: row.mediaId,
      generation: row.generation + 1,
    })),
  );
  const old = await db.retentionDecision.findMany({
    where: { id: { in: before.decisions.map((row) => row.id) } },
    orderBy: { mediaId: "asc" },
  });
  expect(
    old.map((row) => ({
      id: row.id,
      state: row.state,
      generation: row.generation,
    })),
  ).toEqual(
    before.decisions.map((row) => ({
      id: row.id,
      state: "cancelled",
      generation: row.generation,
    })),
  );
  expect(
    await db.mediaRequest.findMany({
      where: { mediaId: { in: before.ids } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(before.requests);
  expect(
    await db.assetCoverage.findMany({
      where: { assetId: bound.asset.id },
      orderBy: { mediaId: "asc" },
    }),
  ).toEqual(before.coverage);
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: bound.asset.id } }),
  ).toEqual(before.asset);
  expect(
    await readFile(
      workerFilePath(bound.files.context, before.asset.path),
      "utf8",
    ),
  ).toBe(bound.published.content);
  const previousOperation = await db.operation.findUniqueOrThrow({
    where: { id: bound.operation.id },
  });
  expect(previousOperation.result).toBeNull();
  for (const observation of await bound.observe(true))
    expect(observation).toEqual({ complete: true, reason: null });
  const bucket = `watch-reset:${crypto.randomUUID()}`;
  const target = intents.find((row) => row.mediaId === bound.files.media.id);
  if (target === undefined)
    throw new Error("Watch reset omitted primary intent");
  await queueRetentionCheck(bound.context, target.mediaId, bucket);
  const operation = await db.operation.findUniqueOrThrow({
    where: {
      idempotencyKey: `retention:${target.mediaId}:${String(target.generation)}:${bucket}`,
    },
  });
  expect(operation.id).not.toBe(bound.operation.id);
  const input = z
    .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
    .parse(operation.payload);
  expect(input.generation).toBe(target.generation);
  const result = await createRetentionActivities(
    bound.context,
  ).evaluateMediaRetention(input);
  expect(result).toMatchObject({ status: "warning" });
  expect(before.decisions.some((row) => row.id === result.decisionId)).toBe(
    false,
  );
  const fresh = await db.retentionDecision.findMany({
    where: {
      mediaId: { in: before.ids },
      edition: "default",
      state: "warning_pending",
    },
    orderBy: { mediaId: "asc" },
  });
  expect(
    fresh.map((row) => ({ mediaId: row.mediaId, generation: row.generation })),
  ).toEqual(
    intents.map((row) => ({
      mediaId: row.mediaId,
      generation: row.generation,
    })),
  );
  for (const decision of fresh) {
    expect(decision.warningAcceptedAt).toBeNull();
    expect(decision.quarantinedAt).toBeNull();
    expect(decision.purgeAfter).toBeNull();
  }
}
