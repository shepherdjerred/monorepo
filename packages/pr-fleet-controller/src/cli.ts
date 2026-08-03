#!/usr/bin/env bun

import { createInterface } from "node:readline/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { MastraModelConfig } from "@mastra/core/llm";
import { resolveProvider } from "@shepherdjerred/code-review";
import { z } from "zod";
import { MastraMaster, MastraWorkerRunner } from "./agents.ts";
import { FleetController } from "./controller.ts";
import { resolveControllerSource } from "./controller-metadata.ts";
import { CommandFleetEnvironment } from "./environment.ts";
import {
  createFleetMastraRuntime,
  type FleetMastraRuntime,
} from "./mastra-runtime.ts";
import type { FleetObserver } from "./ports.ts";
import { RunRecorder } from "./run-recorder.ts";
import { FleetControllerConfigSchema, type FleetSnapshot } from "./schemas.ts";
import { FleetStore } from "./state.ts";
import { consumeTerminalLines, createSharedShutdown } from "./terminal-loop.ts";

const HELP = `Usage:
  bun run pr:fleet --model <provider>/<model> [options]

Options:
  --repo <owner/name>       Repository (default: shepherdjerred/monorepo)
  --checkout <path>         Main checkout (default: current Git root)
  --worktree-root <path>    Fleet worktrees (default: .claude/worktrees/pr-fleet)
  --max-workers <1..5>      Worker limit (default: 5)
  --base-url <url>          Required for openai-compatible/<model>
  --api-key-env <name>      API-key environment variable for a compatible endpoint
  --review-provider <id>    Hosted review provider to gate on (default: codex)
  --state-dir <path>        Local run-bundle root (default: XDG state directory)
  --help                    Show this help

Interactive commands:
  /status  /tick  /help  /stop
  Any other line is queued conversational steering for the master.`;

const ControllerPackageSchema = z.object({ version: z.string().min(1) });

class TerminalObserver implements FleetObserver {
  onSnapshot(snapshot: FleetSnapshot): void {
    const counts = [
      `open=${String(snapshot.open)}`,
      `green=${String(snapshot.green)}`,
      `active=${String(snapshot.active)}`,
      `queued=${String(snapshot.queued)}`,
      `pending=${String(snapshot.pending)}`,
      `paused=${String(snapshot.paused)}`,
    ].join(" ");
    process.stdout.write(`\n${counts}\n`);
  }

  onChange(change: string): void {
    process.stdout.write(`${change}\n`);
  }

  onMasterText(text: string): void {
    process.stdout.write(text);
  }
}

