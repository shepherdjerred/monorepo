#!/usr/bin/env bun

/** Print image selection and publication evidence to the Woodpecker step log. */
import { asRecord } from "../../../scripts/lib/json.ts";

const args = Bun.argv.slice(2);

function flagPath(flag: string, required: boolean): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    if (required) throw new Error(`${flag} is required`);
    return undefined;
  }
  const path = args[index + 1];
  if (path === undefined || path === "" || path.startsWith("--")) {
    throw new Error(`${flag} requires a file path`);
  }
  return path;
}

const reportPath = flagPath("--report", true);
if (reportPath === undefined) throw new Error("--report is required");
const report = asRecord(await Bun.file(reportPath).json());
if (
  report === null ||
  (report["mode"] !== "selected" && report["mode"] !== "all") ||
  !Array.isArray(report["changedPaths"]) ||
  asRecord(report["targets"]) === null
) {
  throw new Error("image selection report has an invalid shape");
}

const outcomesPath = flagPath("--outcomes", false);
const outcomes: unknown =
  outcomesPath === undefined ? [] : await Bun.file(outcomesPath).json();
if (!Array.isArray(outcomes)) {
  throw new TypeError("image push outcomes must be an array");
}

console.log(
  `Image release summary:\n${JSON.stringify({ report, outcomes }, null, 2)}`,
);
