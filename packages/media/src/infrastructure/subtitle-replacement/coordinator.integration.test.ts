import { expect, test } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { Hono } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { registerSubtitleReplacementRoutes } from "#server/subtitle-replacement-routes.ts";
import { SubtitleReplacementDetailSchema } from "#shared/subtitle-replacement.ts";
import { replacementHarness } from "#automation/subtitle-replacement/test-fixture.ts";
import { createSubtitleReplacementNetworkActivities } from "./activities.ts";
import { sweepSubtitleReplacements } from "./sweep.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { createOutboxActivities } from "#automation/store.ts";

const harness = replacementHarness();
async function httpDetail(f: Awaited<ReturnType<typeof harness.setup>>) {
  const app = new Hono<{
    Variables: { actor: MediaActor; requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("actor", f.owner);
    c.set("requestId", "fixture");
    await next();
  });
  registerSubtitleReplacementRoutes(app, f.service);
  const response = await app.request(
    `/api/v1/admin/subtitle-replacements/${f.replacementId}`,
  );
  expect(response.status).toBe(200);
  return SubtitleReplacementDetailSchema.parse(await response.json());
}

test("actual file guard exposes protected version and exact cleanup protection in owner HTTP review", async () => {
  const blocked = await harness.setup();
  const blockedInput = await blocked.approve();
  const before = await blocked.row();
  await writeFile(blocked.filename, "foreign replacement");
  expect(
    await blocked.activities().applySubtitleReplacement(blockedInput),
  ).toMatchObject({ state: "protected" });
  const protectedDetail = await httpDetail(blocked);
  expect(protectedDetail.state).toBe("protected");
  expect(protectedDetail.version).toBeGreaterThan(before.version);
  expect(protectedDetail.reason).not.toBeNull();
  expect(protectedDetail.reservationActive).toBe(true);
  const applied = await harness.setup();
  expect(
    await applied
      .activities()
      .applySubtitleReplacement(await applied.approve()),
  ).toEqual({ state: "applied" });
  applied.advance(8 * 86_400_000);
  applied.context.enabled.purge = () => Promise.resolve(false);
  expect(await applied.cleanup()).toMatchObject({ state: "protected" });
  const detail = await httpDetail(applied);
  expect(detail.state).toBe("applied");
  expect(detail.cleanupReason).not.toBeNull();
  expect(detail.cleanupState).toBe("pending");
});
test("review hash and current owner scope authorize one idempotent apply and separate artifact cleanup", async () => {
  const f = await harness.setup();
  expect(
    await f.activities().prepareSubtitleReplacement(f.prepareInput),
  ).toEqual({ state: "ready" });
  const ready = await f.row();
  const hash = ready.review?.observationHash;
  if (hash === undefined) throw new Error("Missing physical review");
  const input = {
    expectedVersion: ready.version,
    observationHash: hash,
    acknowledgeReplacement: true as const,
  };
  await expect(
    f.service.apply(f.owner, crypto.randomUUID(), f.replacementId, {
      ...input,
      observationHash: "0".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "subtitle_replacement_review_changed" });
  const key = crypto.randomUUID();
  const approved = await f.service.apply(f.owner, key, f.replacementId, input);
  expect(await f.service.apply(f.owner, key, f.replacementId, input)).toEqual(
    approved,
  );
  const operation = {
    replacementId: f.replacementId,
    operationId: z.uuid().parse(approved.operationId),
  };
  expect(await f.activities().applySubtitleReplacement(operation)).toEqual({
    state: "applied",
  });
  const network = createSubtitleReplacementNetworkActivities(f.db);
  await network.queueSubtitleReplacementCleanup(operation);
  await network.queueSubtitleReplacementCleanup(operation);
  expect(
    await f.db.operation.count({
      where: {
        targetId: f.replacementId,
        kind: "cleanup_subtitle_replacement",
      },
    }),
  ).toBe(1);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toEqual(f.asset);
  expect(await readFile(f.filename, "utf8")).toBe(f.newText);
});

test("revoked owner after queued approval cannot install and exact current owner can reconcile", async () => {
  const f = await harness.setup();
  const input = await f.approve();
  await f.db.mediaUser.update({
    where: { id: f.owner.id },
    data: { restricted: true },
  });
  await expect(
    f.activities().applySubtitleReplacement(input),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await readFile(f.filename, "utf8")).toBe(f.oldText);
  const row = await f.row();
  expect(row.receipt).toBeNull();
  expect(row.reservationActive).toBe(true);
  const current = await f.db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Current owner",
      role: "owner",
    },
  });
  expect(await f.reconcile(current)).toEqual({ state: "rolled_back" });
});

test("terminated coordinator is fenced while its old file Activity resumes after hashing", async () => {
  const f = await harness.setup();
  const input = await f.approve();
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  let paused = false;
  f.context.checkpoint = async (phase) => {
    if (phase === "replacement-hashing" && !paused) {
      paused = true;
      entered.resolve(undefined);
      await release.promise;
    }
  };
  const executing = f.activities().applySubtitleReplacement(input);
  await entered.promise;
  const initial = await f.row();
  const newOperation = await f.service.reconcile(
    f.owner,
    crypto.randomUUID(),
    f.replacementId,
    { expectedVersion: initial.version },
  );
  const network = createSubtitleReplacementNetworkActivities(f.db);
  expect(await network.beginSubtitleReplacementReconciliation(input)).toBe(
    false,
  );
  release.resolve(undefined);
  expect(await executing).toMatchObject({
    state: "protected",
    reason: "subtitle_replacement_coordinator_changed",
  });
  expect(await readFile(f.filename, "utf8")).toBe(f.oldText);
  const row = await f.row();
  expect(row.coordinatorOperationId).toBe(newOperation.operationId);
  expect(row.receipt).toBeNull();
  expect(row.reservationActive).toBe(true);
});

test("bounded sweep leaves active coordinator alone and dispatches exact terminal recovery", async () => {
  const f = await harness.setup();
  let running = true;
  const context = {
    db: f.db,
    describeWorkflow: async () => ({
      runId: "prior-run",
      status: running ? ("RUNNING" as const) : ("TERMINATED" as const),
    }),
  } satisfies Pick<MediaAutomationContext, "db" | "describeWorkflow">;
  await sweepSubtitleReplacements(context);
  const runningRow = await f.row();
  expect(runningRow.coordinatorOperationId).toBe(f.prepareInput.operationId);
  running = false;
  await sweepSubtitleReplacements(context);
  const row = await f.row();
  expect(row.coordinatorOperationId).not.toBe(f.prepareInput.operationId);
  expect(row.state).toBe("reconciling");
  expect(
    await f.activities().prepareSubtitleReplacement(f.prepareInput),
  ).toMatchObject({ state: "protected" });
  const starts: { workflowType: string; input: unknown }[] = [];
  await createOutboxActivities(f.db, async (input) => {
    starts.push(input);
  }).dispatchMediaOutbox();
  expect(starts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        workflowType: "reconcileSubtitleReplacementWorkflow",
        input: expect.objectContaining({
          replacementId: f.replacementId,
          coordinators: expect.arrayContaining([
            expect.objectContaining({
              runId: "prior-run",
              status: "TERMINATED",
            }),
          ]),
        }),
      }),
    ]),
  );
});
