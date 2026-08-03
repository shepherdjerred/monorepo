#!/usr/bin/env bun

import path from "node:path";
import { parseArgs } from "node:util";
import { inspectEvents, loadRunBundle } from "./run-inspection.ts";
import { resolveRunDirectory } from "./run-recorder.ts";

const parsed = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    run: { type: "string" },
    "state-dir": { type: "string" },
    pr: { type: "string" },
    "show-bodies": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
  strict: true,
});

const run = parsed.values.run;
if (run === undefined) {
  throw new Error("--run <run-id-or-directory> is required");
}
const runDirectory = resolveRunDirectory(run, parsed.values["state-dir"]);
const bundle = await loadRunBundle(runDirectory);
const requestedPr = parsed.values.pr;
const prNumber = requestedPr === undefined ? undefined : Number(requestedPr);
if (prNumber !== undefined && (!Number.isInteger(prNumber) || prNumber < 1)) {
  throw new Error("--pr must be a positive integer");
}
const events = inspectEvents(bundle.events, {
  ...(prNumber === undefined ? {} : { prNumber }),
  showBodies: parsed.values["show-bodies"],
});

if (parsed.values.json) {
  process.stdout.write(
    `${JSON.stringify({ directory: path.resolve(runDirectory), ...bundle, events }, null, 2)}\n`,
  );
} else {
  process.stdout.write(
    `run=${bundle.manifest.runId} status=${bundle.summary.status} model=${bundle.manifest.model} events=${String(bundle.summary.eventCount)}\n`,
  );
  for (const event of events) {
    const correlation = Object.entries(event.correlation)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ");
    process.stdout.write(
      `${String(event.sequence).padStart(4)} ${event.timestamp} ${event.kind}${correlation.length === 0 ? "" : ` ${correlation}`} ${JSON.stringify(event.payload)}\n`,
    );
  }
}
