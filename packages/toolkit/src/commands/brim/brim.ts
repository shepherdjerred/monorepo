import { parseArgs } from "node:util";
import { runPicker } from "#commands/brim/run-picker.tsx";
import { defaultSnapshotsPath, loadSnapshots } from "#lib/brim/cache.ts";
import {
  buildFishProgram,
  directBinary,
  fishWord,
  noFishCommand,
  resolveFishEntries,
  type ResolvedFishEntry,
  spawnDirectBinary,
  spawnFishProgram,
  spawnNoFish,
} from "#lib/brim/fish.ts";
import { formatPickerRow } from "#lib/brim/selection.ts";
import {
  displayName,
  rankSnapshots,
  type RankedEntry,
  type RankResult,
} from "#lib/brim/rank.ts";

const USAGE = `
toolkit brim — start a session on the least-used AI subscription

Ranks live Brim quota snapshots (5-hour gate, then budget usage with pacing)
and spawns the pick through your interactive fish abbreviations/functions:

  toolkit brim [--provider <id>] [--min-5h <pct>] [--dry-run] [-- <agent args...>]
  toolkit brim --json [--min-5h <pct>]

In a terminal, brim shows an interactive list: move with ↑↓, spawn with
Enter, cancel with Esc.

Options:
  --provider <id>     Skip picking; use this provider (id or display name)
  --min-5h <pct>      Minimum 5-hour remaining percent to stay available (default 10)
  --dry-run           Print the resolved fish command without spawning
  --no-fish           Bypass fish; use the built-in fallback command (can drift)
  --no-interactive    Never prompt; take the top-ranked provider
  --snapshots <path>  Read snapshots from <path> instead of Brim's cache
  --json              Print the ranking as JSON and exit without spawning
`;

type BrimOptions = {
  readonly provider: string | undefined;
  readonly minRemaining: number;
  readonly dryRun: boolean;
  readonly noFish: boolean;
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
      "no-fish": { type: "boolean", default: false },
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
      noFish: parsed.values["no-fish"],
      noInteractive: parsed.values["no-interactive"],
      snapshotsPath: parsed.values.snapshots,
      json: parsed.values.json,
    },
    extraArgs: parsed.positionals,
  };
}

function selectRequested(result: RankResult, requested: string): RankedEntry {
  const normalized = requested.toLowerCase();
  const available = availableEntries(result);
  const match = available.find(
    (entry) =>
      entry.provider.toLowerCase() === normalized ||
      entry.displayName.toLowerCase() === normalized ||
      fishWord(entry.provider) === normalized ||
      directBinary(entry.provider) === normalized,
  );
  if (match !== undefined) return match;
  const stuck = result.unavailable.find(
    (entry) =>
      entry.provider.toLowerCase() === normalized ||
      entry.displayName.toLowerCase() === normalized,
  );
  if (stuck !== undefined) {
    console.log(render(result));
    fail(
      `${displayName(stuck.provider)} is unavailable: ${stuck.reason ?? "no data"}.`,
    );
  }
  fail(
    `Unknown provider "${requested}". Available: ${available.map((entry) => entry.provider).join(", ") || "none"}.`,
  );
}

/** Resolved fish programs per provider, for the picker preview. */
function previewPrograms(
  available: readonly RankedEntry[],
  entries: ReadonlyMap<string, ResolvedFishEntry>,
): ReadonlyMap<string, string> {
  const programs = new Map<string, string>();
  for (const entry of available) {
    const word = fishWord(entry.provider);
    if (word === null) continue;
    const program = buildFishProgram(
      word,
      entries.get(word) ?? { kind: "none" },
      [],
    );
    if (program !== null) programs.set(entry.provider, program);
  }
  return programs;
}

async function resolveSelection(
  result: RankResult,
  options: BrimOptions,
  previews: ReadonlyMap<string, string>,
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
  const chosen = await runPicker(result, previews, options.noFish);
  if (chosen === null) {
    fail("Selection cancelled; nothing to spawn.");
  }
  return chosen;
}

