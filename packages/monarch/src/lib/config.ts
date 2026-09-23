import { parseArgs } from "node:util";
import { z } from "zod";
import { latestSclCsv } from "./finance-vault.ts";

export type Config = {
  openRouterApiKey: string;
  apply: boolean;
  limit: number;
  batchSize: number;
  model: string;
  skipAmazon: boolean;
  amazonYears: number[];
  forceScrape: boolean;
  forceFetch: boolean;
  sample: number;
  verbose: boolean;
  interactive: boolean;
  venmoCsv: string | undefined;
  skipVenmo: boolean;
  conserviceCookies: string | undefined;
  skipBilt: boolean;
  skipUsaa: boolean;
  sclCsv: string | undefined;
  skipScl: boolean;
  skipApple: boolean;
  skipCostco: boolean;
  skipPaystub: boolean;
  skipEquity: boolean;
  skipBrokerage: boolean;
  skipLoan: boolean;
  skipResearch: boolean;
  output: string | undefined;
  checkpointFile: string | undefined;
  rebuildKb: boolean;
  skipEnrich: boolean;
  suggest: boolean;
  since: string;
  until: string;
  notesOnly: boolean;
  derivedOnly: boolean;
};

const DateFlagSchema = z.iso.date();
const DAY_MS = 24 * 60 * 60 * 1000;

// The pipeline historically looked at a fixed trailing year. That default is
// preserved exactly, but both ends are now addressable so history can be
// enriched without re-running classification over it.
export function resolveDateRange(
  since: string | undefined,
  until: string | undefined,
  now: Date,
): { since: string; until: string } {
  const resolvedUntil =
    until === undefined
      ? (now.toISOString().split("T")[0] ?? "")
      : DateFlagSchema.parse(until);
  const resolvedSince =
    since === undefined
      ? (new Date(now.getTime() - 365 * DAY_MS).toISOString().split("T")[0] ??
        "")
      : DateFlagSchema.parse(since);
  if (resolvedSince > resolvedUntil) {
    throw new Error(
      `--since ${resolvedSince} is after --until ${resolvedUntil}`,
    );
  }
  return { since: resolvedSince, until: resolvedUntil };
}

export function getConfig(): Config {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      limit: { type: "string", default: "0" },
      "batch-size": { type: "string", default: "25" },
      model: { type: "string", default: "gpt-5.6-luna" },
      since: { type: "string" },
      until: { type: "string" },
      "notes-only": { type: "boolean", default: false },
      "derived-only": { type: "boolean", default: false },
      "skip-amazon": { type: "boolean", default: false },
      "amazon-years": { type: "string" },
      "force-scrape": { type: "boolean", default: false },
      "force-fetch": { type: "boolean", default: false },
      sample: { type: "string", default: "0" },
      verbose: { type: "boolean", default: false },
      interactive: { type: "boolean", default: false },
      "venmo-csv": { type: "string" },
      "skip-venmo": { type: "boolean", default: false },
      "conservice-cookies": { type: "string" },
      "skip-bilt": { type: "boolean", default: false },
      "skip-usaa": { type: "boolean", default: false },
      "scl-csv": { type: "string" },
      "skip-scl": { type: "boolean", default: false },
      "skip-apple": { type: "boolean", default: false },
      "skip-costco": { type: "boolean", default: false },
      "skip-paystub": { type: "boolean", default: false },
      "skip-equity": { type: "boolean", default: false },
      "skip-brokerage": { type: "boolean", default: false },
      "skip-loan": { type: "boolean", default: false },
      "skip-research": { type: "boolean", default: false },
      output: { type: "string" },
      "checkpoint-file": { type: "string" },
      "rebuild-kb": { type: "boolean", default: false },
      "skip-enrich": { type: "boolean", default: false },
      suggest: { type: "boolean", default: true },
    },
    strict: true,
  });

  // --notes-only renders already-gathered facts and never reaches a tier, so
  // it makes no model call and needs no model credential. Demanding one would
  // make the cheapest mode the hardest to run.
  const notesOnly = values["notes-only"];
  const derivedOnly = values["derived-only"];
  const openRouterApiKey = Bun.env["OPENROUTER_API_KEY"] ?? "";
  if (openRouterApiKey === "" && !notesOnly && !derivedOnly) {
    throw new Error("OPENROUTER_API_KEY environment variable is required");
  }

  const currentYear = new Date().getFullYear();
  const defaultYears = [currentYear - 1, currentYear];
  const amazonYearsRaw = values["amazon-years"];
  const amazonYears =
    amazonYearsRaw !== undefined && amazonYearsRaw !== ""
      ? amazonYearsRaw.split(",").map(Number)
      : defaultYears;

  return {
    openRouterApiKey,
    apply: values.apply,
    limit: Number(values.limit),
    batchSize: Number(values["batch-size"]),
    model: values.model,
    skipAmazon: values["skip-amazon"],
    amazonYears,
    forceScrape: values["force-scrape"],
    forceFetch: values["force-fetch"],
    sample: Number(values.sample),
    verbose: values.verbose,
    interactive: values.interactive,
    venmoCsv: values["venmo-csv"],
    skipVenmo: values["skip-venmo"],
    conserviceCookies:
      values["conservice-cookies"] ?? Bun.env["CONSERVICE_COOKIES"],
    skipBilt: values["skip-bilt"],
    skipUsaa: values["skip-usaa"],
    sclCsv: values["scl-csv"] ?? latestSclCsv(),
    skipScl: values["skip-scl"],
    skipApple: values["skip-apple"],
    skipCostco: values["skip-costco"],
    skipPaystub: values["skip-paystub"],
    skipEquity: values["skip-equity"],
    skipBrokerage: values["skip-brokerage"],
    skipLoan: values["skip-loan"],
    skipResearch: values["skip-research"],
    output: values.output,
    checkpointFile: resolveCheckpointFile(
      values["checkpoint-file"],
      values.output,
    ),
    rebuildKb: values["rebuild-kb"],
    skipEnrich: values["skip-enrich"],
    suggest: values.suggest,
    ...resolveDateRange(values.since, values.until, new Date()),
    notesOnly,
    derivedOnly,
  };
}

export function deriveCheckpointPath(
  outputPath: string | undefined,
): string | undefined {
  if (outputPath === undefined || outputPath === "") return undefined;
  return outputPath.endsWith(".json")
    ? `${outputPath.slice(0, -".json".length)}.checkpoint.json`
    : `${outputPath}.checkpoint.json`;
}

export function resolveCheckpointFile(
  checkpointFile: string | undefined,
  outputPath: string | undefined,
): string | undefined {
  return checkpointFile !== undefined && checkpointFile !== ""
    ? checkpointFile
    : deriveCheckpointPath(outputPath);
}
