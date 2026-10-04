/**
 * The live `minecraft-tsmc` target: daemon routes under /live and the write
 * flags every guarded write to `/targets/live/...` carries as headers (so the
 * bridge request bodies stay exactly the bridge contract). Nothing here may
 * carry a secret: the MCBridge token lives only in the daemon's environment.
 */
import { z } from "zod";
import { type Box, BoxSchema } from "./bridge.ts";
import { parseBlockPos } from "./ipc.ts";

/** The target id for live tsmc. Never inferred: callers pass it explicitly. */
export const LIVE_TARGET_ID = "live";

export const LIVE_TOKEN_ENV = "MC_BRIDGE_TOKEN";
/** 1Password vault "Homelab (Kubernetes)"; `op://` rejects its name, so refer by id. */
const HOMELAB_VAULT_ID = "v64ocnykdqju4ui6j6pua56xw4";
/** 1Password item "storm-brain", which also feeds the tsmc pod's bridge token. */
const STORM_BRAIN_ITEM_ID = "mpv7cti3fpwrfobgr6ydnemydy";
/** 1Password reference for the bridge token (a pointer, not the token). */
export const LIVE_TOKEN_OP_REF = `op://${HOMELAB_VAULT_ID}/${STORM_BRAIN_ITEM_ID}/${LIVE_TOKEN_ENV}`;
export const LIVE_DAEMON_START_HINT = `${LIVE_TOKEN_ENV}=$(op read '${LIVE_TOKEN_OP_REF}') toolkit mc daemon start`;

/** Write flags, sent as headers on guarded `/targets/live/...` writes. */
export const LIVE_HEADERS = {
  reason: "x-mc-reason",
  allowPlayers: "x-mc-allow-players",
  confirmDangerous: "x-mc-confirm-dangerous",
  affects: "x-mc-affects",
} as const;

export type LiveWriteFlags = {
  /** Why the write happens; required for every live write, journaled. */
  reason?: string | undefined;
  /** Proceed although a human player is near (never inside) the box. */
  allowPlayers?: boolean | undefined;
  /** Required for dangerous commands (stop, kill @e, co rollback, ...). */
  confirmDangerous?: boolean | undefined;
  /** The box a WorldEdit op changes when its selection does not bound it. */
  affects?: Box | undefined;
};

/** Headers for a write; empty when no flag is set (sandbox writes). */
export function liveWriteHeaders(
  flags: LiveWriteFlags,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (flags.reason !== undefined) {
    // Header values are ISO-8859-1; the reason is free text.
    headers[LIVE_HEADERS.reason] = encodeURIComponent(flags.reason);
  }
  if (flags.allowPlayers === true) {
    headers[LIVE_HEADERS.allowPlayers] = "1";
  }
  if (flags.confirmDangerous === true) {
    headers[LIVE_HEADERS.confirmDangerous] = "1";
  }
  if (flags.affects !== undefined) {
    headers[LIVE_HEADERS.affects] = encodeURIComponent(
      JSON.stringify(flags.affects),
    );
  }
  return headers;
}

/** Reads the write flags back from request headers. */
export function readLiveWriteFlags(headers: Headers): LiveWriteFlags {
  const reason = headers.get(LIVE_HEADERS.reason);
  const affects = headers.get(LIVE_HEADERS.affects);
  return {
    reason:
      reason === null
        ? undefined
        : decodeURIComponent(reason).trim() || undefined,
    allowPlayers: headers.get(LIVE_HEADERS.allowPlayers) === "1",
    confirmDangerous: headers.get(LIVE_HEADERS.confirmDangerous) === "1",
    affects:
      affects === null
        ? undefined
        : BoxSchema.parse(JSON.parse(decodeURIComponent(affects))),
  };
}

/** `--affects x1,y1,z1 x2,y2,z2` in `world` → a normalized box. */
export function parseAffects(world: string, a: string, b: string): Box {
  const first = parseBlockPos(a);
  const second = parseBlockPos(b);
  return {
    world,
    min: {
      x: Math.min(first.x, second.x),
      y: Math.min(first.y, second.y),
      z: Math.min(first.z, second.z),
    },
    max: {
      x: Math.max(first.x, second.x),
      y: Math.max(first.y, second.y),
      z: Math.max(first.z, second.z),
    },
  };
}

// GET /live/status — read-only cluster view; never wakes or scales the server.
export const LiveStatusResponseSchema = z.strictObject({
  replicas: z.number().int(),
  readyReplicas: z.number().int(),
  podPhase: z.string().nullable(),
  podReady: z.boolean(),
  image: z.string().nullable(),
  /** Value of the mining-reset lock annotation; writes refuse while set. */
  miningResetLock: z.string().nullable(),
  /** Whether the daemon has the bridge token (the value is never returned). */
  tokenConfigured: z.boolean(),
  bridge: z.strictObject({
    connected: z.boolean(),
    localPort: z.number().int().nullable(),
  }),
  /** Null when usable; otherwise why live calls are refused right now. */
  refusal: z.string().nullable(),
});
export type LiveStatusResponse = z.infer<typeof LiveStatusResponseSchema>;

// POST /live/backup
export const LiveBackupRequestSchema = z.strictObject({
  reason: z.string().min(1),
  wait: z.boolean(),
});
export const LiveBackupResponseSchema = z.strictObject({
  name: z.string(),
  phase: z.string(),
  completedAt: z.string().nullable(),
  journalId: z.string(),
});
export type LiveBackupResponse = z.infer<typeof LiveBackupResponseSchema>;

export const LiveTierSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
]);
export type LiveTier = z.infer<typeof LiveTierSchema>;

/** One append-only line in ~/.toolkit/mc/journal/live/<date>.jsonl. */
export const LiveJournalEntrySchema = z.strictObject({
  version: z.literal(1),
  id: z.string().regex(/^lj-[0-9a-z]+-[0-9a-f]{6}$/u),
  ts: z.string(),
  kind: z.enum(["write", "undo", "backup"]),
  reason: z.string().min(1),
  op: z.strictObject({ kind: z.string(), summary: z.string() }),
  tier: LiveTierSchema,
  world: z.string().nullable(),
  box: BoxSchema.nullable(),
  humansOnline: z.array(z.string()),
  backup: z
    .strictObject({ name: z.string(), completedAt: z.string() })
    .nullable(),
  /** Bridge snapshot of `box` taken before the write; `live undo` restores it. */
  snapshotId: z.string().nullable(),
  result: z.enum(["ok", "failed"]),
  error: z.string().nullable(),
  /** For `undo` entries: the journal id this undo reverted. */
  undoes: z.string().nullable(),
});
export type LiveJournalEntry = z.infer<typeof LiveJournalEntrySchema>;

export const LiveJournalResponseSchema = z.strictObject({
  entries: z.array(LiveJournalEntrySchema),
});

// POST /live/undo
export const LiveUndoRequestSchema = z.strictObject({
  id: z.string().min(1),
  reason: z.string().min(1),
  /** Restore although a human player is near (never inside) the box. */
  allowPlayers: z.boolean().optional(),
});
export const LiveUndoResponseSchema = z.strictObject({
  entry: LiveJournalEntrySchema,
  changed: z.number().int(),
});
