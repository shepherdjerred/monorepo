#!/usr/bin/env bun

import { createInterface } from "node:readline/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { MastraModelConfig } from "@mastra/core/llm";
import { resolveProvider } from "@shepherdjerred/code-review";
import { z } from "zod";
import { MastraMaster, MastraWorkerRunner } from "./agents.ts";
import { combineFailures, normalizeFailure } from "./cli-failures.ts";
import { settleCliResources } from "./cli-shutdown.ts";
import { FleetController } from "./controller.ts";
import {
  assertStateRootOutsideControllerRepository,
  resolveControllerSource,
} from "./controller-metadata.ts";
import { CommandFleetEnvironment } from "./environment.ts";
import {
  createFleetMastraRuntime,
  type FleetMastraRuntime,
} from "./mastra-runtime.ts";
import type { FleetObserver } from "./ports.ts";
import { runRecordedCommand } from "./recorded-command.ts";
import { resolveStateDirectory, RunRecorder } from "./run-recorder.ts";
import { FleetControllerConfigSchema, type FleetSnapshot } from "./schemas.ts";
import { FleetStore } from "./state.ts";
import { consumeTerminalLines, createSharedShutdown } from "./terminal-loop.ts";
import type { TerminalOutcome } from "./terminal-loop.ts";

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
const UNRESOLVED_COMMIT = "0".repeat(40);
const UNRESOLVED_FINGERPRINT = "0".repeat(64);
const EMPTY_SNAPSHOT: FleetSnapshot = {
  open: 0,
  green: 0,
  active: 0,
  queued: 0,
  pending: 0,
  paused: 0,
  prs: [],
};

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

function bootstrapWorkerLimit(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : 1;
}

function configuredSecretValues(value: string | undefined): readonly string[] {
  return value === undefined || value.length === 0 ? [] : [value];
}

