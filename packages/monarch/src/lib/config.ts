import { parseArgs } from "node:util";

export type Config = {
  monarchToken: string;
  anthropicApiKey: string;
  apply: boolean;
  limit: number;
  batchSize: number;
  model: string;
  skipAmazon: boolean;
  amazonYears: number[];
  forceScrape: boolean;
  sample: number;
  verbose: boolean;
  interactive: boolean;
};

export function getConfig(): Config {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      limit: { type: "string", default: "0" },
      "batch-size": { type: "string", default: "25" },
      model: { type: "string", default: "claude-sonnet-4-20250514" },
      "skip-amazon": { type: "boolean", default: false },
      "amazon-years": { type: "string" },
      "force-scrape": { type: "boolean", default: false },
      sample: { type: "string", default: "0" },
      verbose: { type: "boolean", default: false },
      interactive: { type: "boolean", default: false },
    },
    strict: true,
  });

  const monarchToken = Bun.env["MONARCH_TOKEN"];
  if (monarchToken === undefined || monarchToken === "") {
    throw new Error("MONARCH_TOKEN environment variable is required");
  }

  const anthropicApiKey = Bun.env["ANTHROPIC_API_KEY"];
  if (anthropicApiKey === undefined || anthropicApiKey === "") {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  const currentYear = new Date().getFullYear();
  const defaultYears = [currentYear - 1, currentYear];
  const amazonYearsRaw = values["amazon-years"];
  const amazonYears =
    amazonYearsRaw !== undefined && amazonYearsRaw !== ""
      ? amazonYearsRaw.split(",").map(Number)
      : defaultYears;

  return {
    monarchToken,
    anthropicApiKey,
    apply: values.apply,
    limit: Number(values.limit),
    batchSize: Number(values["batch-size"]),
    model: values.model,
    skipAmazon: values["skip-amazon"],
    amazonYears,
    forceScrape: values["force-scrape"],
    sample: Number(values.sample),
    verbose: values.verbose,
    interactive: values.interactive,
  };
}
