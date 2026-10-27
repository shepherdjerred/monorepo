import { afterEach, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createManagedSeriesFixture } from "#testing/series-workflow/fixture.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { MediaAutomationContext } from "#automation/context.ts";

type WorkflowStatus = NonNullable<
  Awaited<ReturnType<MediaAutomationContext["describeWorkflow"]>>
>["status"];

const h = automationTestHarness();
const directories: string[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture(1280);
  upgrade = await movieVideoFixture(1920, undefined, { bitrateKbps: 160_000 });
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const f = await createManagedSeriesFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  const command = await f.reserve();
  const birth = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: command.attemptId },
  });
  const control: {
    rootStatus: WorkflowStatus;
    childStatus: WorkflowStatus | null;
  } = {
    rootStatus: "TERMINATED",
    childStatus: null,
  };
  f.context.describeWorkflow = (id) => {
    if (id === `media-operation-${command.operationId}`)
      return Promise.resolve({ status: control.rootStatus, runId: "root-run" });
    if (id !== `media-acquire-${command.attemptId}`)
      return Promise.resolve({ status: "RUNNING", runId: "other-fixture-run" });
    return Promise.resolve(
      control.childStatus === null
        ? null
        : { status: control.childStatus, runId: "child-run" },
    );
  };
  const sweep = () =>
    createSweepActivities(f.context).sweepMediaWork({
      kind: "downloads",
      cursor: null,
      sweepId: crypto.randomUUID(),
    });
  const recoveries = () =>
    f.db.operation.findMany({
      where: {
        idempotencyKey: { startsWith: `recover:${command.attemptId}:` },
      },
    });
  return { ...f, command, birth, control, sweep, recoveries };
}

test.each(["reserved", "downloading", "prepared", "published"] as const)(
  "terminal household TV %s resumes its actual acquisition and physical journal without personal consent or another add",
  async (phase) => {
    const f = await fixture();
    f.control.rootStatus =
      phase === "reserved"
        ? "TERMINATED"
        : phase === "downloading"
          ? "FAILED"
          : phase === "prepared"
            ? "TIMED_OUT"
            : "CANCELLED";
    if (phase !== "reserved") {
      expect(await f.acquired.submitMediaTorrent(f.command)).toMatchObject({
        status: "submitted",
      });
      f.control.childStatus = "FAILED";
    }
    if (phase === "prepared" || phase === "published") {
      expect(await f.acquired.observeMediaAcquisition(f.command)).toMatchObject(
        {
          status: "ready",
        },
      );
      expect(await f.physical.inspectAndStageMedia(f.command)).toEqual({
        status: "staged",
      });
    }
    if (phase === "published")
      expect(await f.physical.promoteMediaFiles(f.command)).toEqual({
        status: "published",
      });
    const before = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.command.attemptId },
    });
    await f.sweep();
    await f.sweep();
    const recovery = await f.recoveries();
    expect(recovery).toHaveLength(1);
    const operation = z
      .object({ id: z.uuid(), payload: z.unknown() })
      .parse(recovery[0]);
    const input = z
      .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
      .parse(operation.payload);
    const starts: {
      workflowType: string;
      workflowId: string;
      input: unknown;
    }[] = [];
    await createOutboxActivities(f.db, (start) => {
      if (start.workflowId === `media-operation-${operation.id}`)
        starts.push(start);
      return Promise.resolve();
    }).dispatchMediaOutbox();
    expect(starts).toEqual([
      {
        workflowType: "reconcileMediaWorkflow",
        workflowId: `media-operation-${operation.id}`,
        input: operation.payload,
      },
    ]);
    expect(await f.acquired.reconcileMediaIntent(input)).toEqual({
      status: "acquire",
      attemptId: f.command.attemptId,
      reason: "resume_existing_acquisition",
    });
    const resumed = { ...f.command, operationId: operation.id };
    expect(await f.acquired.submitMediaTorrent(resumed)).toMatchObject({
      status: "submitted",
    });
    expect(await f.acquired.observeMediaAcquisition(resumed)).toMatchObject({
      status: "ready",
    });
    expect(await f.physical.inspectAndStageMedia(resumed)).toEqual({
      status: "staged",
    });
    expect(await f.physical.promoteMediaFiles(resumed)).toEqual({
      status: "published",
    });
    expect(await f.publication.publishMediaToPlex(resumed)).toEqual({
      status: "available",
      reason: null,
    });
    await f.publication.finalizeMediaAcquisition(resumed);
    const after = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.command.attemptId },
    });
    expect(after).toMatchObject({
      operationId: f.birth.operationId,
      coordinatorOperationId: operation.id,
      state: "completed",
      sponsorRequestId: null,
      generations: f.birth.generations,
      identityEvidence: f.birth.identityEvidence,
    });
    if (before.filePlan !== null)
      expect(identityHash(after.filePlan)).toBe(identityHash(before.filePlan));
    expect(
      await f.db.acquisitionAttempt.count({
        where: { mediaIds: { hasSome: f.ids } },
      }),
    ).toBe(1);
    expect(
      await f.db.mediaRequest.count({ where: { mediaId: { in: f.ids } } }),
    ).toBe(0);
    expect(f.wire.additions()).toBe(1);
  },
);

