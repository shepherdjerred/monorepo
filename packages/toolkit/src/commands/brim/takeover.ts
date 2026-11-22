import { runPicker } from "#commands/brim/run-picker.tsx";
import {
  parseTakeoverArgs,
  TAKEOVER_USAGE,
  type ParsedTakeoverArgs,
} from "#commands/brim/takeover-args.ts";
import {
  defaultSnapshotsPath,
  loadSnapshots,
  SnapshotCacheMissingError,
  type UsageSnapshot,
} from "#lib/brim/cache.ts";
import {
  formatLaunch,
  LaunchError,
  previewLaunch,
  type LaunchPreview,
  type Which,
} from "#lib/brim/launch.ts";
import {
  excludeProviders,
  rankSnapshots,
  withKnownProviders,
  withoutQuotaData,
  type RankedEntry,
  type RankResult,
} from "#lib/brim/rank.ts";
import { findRequested, formatPickerRow } from "#lib/brim/selection.ts";
import { TakeoverError } from "#lib/brim/takeover/errors.ts";
import {
  prepareTakeover,
  type PreparedTakeover,
} from "#lib/brim/takeover/handoff.ts";
import {
  replaceHerdrTerminal,
  resolveTakeoverLaunch,
  spawnTakeoverLaunch,
  type HerdrAppRunner,
  type HerdrDetachedRunner,
  type ResolvedTakeoverLaunch,
  type TakeoverSpawner,
} from "#lib/brim/takeover/launch.ts";
import {
  requireBrimProvider,
  type BrimProviderId,
} from "#lib/brim/takeover/providers.ts";
import {
  resolveTakeoverSession,
  type ResolveSessionOptions,
} from "#lib/brim/takeover/resolve.ts";
import {
  inspectTerminal,
  type HcCommandRunner,
} from "#lib/brim/takeover/terminal.ts";
import type { HistoryPaths, HistoryRuntimePaths } from "#lib/history/paths.ts";
import type { HistorySource } from "#lib/history/types.ts";

export type TakeoverCommandContext = {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly isTTY: boolean;
  readonly now: () => Date;
  readonly historyPaths?: HistoryPaths;
  readonly runtimePaths?: HistoryRuntimePaths;
  readonly sources?: readonly HistorySource[];
  readonly loadSnapshots: (path: string) => Promise<readonly UsageSnapshot[]>;
  readonly which?: Which;
  readonly runHc?: HcCommandRunner;
  readonly runHerdrApp?: HerdrAppRunner;
  readonly detachHerdrApp?: HerdrDetachedRunner;
  readonly spawn?: TakeoverSpawner;
  readonly copyToClipboard?: (text: string) => Promise<boolean>;
  readonly pickProvider: (
    result: RankResult,
    previews: ReadonlyMap<string, LaunchPreview>,
  ) => Promise<RankedEntry | null>;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
};

export function defaultTakeoverContext(): TakeoverCommandContext {
  return {
    env: Bun.env,
    isTTY: process.stdin.isTTY,
    now: () => new Date(),
    loadSnapshots: (filePath) => loadSnapshots(filePath),
    pickProvider: (result, previews) => runPicker(result, previews),
    stdout: (line) => {
      console.log(line);
    },
    stderr: (line) => {
      console.error(line);
    },
  };
}

function renderPlainRanking(result: RankResult): string {
  const lines: string[] = ["Target providers by usage"];
  for (const entry of result.ranked) {
    lines.push(`  ${formatPickerRow(entry)}`);
  }
  if (result.other.length > 0) {
    lines.push("Other windows");
    for (const entry of result.other) {
      lines.push(`  ${formatPickerRow(entry)}`);
    }
  }
  lines.push("Unavailable");
  for (const entry of result.unavailable) {
    lines.push(`  ${entry.displayName} — ${entry.reason ?? "no data"}`);
  }
  return lines.join("\n");
}

async function rankTargetProviders(
  parsed: ParsedTakeoverArgs,
  sourceProvider: string,
  context: TakeoverCommandContext,
): Promise<RankResult> {
  let result: RankResult;
  try {
    const snapshots = await context.loadSnapshots(
      parsed.snapshotsPath ?? defaultSnapshotsPath(),
    );
    result = withKnownProviders(
      rankSnapshots(snapshots, { minFiveHourRemaining: parsed.minRemaining }),
    );
  } catch (error: unknown) {
    if (
      !(error instanceof SnapshotCacheMissingError) ||
      parsed.to === undefined
    ) {
      throw new TakeoverError(
        error instanceof Error ? error.message : String(error),
      );
    }
    result = withoutQuotaData("no Brim snapshot cache on this machine");
  }
  const withSourceExcluded = excludeProviders(
    result,
    [sourceProvider],
    "excluded (source session provider)",
  );
  return excludeProviders(withSourceExcluded, parsed.exclude);
}

