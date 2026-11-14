import { parseArgs } from "node:util";
import { defaultSnapshotsPath } from "#lib/brim/cache.ts";
import {
  HistoryApiBlocksResponseSchema,
  HistoryApiUsageReportResponseSchema,
} from "#lib/history/api/report-schema.ts";
import {
  historyBlocks,
  loadQuotaSnapshots,
  parseBlocksParams,
} from "#lib/history/blocks.ts";
import { parseUsageReportParams } from "#lib/history/usage-report.ts";
import { renderBlocks, renderUsageReport } from "#lib/history/usage-render.ts";
import { withReadOnlyIndex } from "./read-index.ts";

/**
 * `toolkit history usage --period` and `toolkit history blocks`. Flags become
 * the API's query parameters and run through the same parsers and queries as
 * `/v1/usage?period=…` and `/v1/blocks`, so `--json` prints the API response.
 */

/** CLI flag → API query parameter. */
const REPORT_FLAGS = {
  period: "period",
  breakdown: "breakdown",
  since: "since",
  until: "until",
  timezone: "timezone",
  "start-of-week": "startOfWeek",
  agent: "agent",
  source: "source",
  machine: "machine",
  project: "project",
} as const;

function toParams(
  values: Readonly<Record<string, string | boolean | undefined>>,
  flags: Readonly<Record<string, string>>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [flag, param] of Object.entries(flags)) {
    const value = values[flag];
    if (typeof value === "string") {
      params.set(param, value);
    } else if (value === true) {
      params.set(param, "true");
    }
  }
  return params;
}

/** True when the arguments ask for the period report. */
export function wantsUsageReport(args: readonly string[]): boolean {
  return args.some((arg) => arg === "--period" || arg.startsWith("--period="));
}

export async function usageReportCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      ...Object.fromEntries(
        Object.keys(REPORT_FLAGS).map((flag) => [flag, { type: "string" }]),
      ),
      json: { type: "boolean", default: false },
    },
    strict: true,
  });
  const query = parseUsageReportParams(
    toParams(values, REPORT_FLAGS),
    new Date(),
  );
  const report = HistoryApiUsageReportResponseSchema.parse(
    await withReadOnlyIndex((index) => index.usageReport(query)),
  );
  console.log(
    values.json ? JSON.stringify(report, null, 2) : renderUsageReport(report),
  );
}

export async function blocksCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      active: { type: "boolean", default: false },
      agent: { type: "string" },
      since: { type: "string" },
      machine: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: true,
  });
  const now = new Date();
  const query = parseBlocksParams(
    toParams(values, {
      active: "active",
      agent: "agent",
      since: "since",
      machine: "machine",
    }),
    now,
  );
  const snapshots = await loadQuotaSnapshots(defaultSnapshotsPath());
  const response = HistoryApiBlocksResponseSchema.parse(
    await withReadOnlyIndex((index) =>
      historyBlocks(index, query, { now, snapshots }),
    ),
  );
  console.log(
    values.json ? JSON.stringify(response, null, 2) : renderBlocks(response),
  );
}
