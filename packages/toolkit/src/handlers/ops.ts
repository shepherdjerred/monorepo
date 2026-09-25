import { parseArgs } from "node:util";
import {
  OpsUsageError,
  opsSummaryCommand,
  parseSectionId,
} from "#commands/ops/ops.ts";
import { OpsSnapshotError } from "#lib/ops.ts";

const USAGE = `toolkit ops summary [--json] [--needs-me] [--section <id>]

Reads the homelab ops snapshot and prints overall severity, staleness, one
line per section, what is waiting on you, and the top attention signals.

Options:
  --json            Print the snapshot (or the selected slice) as JSON
  --needs-me        Only the signals whose next action is yours
  --section <id>    One section in detail: alerts, platform, delivery, work,
                    errors, product, ai, maintenance, observability

Configuration: OPS_DASHBOARD_URL or ops.dashboard.url in
~/.toolkit/config.toml (defaults to https://ops.tailnet-1a49.ts.net)`;

export async function handleOpsCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (
    subcommand === undefined ||
    subcommand === "--help" ||
    subcommand === "-h"
  ) {
    console.log(USAGE);
    return;
  }
  if (subcommand !== "summary") {
    throw new Error(`Unknown ops subcommand: ${subcommand}\n\n${USAGE}`);
  }
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      "needs-me": { type: "boolean", default: false },
      section: { type: "string" },
    },
    allowPositionals: false,
  });
  try {
    await opsSummaryCommand({
      json: values.json,
      needsMe: values["needs-me"],
      section:
        values.section === undefined
          ? undefined
          : parseSectionId(values.section),
    });
  } catch (error: unknown) {
    if (error instanceof OpsSnapshotError || error instanceof OpsUsageError) {
      console.error(`toolkit ops: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
