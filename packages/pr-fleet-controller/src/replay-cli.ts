#!/usr/bin/env bun

import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadRunBundle, replayRunBundle } from "./run-inspection.ts";
import { resolveRunDirectory } from "./run-recorder.ts";

const PackageSchema = z.object({ version: z.string().min(1) });
const parsed = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    run: { type: "string" },
    "state-dir": { type: "string" },
    "allow-version-mismatch": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
  strict: true,
});
const run = parsed.values.run;
if (run === undefined) {
  throw new Error("--run <run-id-or-directory> is required");
}
const packageMetadata = PackageSchema.parse(
  await Bun.file(path.join(import.meta.dir, "..", "package.json")).json(),
);
const runDirectory = resolveRunDirectory(run, parsed.values["state-dir"]);
const report = replayRunBundle(await loadRunBundle(runDirectory), {
  currentControllerVersion: packageMetadata.version,
  allowVersionMismatch: parsed.values["allow-version-mismatch"],
});
if (parsed.values.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    `replay verified run=${report.runId} status=${report.status} events=${String(report.eventCount)} ticks=${String(report.ticks.completed)}/${String(report.ticks.started)} commands=${String(report.commands.completed)}/${String(report.commands.started)} tools=${String(report.tools.completed)}/${String(report.tools.started)} workers=completed:${String(report.workers.completed)},cancelled:${String(report.workers.cancelled)},started:${String(report.workers.started)} workerAttempts=${String(report.workerAttempts.completed)}/${String(report.workerAttempts.started)} masterTurns=${String(report.masterTurns.completed)}/${String(report.masterTurns.started)}\n`,
  );
}
