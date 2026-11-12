import { parseArgs } from "node:util";
import {
  formatRedactReport,
  runCaptureRedact,
} from "#commands/brim/capture.ts";
import { defaultBrimCapturePaths } from "#lib/brim/capture/paths.ts";
import { createSealer } from "#lib/brim/sync/crypto.ts";
import { defaultHistoryRuntimePaths } from "#lib/history/paths.ts";
import {
  HOMEBREW_JOB_PATH,
  assertDarwin,
  installLaunchAgentJob,
  launchAgentJobStatus,
  selfArgv,
  uninstallLaunchAgentJob,
  type LaunchAgentSpec,
} from "#lib/launchd.ts";
import { SyncSetupError } from "#lib/brim/sync/errors.ts";
import { acquireSyncLock } from "#lib/brim/sync/lock.ts";
import { readLocalManifest } from "#lib/brim/sync/manifest.ts";
import { readMirrorIndex } from "#lib/brim/sync/mirror-index.ts";
import { createS3ObjectStore } from "#lib/brim/sync/object-store.ts";
import {
  defaultBrimSyncPaths,
  type BrimSyncPaths,
} from "#lib/brim/sync/paths.ts";
import { pullArchive, type PullReport } from "#lib/brim/sync/pull.ts";
import { pushArchive, type PushReport } from "#lib/brim/sync/push.ts";
import {
  redactSources,
  type RedactReport,
} from "#lib/brim/sync/redact-files.ts";
import { syncRoots } from "#lib/brim/sync/scan.ts";
import {
  brokeredS3Credentials,
  lazyOpener,
  loadBrimSyncSettings,
  type BrimSyncSettings,
} from "#lib/brim/sync/settings.ts";

export const SYNC_USAGE = `
brim sync — encrypted cross-machine archive of Claude Code and Codex transcripts

  brim sync push [--json]          Archive new transcript lines to S3
  brim sync pull [--all] [--json]  Mirror other machines' recent sessions
  brim sync run [--json]           push, then pull (the macOS LaunchAgent)
  brim sync status [--json]        Local archive, mirror and agent state
  brim sync redact [--dry-run] [--json]
                                   Overwrite leaked credentials in this machine's
                                   transcripts and re-archive the affected files;
                                   also redacts brim capture's spool and store
  brim sync install | uninstall    Manage the 5-minute macOS LaunchAgent

push uploads every transcript, whatever its age; the archive never expires.
pull mirrors the last brim.sync.pull.since.days days (default 30) into
~/.toolkit/brim-sync/mirror/ for toolkit history and Brim; --all mirrors
everything. On Windows a Scheduled Task runs push; see the dotfiles-windows
source.

Push overwrites credentials (Anthropic, OpenAI and Linear keys, JWTs) with a
same-length REDACTED-<kind> marker before upload. redact does the same to the
local files in place, then retires their archive generations; run push next
to replace them in S3. Values are never printed.
`;

const LAUNCH_AGENT_LABEL = "com.jerred.brim-sync";
const INTERVAL_SECONDS = 300;

