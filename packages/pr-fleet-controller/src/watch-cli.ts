#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { resolveRunDirectory, resolveStateDirectory } from "./run-recorder.ts";
import { startWatchServer } from "./watch-server.ts";
import { resolveLatestRunDirectory } from "./watch-tail.ts";

const parsed = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    run: { type: "string" },
    "state-dir": { type: "string" },
    port: { type: "string" },
    "no-open": { type: "boolean", default: false },
  },
  strict: true,
});

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

async function resolveTarget(): Promise<string> {
  const run = parsed.values.run;
  if (run !== undefined) {
    return resolveRunDirectory(run, parsed.values["state-dir"]);
  }
  const stateRoot = resolveStateDirectory(parsed.values["state-dir"]);
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

const runDirectory = await resolveTarget();
const server = startWatchServer({
  runDirectory,
  ...((): { port?: number } => {
    const port = parsePort(parsed.values.port);
    return port === undefined ? {} : { port };
  })(),
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
