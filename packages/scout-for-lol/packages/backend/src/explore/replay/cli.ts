import path from "node:path";
import { EXPLORE_REPLAY_PROFILES } from "#src/explore/replay/profiles.ts";

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
  /** One or more profile names, run as a matrix. */
  readonly profiles: readonly string[];
  readonly includeChips: boolean;
  readonly includeConversations: boolean;
  /** Cap on cases per profile, for iterating without paying for a sweep. */
  readonly limit: number | null;
  readonly concurrency: number;
  /** Continue a previous run, skipping cases it already recorded. */
  readonly resumeRunId: string | null;
  /** A previous run to compare against; required for chips to mean anything. */
  readonly baselineRunId: string | null;
  /** Run exactly one case, by id. */
  readonly onlyCaseId: string | null;
  readonly write: boolean;
};

export type ReplayCliParseResult =
  | { readonly kind: "help" }
  | { readonly kind: "options"; readonly options: ReplayCliOptions };

const PROFILE_NAMES = EXPLORE_REPLAY_PROFILES.map(
  (profile) => profile.name,
).join(", ");

export const USAGE = `Usage: bun run test:explore:replay -- [options]

Replays Explore cases against a pinned stage dataset and writes a bundle.

Options:
  --stage <beta|prod>      Which pinned dataset to read (default: beta)
  --profile <name>         Capability profile; repeat or comma-separate
                           (default: minimal,full). Known: ${PROFILE_NAMES}
  --chips                  Include the shipped starter chips
  --conversations          Include the curated conversation corpus
  --limit <n>              Cap cases per profile
  --concurrency <n>        Cases in flight at once (default: 4)
  --resume <runId>         Continue a run, skipping recorded cases
  --baseline <runId>       Compare against a previous run
  --only <caseId>          Run exactly one case
  --write                  Persist the report next to the code it grades
  --help                   Show this help

With neither --chips nor --conversations, chips are run: they need no corpus.
This calls a live model and is a manual gate, never CI.`;

const DEFAULT_PROFILES = ["minimal", "full"] as const;

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

/** Every profile name that is not one of the built-ins. */
export function unknownProfiles(names: readonly string[]): readonly string[] {
  const known = new Set(EXPLORE_REPLAY_PROFILES.map((entry) => entry.name));
  return names.filter((name) => !known.has(name));
}

export function parseReplayArgs(args: readonly string[]): ReplayCliParseResult {
  let stage: ReplayStageName = "beta";
  const profiles: string[] = [];
  let includeChips = false;
  let includeConversations = false;
  let limit: number | null = null;
  let concurrency = 4;
  let resumeRunId: string | null = null;
  let baselineRunId: string | null = null;
  let onlyCaseId: string | null = null;
  let write = false;

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
      case "--write":
        write = true;
        continue;
      case "--stage":
        stage = parseStage(requireValue(args, index, "--stage"));
        index += 1;
        continue;
      case "--profile":
        profiles.push(
          ...requireValue(args, index, "--profile")
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
        onlyCaseId = requireValue(args, index, "--only");
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

  const selected = profiles.length > 0 ? profiles : [...DEFAULT_PROFILES];
  const unknown = unknownProfiles(selected);
  if (unknown.length > 0) {
    throw new Error(
      `Unknown profile(s): ${unknown.join(", ")}. Known: ${PROFILE_NAMES}`,
    );
  }
  // Duplicates would run the same matrix cell twice and double the spend for
  // nothing; the second run's bundle would also overwrite the first's.
  const deduplicated = [...new Set(selected)];

  return {
    kind: "options",
    options: {
      stage,
      profiles: deduplicated,
      // Chips need no corpus, so they are what an unqualified run does.
      includeChips: includeChips || !includeConversations,
      includeConversations,
      limit,
      concurrency,
      resumeRunId,
      baselineRunId,
      onlyCaseId,
      write,
    },
  };
}
