#!/usr/bin/env bun

import path from "node:path";
import { chmod } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";

import { runDevLoop } from "#src/dev/loop.ts";
import { LaunchdService } from "#src/host/launchd.ts";
import { loadConfig } from "#src/runtime/config.ts";
import { runtimePaths } from "#src/runtime/paths.ts";
import { runCommand } from "#src/runtime/process.ts";
import { requireSuccess } from "#src/runtime/process.ts";
import { StateStore } from "#src/runtime/state-store.ts";
import { checkConnections } from "#src/integrations/preflight.ts";
import { checkGitHubAccess } from "#src/integrations/github-access.ts";
import { formatTaskStatus } from "#src/reconcile-autonomy.ts";

const HELP = `Run Justin locally with source reloads.

Usage: bun run dev [--once] [--interval-seconds 5]

Uses the configured live queue and durable task state. Stop the LaunchAgent
first with: bun src/cli.ts daemon stop
Ctrl-C stops after the current reconcile finishes. Save source to reload.
--once runs one reconcile with local host and container sources, then exits.
`;

function log(message: string): void {
  process.stdout.write(`[dev ${new Date().toLocaleTimeString()}] ${message}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h" },
      once: { type: "boolean" },
      "interval-seconds": { type: "string", default: "5" },
    },
    strict: true,
  });
  if (values.help === true) {
    process.stdout.write(HELP);
    return;
  }
  const intervalSeconds = z.coerce
    .number()
    .int()
    .min(1)
    .max(3600)
    .parse(values["interval-seconds"]);
  const paths = runtimePaths();
  const initialConfig = await loadConfig(paths);
  if (await new LaunchdService(paths, runCommand).isLoaded()) {
    throw new Error(
      "The LaunchAgent is loaded. Run `bun src/cli.ts daemon stop` before local development.",
    );
  }
  log("Checking native OpenAI model access and Woodpecker repository access");
  await checkConnections(initialConfig, runCommand);
  log("Checking GitHub App repository and branch protection access");
  await checkGitHubAccess({ config: initialConfig, paths, run: runCommand });
  const sourcePackage = path.resolve(import.meta.dirname, "..");
  const toolkitDirectory = path.resolve(sourcePackage, "../toolkit/dist/dev");
  const toolkitPath = path.join(toolkitDirectory, "toolkit");
  log("Building the trusted host Toolkit from this checkout");
  requireSuccess(
    "Dev host Toolkit build",
    await runCommand(
      [
        process.execPath,
        "build",
        path.resolve(sourcePackage, "../toolkit/src/index.ts"),
        "--target",
        "bun",
        "--external",
        "ffmpeg-static",
        "--outfile",
        toolkitPath,
      ],
      { cwd: path.resolve(sourcePackage, "../..") },
    ),
  );
  await chmod(toolkitPath, 0o700);
  const controller = new AbortController();
  const stop = () => {
    if (controller.signal.aborted) return;
    log("Stopping after the current reconcile; task state will be preserved");
    controller.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const store = new StateStore(paths);
  const turn = async (): Promise<number> => {
    // Resolve references on every turn, just as launchd does. Only op://
    // references enter this environment; op run owns secret injection.
    const config = await loadConfig(paths);
    log("Starting fresh reconcile with local source");
    const child = Bun.spawn(
      [
        "op",
        "run",
        "--",
        process.execPath,
        path.join(sourcePackage, "src/cli.ts"),
        "reconcile",
        "--runner-source",
        sourcePackage,
      ],
      {
        cwd: path.resolve(sourcePackage, "../.."),
        env: {
          ...Bun.env,
          PATH: `${toolkitDirectory}:${Bun.env["PATH"] ?? ""}`,
          LINEAR_API_KEY: config.linear.apiKey,
          WOODPECKER_TOKEN: config.woodpecker.apiToken,
          WOODPECKER_URL: config.woodpecker.baseUrl,
          WOODPECKER_REPO_ID: String(config.woodpecker.repoId),
          PINCHTAB_CONFIG: config.pinchtab.configPath,
        },
        // Isolate terminal signals so Ctrl-C can drain the whole reconcile,
        // including its Docker cleanup, instead of orphaning an agent turn.
        detached: true,
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    const started = Date.now();
    const heartbeat = setInterval(() => {
      log(
        `Reconcile still running (${String(Math.round((Date.now() - started) / 1000))}s)`,
      );
    }, 15_000);
    let exitCode: number;
    try {
      exitCode = await child.exited;
    } finally {
      clearInterval(heartbeat);
    }
    for (const state of await store.list()) {
      log(formatTaskStatus(state));
    }
    return exitCode;
  };
  try {
    log(`Host and container source: ${sourcePackage}`);
    log(`Live queue state: ${paths.state}`);
    log(
      "Ctrl-C drains the current turn. Source edits queue a fresh reconcile.",
    );
    if (values.once === true) {
      process.exitCode = await turn();
    } else {
      await runDevLoop({
        watchPath: path.join(sourcePackage, "src"),
        intervalMs: intervalSeconds * 1000,
        signal: controller.signal,
        turn,
        log,
      });
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