async function selectTargetEntry(
  result: RankResult,
  parsed: ParsedTakeoverArgs,
  prepared: PreparedTakeover,
  context: TakeoverCommandContext,
): Promise<RankedEntry> {
  if (parsed.to !== undefined) {
    const canonical = requireBrimProvider(parsed.to, "target");
    const match = findRequested(result, canonical);
    if (match === undefined) {
      throw new TakeoverError(`Unknown target provider "${parsed.to}".`);
    }
    if (!match.available) {
      context.stderr(
        `brim takeover: ${match.displayName} is unavailable (${match.reason ?? "no data"}); starting it anyway.`,
      );
    }
    return match;
  }

  const available = [...result.ranked, ...result.other];
  if (parsed.noInteractive || !context.isTTY) {
    if (!parsed.json) {
      context.stderr(renderPlainRanking(result));
    }
    const top = available[0];
    if (top === undefined) {
      throw new TakeoverError(
        `All target providers are unavailable; handoff saved at ${prepared.handoffPath}.`,
      );
    }
    return top;
  }

  if (available.length === 0) {
    context.stderr(renderPlainRanking(result));
    throw new TakeoverError(
      `All target providers are unavailable; handoff saved at ${prepared.handoffPath}.`,
    );
  }

  const previews = new Map(
    available.map((entry) => [
      entry.provider,
      context.which === undefined
        ? previewLaunch(entry.provider)
        : previewLaunch(entry.provider, context.which),
    ]),
  );
  const chosen = await context.pickProvider(result, previews);
  if (chosen === null) {
    throw new TakeoverError(
      `Selection cancelled; handoff saved at ${prepared.handoffPath}.`,
    );
  }
  return chosen;
}

function buildResolveOptions(
  parsed: ParsedTakeoverArgs,
  fromProvider: BrimProviderId | undefined,
  terminal: Awaited<ReturnType<typeof inspectTerminal>> | null,
  context: TakeoverCommandContext,
): ResolveSessionOptions {
  return {
    ...(parsed.historyId === undefined ? {} : { historyId: parsed.historyId }),
    ...(parsed.cwd === undefined ? {} : { cwd: parsed.cwd }),
    ...(fromProvider === undefined ? {} : { fromProvider }),
    terminal,
    ...(context.historyPaths === undefined
      ? {}
      : { historyPaths: context.historyPaths }),
    ...(context.runtimePaths === undefined
      ? {}
      : { runtimePaths: context.runtimePaths }),
    ...(context.sources === undefined ? {} : { sources: context.sources }),
  };
}

function resolveTerminalAddress(
  parsed: ParsedTakeoverArgs,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const terminalAddress =
    parsed.terminal ?? (parsed.herdr ? env["HC_TERMINAL_ID"] : undefined);
  if (
    parsed.herdr &&
    (terminalAddress === undefined || terminalAddress.trim().length === 0)
  ) {
    throw new TakeoverError(
      "--herdr requires --terminal <addr> or $HC_TERMINAL_ID.",
    );
  }
  return terminalAddress;
}

async function resolveAndPrepareTakeover(
  parsed: ParsedTakeoverArgs,
  terminalAddress: string | undefined,
  context: TakeoverCommandContext,
): Promise<PreparedTakeover> {
  const fromProvider =
    parsed.from === undefined
      ? undefined
      : requireBrimProvider(parsed.from, "source");
  const terminal =
    terminalAddress === undefined
      ? null
      : await inspectTerminal(terminalAddress, context.runHc);
  const session = await resolveTakeoverSession(
    buildResolveOptions(parsed, fromProvider, terminal, context),
  );
  return prepareTakeover(session, {
    ...(parsed.outputDir === undefined ? {} : { outputDir: parsed.outputDir }),
    ...(parsed.note === undefined ? {} : { note: parsed.note }),
    now: context.now(),
    terminal,
  });
}

