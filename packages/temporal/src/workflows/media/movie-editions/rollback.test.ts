import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Context } from "@temporalio/activity";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { WorkflowHandle } from "@temporalio/client";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { assertScopedMovieActivityBudgets } from "#activities/media/testing/history.ts";

const current = new URL("acquisition.ts", import.meta.url).pathname;
const historical = new URL(
  "acquisition-before-rollback.fixture.ts",
  import.meta.url,
).pathname;
type Mode =
  | "rollback"
  | "admission-blocked"
  | "physical-blocked"
  | "rebind-blocked"
  | "resume"
  | "plex-timeout"
  | "cancelled";

async function cancelRollback(
  mode: Mode,
  started: Promise<undefined>,
  handle: WorkflowHandle,
) {
  if (mode !== "cancelled") return;
  await started;
  await handle.cancel();
}

async function completion(mode: Mode, handle: WorkflowHandle) {
  try {
    return await handle.result();
  } catch (error) {
    if (mode !== "cancelled") throw error;
    expect(error).toMatchObject({ cause: { name: "CancelledFailure" } });
    return { status: "cancelled" };
  }
}

async function scenario(mode: Mode, workflowsPath = current) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const mediaId = crypto.randomUUID();
  const input = {
    schemaVersion: 4,
    operationId: crypto.randomUUID(),
    attemptId: crypto.randomUUID(),
    scope: { mediaId, rootMediaId: mediaId, edition: "extended_cut" },
  };
  const calls: string[] = [];
  const started = Promise.withResolvers<undefined>();
  const files = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: {
      inspectAndStageMovieV4: () => {
        calls.push("inspect");
        return Promise.resolve({ status: "staged" });
      },
      prepareMoviePublicationV4: () => {
        calls.push("prepare-publication");
        return Promise.resolve({ status: "prepared" });
      },
      promoteMovieFilesV4: () => {
        calls.push("publish");
        return Promise.resolve({ status: "published" });
      },
      prepareMovieRollbackV4: (raw: unknown) => {
        expect(raw).toEqual(input);
        calls.push("admit-rollback");
        return Promise.resolve(
          mode === "admission-blocked"
            ? { status: "blocked", reason: "actual_negative_parent_missing" }
            : { status: "prepared", reason: null },
        );
      },
      rollbackMoviePublicationV4: async (raw: unknown) => {
        expect(raw).toEqual(input);
        calls.push("rollback-files");
        if (mode === "cancelled") {
          const activity = Context.current();
          const heartbeat = setInterval(() => activity.heartbeat(), 10);
          started.resolve(undefined);
          try {
            return await activity.cancelled;
          } finally {
            clearInterval(heartbeat);
            calls.push("rollback-settled");
          }
        }
        return mode === "physical-blocked"
          ? { status: "blocked", reason: "physical_version_changed" }
          : { status: "physically_rolled_back", reason: null };
      },
    },
  });
  const publish = (method: string) => {
    calls.push(method);
    return Promise.resolve(
      mode === "plex-timeout"
        ? { status: "waiting", reason: "part_unverified" }
        : { status: "blocked", reason: "original_part_identity_mismatch" },
    );
  };
  const network = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      observeMovieAcquisitionV4: () =>
        Promise.resolve({
          status: "ready",
          reason:
            mode === "resume"
              ? "resume_movie_rollback"
              : "resume_committed_publication",
        }),
      publishMovieToPlexV4: () => publish("old-plex"),
      publishMovieWithRollbackV4: () => publish("plex"),
      verifyRolledBackMoviePlexV4: (raw: unknown) => {
        expect(raw).toEqual(input);
        calls.push("verify-rollback");
        return Promise.resolve(
          mode === "rebind-blocked"
            ? { status: "blocked", reason: "original_item_changed" }
            : { status: "available", reason: null },
        );
      },
      finalizeMovieAcquisitionV4: () => {
        calls.push("finalize");
        return Promise.resolve();
      },
      finishMediaOperation: (value: {
        status: string;
        reason: string | null;
      }) => {
        calls.push(`finish:${value.status}:${String(value.reason)}`);
        return Promise.resolve();
      },
    },
  });
  const workflow = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath,
  });
  const running = [files.run(), network.run()];
  try {
    const handle = await environment.client.workflow.start(
      "acquireMovieEditionV4Workflow",
      {
        workflowId: crypto.randomUUID(),
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [{ ...input, submitted: true }],
      },
    );
    const cancellation = cancelRollback(mode, started.promise, handle);
    const result: unknown = await workflow.runUntil(completion(mode, handle));
    await cancellation;
    const history = await handle.fetchHistory();
    assertScopedMovieActivityBudgets(history);
    await Worker.runReplayHistory({ workflowsPath: current }, history);
    return { result, calls };
  } finally {
    files.shutdown();
    network.shutdown();
    await Promise.all(running);
    await environment.teardown();
  }
}

test.each([
  ["rollback", "original_part_identity_mismatch"],
  ["resume", "movie_plex_publication_rolled_back"],
  ["plex-timeout", "movie_plex_publication_unverified"],
] as const)(
  "%s restores and reverifies before finishing the failed upgrade and replays",
  async (mode, reason) => {
    const { result, calls } = await scenario(mode);
    expect(result).toEqual({ status: "blocked", reason });
    expect(calls.slice(-4)).toEqual([
      "admit-rollback",
      "rollback-files",
      "verify-rollback",
      `finish:reconciling:${reason}`,
    ]);
    expect(calls).not.toContain("finalize");
    expect(calls).not.toContain("inspect");
    expect(calls.filter((call) => call === "plex")).toHaveLength(
      mode === "resume" ? 0 : mode === "plex-timeout" ? 30 : 1,
    );
  },
  60_000,
);

test.each([
  ["admission-blocked", "actual_negative_parent_missing", "rollback-files"],
  ["physical-blocked", "physical_version_changed", "verify-rollback"],
  ["rebind-blocked", "original_item_changed", "finalize"],
] as const)(
  "%s protects the next effect and replays",
  async (mode, reason, forbidden) => {
    const { result, calls } = await scenario(mode);
    expect(result).toEqual({ status: "blocked", reason });
    expect(calls.at(-1)).toBe(`finish:reconciling:${reason}`);
    expect(calls).not.toContain(forbidden);
  },
  60_000,
);

test("cancellation waits for native rollback settlement before closing the coordinator and replays", async () => {
  const { result, calls } = await scenario("cancelled");
  expect(result).toEqual({ status: "cancelled" });
  expect(calls.slice(-2)).toEqual([
    "rollback-settled",
    "finish:reconciling:movie_operation_cancelled",
  ]);
  expect(calls).not.toContain("verify-rollback");
}, 60_000);

test("the literal scoped acquisition before rollback replays its failure without new Activities", async () => {
  expect(
    createHash("sha256")
      .update(await readFile(historical))
      .digest("hex"),
  ).toBe("0d91118f3d927c5c8abbf793ab89284df3a86cb67e615dc40ec8ea6e49f726dd");
  const { result, calls } = await scenario("rollback", historical);
  expect(result).toEqual({
    status: "blocked",
    reason: "original_part_identity_mismatch",
  });
  expect(calls).toEqual([
    "old-plex",
    "finish:reconciling:original_part_identity_mismatch",
  ]);
}, 60_000);
