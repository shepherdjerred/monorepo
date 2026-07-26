import { z } from "zod";
import {
  proposeQueueWindowEdits,
  QueueWindowsFileSchema,
  type QueueWindowEdit,
  type QueueWindowWarning,
} from "@scout-for-lol/data/index.ts";
import { collectQueueActivity } from "./queue-activity-s3.ts";
// riot-patch.ts is a data-package script (not part of the package's src export
// surface), so it is referenced by path. This CLI is not in the ESLint `src`
// scope; keep it byte-clean for prettier/typecheck.
import { fetchPatches } from "../../data/scripts/riot-patch.ts";

const RawArgsSchema = z.array(z.string());

// The committed source of truth, resolved relative to this script so the CLI
// works regardless of cwd (Temporal runs it from packages/scout-for-lol).
const QUEUE_WINDOWS_PATH = new URL(
  "../../data/src/model/queue-windows.json",
  import.meta.url,
).pathname;

function optionalFlagValue(
  args: readonly string[],
  flag: string,
): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function requiredFlagValue(args: readonly string[], flag: string): string {
  const value = optionalFlagValue(args, flag);
  if (value === undefined) {
    throw new Error(`Missing required flag ${flag}`);
  }
  return value;
}

const CliConfigSchema = z.strictObject({
  bucket: z.string().min(1),
  lookbackDays: z.number().int().positive(),
  dryRun: z.boolean(),
  reportPath: z.string().min(1).optional(),
  awsProfile: z.string().min(1).optional(),
  endpointUrl: z.string().url().optional(),
});

type CliConfig = z.infer<typeof CliConfigSchema>;

function parseCliConfig(): CliConfig {
  const args = RawArgsSchema.parse(Bun.argv.slice(2));
  const lookbackRaw = optionalFlagValue(args, "--lookback-days");
  return CliConfigSchema.parse({
    bucket: requiredFlagValue(args, "--bucket"),
    lookbackDays: lookbackRaw === undefined ? 21 : Number(lookbackRaw),
    dryRun: args.includes("--dry-run"),
    reportPath: optionalFlagValue(args, "--report"),
    awsProfile: optionalFlagValue(args, "--aws-profile"),
    endpointUrl: optionalFlagValue(args, "--endpoint-url"),
  });
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysUtc(dateString: string, delta: number): string {
  const ms = Date.parse(`${dateString}T00:00:00.000Z`) + delta * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

type PatchNotes =
  | { titles: { title: string; url: string }[] }
  | { error: string };

async function fetchPatchNotes(): Promise<PatchNotes> {
  try {
    const patches = await fetchPatches();
    return {
      titles: patches
        .slice(0, 5)
        .map((patch) => ({ title: patch.title, url: patch.url })),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function unknownQueueIdsFromWarnings(
  warnings: readonly QueueWindowWarning[],
): { queueId: string; total: number }[] {
  const result: { queueId: string; total: number }[] = [];
  for (const warning of warnings) {
    if (warning.kind === "unknown-queue-id" && warning.queueId !== undefined) {
      result.push({ queueId: warning.queueId, total: warning.total });
    }
  }
  return result;
}

function printSummary(input: {
  config: CliConfig;
  today: string;
  startDate: string;
  endDate: string;
  edits: readonly QueueWindowEdit[];
  warnings: readonly QueueWindowWarning[];
  patchNotes: PatchNotes;
  changed: boolean;
}): void {
  const { config, edits, warnings, patchNotes } = input;
  console.log(
    `queue-windows watcher — ${config.dryRun ? "DRY RUN" : "APPLY"} (today ${input.today}, window ${input.startDate}..${input.endDate})`,
  );
  console.log(
    `proposed ${edits.length.toString()} edit(s), ${warnings.length.toString()} warning(s); file ${input.changed ? "would change" : "unchanged"}`,
  );
  for (const edit of edits) {
    console.log(`  edit [${edit.kind}] ${edit.message}`);
  }
  for (const warning of warnings) {
    console.log(`  warning [${warning.kind}] ${warning.message}`);
  }
  if ("error" in patchNotes) {
    console.log(`  patch notes unavailable: ${patchNotes.error}`);
  } else {
    for (const note of patchNotes.titles) {
      console.log(`  patch note: ${note.title} (${note.url})`);
    }
  }
}

async function main(): Promise<void> {
  const config = parseCliConfig();
  const today = todayUtc();
  const startDate = addDaysUtc(today, -config.lookbackDays);
  const endDate = addDaysUtc(today, -1);

  const counts = await collectQueueActivity({
    bucket: config.bucket,
    startDate,
    endDate,
    ...(config.awsProfile === undefined
      ? {}
      : { awsProfile: config.awsProfile }),
    ...(config.endpointUrl === undefined
      ? {}
      : { endpointUrl: config.endpointUrl }),
  });

  const currentRaw: unknown = await Bun.file(QUEUE_WINDOWS_PATH).json();
  const file = QueueWindowsFileSchema.parse(currentRaw);

  const { next, edits, warnings } = proposeQueueWindowEdits({
    file,
    counts,
    today,
    lookbackDays: config.lookbackDays,
  });

  const changed = edits.length > 0;
  if (changed && !config.dryRun) {
    await Bun.write(QUEUE_WINDOWS_PATH, `${JSON.stringify(next, null, 2)}\n`);
  }

  const patchNotes = await fetchPatchNotes();

  if (config.reportPath !== undefined) {
    const report = {
      generatedAt: new Date().toISOString(),
      today,
      lookbackDays: config.lookbackDays,
      observationWindow: { startDate, endDate },
      dryRun: config.dryRun,
      changed,
      edits,
      warnings,
      unknownQueueIds: unknownQueueIdsFromWarnings(warnings),
      perQueueCounts: counts,
      patchNotes,
    };
    await Bun.write(config.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  printSummary({
    config,
    today,
    startDate,
    endDate,
    edits,
    warnings,
    patchNotes,
    changed,
  });
}

await main();