function emitDryRunOutput(options: {
  readonly parsed: ParsedTakeoverArgs;
  readonly prepared: PreparedTakeover;
  readonly selected: RankedEntry;
  readonly launch: ResolvedTakeoverLaunch;
  readonly context: TakeoverCommandContext;
}): void {
  const { parsed, prepared, selected, launch, context } = options;
  if (parsed.json) {
    context.stdout(
      JSON.stringify(
        {
          prepared,
          targetProvider: selected.provider,
          mode: parsed.herdr ? "herdr" : "spawn",
          launch,
        },
        null,
        2,
      ),
    );
    return;
  }
  context.stdout(`Handoff written: ${prepared.handoffPath}`);
  context.stdout(
    `Would ${parsed.herdr ? "replace in Herdr with" : "spawn"} (${selected.displayName}): ${formatLaunch(launch)} (cwd: ${launch.cwd})`,
  );
}

async function executeHerdrReplacement(options: {
  readonly parsed: ParsedTakeoverArgs;
  readonly prepared: PreparedTakeover;
  readonly selected: RankedEntry;
  readonly launch: ResolvedTakeoverLaunch;
  readonly terminalAddress: string;
  readonly context: TakeoverCommandContext;
}): Promise<number> {
  const { parsed, prepared, selected, launch, terminalAddress, context } =
    options;
  const replacement = await replaceHerdrTerminal({
    terminalAddress,
    launch,
    prepared,
    keepOpen: parsed.keepOpen,
    currentTerminalId: context.env["HC_TERMINAL_ID"] ?? null,
    ...(context.runHerdrApp === undefined
      ? {}
      : { runHerdrApp: context.runHerdrApp }),
    ...(context.detachHerdrApp === undefined
      ? {}
      : { detachHerdrApp: context.detachHerdrApp }),
    ...(context.runHc === undefined ? {} : { runHc: context.runHc }),
  });
  context.stdout(
    parsed.json
      ? JSON.stringify(
          { prepared, targetProvider: selected.provider, replacement },
          null,
          2,
        )
      : `Switched ${terminalAddress} from ${prepared.sourceDisplayName} to ${selected.displayName} (handoff: ${prepared.handoffPath})`,
  );
  return 0;
}

function emitPreparedOutput(
  prepared: PreparedTakeover,
  json: boolean,
  context: TakeoverCommandContext,
): void {
  if (json) {
    context.stdout(JSON.stringify(prepared, null, 2));
    return;
  }
  context.stdout(
    `Prepared takeover from ${prepared.sourceDisplayName} ("${prepared.title}")`,
  );
  context.stdout(`  Workspace: ${prepared.cwd}`);
  context.stdout(`  Messages:  ${String(prepared.messageCount)}`);
  context.stdout(`  Handoff:   ${prepared.handoffPath}`);
}

async function runTakeoverLaunchFlow(
  parsed: ParsedTakeoverArgs,
  prepared: PreparedTakeover,
  terminalAddress: string | undefined,
  context: TakeoverCommandContext,
): Promise<number> {
  const ranked = await rankTargetProviders(
    parsed,
    prepared.sourceProvider,
    context,
  );
  const selected = await selectTargetEntry(ranked, parsed, prepared, context);
  const launch = resolveTakeoverLaunch(
    requireBrimProvider(selected.provider, "target"),
    prepared,
    parsed.extraArgs,
    context.which,
  );

  if (parsed.dryRun) {
    emitDryRunOutput({ parsed, prepared, selected, launch, context });
    return 0;
  }
  if (terminalAddress !== undefined && parsed.herdr) {
    return executeHerdrReplacement({
      parsed,
      prepared,
      selected,
      launch,
      terminalAddress,
      context,
    });
  }
  return spawnTakeoverLaunch(launch, {
    handoffPath: prepared.handoffPath,
    stderr: context.stderr,
    ...(context.spawn === undefined ? {} : { spawn: context.spawn }),
    ...(context.copyToClipboard === undefined
      ? {}
      : { copyToClipboard: context.copyToClipboard }),
  });
}

export async function handleTakeoverCommand(
  args: string[],
  _invocationPrefix: readonly string[] = [],
  context: TakeoverCommandContext = defaultTakeoverContext(),
): Promise<number> {
  try {
    const parsed = parseTakeoverArgs(args);
    if (parsed.help) {
      context.stdout(TAKEOVER_USAGE);
      return 0;
    }
    const terminalAddress = resolveTerminalAddress(parsed, context.env);
    const prepared = await resolveAndPrepareTakeover(
      parsed,
      terminalAddress,
      context,
    );
    if (parsed.prepare) {
      emitPreparedOutput(prepared, parsed.json, context);
      return 0;
    }
    return await runTakeoverLaunchFlow(
      parsed,
      prepared,
      terminalAddress,
      context,
    );
  } catch (error: unknown) {
    if (error instanceof TakeoverError || error instanceof LaunchError) {
      context.stderr(`brim takeover: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