export function syncLaunchAgent(
  paths: BrimSyncPaths,
  invocationPrefix: readonly string[],
): LaunchAgentSpec {
  return {
    label: LAUNCH_AGENT_LABEL,
    plistPath: paths.launchAgent,
    programArguments: selfArgv([...invocationPrefix, "sync", "run"]),
    logsDir: paths.logsDir,
    keepAlive: false,
    startIntervalSeconds: INTERVAL_SECONDS,
    // The credential broker spawns `op` for the age identity and, in broker
    // mode, the S3 keys.
    environment: { PATH: HOMEBREW_JOB_PATH },
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? "TiB"}`;
}

async function store(settings: BrimSyncSettings) {
  const credentials = await brokeredS3Credentials(settings);
  return createS3ObjectStore({
    bucket: settings.bucket,
    profile: settings.profile,
    ...(credentials === undefined ? {} : { credentials }),
  });
}

async function runPush(
  settings: BrimSyncSettings,
  paths: BrimSyncPaths,
): Promise<PushReport> {
  return pushArchive({
    store: await store(settings),
    seal: createSealer(settings.recipient),
    open: lazyOpener(),
    paths,
    machineId: settings.machineId,
    displayName: settings.displayName,
    platform: settings.platform,
    roots: syncRoots(Bun.env, paths.home),
    log: (line) => {
      console.log(line);
    },
  });
}

async function runPull(
  settings: BrimSyncSettings,
  paths: BrimSyncPaths,
  all: boolean,
): Promise<PullReport> {
  return pullArchive({
    store: await store(settings),
    open: lazyOpener(),
    paths,
    machineId: settings.machineId,
    sinceDays: all ? null : settings.pullSinceDays,
    log: (line) => {
      console.log(line);
    },
  });
}

function formatCounts(counts: Partial<Record<string, number>>): string {
  return Object.entries(counts)
    .map(([kind, count]) => `${kind} ${String(count)}`)
    .join(", ");
}

function printRedact(report: RedactReport): void {
  const verb = report.dryRun ? "would redact" : "redacted";
  for (const file of report.files) {
    const skipped =
      file.skipped === 0
        ? ""
        : ` (${String(file.skipped)} changed during redaction; rerun)`;
    console.log(
      `redact: ${file.tool}:${file.relPath}: ${formatCounts(file.counts)}${skipped}`,
    );
  }
  const total = Object.values(report.totals).reduce(
    (sum, count) => sum + count,
    0,
  );
  console.log(
    `redact: scanned ${String(report.scannedFiles)} files; ${verb} ${String(total)} secrets in ${String(report.files.length)} files${total === 0 ? "" : ` (${formatCounts(report.totals)})`}`,
  );
  if (!report.dryRun && report.regenerated > 0) {
    console.log(
      `redact: retired ${String(report.regenerated)} archive generations; run \`brim sync push\` to replace them in S3.`,
    );
  }
  if (report.archivedOnly > 0) {
    console.log(
      `redact: ${String(report.archivedOnly)} archived files no longer exist locally and were not scanned.`,
    );
  }
}

function printPush(report: PushReport): void {
  console.log(
    `push: ${String(report.files)} files archived; ${String(report.changedFiles)} changed, ${String(report.rewrittenFiles)} rewritten, ${String(report.newlyDeletedFiles)} newly deleted locally; ${String(report.uploadedSegments)} segments (${formatBytes(report.uploadedBytes)}) in ${String(report.commits)} commits${report.redactedSecrets === 0 ? "" : `; ${String(report.redactedSecrets)} secrets redacted before upload`}`,
  );
  for (const error of report.errors) {
    console.error(`push: ${error.relPath}: ${error.message}`);
  }
}

function printPull(report: PullReport): void {
  for (const machine of report.machines) {
    console.log(
      `pull: ${machine.machineId}: ${String(machine.mirroredFiles)} files mirrored, ${formatBytes(machine.downloadedBytes)} downloaded, ${String(machine.rebuiltFiles)} rebuilt, ${String(machine.prunedFiles)} pruned`,
    );
  }
  for (const error of report.errors) {
    console.error(`pull: ${error.machineId}: ${error.message}`);
  }
}

async function printStatus(
  settings: BrimSyncSettings,
  paths: BrimSyncPaths,
  agentSpec: LaunchAgentSpec,
  json: boolean,
): Promise<void> {
  const manifest = await readLocalManifest(paths.manifest);
  const index = await readMirrorIndex(paths.mirrorIndex);
  const agent = await launchAgentJobStatus(agentSpec);
  const archive =
    manifest === null
      ? null
      : {
          updatedAt: manifest.updatedAt,
          files: manifest.files.length,
          deletedLocally: manifest.files.filter(
            (entry) => entry.deletedAt !== null,
          ).length,
          archivedBytes: manifest.files.reduce(
            (total, entry) => total + entry.size,
            0,
          ),
        };
  const status = {
    machineId: settings.machineId,
    bucket: settings.bucket,
    profile: settings.profile,
    s3Credentials: settings.s3Credentials,
    recipient: settings.recipient,
    archive,
    mirror:
      index?.machines.map((machine) => ({
        machineId: machine.machineId,
        displayName: machine.displayName,
        platform: machine.platform,
        manifestUpdatedAt: machine.manifestUpdatedAt,
        pulledAt: machine.pulledAt,
      })) ?? [],
    launchAgent: process.platform === "darwin" ? agent : null,
  };
  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(
    `Machine: ${status.machineId} (bucket ${status.bucket}, profile ${status.profile}, keys from ${status.s3Credentials})`,
  );
  console.log(`Recipient: ${status.recipient}`);
  console.log(
    archive === null
      ? "Archive: nothing pushed from this machine yet"
      : `Archive: ${String(archive.files)} files (${String(archive.deletedLocally)} deleted locally), ${formatBytes(archive.archivedBytes)}, committed ${archive.updatedAt}`,
  );
  if (status.mirror.length === 0) console.log("Mirror: no machines pulled");
  for (const machine of status.mirror) {
    console.log(
      `Mirror: ${machine.machineId} (${machine.platform}) pulled ${machine.pulledAt}, remote committed ${machine.manifestUpdatedAt}`,
    );
  }
  if (status.launchAgent !== null) {
    console.log(
      `LaunchAgent: ${status.launchAgent.installed ? "installed" : "not installed"} (${status.launchAgent.loaded ? "loaded" : "not loaded"})`,
    );
  }
}

