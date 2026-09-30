#!/usr/bin/env bun

import { doctor } from "#src/host/doctor.ts";
import { LaunchdService } from "#src/host/launchd.ts";
import { Reconciler } from "#src/reconcile.ts";
import { loadConfig } from "#src/runtime/config.ts";
import { runtimePaths } from "#src/runtime/paths.ts";
import { runCommand } from "#src/runtime/process.ts";
import { writeInfo } from "#src/runtime/output.ts";
import { StateStore } from "#src/runtime/state-store.ts";

const USAGE = `justin-principal-engineer

Usage:
  justin-principal-engineer doctor
  justin-principal-engineer reconcile
  justin-principal-engineer daemon <install|start|stop|status|uninstall>
`;

async function main(args: readonly string[]): Promise<void> {
  const paths = runtimePaths();
  const command = args[0];
  if (command === "doctor") {
    await doctor({ config: await loadConfig(paths), paths, run: runCommand });
    return;
  }
  if (command === "reconcile") {
    const reconciler = new Reconciler(
      await loadConfig(paths),
      paths,
      runCommand,
    );
    await reconciler.reconcile();
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
          writeInfo(`${state.issue.identifier}: ${state.phase}`);
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
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
