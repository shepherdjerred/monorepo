import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { ReverifyPlexBindingInputSchema } from "#shared/plex-binding/activities.ts";
import { createPlexBindingActivities } from "./activities.ts";
import { queueExistingPlexBinding } from "./queue.ts";
import { plexBindingFixture, bindingTestExecution } from "./test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real cold outbox and factory bind owned bytes after demand cancellation without rewriting publication history", async () => {
  const db = harness.database();
  const f = await plexBindingFixture(db, harness.context());
  directories.push(f.files.directory);
  const app = new PrismaMediaApplication(db, {
    keepDays: 7,
    serverMachineId: "fixture-server",
    movieSectionId: "1",
  });
  const actor = { ...f.files.user, role: "member" as const };
  const list = await app.listMovieEditionRequests(actor, {
    subjectUserId: actor.id,
    cursor: null,
  });
  const request = list.items.find(
    (row) => row.requestId === f.files.request.id,
  );
  if (request === undefined) {
    throw new Error("Actual chosen request missing");
  }
  await app.cancelMovieEditionRequest(actor, crypto.randomUUID(), {
    schemaVersion: 3,
    action: "cancel_request",
    subjectUserId: actor.id,
    scope: request.scope,
    requestId: request.requestId,
    expected: {
      targetVersion: request.targetVersion,
      requestVersion: request.requestVersion,
      choiceRevision: request.choiceRevision,
    },
  });
  const before = {
    attempt: await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.published.attempt.id },
    }),
    asset: await db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
    }),
    request: await db.mediaRequest.findUniqueOrThrow({
      where: { id: f.files.request.id },
    }),
    transition: await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: f.published.attempt.id },
    }),
  };
  expect(before.request.movieEditionChoiceId).toBeNull();
  const queued = await queueExistingPlexBinding(f.context, f.asset.id);
  if (queued.status !== "queued") {
    throw new Error(`Expected cold request: ${queued.reason}`);
  }
  const duplicate = await queueExistingPlexBinding(f.context, f.asset.id);
  expect(duplicate).toEqual({
    status: "queued",
    operationId: queued.operationId,
    created: false,
  });
  const started: unknown[] = [];
  await createOutboxActivities(db, (value) => {
    started.push(value);
    return Promise.resolve();
  }).dispatchMediaOutbox();
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: queued.operationId },
  });
  const input = ReverifyPlexBindingInputSchema.parse(operation.payload);
  expect(started).toContainEqual({
    workflowType: "reverifyPlexBindingWorkflow",
    workflowId: `media-operation-${operation.id}`,
    input,
  });
  expect(Object.keys(input).sort()).toEqual([
    "assetIds",
    "kind",
    "operationId",
    "recoveryEpoch",
    "schemaVersion",
  ]);
  expect(
    await createPlexBindingActivities(f.context).reverify(
      input,
      bindingTestExecution(),
    ),
  ).toEqual({ status: "verified", bindingCount: 1 });
  expect(
    await db.plexBindingCurrent.count({
      where: { mediaId: f.files.media.id, evidenceId: { not: null } },
    }),
  ).toBe(1);
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toEqual(before.asset);
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.published.attempt.id },
    }),
  ).toEqual(before.attempt);
  expect(
    await db.mediaRequest.findUniqueOrThrow({
      where: { id: f.files.request.id },
    }),
  ).toEqual(before.request);
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: f.published.attempt.id },
    }),
  ).toEqual(before.transition);
});

test("lost completion ACK replays the exact count after proof expiry and a throwing fresh config factory", async () => {
  const db = harness.database();
  const f = await plexBindingFixture(db, harness.context());
  directories.push(f.files.directory);
  const queued = await queueExistingPlexBinding(f.context, f.asset.id);
  if (queued.status !== "queued") {
    throw new Error(`Expected request: ${queued.reason}`);
  }
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: queued.operationId },
  });
  const input = ReverifyPlexBindingInputSchema.parse(operation.payload);
  const actual = await createPlexBindingActivities(f.context).reverify(
    input,
    bindingTestExecution(),
  );
  expect(actual).toEqual({ status: "verified", bindingCount: 1 });
  const receipt = await db.plexBindingVerificationReceipt.findUniqueOrThrow({
    where: { operationId: operation.id },
  });
  const calls = f.calls.length;
  const execution = bindingTestExecution();
  const expired = { ...execution, expiresAtMs: execution.observed.wall - 1 };
  const replay = createPlexBindingActivities({
    ...f.context,
    plexAccess: () =>
      Promise.reject(new Error("Must not resolve current config")),
  });
  expect(await replay.reverify(input, expired)).toEqual(actual);
  expect(f.calls).toHaveLength(calls);
  expect(
    await db.plexBindingVerificationReceipt.findUniqueOrThrow({
      where: { operationId: operation.id },
    }),
  ).toEqual(receipt);
});

test("an uncommitted invocation expired during lazy work does not renew its proof or read configuration", async () => {
  const db = harness.database();
  const f = await plexBindingFixture(db, harness.context());
  directories.push(f.files.directory);
  const queued = await queueExistingPlexBinding(f.context, f.asset.id);
  if (queued.status !== "queued") {
    throw new Error(`Expected request: ${queued.reason}`);
  }
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: queued.operationId },
  });
  const input = ReverifyPlexBindingInputSchema.parse(operation.payload);
  const execution = bindingTestExecution();
  const result = await createPlexBindingActivities({
    ...f.context,
    plexAccess: () =>
      Promise.reject(new Error("Must not configure expired proof")),
  }).reverify(input, {
    ...execution,
    expiresAtMs: execution.observed.wall - 1,
  });
  expect(result).toEqual({
    status: "protected",
    reason: "verification_expired",
  });
  expect(f.calls).toEqual([]);
  expect(
    await db.plexBindingVerificationReceipt.count({
      where: { operationId: operation.id },
    }),
  ).toBe(0);
  expect(
    await db.plexBindingCurrent.count({ where: { mediaId: f.files.media.id } }),
  ).toBe(0);
});
