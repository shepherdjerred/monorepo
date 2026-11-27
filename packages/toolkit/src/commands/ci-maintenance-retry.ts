import { parseArgs } from "node:util";
import { z } from "zod";
import {
  CI_MAINTENANCE_KINDS,
  formatMaintenanceRetry,
  maintenanceRetry,
} from "#lib/ci/maintenance/retry.ts";

const USAGE = `toolkit ci maintenance retry <kind> [--apply] [--json]

Retry a blocked CI maintenance stream. Reads the ci-maintenance-coordinator
memo; if blocked[kind] exists and nothing is pending, sends the Temporal signal
maintenanceRetry {kind, requestId} bound to that blocked request. Otherwise
prints why not. Dry run unless --apply, which sends and reads the memo back.

  kind: ${CI_MAINTENANCE_KINDS.join(" | ")}
`;

export async function ciMaintenanceRetryCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      apply: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  if (positionals.length !== 1)
    throw new Error(`Expected one kind: ${CI_MAINTENANCE_KINDS.join(", ")}`);
  const kind = z.enum(CI_MAINTENANCE_KINDS).parse(positionals[0]);
  const report = await maintenanceRetry(
    kind,
    values.apply,
    AbortSignal.timeout(120_000),
  );
  console.log(
    values.json
      ? JSON.stringify(report, null, 2)
      : formatMaintenanceRetry(report),
  );
  if (report.plan.action === "refuse") process.exitCode = 1;
  else if (report.sent && report.blockCleared !== true) process.exitCode = 1;
}