test.each([
  "root_running",
  "child_running",
  "unknown_add",
  "owner",
  "generation",
  "profile",
  "reservation",
] as const)(
  "%s cannot authorize terminal household TV takeover",
  async (change) => {
    const f = await fixture();
    switch (change) {
      case "root_running":
        f.control.rootStatus = "RUNNING";
        break;
      case "child_running":
        f.control.childStatus = "RUNNING";
        break;
      case "unknown_add":
        f.wire.control.loseReply = true;
        expect(await f.acquired.submitMediaTorrent(f.command)).toMatchObject({
          status: "blocked",
        });
        f.wire.control.visible = false;
        break;
      case "owner":
        await f.db.mediaUser.update({
          where: { id: f.network.actor.id },
          data: { restricted: true },
        });
        break;
      case "generation":
        await f.db.mediaIntent.update({
          where: {
            mediaId_edition: {
              mediaId: z.uuid().parse(f.ids[1]),
              edition: "default",
            },
          },
          data: { generation: { increment: 1 } },
        });
        break;
      case "profile":
        await f.db.qualityProfile.update({
          where: { id: f.profile.id },
          data: { version: { increment: 1 } },
        });
        break;
      case "reservation":
        await f.db.acquisitionReservation.deleteMany({
          where: {
            attemptId: f.command.attemptId,
            mediaId: z.uuid().parse(f.ids[0]),
          },
        });
        break;
    }
    await f.sweep();
    expect(await f.recoveries()).toHaveLength(0);
    const after = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.command.attemptId },
    });
    expect(after.coordinatorOperationId).toBe(f.command.operationId);
    expect(after.identityEvidence).toEqual(f.birth.identityEvidence);
    expect(f.wire.additions()).toBe(change === "unknown_add" ? 1 : 0);
  },
);

test("terminal recovery retains the sweep's original execution and one provenance allowance", async () => {
  const f = await fixture();
  const execution = f.context.plexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  await expect(
    createSweepActivities({
      ...f.context,
      movieManagement: { execution, budget },
    }).sweepMediaWork({
      kind: "downloads",
      cursor: null,
      sweepId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("100 total queried records");
  expect(await f.recoveries()).toHaveLength(0);
  const after = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.command.attemptId },
  });
  expect(after.coordinatorOperationId).toBe(f.command.operationId);
  expect(f.wire.additions()).toBe(0);
});

test("expiry during terminal history reads cannot renew the sweep's original SDK authority", async () => {
  const f = await fixture();
  const execution = f.context.plexBindingExecution();
  let expired = false;
  const describe = f.context.describeWorkflow;
  f.context.describeWorkflow = async (id) => {
    const result = await describe(id);
    if (id === `media-acquire-${f.command.attemptId}`) expired = true;
    return result;
  };
  f.context.plexBindingExecution = () => ({
    ...execution,
    assertActive: () => {
      execution.assertActive();
      if (expired) throw new Error("Original sweep SDK expired");
    },
  });
  await expect(f.sweep()).rejects.toThrow("Original sweep SDK expired");
  expect(await f.recoveries()).toHaveLength(0);
  expect(f.wire.additions()).toBe(0);
});

test("two household recoveries in one sweep share the same 100-record allowance", async () => {
  const first = await fixture();
  const second = await fixture();
  const scenarios = [first, second];
  const execution = first.context.plexBindingExecution();
  first.context.describeWorkflow = (id) => {
    if (
      scenarios.some((f) => id === `media-operation-${f.command.operationId}`)
    )
      return Promise.resolve({ status: "TERMINATED", runId: "root-run" });
    return Promise.resolve(
      scenarios.some((f) => id === `media-acquire-${f.command.attemptId}`)
        ? null
        : { status: "RUNNING", runId: "other-fixture-run" },
    );
  };
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(95);
  await expect(
    createSweepActivities({
      ...first.context,
      movieManagement: { execution, budget },
    }).sweepMediaWork({
      kind: "downloads",
      cursor: null,
      sweepId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("100 total queried records");
  const recoveries = [
    ...(await first.recoveries()),
    ...(await second.recoveries()),
  ];
  expect(recoveries).toHaveLength(1);
  expect(scenarios.map((f) => f.wire.additions())).toEqual([0, 0]);
});