function parseCliArgs(args: string[]) {
  return parseArgs({
    args,
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
}

function rawOptionValue(args: string[], name: string): string | undefined {
  const option = `--${name}`;
  const assignment = `${option}=`;
  for (const [index, argument] of args.entries()) {
    if (argument === option) {
      return args[index + 1];
    }
    if (argument.startsWith(assignment)) {
      return argument.slice(assignment.length);
    }
  }
  return undefined;
}

function parseInvocation(args: string[]) {
  const parsed = parseCliArgs(args);
  const modelName = parsed.values.model;
  if (modelName === undefined) {
    throw new Error("--model is required");
  }
  return { parsed, modelName };
}

async function createBootstrapRecorder(
  args: string[],
  controllerVersion: string,
): Promise<RunRecorder> {
  const bootstrapModel = rawOptionValue(args, "model") ?? "unresolved/unknown";
  const bootstrapRepository =
    rawOptionValue(args, "repo") ?? "shepherdjerred/monorepo";
  const bootstrapCheckout = rawOptionValue(args, "checkout") ?? process.cwd();
  const bootstrapWorktreeRoot =
    rawOptionValue(args, "worktree-root") ??
    path.join(bootstrapCheckout, ".claude", "worktrees", "pr-fleet");
  const bootstrapMaxWorkers = rawOptionValue(args, "max-workers") ?? "5";
  const stateDirectory = resolveStateDirectory(
    rawOptionValue(args, "state-dir"),
  );
  await assertStateRootOutsideControllerRepository(stateDirectory);
  const recorder = await RunRecorder.create({
    stateDirectory,
    controllerVersion,
    controllerCommit: UNRESOLVED_COMMIT,
    controllerSourceDirty: true,
    controllerSourceFingerprint: UNRESOLVED_FINGERPRINT,
    controllerSourceResolved: false,
    model: bootstrapModel,
    repository: bootstrapRepository,
    checkout: bootstrapCheckout,
    worktreeRoot: bootstrapWorktreeRoot,
    maxWorkers: bootstrapWorkerLimit(bootstrapMaxWorkers),
  });
  recorder.record("run.started", {
    phase: "preflight",
    model: bootstrapModel,
    repository: bootstrapRepository,
    checkout: bootstrapCheckout,
    worktreeRoot: bootstrapWorktreeRoot,
    maxWorkers: bootstrapMaxWorkers,
    reviewProvider: rawOptionValue(args, "review-provider") ?? "codex",
  });
  process.stdout.write(`Run bundle: ${recorder.paths.runDirectory}\n`);
  return recorder;
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.includes("--help")) {
    parseCliArgs(args);
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const packageMetadata = ControllerPackageSchema.parse(
    await Bun.file(path.join(import.meta.dir, "..", "package.json")).json(),
  );
  const recorder = await createBootstrapRecorder(args, packageMetadata.version);

  let runtime: FleetMastraRuntime | undefined;
  let runtimeInitialization: Promise<FleetMastraRuntime> | undefined;
  let controller: FleetController | undefined;
  let master: MastraMaster | undefined;
  let terminal: ReturnType<typeof createInterface> | undefined;
  let shutdownRequested = false;
  let preflightInProgress = true;
  let runFailure: Error | undefined;
  let finalizationPromise: Promise<void> | undefined;
  const observer = new TerminalObserver();
  const settleResources = createSharedShutdown(() =>
    settleCliResources<FleetSnapshot>({
      input: () => terminal,
      master: () => master,
      controller: () => controller,
      runtime: () => runtimeInitialization,
      observeSnapshot: (snapshot) => {
        observer.onSnapshot(snapshot);
      },
    }),
  );
  const finalizeRun = (outcome?: TerminalOutcome): Promise<void> => {
    if (outcome?.status === "failed") {
      runFailure = combineFailures(runFailure, outcome.error);
    }
    finalizationPromise ??= Promise.resolve().then(async () => {
      const settlement = await settleResources();
      let snapshot: FleetSnapshot | null = settlement.snapshot;
      if (settlement.failure !== undefined) {
        runFailure = combineFailures(runFailure, settlement.failure);
      }
      if (runFailure === undefined && controller === undefined) {
        snapshot = EMPTY_SNAPSHOT;
        recorder.record("shutdown.started", {
          activeWorkers: 0,
          phase: "startup",
        });
        recorder.record("shutdown.completed", { snapshot });
      }
      await recorder.finalize(
        runFailure === undefined ? "completed" : "failed",
        snapshot,
        runFailure ?? null,
      );
    });
    return finalizationPromise;
  };
  const stopAfterRequest = async (): Promise<void> => {
    try {
      await finalizeRun();
      if (runFailure !== undefined) {
        throw runFailure;
      }
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  };
  const handleSigint = (): void => {
    shutdownRequested = true;
    if (!preflightInProgress) {
      void stopAfterRequest();
    }
  };
  process.once("SIGINT", handleSigint);
  const finishIfRequested = async (): Promise<boolean> => {
    if (!shutdownRequested) {
      return false;
    }
    await finalizeRun();
    if (runFailure !== undefined) {
      throw runFailure;
    }
    return true;
  };
  try {
    const { parsed, modelName } = parseInvocation(args);
    const apiKeyEnvironment = parsed.values["api-key-env"];
    const configuredSecret =
      apiKeyEnvironment === undefined ? undefined : Bun.env[apiKeyEnvironment];
    if (await finishIfRequested()) {
      return;
    }
    requireTools();
    let checkout = parsed.values.checkout;
    if (checkout === undefined) {
      const checkoutResult = await runRecordedCommand(
        {
          executable: "git",
          args: ["rev-parse", "--show-toplevel"],
          cwd: process.cwd(),
          timeoutMs: 120_000,
          sensitiveOutput: true,
        },
        recorder,
      );
      if (checkoutResult.exitCode !== 0) {
        throw new Error(
          `git rev-parse --show-toplevel failed: ${checkoutResult.stderr.trim()}`,
        );
      }
      checkout = checkoutResult.stdout.trim();
    }
    if (await finishIfRequested()) {
      return;
    }
    const config = FleetControllerConfigSchema.parse({
      model: modelName,
      repo: parsed.values.repo,
      checkout,
      worktreeRoot:
        parsed.values["worktree-root"] ??
        path.join(checkout, ".claude", "worktrees", "pr-fleet"),
      maxWorkers: Number(parsed.values["max-workers"]),
    });
    const controllerSource = await resolveControllerSource({
      stateRoot: recorder.paths.root,
      run: (request) => runRecordedCommand(request, recorder),
    });
    if (await finishIfRequested()) {
      return;
    }
    await recorder.initializeController({
      controllerVersion: packageMetadata.version,
      controllerCommit: controllerSource.commit,
      controllerSourceDirty: controllerSource.dirty,
      controllerSourceFingerprint: controllerSource.fingerprint,
      model: config.model,
      repository: config.repo,
      checkout: config.checkout,
      worktreeRoot: config.worktreeRoot,
      maxWorkers: config.maxWorkers,
    });
    recorder.configureSecretValues(configuredSecretValues(configuredSecret));
    const model = resolveModel(
      config.model,
      parsed.values["base-url"],
      apiKeyEnvironment,
    );
    const reviewProvider = resolveProvider(parsed.values["review-provider"]);
    preflightInProgress = false;
    if (await finishIfRequested()) {
      return;
    }
    const store = new FleetStore(config.maxWorkers);
    runtimeInitialization = createFleetMastraRuntime(recorder);
    runtime = await runtimeInitialization;
    if (await finishIfRequested()) {
      return;
    }
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
    const activeController = controller;
    master = new MastraMaster(model, activeController, observer, {
      mastra: runtime.mastra,
      telemetry: recorder,
      requestShutdown: () => {
        shutdownRequested = true;
        void stopAfterRequest();
      },
    });
    terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    process.stdout.write(
      `PR fleet controller model=${config.model} workers=${String(config.maxWorkers)}\n${HELP}\n`,
    );
    await controller.start();
    if (await finishIfRequested()) {
      return;
    }
    terminal.setPrompt("fleet> ");
    terminal.prompt();
    await consumeTerminalLines(
      terminal,
      async (rawLine) => {
        if (shutdownRequested) {
          return "stop";
        }
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
      finalizeRun,
    );
    await finalizeRun();
    if (runFailure !== undefined) {
      throw runFailure;
    }
  } catch (error) {
    await finalizeRun({ status: "failed", error });
    throw runFailure ?? normalizeFailure(error);
  } finally {
    process.removeListener("SIGINT", handleSigint);
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
