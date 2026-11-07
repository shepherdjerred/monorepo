import { parseArgs } from "node:util";
import { runPicker } from "#commands/brim/run-picker.tsx";
import {
  defaultSnapshotsPath,
  loadSnapshots,
  SnapshotCacheMissingError,
} from "#lib/brim/cache.ts";
import {
  formatLaunch,
  LaunchError,
  previewLaunch,
  resolveLaunch,
  spawnLaunch,
  type LaunchPreview,
  type ResolvedLaunch,
} from "#lib/brim/launch.ts";
import { findRequested, formatPickerRow } from "#lib/brim/selection.ts";
import {
  rankSnapshots,
  withKnownProviders,
  withoutQuotaData,
  type RankedEntry,
  type RankResult,
} from "#lib/brim/rank.ts";

const USAGE = `
toolkit brim — start a session on the least-used AI subscription

Ranks live Brim quota snapshots (5-hour gate, then budget usage with pacing)
and runs the pick's agent command from PATH (the wrappers in
~/.local/share/agent-bin own credential scrubbing and bypass flags):

  toolkit brim [--provider <id>] [--min-5h <pct>] [--dry-run] [-- <agent args...>]
  toolkit brim --json [--min-5h <pct>]

In a terminal, brim shows an interactive list: move with ↑↓, spawn with
Enter, cancel with Esc.

Options:
  --provider <id>     Skip picking; use this provider (id or display name),
                      even without usable quota data or a Brim cache on this
                      machine (warns)
  --min-5h <pct>      Minimum 5-hour remaining percent to stay available (default 10)
  --dry-run           Print the resolved command path and args without spawning
  --no-interactive    Never prompt; take the top-ranked provider
  --snapshots <path>  Read snapshots from <path> instead of Brim's cache
  --json              Print the ranking as JSON and exit without spawning
`;

type BrimOptions = {
  readonly provider: string | undefined;
  readonly minRemaining: number;
  readonly dryRun: boolean;
  readonly noInteractive: boolean;
  readonly snapshotsPath: string | undefined;
  readonly json: boolean;
};

function fail(message: string): never {
  console.error(`brim: ${message}`);
  process.exit(1);
}

function formatEntry(entry: RankedEntry): string {
  return formatPickerRow(entry);
}

function render(result: RankResult): string {
  const lines: string[] = ["Sorted by usage"];
  for (const entry of result.ranked) {
    lines.push(`  ${formatEntry(entry)}`);
  }
  if (result.other.length > 0) {
    lines.push("Other windows");
    for (const entry of result.other) {
      lines.push(`  ${formatEntry(entry)}`);
    }
  }
  lines.push("Unavailable");
  if (result.unavailable.length === 0) {
    lines.push("  (none)");
  }
  for (const entry of result.unavailable) {
    const reason = entry.reason ?? "no data";
    lines.push(`  ${entry.displayName} — ${reason}`);
  }
  return lines.join("\n");
}

function availableEntries(result: RankResult): RankedEntry[] {
  return [...result.ranked, ...result.other];
}

function parseOptions(args: string[]): {
  help: boolean;
  options: BrimOptions;
  extraArgs: string[];
} {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      provider: { type: "string" },
      "min-5h": { type: "string", default: "10" },
      "dry-run": { type: "boolean", default: false },
      "no-interactive": { type: "boolean", default: false },
      snapshots: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const minRemaining = Number.parseFloat(parsed.values["min-5h"]);
  if (
    !Number.isFinite(minRemaining) ||
    minRemaining < 0 ||
    minRemaining > 100
  ) {
    fail("--min-5h must be a number between 0 and 100.");
  }
  return {
    help: parsed.values.help,
    options: {
      provider: parsed.values.provider,
      minRemaining,
      dryRun: parsed.values["dry-run"],
      noInteractive: parsed.values["no-interactive"],
      snapshotsPath: parsed.values.snapshots,
      json: parsed.values.json,
    },
    extraArgs: parsed.positionals,
  };
}

function selectRequested(result: RankResult, requested: string): RankedEntry {
  const match = findRequested(result, requested);
  if (match === undefined) {
    const known = [...availableEntries(result), ...result.unavailable];
    fail(
      `Unknown provider "${requested}". Known: ${known.map((entry) => entry.provider).join(", ") || "none"}.`,
    );
  }
  if (!match.available) {
    console.error(
      `brim: ${match.displayName} has no usable quota data (${match.reason ?? "no data"}); starting it anyway.`,
    );
  }
  return match;
}

/** Launch previews per available provider, for the picker. */
function launchPreviews(
  available: readonly RankedEntry[],
): ReadonlyMap<string, LaunchPreview> {
  return new Map(
    available.map((entry) => [entry.provider, previewLaunch(entry.provider)]),
  );
}

async function resolveSelection(
  result: RankResult,
  options: BrimOptions,
): Promise<RankedEntry> {
  if (options.provider !== undefined) {
    return selectRequested(result, options.provider);
  }
  const available = availableEntries(result);
  if (options.noInteractive || !process.stdin.isTTY) {
    console.log(render(result));
    const top = available[0];
    if (top === undefined) {
      fail("All providers are unavailable; nothing to spawn.");
    }
    return top;
  }
  if (available.length === 0) {
    console.log(render(result));
    fail("All providers are unavailable; nothing to spawn.");
  }
  const chosen = await runPicker(result, launchPreviews(available));
  if (chosen === null) {
    fail("Selection cancelled; nothing to spawn.");
  }
  return chosen;
}

function resolveOrFail(
  provider: string,
  extraArgs: readonly string[],
): ResolvedLaunch {
  try {
    return resolveLaunch(provider, extraArgs);
  } catch (error: unknown) {
    if (error instanceof LaunchError) {
      fail(error.message);
    }
    throw error;
  }
}

async function spawnSelection(
  selected: RankedEntry,
  options: BrimOptions,
  extraArgs: string[],
): Promise<void> {
  const launch = resolveOrFail(selected.provider, extraArgs);
  if (options.dryRun) {
    console.log(`Would spawn: ${formatLaunch(launch)}`);
    return;
  }
  process.exit(await spawnLaunch(launch));
}

export async function handleBrimCommand(args: string[]): Promise<void> {
  const { help, options, extraArgs } = parseOptions(args);
  if (help) {
    console.log(USAGE);
    return;
  }
  let result: RankResult;
  try {
    result = withKnownProviders(
      rankSnapshots(
        await loadSnapshots(options.snapshotsPath ?? defaultSnapshotsPath()),
        { minFiveHourRemaining: options.minRemaining },
      ),
    );
  } catch (error: unknown) {
    // An explicit pick needs no ranking, so a machine that never ran the Brim
    // app (a remote Herdr machine) still starts it. A corrupt cache still fails.
    if (
      !(error instanceof SnapshotCacheMissingError) ||
      options.provider === undefined ||
      options.json
    ) {
      fail(error instanceof Error ? error.message : String(error));
    }
    result = withoutQuotaData("no Brim snapshot cache on this machine");
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ranked: result.ranked,
          other: result.other,
          unavailable: result.unavailable,
        },
        null,
        2,
      ),
    );
    return;
  }

  const selected = await resolveSelection(result, options);
  await spawnSelection(selected, options, extraArgs);
}
