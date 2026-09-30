import path from "node:path";

/**
 * What one invocation of the replay harness is asked to do.
 *
 * Parsed separately from the script that acts on it, and before anything from
 * `#src/` is imported, because the script's whole safety story rests on
 * proving the environment points at the pinned dataset *before* the agent's
 * module singletons bind to whatever `DATABASE_URL` happens to say.
 */

export type ReplayStageName = "beta" | "prod";

export type ReplayCliOptions = {
  readonly stage: ReplayStageName;
  /**
   * Guilds to run as, by label or id. Empty means every guild in the pin,
   * which is the point: the dataset names the guilds worth evaluating.
   */
  readonly guilds: readonly string[];
  readonly includeChips: boolean;
  readonly includeConversations: boolean;
  /** Cap on cases per guild, for iterating without paying for a sweep. */
  readonly limit: number | null;
  readonly concurrency: number;
  /** Continue a previous run, skipping cases it already recorded. */
  readonly resumeRunId: string | null;
  /** A previous run to compare against; required for chips to mean anything. */
  readonly baselineRunId: string | null;
  /** Run exactly one case, by id. */
  /** Run just these cases: a targeted re-check at a fraction of a sweep's cost. */
  readonly onlyCaseIds: readonly string[] | null;
};

export type ReplayCliParseResult =
  | { readonly kind: "help" }
  | { readonly kind: "options"; readonly options: ReplayCliOptions };

export const USAGE = `Usage: bun run test:explore:replay -- [options]

Replays Explore cases against a pinned stage dataset and writes a bundle.

Options:
  --stage <beta|prod>      Which pinned dataset to read (default: beta)
  --guild <label|id>       Guild to run as; repeat or comma-separate
                           (default: every guild in the dataset pin)
  --chips                  Include the shipped starter chips
  --conversations          Include the curated conversation corpus
  --limit <n>              Cap cases per guild
  --concurrency <n>        Cases in flight at once (default: 4)
  --resume <runId>         Continue a run, skipping recorded cases
  --baseline <runId>       Compare against a previous run
  --only <caseId,...>      Run exactly these cases (comma-separated)
  --help                   Show this help

With neither --chips nor --conversations, chips are run: they need no corpus.

This calls a live model and is a manual gate, never CI.`;

/**
 * There is deliberately no --write.
 *
 * emitEvalReport's convention is to persist a report beside the code it
 * grades. That suits the small committed-corpus evals, whose corpora are
 * hand-written and in-tree; it does not suit a harness whose output is a
 * private local bundle of real conversation text. The half of the convention
 * that does apply — a non-zero exit when the run fails — is honoured by the
 * entry point.
 */

function parseStage(value: string): ReplayStageName {
  if (value === "beta" || value === "prod") return value;
  throw new Error(`--stage must be beta or prod, got ${value}`);
}

function parsePositiveInteger(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer, got ${value}`);
  }
  return parsed;
}

function requireValue(
  args: readonly string[],
  index: number,
  flag: string,
): string {
  const value = args[index + 1];
  if (value === undefined) throw new Error(`${flag} requires a value`);
  return value;
}

/**
 * Where `dev:lake-pull` leaves this stage's dataset pin.
 *
 * The same convention as `defaultLakeDestination` in
 * `scripts/dev/dev-lake-pull-plan.ts`, which is what writes it. The two must
 * agree or the harness looks for a pin the puller never created; both are one
 * path join, and both name the other.
 */
export function defaultDatasetPinPath(
  stage: ReplayStageName,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const dataHome =
    environment["XDG_DATA_HOME"] ??
    path.join(environment["HOME"] ?? "/tmp", ".local", "share");
  return path.join(
    dataHome,
    "scout-for-lol",
    "stage-dataset",
    stage,
    "dataset.json",
  );
}

export function parseReplayArgs(args: readonly string[]): ReplayCliParseResult {
  let stage: ReplayStageName = "beta";
  const guilds: string[] = [];
  let includeChips = false;
  let includeConversations = false;
  let limit: number | null = null;
  let concurrency = 4;
  let resumeRunId: string | null = null;
  let baselineRunId: string | null = null;
  let onlyCaseIds: readonly string[] | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--help":
      case "-h":
        return { kind: "help" };
      case "--chips":
        includeChips = true;
        continue;
      case "--conversations":
        includeConversations = true;
        continue;
      case "--stage":
        stage = parseStage(requireValue(args, index, "--stage"));
        index += 1;
        continue;
      case "--guild":
        guilds.push(
          ...requireValue(args, index, "--guild")
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0),
        );
        index += 1;
        continue;
      case "--limit":
        limit = parsePositiveInteger(
          "--limit",
          requireValue(args, index, "--limit"),
        );
        index += 1;
        continue;
      case "--concurrency":
        concurrency = parsePositiveInteger(
          "--concurrency",
          requireValue(args, index, "--concurrency"),
        );
        index += 1;
        continue;
      case "--resume":
        resumeRunId = requireValue(args, index, "--resume");
        index += 1;
        continue;
      case "--baseline":
        baselineRunId = requireValue(args, index, "--baseline");
        index += 1;
        continue;
      case "--only":
        onlyCaseIds = requireValue(args, index, "--only")
          .split(",")
          .map((caseId) => caseId.trim())
          .filter((caseId) => caseId.length > 0);
        index += 1;
        continue;
      // `undefined` is unreachable while the loop is bounded by `length`,
      // but the index signature admits it, and an unhandled case here would
      // silently skip an argument rather than refuse it.
      case undefined:
      default:
        throw new Error(`Unknown argument ${argument ?? ""}`);
    }
  }

  // Duplicates would run the same guild twice and double the spend for
  // nothing; the second run's bundle would also overwrite the first's.
  const deduplicated = [...new Set(guilds)];

  return {
    kind: "options",
    options: {
      stage,
      guilds: deduplicated,
      // Chips need no corpus, so they are what an unqualified run does.
      includeChips: includeChips || !includeConversations,
      includeConversations,
      limit,
      concurrency,
      resumeRunId,
      baselineRunId,
      onlyCaseIds,
    },
  };
}
