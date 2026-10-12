// `toolkit mc live …`: read-only status, Velero backups, the journal and undo
// for live minecraft-tsmc. Writes themselves use the target commands with
// `--target live`; the daemon guards them.
import type { ParseArgsOptionsConfig } from "node:util";
import { LIVE_DAEMON_START_HINT } from "@shepherdjerred/mc-harness/protocol/live.ts";
import {
  mcLiveBackupCommand,
  mcLiveJournalCommand,
  mcLiveStatusCommand,
  mcLiveUndoCommand,
} from "#commands/mc/live.ts";
import { LIVE_WRITE_OPTIONS, parseSince } from "#lib/mc/live.ts";
import { parseMcArgs } from "./mc-args.ts";

export const LIVE_USAGE = `Live minecraft-tsmc (--target live; the daemon needs the bridge token):
  ${LIVE_DAEMON_START_HINT}
  toolkit mc live status [--json]        Read-only cluster view; refuses when asleep or mining-reset locked
  toolkit mc live backup --reason <why> [--wait]   Velero backup of minecraft-tsmc (needed for tier-2 writes)
  toolkit mc live journal [--since 1d]   Every live write, undo and backup
  toolkit mc live undo <journal-id> --reason <why> [--allow-players] [--allow-protected]   Restore the pre-write snapshot (LIFO)
Live writes need --reason "<why>"; --allow-players when a human is near the box (never inside);
--allow-protected for a box inside a protected region (mcLiveProtectedRegions, e.g. the zombies settlement);
--confirm-dangerous plus a backup from the last 24h for stop, kill, op/deop, co rollback, //regen, …;
--affects x1,y1,z1:x2,y2,z2 for WorldEdit ops whose change is not bounded by --pos1/--pos2.`;

const OPTIONS = {
  json: { type: "boolean", default: false },
  wait: { type: "boolean", default: false },
  since: { type: "string" },
  ...LIVE_WRITE_OPTIONS,
} as const satisfies ParseArgsOptionsConfig;

function requireString(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Error: ${name} is required`);
  }
  return value;
}

export async function handleMcLive(args: string[]): Promise<void> {
  const [action = "", ...rest] = args;
  const { values, positionals } = parseMcArgs(OPTIONS, rest, {});
  switch (action) {
    case "status": {
      await mcLiveStatusCommand(values.json);
      return;
    }
    case "backup": {
      await mcLiveBackupCommand({
        reason: requireString(values.reason, "--reason"),
        wait: values.wait,
        json: values.json,
      });
      return;
    }
    case "journal": {
      await mcLiveJournalCommand({
        since:
          values.since === undefined
            ? undefined
            : parseSince(values.since, new Date()),
        json: values.json,
      });
      return;
    }
    case "undo": {
      await mcLiveUndoCommand({
        id: requireString(positionals[0], "<journal-id>"),
        reason: requireString(values.reason, "--reason"),
        allowPlayers: values["allow-players"],
        allowProtected: values["allow-protected"],
        json: values.json,
      });
      return;
    }
  }
  throw new Error(
    `Error: unknown live action "${action}"; use status, backup, journal or undo`,
  );
}
