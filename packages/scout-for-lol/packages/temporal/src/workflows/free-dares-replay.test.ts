import { afterEach, beforeEach, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, bundleWorkflowCode } from "@temporalio/worker";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scoutPrematchGameInputCodec } from "#src/workflow-contracts.ts";
import { scoutTaskQueues } from "#src/identifiers.ts";
import {
  createScoutPrematchStore,
  scoutPrematchActivityStubs,
  scoutPrematchBackgroundStubs,
  GAME_REF,
} from "./prematch.test-fixtures.ts";
import { createScoutWorkerPool } from "./worker-pool.test-fixtures.ts";

const workflowsPath = new URL("index.ts", import.meta.url).pathname;
const pool = createScoutWorkerPool();
let environment: TestWorkflowEnvironment;
beforeEach(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);
afterEach(async () => {
  await pool.drain();
  await environment.teardown();
});

/**
 * The current Workflows with one `patched(...)` gate forced off: the code as an
 * earlier release ran it, which is what retained histories were recorded by.
 */
async function bundleWithGateOff(
  gate: string,
  boundary: string,
): Promise<Awaited<ReturnType<typeof bundleWorkflowCode>>> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "scout-prematch-replay-"),
  );
  const loader = path.join(directory, "before-gate.cjs");
  try {
    await writeFile(
      loader,
      `module.exports = function(source) {
      const marker = new RegExp(${JSON.stringify(gate)}, "g");
      if ((source.match(marker) || []).length !== 1) throw Error(${JSON.stringify(boundary)});
      return source.replace(marker, "false");
    };`,
    );
    return await bundleWorkflowCode({
      workflowsPath,
      webpackConfigHook: (config) => {
        config.module ??= {};
        config.module.rules ??= [];
        config.module.rules.push({
          test: /[/\\]prematch\.ts$/u,
          enforce: "pre",
          use: [{ loader }],
        });
        return config;
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function startLegacyGame(
  legacyBundle: Awaited<ReturnType<typeof bundleWorkflowCode>>,
  workflowId: string,
  options: { background: boolean },
) {
  const store = createScoutPrematchStore();
  await pool.start(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: scoutTaskQueues("dev").workflow,
      workflowBundle: legacyBundle,
    }),
  );
  await pool.start(
    await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: scoutTaskQueues("dev").realtime,
      activities: scoutPrematchActivityStubs(store),
    }),
  );
  if (options.background) {
    await pool.start(
      await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: scoutTaskQueues("dev").background,
        activities: scoutPrematchBackgroundStubs(store),
      }),
    );
  }
  const handle = await environment.client.workflow.start(
    "scoutPrematchGameWorkflow",
    {
      taskQueue: scoutTaskQueues("dev").workflow,
      workflowId,
      args: [
        scoutPrematchGameInputCodec.serialize({
          stage: "dev",
          gameRef: GAME_REF,
        }),
      ],
    },
  );
  await handle.result();
  return { store, history: await handle.fetchHistory() };
}

test("replays a retained prematch history that issued the retired market Activity", async () => {
  const legacyBundle = await bundleWithGateOff(
    String.raw`patched\(\s*["']scout-free-dares-v1["']\s*\)`,
    "Expected the free-Dare patch boundary",
  );
  // The legacy bundle is the current code with one gate forced off, so it
  // still runs the live-roster step and needs its queue served.
  const { store, history } = await startLegacyGame(
    legacyBundle,
    "retained-prematch-market-command",
    { background: true },
  );
  expect(store.calls).toContain("openPrematchMarkets");
  await Worker.runReplayHistory({ workflowsPath }, history);
}, 120_000);

test("replays a prematch history recorded before the live roster step existed", async () => {
  const legacyBundle = await bundleWithGateOff(
    String.raw`patched\(\s*SCOUT_PREMATCH_LIVE_ROSTER_PATCH\s*\)`,
    "Expected the live roster patch boundary",
  );
  // No background worker is started: the release this models never asked for
  // one, and a run that did would hang rather than finish.
  const { store, history } = await startLegacyGame(
    legacyBundle,
    "retained-prematch-before-live-roster",
    { background: false },
  );
  expect(store.rosterReads).toEqual([]);
  expect(JSON.stringify(history)).not.toContain("recordLiveRosterRecentForm");
  await Worker.runReplayHistory({ workflowsPath }, history);
}, 120_000);
