#!/usr/bin/env bun

import { createInterface } from "node:readline/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { MastraModelConfig } from "@mastra/core/llm";
import { resolveProvider } from "@shepherdjerred/code-review";
import { MastraMaster, MastraWorkerRunner } from "./agents.ts";
import { FleetController } from "./controller.ts";
import { CommandFleetEnvironment } from "./environment.ts";
import type { FleetObserver } from "./ports.ts";
import { FleetControllerConfigSchema, type FleetSnapshot } from "./schemas.ts";
import { FleetStore } from "./state.ts";

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
  --help                    Show this help

Interactive commands:
  /status  /tick  /help  /stop
  Any other line is queued conversational steering for the master.`;

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
  const model = resolveModel(
    config.model,
    parsed.values["base-url"],
    parsed.values["api-key-env"],
  );
  const reviewProvider = resolveProvider(parsed.values["review-provider"]);
  const observer = new TerminalObserver();
  const store = new FleetStore(config.maxWorkers);
  const environment = new CommandFleetEnvironment(
    config.repo,
    config.checkout,
    config.worktreeRoot,
    reviewProvider,
  );
  const workerRunner = new MastraWorkerRunner(model, store, environment);
  const controller = new FleetController({
    config,
    environment,
    workerRunner,
    observer,
    store,
  });
  const master = new MastraMaster(model, controller, observer);
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let stopping = false;

  const stop = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    // Abort and await BOTH the controller workers and the master's in-flight
    // model turn before reporting shutdown and closing the terminal, so no
    // remote turn keeps emitting output or invoking tools after we have stopped.
    const [snapshot] = await Promise.all([controller.stop(), master.stop()]);
    observer.onSnapshot(snapshot);
    terminal.close();
  };
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
  for await (const rawLine of terminal) {
    const line = rawLine.trim();
    if (line === "/stop") {
      await stop();
      break;
    }
    switch (line) {
      case "/status": {
        observer.onSnapshot(controller.snapshot());

        break;
      }
      case "/tick": {
        await controller.tick("user");

        break;
      }
      case "/help": {
        process.stdout.write(`${HELP}\n`);

        break;
      }
      default:
        if (line.length > 0) {
          master.send(line);
        }
    }
    terminal.prompt();
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
