import { parseArgs } from "node:util";
import { reapPinchtabLeaseTarget } from "#lib/pinchtab-cli/client.ts";
import type { PinchtabClientOptions } from "#lib/pinchtab-cli/http.ts";
import {
  acquireLease,
  listLeases,
  releaseLease,
  wrapWithLease,
} from "#lib/tend/leases.ts";
import {
  DEFAULT_WORKTREE_MIN_AGE_MS,
  parseByteSize,
  parseDurationMs,
  resolveTendPaths,
  type TendPaths,
} from "#lib/tend/paths.ts";
import {
  defaultCommandRunner,
  snapshotOsProcesses,
} from "#lib/tend/process-probe.ts";
import type { LockTiming } from "#lib/tend/run-lock.ts";
import { runTend } from "#lib/tend/runner.ts";
import {
  buildTailscaleServeOffArgv,
  IMMUNE_TAILSCALE_PORT,
} from "#lib/tend/tailscale-serve.ts";
import {
  type CommandRunner,
  LeaseKindSchema,
  type TendSurface,
  TendSurfaceSchema,
} from "#lib/tend/types.ts";
import {
  handleTendScheduleCommand,
  type TendScheduleDeps,
} from "./schedule.ts";
import { formatLeaseList, formatTendReport } from "./tend-format.ts";

const TEND_HELP = `
toolkit tend — inspect and reap orphaned local dev resources (dry-run by default)

Usage:
  toolkit tend status [--json] [--worktree-min-age 3d] [--offline]
  toolkit tend run [--apply] [--only <surfaces>] [--worktree-min-age 3d] [--immediate-proxies] [--lock-wait 0s] [--offline] [--json]
  toolkit tend worktrees [--apply] [--worktree-min-age 3d] [--git-dir <dir>] [--include-closed-prs] [--lock-wait 0s] [--summary] [--verbose] [--json]
  toolkit tend dedupe [--apply] [--worktree <path>] [--dedupe-min-size 64k] [--no-refresh] [--lock-wait 0s] [--git-dir <dir>] [--summary] [--json]
  toolkit tend schedule install | uninstall | status [--json]
  toolkit tend lease list [--json]
  toolkit tend lease acquire --kind <kind> --target <target> [--ttl 4h] [--worktree <path>] [--id <id>] [--json]
  toolkit tend lease release <id> [--json]
  toolkit tend lease wrap --kind <kind> --target <target> [--ttl 4h] -- <command...>

Surfaces (--only comma-separated):
  worktrees, dedupe, postgres, processes, tailscale-serve, docker, artifacts, leases

Notes:
  - Runs are read-only / dry-run unless --apply is passed. Only one applied
    run works at a time: a second one fails at once, or with --lock-wait
    <duration> waits that long for the first to finish. Dry runs never wait.
  - A worktree is removed only when nothing holds it (live Herdr terminal,
    process, lease, Forum notice, pool or live-agent lock), it has no open
    pull request, and it has been idle for 3d (72h) by default. Uncommitted
    work, and detached commits that are not on the default branch, are saved
    under refs/tend/rescue/ first; unmerged branches are kept.
  - --summary prints the per-reason keep counts without the item lists;
    --verbose also lists every kept worktree with its reason.
  - dedupe replaces tracked files that are identical across a repository's
    worktrees with APFS copy-on-write clones of one copy (macOS only). Nothing
    is deleted. Files under --dedupe-min-size (default 64k), modified or
    untracked files, and worktrees mid git operation are left alone;
    --worktree limits replacement to one worktree. The index is refreshed
    afterwards only in worktrees nobody is using; --no-refresh skips it
    everywhere. "tend status" does not plan dedupe unless --only names it.
  - "schedule install" loads a macOS LaunchAgent that runs
    "tend run --apply --only worktrees,dedupe" daily at 04:30 local time (or at the
    next wake after it). Installing removes nothing. To sweep by hand, read
    "tend worktrees" (dry run), then run "tend worktrees --apply".
  - Open Forum notices scoped to host/<thisHost> protect referenced paths, and
    notices with "databases" or "testing" hold postgres + processes sweeps.
  - Tailscale Serve port 443 and root "/" are unconditionally immune.
`.trim();

function parseSurfaceFilter(
  rawValues: readonly string[] | undefined,
): TendSurface[] | undefined {
  if (rawValues === undefined || rawValues.length === 0) {
    return undefined;
  }
  const tokens = rawValues
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return tokens.length === 0
    ? undefined
    : tokens.map((token) => TendSurfaceSchema.parse(token));
}