async function spawnDirect(
  selected: RankedEntry,
  options: BrimOptions,
  extraArgs: string[],
): Promise<void> {
  const binary = directBinary(selected.provider);
  if (binary === null) {
    fail(
      `No fish abbreviation or fallback binary for ${selected.displayName}. Add one to ~/.config/fish/config.fish.`,
    );
  }
  if (options.dryRun) {
    console.log(`Would spawn: ${[binary, ...extraArgs].join(" ")} (direct)`);
    if (Bun.which(binary) === null) {
      console.log(`note: "${binary}" is not on PATH yet.`);
    }
    return;
  }
  try {
    const { exitCode } = await spawnDirectBinary(binary, extraArgs);
    process.exit(exitCode);
  } catch (error: unknown) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function printFishDryRun(
  word: string,
  entry: ResolvedFishEntry,
  program: string,
): void {
  if (entry.kind === "function") {
    console.log(`fish defines "${word}" as a function:`);
    console.log(entry.body);
  } else if (entry.kind === "abbr") {
    console.log(`fish expands "${word}" to: ${entry.expansion}`);
  }
  console.log(`Would spawn: fish -i -c '${program}'`);
}

async function spawnSelection(
  selected: RankedEntry,
  options: BrimOptions,
  extraArgs: string[],
  entries: ReadonlyMap<string, ResolvedFishEntry>,
): Promise<void> {
  if (options.noFish) {
    const fallback = noFishCommand(selected.provider);
    if (fallback === null) {
      fail(`No --no-fish fallback configured for "${selected.provider}".`);
    }
    if (options.dryRun) {
      console.log(
        `Would spawn (no-fish fallback): ${[...fallback.argv, ...extraArgs].join(" ")}`,
      );
      return;
    }
    console.log(`Spawning (no-fish fallback): ${fallback.argv.join(" ")}`);
    try {
      const { exitCode } = await spawnNoFish(selected.provider, extraArgs);
      process.exit(exitCode);
    } catch (error: unknown) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
  const word = fishWord(selected.provider);
  if (word === null) {
    return spawnDirect(selected, options, extraArgs);
  }
  const entry = entries.get(word) ?? { kind: "none" };
  const program = buildFishProgram(word, entry, extraArgs);
  if (program === null) {
    // Fish defines nothing for this word: a bare `fish -i -c '<word>'`
    // would run whatever binary happens to be on PATH without the wrapper
    // flags, so use the direct binary when one is configured and fail
    // loudly otherwise.
    if (directBinary(selected.provider) !== null) {
      return spawnDirect(selected, options, extraArgs);
    }
    fail(
      `fish defines neither a function nor an abbreviation for "${word}". Add one to ~/.config/fish/config.fish or use --no-fish.`,
    );
  }
  if (options.dryRun) {
    printFishDryRun(word, entry, program);
    return;
  }
  const { exitCode } = await spawnFishProgram(program);
  process.exit(exitCode);
}

export async function handleBrimCommand(args: string[]): Promise<void> {
  const { help, options, extraArgs } = parseOptions(args);
  if (help) {
    console.log(USAGE);
    return;
  }
  let snapshots;
  try {
    snapshots = await loadSnapshots(
      options.snapshotsPath ?? defaultSnapshotsPath(),
    );
  } catch (error: unknown) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const result = rankSnapshots(snapshots, {
    minFiveHourRemaining: options.minRemaining,
  });

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

  const available = [...result.ranked, ...result.other];
  const words = [
    ...new Set(
      available.flatMap((entry) => {
        const word = fishWord(entry.provider);
        return word === null ? [] : [word];
      }),
    ),
  ];
  // --no-fish promises to bypass fish entirely, so it must not probe for
  // abbreviations first: on a machine without fish the spawn itself would
  // throw before the fallback is ever consulted.
  const entries: ReadonlyMap<string, ResolvedFishEntry> = options.noFish
    ? new Map()
    : await resolveFishEntries(words);

  const selected = await resolveSelection(
    result,
    options,
    previewPrograms(available, entries),
  );
  await spawnSelection(selected, options, extraArgs, entries);
}