async function withLock(
  paths: BrimSyncPaths,
  work: () => Promise<boolean>,
): Promise<number> {
  const lock = await acquireSyncLock(paths.lock);
  if (lock === null) {
    console.log("brim sync: another sync is running; skipping this run.");
    return 0;
  }
  try {
    return (await work()) ? 0 : 1;
  } finally {
    await lock.release();
  }
}

/**
 * `invocationPrefix` is how the current binary reaches `sync`: `[]` for the
 * standalone `brim`, `["brim"]` for `toolkit brim`. The LaunchAgent re-runs
 * the same binary with it.
 */
export async function handleSyncCommand(
  args: string[],
  invocationPrefix: readonly string[] = [],
): Promise<number> {
  try {
    return await dispatch(args, invocationPrefix);
  } catch (error: unknown) {
    if (error instanceof SyncSetupError) {
      console.error(`brim sync: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

async function dispatch(
  args: string[],
  invocationPrefix: readonly string[],
): Promise<number> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      all: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const [action, ...extra] = parsed.positionals;
  if (parsed.values.help) {
    console.log(SYNC_USAGE);
    return 0;
  }
  if (action === undefined) {
    console.log(SYNC_USAGE);
    return 1;
  }
  if (extra.length > 0) {
    console.error(`brim sync: unexpected arguments: ${extra.join(" ")}`);
    return 1;
  }
  const paths = defaultBrimSyncPaths();
  const settings = await loadBrimSyncSettings();
  const { json, all } = parsed.values;
  const agentSpec = syncLaunchAgent(paths, invocationPrefix);
  switch (action) {
    case "push":
      return withLock(paths, async () => {
        const report = await runPush(settings, paths);
        if (json) console.log(JSON.stringify(report, null, 2));
        else printPush(report);
        return report.errors.length === 0;
      });
    case "pull":
      return withLock(paths, async () => {
        const report = await runPull(settings, paths, all);
        if (json) console.log(JSON.stringify(report, null, 2));
        else printPull(report);
        return report.errors.length === 0;
      });
    case "run":
      return withLock(paths, async () => {
        const push = await runPush(settings, paths);
        const pull = await runPull(settings, paths, false);
        if (json) console.log(JSON.stringify({ push, pull }, null, 2));
        else {
          printPush(push);
          printPull(pull);
        }
        return push.errors.length === 0 && pull.errors.length === 0;
      });
    case "redact":
      return withLock(paths, async () => {
        const report = await redactSources({
          roots: syncRoots(Bun.env, paths.home),
          paths,
          dryRun: parsed.values["dry-run"],
        });
        // Captured requests hold the same prompts and tool output, so they
        // are redacted with the same patterns.
        const captures = await runCaptureRedact(
          defaultBrimCapturePaths(paths.home),
          defaultHistoryRuntimePaths(paths.home).capturesDb,
          parsed.values["dry-run"],
        );
        if (json) console.log(JSON.stringify({ ...report, captures }, null, 2));
        else {
          printRedact(report);
          console.log(formatRedactReport(captures));
        }
        return report.files.every((file) => file.skipped === 0);
      });
    case "status":
      await printStatus(settings, paths, agentSpec, json);
      return 0;
    case "install":
      assertDarwin("brim sync install");
      await installLaunchAgentJob(agentSpec);
      console.log(
        `Brim sync LaunchAgent installed: ${paths.launchAgent} (every ${String(INTERVAL_SECONDS / 60)} minutes)`,
      );
      return 0;
    case "uninstall":
      assertDarwin("brim sync uninstall");
      await uninstallLaunchAgentJob(agentSpec);
      console.log(`Brim sync LaunchAgent removed: ${paths.launchAgent}`);
      return 0;
    default:
      console.error(`brim sync: unknown action "${action}"`);
      console.log(SYNC_USAGE);
      return 1;
  }
}
