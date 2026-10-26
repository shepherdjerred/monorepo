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

test("replays a retained prematch history that issued the retired market Activity", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "scout-free-dares-replay-"),
  );
  const loader = path.join(directory, "before-retirement.cjs");
  let legacyBundle;
  try {
    await writeFile(
      loader,
      String.raw`module.exports = function(source) {
      const marker = /patched\(\s*["']scout-free-dares-v1["']\s*\)/g;
      if ((source.match(marker) || []).length !== 1) throw Error("Expected the free-Dare patch boundary");
      return source.replace(marker, "false");
    };`,
    );
    legacyBundle = await bundleWorkflowCode({
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
  const handle = await environment.client.workflow.start(
    "scoutPrematchGameWorkflow",
    {
      taskQueue: scoutTaskQueues("dev").workflow,
      workflowId: "retained-prematch-market-command",
      args: [
        scoutPrematchGameInputCodec.serialize({
          stage: "dev",
          gameRef: GAME_REF,
        }),
      ],
    },
  );
  await handle.result();
  expect(store.calls).toContain("openPrematchMarkets");
  const history = await handle.fetchHistory();
  await Worker.runReplayHistory({ workflowsPath }, history);
}, 120_000);