function parseTendSweepArgs(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    allowPositionals: true,
    options: {
      apply: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      only: { type: "string", multiple: true },
      "worktree-min-age": { type: "string" },
      "git-dir": { type: "string" },
      worktree: { type: "string" },
      "dedupe-min-size": { type: "string" },
      "no-refresh": { type: "boolean", default: false },
      "lock-wait": { type: "string" },
      "immediate-proxies": { type: "boolean", default: false },
      "include-closed-prs": { type: "boolean", default: false },
      "remove-clean-worktrees": { type: "boolean", default: false },
      "stale-pr-days": { type: "string" },
      "no-prs": { type: "boolean", default: false },
      "no-color": { type: "boolean", default: false },
      offline: { type: "boolean", default: false },
      summary: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
}

async function releaseTailscaleServeTargetIfApplicable(
  target: string,
  runner: CommandRunner,
): Promise<void> {
  const match = /^(?:(https|http|tcp):)?(\d+)$/iu.exec(target.trim());
  if (match === null) {
    return;
  }
  const rawProto = match[1]?.toLowerCase();
  const port = Number(match[2]);
  if (
    port === IMMUNE_TAILSCALE_PORT ||
    !Number.isInteger(port) ||
    port <= 0 ||
    port > 65_535
  ) {
    return;
  }
  const protocol =
    rawProto === "tcp" ? "tcp" : rawProto === "http" ? "http" : "https";
  await runner(buildTailscaleServeOffArgv({ protocol, externalPort: port }), {
    timeoutMs: 5000,
  });
}

async function runLeaseListAction(
  args: readonly string[],
  paths: TendPaths,
  runner: CommandRunner,
): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: { json: { type: "boolean", default: false } },
  });
  const processes = await snapshotOsProcesses({ runner });
  const classified = await listLeases({ paths, processes });
  console.log(
    values.json
      ? JSON.stringify(classified, null, 2)
      : formatLeaseList(classified),
  );
}

async function runLeaseReleaseAction(
  args: readonly string[],
  paths: TendPaths,
  runner: CommandRunner,
  pinchtab?: PinchtabClientOptions,
): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { json: { type: "boolean", default: false } },
  });
  const leaseId = positionals[0];
  if (leaseId === undefined || leaseId.length === 0) {
    throw new Error("Usage: toolkit tend lease release <id> [--json]");
  }
  const allLeases = await listLeases({ paths });
  const existing = allLeases.find((item) => item.lease.id === leaseId);
  if (existing?.lease.kind === "tailscale-serve") {
    await releaseTailscaleServeTargetIfApplicable(
      existing.lease.target,
      runner,
    );
  } else if (existing?.lease.kind === "pinchtab") {
    const teardown = await reapPinchtabLeaseTarget(
      existing.lease.target,
      pinchtab,
    );
    if (!teardown.ok && teardown.detail !== undefined) {
      console.error(`Warning: ${teardown.detail}`);
    }
  }
  const released = await releaseLease(leaseId, { paths });
  if (values.json) {
    console.log(JSON.stringify({ id: leaseId, released }, null, 2));
    return;
  }
  console.log(
    released ? `Released lease ${leaseId}` : `Lease ${leaseId} was not present`,
  );
}

async function runLeaseAcquireAction(
  args: readonly string[],
  paths: TendPaths,
  runner: CommandRunner,
): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      kind: { type: "string" },
      target: { type: "string" },
      ttl: { type: "string" },
      worktree: { type: "string" },
      id: { type: "string" },
      "owner-pid": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  if (values.kind === undefined || values.target === undefined) {
    throw new Error(
      "Usage: toolkit tend lease acquire --kind <kind> --target <target> [--ttl 4h] [--json]",
    );
  }
  const parsedOwnerPid =
    values["owner-pid"] === undefined ? undefined : Number(values["owner-pid"]);
  const validOwnerPid =
    parsedOwnerPid !== undefined &&
    Number.isInteger(parsedOwnerPid) &&
    parsedOwnerPid > 0
      ? parsedOwnerPid
      : undefined;
  const lease = await acquireLease({
    kind: LeaseKindSchema.parse(values.kind),
    target: values.target,
    ttl: values.ttl,
    worktree: values.worktree,
    id: values.id,
    ...(validOwnerPid === undefined ? {} : { ownerPid: validOwnerPid }),
    paths,
    runner,
  });
  console.log(
    values.json
      ? JSON.stringify(lease, null, 2)
      : `Acquired lease ${lease.id} (${lease.kind} -> ${lease.target}, expires ${lease.expiresAt})`,
  );
}

