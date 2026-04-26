import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { Glob } from "bun";
import path from "node:path";

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
  appleMailDir: string | undefined;
  skipApple: boolean;
  skipCostco: boolean;
  skipResearch: boolean;
  output: string | undefined;
  rebuildKb: boolean;
  skipEnrich: boolean;
  suggest: boolean;
};

export function getConfig(): Config {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      limit: { type: "string", default: "0" },
      "batch-size": { type: "string", default: "25" },
      model: { type: "string", default: "claude-sonnet-4-6" },
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
      "apple-mail-dir": { type: "string" },
      "skip-apple": { type: "boolean", default: false },
      "skip-costco": { type: "boolean", default: false },
      "skip-research": { type: "boolean", default: false },
      output: { type: "string" },
      "rebuild-kb": { type: "boolean", default: false },
      "skip-enrich": { type: "boolean", default: false },
      suggest: { type: "boolean", default: true },
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

  const appleMailDir = resolveAppleMailDir(values["apple-mail-dir"]);

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
    sclCsv: values["scl-csv"],
    skipScl: values["skip-scl"],
    appleMailDir,
    skipApple: values["skip-apple"],
    skipCostco: values["skip-costco"],
    skipResearch: values["skip-research"],
    output: values.output,
    rebuildKb: values["rebuild-kb"],
    skipEnrich: values["skip-enrich"],
    suggest: values.suggest,
  };
}

export function autoDetectAppleMailDir(
  mailmateRoots = getMailmateMessageRoots(),
): string | undefined {
  const archiveMessagesGlob = new Glob("**/Archive.mailbox/Messages");

  for (const mailmateRoot of mailmateRoots) {
    try {
      for (const match of archiveMessagesGlob.scanSync({
        cwd: mailmateRoot,
        onlyFiles: false,
      })) {
        if (match.includes("/[Gmail].mailbox/Archive.mailbox/Messages")) {
          return path.join(mailmateRoot, match);
        }
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

export function resolveAppleMailDir(
  explicitMailDir: string | undefined,
  mailmateRoots = getMailmateMessageRoots(),
): string | undefined {
  return explicitMailDir ?? autoDetectAppleMailDir(mailmateRoots);
}

function getMailmateMessageRoots(): string[] {
  return [
    path.join(
      homedir(),
      "Library",
      "Application Support",
      "MailMate",
      "Messages.noindex",
      "IMAP",
    ),
    path.join(
      homedir(),
      "Library",
      "Application Support",
      "MailMate",
      "Messages",
      "IMAP",
    ),
    path.join(homedir(), "com.freron.MailMate", "Messages", "IMAP"),
  ];
}
