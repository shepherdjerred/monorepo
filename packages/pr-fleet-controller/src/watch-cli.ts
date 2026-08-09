#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { resolveRunDirectory } from "./run-recorder.ts";
import { resolveStateDirectory } from "./state-directory.ts";
import { startWatchServer } from "./watch-server.ts";
import { resolveLatestRunDirectory } from "./watch-tail.ts";

export function parseWatchArgs(args: string[]) {
  return parseArgs({
    args,
    options: {
      run: { type: "string" },
      "state-dir": { type: "string" },
      port: { type: "string" },
      "no-open": { type: "boolean", default: false },
    },
    strict: true,
  });
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`--port must be an integer in [0, 65535]: ${value}`);
  }
  return port;
}

async function resolveTarget(
  run: string | undefined,
  stateDirectory: string | undefined,
): Promise<string> {
  if (run !== undefined) {
    return resolveRunDirectory(run, stateDirectory);
  }
  const stateRoot = resolveStateDirectory(stateDirectory);
  const latest = await resolveLatestRunDirectory(stateRoot);
  if (latest === null) {
    throw new Error(
      `No run bundles found under ${stateRoot}. Pass --run <run-id-or-directory>.`,
    );
  }
  return latest;
}

function openBrowser(url: string): void {
  try {
    Bun.spawn(["open", url], { stdout: "inherit", stderr: "inherit" });
  } catch (error) {
    process.stderr.write(
      `Could not open a browser automatically (${error instanceof Error ? error.message : String(error)}). Open ${url} manually.\n`,
    );
  }
}

export async function runWatchCli(
  args: string[],
  controllerControlSocket?: string,
): Promise<void> {
  const parsed = parseWatchArgs(args);
  const runDirectory = await resolveTarget(
    parsed.values.run,
    parsed.values["state-dir"],
  );
  const port = parsePort(parsed.values.port);
  const server = startWatchServer({
    runDirectory,
    ...(controllerControlSocket === undefined
      ? {}
      : { controlSocket: controllerControlSocket }),
    ...(port === undefined ? {} : { port }),
  });

  process.stdout.write(`PR fleet dashboard: ${server.url}\n`);
  process.stdout.write(`Watching run: ${runDirectory}\n`);
  if (!parsed.values["no-open"]) {
    openBrowser(server.url);
  }

  const shutdown = (): void => {
    server.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (import.meta.main) {
  await runWatchCli(Bun.argv.slice(2));
}