async function commandOutput(
  executable: string,
  args: string[],
): Promise<string> {
  const subprocess = Bun.spawn([executable, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${executable} failed: ${stderr.trim()}`);
  }
  return stdout.trim();
}

function requireTools(): void {
  for (const executable of [
    "bk",
    "bun",
    "gh",
    "git",
    "git-spice",
    "mise",
    "rg",
    "sandbox-exec",
  ]) {
    if (Bun.which(executable) === null) {
      throw new Error(`Required executable is missing: ${executable}`);
    }
  }
}

function resolveModel(
  model: string,
  baseUrl: string | undefined,
  apiKeyEnvironment: string | undefined,
): MastraModelConfig {
  if (!model.startsWith("openai-compatible/")) {
    if (baseUrl !== undefined || apiKeyEnvironment !== undefined) {
      throw new Error(
        "--base-url and --api-key-env are only valid with openai-compatible/<model>",
      );
    }
    return model;
  }
  if (baseUrl === undefined || apiKeyEnvironment === undefined) {
    throw new Error(
      "openai-compatible models require --base-url and --api-key-env",
    );
  }
  const apiKey = Bun.env[apiKeyEnvironment];
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(
      `API key environment variable is empty: ${apiKeyEnvironment}`,
    );
  }
  const modelId = model.slice("openai-compatible/".length);
  return createOpenAICompatible({
    baseURL: baseUrl,
    name: "pr-fleet-compatible",
    apiKey,
  }).chatModel(modelId);
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      model: { type: "string" },
      repo: { type: "string", default: "shepherdjerred/monorepo" },
      checkout: { type: "string" },
      "worktree-root": { type: "string" },
      "max-workers": { type: "string", default: "5" },
      "base-url": { type: "string" },
      "api-key-env": { type: "string" },
      "review-provider": { type: "string" },
      "state-dir": { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (parsed.values.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const modelName = parsed.values.model;
  if (modelName === undefined) {
    throw new Error("--model is required");
  }
  requireTools();
  const checkout =
    parsed.values.checkout ??
    (await commandOutput("git", ["rev-parse", "--show-toplevel"]));
  const config = FleetControllerConfigSchema.parse({
    model: modelName,
    repo: parsed.values.repo,
    checkout,
    worktreeRoot:
      parsed.values["worktree-root"] ??
      path.join(checkout, ".claude", "worktrees", "pr-fleet"),
    maxWorkers: Number(parsed.values["max-workers"]),
  });
  const apiKeyEnvironment = parsed.values["api-key-env"];
  const packageMetadata = ControllerPackageSchema.parse(
    await Bun.file(path.join(import.meta.dir, "..", "package.json")).json(),
  );
  const controllerSource = await resolveControllerSource();
  const configuredSecret =
    apiKeyEnvironment === undefined ? undefined : Bun.env[apiKeyEnvironment];
  const stateDirectory = parsed.values["state-dir"];
  const recorder = await RunRecorder.create({
    ...(stateDirectory === undefined ? {} : { stateDirectory }),
    controllerVersion: packageMetadata.version,
    controllerCommit: controllerSource.commit,
    controllerSourceDirty: controllerSource.dirty,
    controllerSourceFingerprint: controllerSource.fingerprint,
    model: config.model,
    repository: config.repo,
    checkout: config.checkout,
    worktreeRoot: config.worktreeRoot,
    maxWorkers: config.maxWorkers,
    secretValues:
      configuredSecret === undefined || configuredSecret.length === 0
        ? []
        : [configuredSecret],
  });
  recorder.record("run.started", {
    model: config.model,
    repository: config.repo,
    checkout: config.checkout,
    worktreeRoot: config.worktreeRoot,
    maxWorkers: config.maxWorkers,
    reviewProvider: parsed.values["review-provider"] ?? "codex",
  });
  process.stdout.write(`Run bundle: ${recorder.paths.runDirectory}\n`);

  let runtime: FleetMastraRuntime | undefined;
  let controller: FleetController | undefined;
  let master: MastraMaster | undefined;
  let terminal: ReturnType<typeof createInterface> | undefined;
  try {
    const model = resolveModel(
      config.model,
      parsed.values["base-url"],
      apiKeyEnvironment,
    );
    const reviewProvider = resolveProvider(parsed.values["review-provider"]);
    const observer = new TerminalObserver();
    const store = new FleetStore(config.maxWorkers);
    runtime = await createFleetMastraRuntime(recorder);
    const environment = new CommandFleetEnvironment({
      repo: config.repo,
      checkout: config.checkout,
      worktreeRoot: config.worktreeRoot,
      provider: reviewProvider,
      telemetry: recorder,
    });
    // The configured model key-env var (if any) is scrubbed from every worker
    // validation/setup subprocess in addition to the credential-name heuristic.
    const extraSecretNames =
      apiKeyEnvironment === undefined ? [] : [apiKeyEnvironment];
    const workerRunner = new MastraWorkerRunner(model, store, environment, {
      extraSecretNames,
      mastra: runtime.mastra,
      telemetry: recorder,
    });
    controller = new FleetController({
      config,
      environment,
      workerRunner,
      observer,
      store,
      telemetry: recorder,
    });
    master = new MastraMaster(model, controller, observer, {
      mastra: runtime.mastra,
      telemetry: recorder,
    });
    terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const stop = createSharedShutdown(async () => {
      const masterSettlement = master?.stop() ?? Promise.resolve();
      const snapshot =
        controller === undefined
          ? await masterSettlement.then(() => null)
          : await controller.stop(masterSettlement);
      if (snapshot !== null) {
        observer.onSnapshot(snapshot);
      }
      terminal?.close();
    });
    process.once("SIGINT", () => {
      void (async (): Promise<void> => {
        try {
          await stop();
        } catch (error) {
          process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`,
          );
          process.exitCode = 1;
        }
      })();
    });

    process.stdout.write(
      `PR fleet controller model=${config.model} workers=${String(config.maxWorkers)}\n${HELP}\n`,
    );
    await controller.start();
    terminal.setPrompt("fleet> ");
    terminal.prompt();
    await consumeTerminalLines(
      terminal,
      async (rawLine) => {
        const line = rawLine.trim();
        recorder.record("operator.input", { line });
        if (line === "/stop") {
          return "stop";
        }
        switch (line) {
          case "/status": {
            observer.onSnapshot(controller?.snapshot() ?? store.snapshot());

            break;
          }
          case "/tick": {
            await controller?.tick("user");

            break;
          }
          case "/help": {
            process.stdout.write(`${HELP}\n`);

            break;
          }
          default:
            if (line.length > 0) {
              master?.send(line);
            }
        }
        terminal?.prompt();
        return "continue";
      },
      stop,
    );
    await runtime.shutdown();
    await recorder.finalize("completed", controller.snapshot());
  } catch (error) {
    let failure = error;
    try {
      await Promise.all([controller?.stop(), master?.stop()]);
      await runtime?.shutdown();
    } catch (shutdownError) {
      failure = new AggregateError(
        [error, shutdownError],
        "Controller failed and shutdown also failed",
      );
    }
    await recorder.finalize("failed", controller?.snapshot() ?? null, failure);
    throw failure;
  }
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
