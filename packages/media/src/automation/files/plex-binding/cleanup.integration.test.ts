import { afterEach, beforeEach, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { observeMediaUpgradeCleanup } from "#automation/plex-binding/cleanup.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { loadUpgradeCleanupObservation } from "#infrastructure/plex-binding/cleanup.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { upgradeCleanupFixture } from "./upgrade-cleanup.test-support.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof upgradeCleanupFixture>> | undefined;
let directory: string | undefined;
beforeEach(async () => {
  fixture = await upgradeCleanupFixture(harness.database(), harness.context(), {
    observe: false,
    directoryCreated: (value) => {
      directory = value;
    },
  });
}, 60_000);
afterEach(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
  directory = undefined;
  fixture = undefined;
});

test.each(["canonical", "control", "unknown"] as const)(
  "%s active session prevents durable cleanup authority and every Files deletion",
  async (kind) => {
    if (fixture === undefined) throw new Error("Cleanup fixture missing");
    const f = fixture;
    const current = await harness
      .database()
      .libraryAsset.findUniqueOrThrow({ where: { id: f.entry.assetId } });
    f.transport.state.sessions = [
      {
        ratingKey: "999999",
        type: "movie",
        title: "Synthetic active session",
        ...(kind === "unknown"
          ? {}
          : {
              Media: [
                {
                  Part: [
                    {
                      id: 999_999,
                      file: kind === "control" ? f.old.path : current.path,
                    },
                  ],
                },
              ],
            }),
      },
    ];
    expect(
      await observeMediaUpgradeCleanup(
        f.network,
        f.input,
        bindingTestExecution(),
      ),
    ).toEqual({ status: "protected", reason: "reconciliation_required" });
    expect(
      await harness
        .database()
        .operation.findUniqueOrThrow({ where: { id: f.input.operationId } }),
    ).toMatchObject({ result: null });
    expect(await f.activities.cleanupSupersededMediaFile(f.input)).toEqual({
      status: "protected",
      reason: "reconciliation_required",
    });
    expect(await readFile(workerFilePath(f.context, f.old.path), "utf8")).toBe(
      f.original.content,
    );
    expect(
      await readFile(workerFilePath(f.context, current.path), "utf8"),
    ).toBe(f.acquired.content);
    expect(
      await harness
        .database()
        .upgradeCleanup.findUniqueOrThrow({ where: { id: f.cleanup.id } }),
    ).toEqual(f.cleanup);
  },
);

test("original Network proof expiry during hashing protects despite an active Files SDK invocation", async () => {
  if (fixture === undefined) throw new Error("Cleanup fixture missing");
  const f = fixture;
  const execution = bindingTestExecution();
  expect(
    await observeMediaUpgradeCleanup(f.network, f.input, {
      ...execution,
      expiresAtMs: Date.now() + 1500,
    }),
  ).toEqual({ status: "observed" });
  const proof = await loadUpgradeCleanupObservation(
    harness.database(),
    f.input,
  );
  if (proof.status !== "observed")
    throw new Error("Actual Network producer omitted cleanup proof");
  const original = await harness
    .database()
    .operation.findUniqueOrThrow({ where: { id: f.input.operationId } });
  let waited = false;
  f.context.checkpoint = async (phase) => {
    if (phase !== "content-proof-ready") return;
    waited = true;
    // Wait for this ACTUAL short producer deadline; no SDK, wall clock, row or evidence rewrite.
    await setTimeout(
      Math.max(0, Date.parse(proof.evidence.expiresAt) - Date.now() + 1),
    );
    execution.assertActive();
  };
  expect(await f.activities.cleanupSupersededMediaFile(f.input)).toEqual({
    status: "protected",
    reason: "verification_expired",
  });
  expect(waited).toBe(true);
  expect(await readFile(workerFilePath(f.context, f.old.path), "utf8")).toBe(
    f.original.content,
  );
  expect(
    await harness
      .database()
      .operation.findUniqueOrThrow({ where: { id: f.input.operationId } }),
  ).toEqual(original);
  expect(
    await harness
      .database()
      .upgradeCleanup.findUniqueOrThrow({ where: { id: f.cleanup.id } }),
  ).toMatchObject({ state: "pending" });
});

test("purged cleanup acknowledgement survives unavailable configuration and expired execution", async () => {
  if (fixture === undefined) throw new Error("Cleanup fixture missing");
  const f = fixture;
  expect(
    await observeMediaUpgradeCleanup(
      f.network,
      f.input,
      bindingTestExecution(),
    ),
  ).toEqual({ status: "observed" });
  expect(await f.activities.cleanupSupersededMediaFile(f.input)).toEqual({
    status: "purged",
  });
  const row = await harness
    .database()
    .upgradeCleanup.findUniqueOrThrow({ where: { id: f.cleanup.id } });
  const operation = await harness
    .database()
    .operation.findUniqueOrThrow({ where: { id: f.input.operationId } });
  f.context.plexAccess = () =>
    Promise.reject(new Error("Configuration unavailable"));
  f.context.checkpoint = () =>
    Promise.reject(new Error("No repeated filesystem work"));
  const factory = f.context.publicationExecution;
  if (factory === undefined) throw new Error("Files execution fixture missing");
  f.context.publicationExecution = () => ({
    ...factory(),
    assertActive: () => {
      throw new Error("Old execution expired");
    },
  });
  expect(await f.activities.cleanupSupersededMediaFile(f.input)).toEqual({
    status: "purged",
  });
  expect(
    await harness
      .database()
      .upgradeCleanup.findUniqueOrThrow({ where: { id: f.cleanup.id } }),
  ).toEqual(row);
  expect(
    await harness
      .database()
      .operation.findUniqueOrThrow({ where: { id: f.input.operationId } }),
  ).toEqual(operation);
});
