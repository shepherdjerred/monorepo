#!/usr/bin/env bun

import path from "node:path";
import { parseArgs } from "node:util";
import { doctor } from "#src/host/doctor.ts";
import { LaunchdService } from "#src/host/launchd.ts";
import { Reconciler } from "#src/reconcile.ts";
import { loadConfig } from "#src/runtime/config.ts";
import { runtimePaths } from "#src/runtime/paths.ts";
import { runCommand } from "#src/runtime/process.ts";
import { writeInfo } from "#src/runtime/output.ts";
import { StateStore } from "#src/runtime/state-store.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { formatTaskStatus } from "#src/reconcile-autonomy.ts";

const USAGE = `justin-principal-engineer

Usage:
  justin-principal-engineer doctor
  justin-principal-engineer reconcile [--runner-source <package-directory>]
  justin-principal-engineer merge-ready <issue-identifier> [--runner-source <package-directory>]
  justin-principal-engineer daemon <install|start|stop|status|uninstall>
`;

async function runReconcile(
  command: "reconcile" | "merge-ready",
  args: readonly string[],
  paths: ReturnType<typeof runtimePaths>,
): Promise<void> {
  const { values } = parseArgs({
    args: args.slice(command === "merge-ready" ? 2 : 1),
    options: { "runner-source": { type: "string" } },
    strict: true,
  });
  const reconciler = new Reconciler(
    await loadConfig(paths),
    paths,
    runCommand,
    values["runner-source"] === undefined
      ? undefined
      : path.resolve(values["runner-source"]),
  );
  if (command === "merge-ready") {
    const states = await new StateStore(paths).list();
    const state = states.find(
      (candidate) => candidate.issue.identifier === args[1],
    );
    if (state === undefined)
      throw new Error("Merge readiness requires an existing task");
    if (!(await reconciler.mergeReady(state)))
      throw new Error("Task is not ready to merge");
  } else {
    await reconciler.reconcile();
  }
}

async function main(args: readonly string[]): Promise<void> {
  const paths = runtimePaths();
  const command = args[0];
  if (command === "doctor") {
    await doctor({ config: await loadConfig(paths), paths, run: runCommand });
    return;
  }
  if (command === "reconcile" || command === "merge-ready") {
    await runReconcile(command, args, paths);
    return;
  }
  if (command === "daemon") {
    const service = new LaunchdService(paths, runCommand);
    switch (args[1]) {
      case "install":
        await service.install(await loadConfig(paths));
        return;
      case "start":
        await service.start();
        return;
      case "stop":
        await service.stop();
        return;
      case "status": {
        await service.status();
        const store = new StateStore(paths);
        const states = await store.list();
        for (const state of states) {
          writeInfo(formatTaskStatus(state));
        }
        return;
      }
      case "uninstall":
        await service.uninstall();
        return;
      case undefined:
      default:
        throw new Error(USAGE);
    }
  }
  if (command === "--help" || command === "-h") {
    writeInfo(USAGE);
    return;
  }
  throw new Error(USAGE);
}

try {
  await initFeatureFlags({
    environment: {
      ...Bun.env,
      FEATURE_FLAGS_MODE: Bun.env["FEATURE_FLAGS_MODE"] ?? "disabled",
    },
  });
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await shutdownFeatureFlags();
}
