import {
  LiveBackupResponseSchema,
  LiveJournalResponseSchema,
  LiveStatusResponseSchema,
  LiveUndoResponseSchema,
} from "@shepherdjerred/mc-harness/protocol/live.ts";
import { daemonRequest } from "#lib/mc/client.ts";
import {
  renderLiveBackup,
  renderLiveJournal,
  renderLiveStatus,
} from "#lib/mc/live.ts";

function print<T>(json: boolean, value: T, render: (value: T) => string): void {
  console.log(json ? JSON.stringify(value, null, 2) : render(value));
}

/** Read-only cluster view of live tsmc; exits 1 when it is not usable. */
export async function mcLiveStatusCommand(json: boolean): Promise<void> {
  const status = await daemonRequest(
    LiveStatusResponseSchema,
    "GET",
    "/live/status",
  );
  print(json, status, renderLiveStatus);
  if (status.refusal !== null) {
    process.exitCode = 1;
  }
}

export async function mcLiveBackupCommand(options: {
  reason: string;
  wait: boolean;
  json: boolean;
}): Promise<void> {
  const backup = await daemonRequest(
    LiveBackupResponseSchema,
    "POST",
    "/live/backup",
    {
      reason: options.reason,
      wait: options.wait,
    },
  );
  print(options.json, backup, renderLiveBackup);
}

export async function mcLiveJournalCommand(options: {
  since: Date | undefined;
  json: boolean;
}): Promise<void> {
  const query =
    options.since === undefined
      ? ""
      : `?${new URLSearchParams({ since: options.since.toISOString() }).toString()}`;
  const { entries } = await daemonRequest(
    LiveJournalResponseSchema,
    "GET",
    `/live/journal${query}`,
  );
  print(options.json, entries, renderLiveJournal);
}

export async function mcLiveUndoCommand(options: {
  id: string;
  reason: string;
  allowPlayers: boolean;
  allowProtected: boolean;
  json: boolean;
}): Promise<void> {
  const result = await daemonRequest(
    LiveUndoResponseSchema,
    "POST",
    "/live/undo",
    {
      id: options.id,
      reason: options.reason,
      ...(options.allowPlayers ? { allowPlayers: true } : {}),
      ...(options.allowProtected ? { allowProtected: true } : {}),
    },
  );
  print(
    options.json,
    result,
    (value) =>
      `undid ${options.id}: ${String(value.changed)} block(s) restored; journal ${value.entry.id}`,
  );
}