async function runLeaseWrapAction(
  args: readonly string[],
  paths: TendPaths,
  injectedRunner: CommandRunner | undefined,
): Promise<void> {
  const separatorIdx = args.indexOf("--");
  const optionArgs = separatorIdx === -1 ? args : args.slice(0, separatorIdx);
  const wrappedCommand =
    separatorIdx === -1 ? [] : args.slice(separatorIdx + 1);
  const { values, positionals } = parseArgs({
    args: [...optionArgs],
    allowPositionals: true,
    options: {
      kind: { type: "string" },
      target: { type: "string" },
      ttl: { type: "string" },
      worktree: { type: "string" },
    },
  });
  const commandArgv = wrappedCommand.length > 0 ? wrappedCommand : positionals;
  if (
    values.kind === undefined ||
    values.target === undefined ||
    commandArgv.length === 0
  ) {
    throw new Error(
      "Usage: toolkit tend lease wrap --kind <kind> --target <target> [--ttl 4h] -- <command...>",
    );
  }
  const exitCode = await wrapWithLease({
    kind: LeaseKindSchema.parse(values.kind),
    target: values.target,
    ttl: values.ttl,
    worktree: values.worktree,
    command: commandArgv,
    paths,
    ...(injectedRunner === undefined ? {} : { runner: injectedRunner }),
  });
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

async function handleLeaseSubcommand(
  args: readonly string[],
  options: {
    readonly paths?: TendPaths | undefined;
    readonly runner?: CommandRunner | undefined;
    readonly pinchtab?: PinchtabClientOptions | undefined;
  } = {},
): Promise<void> {
  const action = args[0];
  if (
    action === undefined ||
    action === "--help" ||
    action === "-h" ||
    (action !== "wrap" && args.includes("--help"))
  ) {
    console.log(TEND_HELP);
    return;
  }

  const paths = options.paths ?? resolveTendPaths();
  const runner = options.runner ?? defaultCommandRunner;
  const tail = args.slice(1);

  switch (action) {
    case "list":
      await runLeaseListAction(tail, paths, runner);
      return;
    case "release":
      await runLeaseReleaseAction(tail, paths, runner, options.pinchtab);
      return;
    case "acquire":
      await runLeaseAcquireAction(tail, paths, runner);
      return;
    case "wrap":
      await runLeaseWrapAction(tail, paths, options.runner);
      return;
    default:
      throw new Error(`Unknown tend lease action: ${action}`);
  }
}

export async function handleTendCommand(
  subcommand: string | undefined,
  args: string[],
  injected: {
    readonly runner?: CommandRunner | undefined;
    readonly paths?: TendPaths | undefined;
    readonly pinchtab?: PinchtabClientOptions | undefined;
    readonly schedule?: TendScheduleDeps | undefined;
    readonly lockTiming?: LockTiming | undefined;
  } = {},
): Promise<void> {
  if (
    subcommand === undefined ||
    subcommand === "--help" ||
    subcommand === "-h"
  ) {
    console.log(TEND_HELP);
    return;
  }

  if (subcommand === "lease") {
    await handleLeaseSubcommand(args, injected);
    return;
  }

  if (subcommand === "schedule") {
    await handleTendScheduleCommand(args, {
      ...injected.schedule,
      paths: injected.schedule?.paths ?? injected.paths,
    });
    return;
  }

  if (
    subcommand !== "status" &&
    subcommand !== "run" &&
    subcommand !== "worktrees" &&
    subcommand !== "dedupe"
  ) {
    throw new Error(
      `Unknown tend subcommand "${subcommand}". Expected status, run, worktrees, dedupe, schedule, or lease.`,
    );
  }

  await runTendSweepCommand(subcommand, args, injected);
}

async function runTendSweepCommand(
  subcommand: "status" | "run" | "worktrees" | "dedupe",
  args: string[],
  injected: {
    readonly runner?: CommandRunner | undefined;
    readonly paths?: TendPaths | undefined;
    readonly pinchtab?: PinchtabClientOptions | undefined;
    readonly lockTiming?: LockTiming | undefined;
  },
): Promise<void> {
  const { values, positionals } = parseTendSweepArgs(args);
  if (values.help) {
    console.log(TEND_HELP);
    return;
  }

  const worktreeMinAgeMs =
    values["worktree-min-age"] === undefined
      ? DEFAULT_WORKTREE_MIN_AGE_MS
      : parseDurationMs(values["worktree-min-age"]);

  const explicitGitDir = values["git-dir"] ?? positionals[0];
  const surfaces: readonly TendSurface[] | undefined =
    subcommand === "worktrees" || subcommand === "dedupe"
      ? [subcommand]
      : parseSurfaceFilter(values.only);

  const report = await runTend({
    mode: subcommand === "status" ? "status" : "run",
    apply: subcommand !== "status" && values.apply,
    surfaces,
    worktreeMinAgeMs,
    ...(explicitGitDir === undefined ? {} : { gitDirs: [explicitGitDir] }),
    ...(values["dedupe-min-size"] === undefined
      ? {}
      : { dedupeMinSizeBytes: parseByteSize(values["dedupe-min-size"]) }),
    dedupeWorktree: values.worktree,
    dedupeRefreshIndex: !values["no-refresh"],
    ...(values["lock-wait"] === undefined
      ? {}
      : { lockWaitMs: parseDurationMs(values["lock-wait"]) }),
    lockTiming: injected.lockTiming,
    checkPullRequests: !values["no-prs"],
    includeClosedPrs: values["include-closed-prs"],
    immediateProxies: values["immediate-proxies"],
    offline: values.offline,
    paths: injected.paths,
    runner: injected.runner,
    pinchtab: injected.pinchtab,
  });

  console.log(
    values.json
      ? JSON.stringify(report, null, 2)
      : formatTendReport(report, {
          verbose: values.verbose,
          summaryOnly: values.summary,
        }),
  );

  if (report.totals.failed > 0) {
    process.exitCode = 1;
  }
}
