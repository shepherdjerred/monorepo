import type { ParseArgsOptionsConfig } from "node:util";
import type { BlockPos } from "@shepherdjerred/mc-harness/protocol/bridge.ts";
import type {
  LiveBackupResponse,
  LiveJournalEntry,
  LiveStatusResponse,
  LiveWriteFlags,
} from "@shepherdjerred/mc-harness/protocol/live.ts";

/** Flags every target command accepts; the daemon enforces them for `--target live`. */
export const LIVE_WRITE_OPTIONS = {
  reason: { type: "string" },
  "allow-players": { type: "boolean", default: false },
  "allow-protected": { type: "boolean", default: false },
  "confirm-dangerous": { type: "boolean", default: false },
} as const satisfies ParseArgsOptionsConfig;

export type LiveWriteValues = {
  reason?: string | undefined;
  "allow-players"?: boolean | undefined;
  "allow-protected"?: boolean | undefined;
  "confirm-dangerous"?: boolean | undefined;
};

export function liveWriteFlags(values: LiveWriteValues): LiveWriteFlags {
  return {
    reason: values.reason,
    allowPlayers: values["allow-players"] === true,
    allowProtected: values["allow-protected"] === true,
    confirmDangerous: values["confirm-dangerous"] === true,
  };
}

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** `--since 1d|6h|30m` (relative to now) or an ISO timestamp. */
export function parseSince(raw: string, now: Date): Date {
  const relative = /^(\d+)([mhd])$/u.exec(raw.trim());
  if (relative !== null) {
    const amount = Number(relative[1]);
    const unit = UNIT_MS[relative[2] ?? ""] ?? 0;
    return new Date(now.getTime() - amount * unit);
  }
  const absolute = Date.parse(raw);
  if (Number.isFinite(absolute)) {
    return new Date(absolute);
  }
  throw new Error(
    `--since must look like 1d, 6h, 30m or an ISO timestamp, got "${raw}"`,
  );
}

export function renderLiveStatus(status: LiveStatusResponse): string {
  return [
    `minecraft-tsmc: ${status.refusal === null ? "usable" : "NOT USABLE"}`,
    `  replicas ${String(status.readyReplicas)}/${String(status.replicas)} ready, pod ${status.podPhase ?? "none"}${status.podReady ? " (ready)" : ""}`,
    `  image ${status.image ?? "unknown"}`,
    `  mining-reset lock: ${status.miningResetLock ?? "none"}`,
    `  world-restore lease: ${status.worldRestoreLease ?? "none"}`,
    `  bridge token: ${status.tokenConfigured ? "configured" : "missing"}; port-forward ${status.bridge.connected ? `127.0.0.1:${String(status.bridge.localPort)}` : "not connected"}`,
    ...(status.refusal === null ? [] : [`  refused: ${status.refusal}`]),
  ].join("\n");
}

function formatPos(p: BlockPos): string {
  return `${String(p.x)},${String(p.y)},${String(p.z)}`;
}

function describeEntryBox(entry: LiveJournalEntry): string {
  const box = entry.box;
  return box === null
    ? ""
    : ` [${box.world} ${formatPos(box.min)} → ${formatPos(box.max)}]`;
}

function renderEntry(entry: LiveJournalEntry): string {
  const flags = [
    `tier ${String(entry.tier)}`,
    ...(entry.snapshotId === null ? [] : [`snapshot ${entry.snapshotId}`]),
    ...(entry.undoes === null ? [] : [`undoes ${entry.undoes}`]),
    ...(entry.backup === null ? [] : [`backup ${entry.backup.name}`]),
  ].join(", ");
  const online =
    entry.humansOnline.length > 0
      ? `; online: ${entry.humansOnline.join(", ")}`
      : "";
  return [
    `${entry.id}  ${entry.ts}  ${entry.kind} ${entry.result === "ok" ? "ok" : "FAILED"}  (${flags})`,
    `  ${entry.op.summary}${describeEntryBox(entry)}`,
    `  reason: ${entry.reason}${online}`,
    ...(entry.error === null ? [] : [`  error: ${entry.error}`]),
  ].join("\n");
}

export function renderLiveJournal(
  entries: readonly LiveJournalEntry[],
): string {
  return entries.length === 0
    ? "No live journal entries."
    : entries.map((entry) => renderEntry(entry)).join("\n");
}

export function renderLiveBackup(backup: LiveBackupResponse): string {
  return backup.completedAt === null
    ? `started Velero backup ${backup.name} (${backup.phase}); journal ${backup.journalId}. Tier-2 writes accept it once it completes (pass --wait to block until then).`
    : `Velero backup ${backup.name} completed at ${backup.completedAt}; journal ${backup.journalId}`;
}
