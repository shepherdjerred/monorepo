/**
 * Wire contract for MCBridge, the Paper plugin in
 * packages/the-storm/plugin/bridge. Every route lives under /v1, takes and
 * returns JSON (except the raw snapshot download), and requires
 * `Authorization: Bearer <MC_BRIDGE_TOKEN>`. Errors are `BridgeError` with a
 * non-2xx status. Schemas are strict so plugin/harness skew fails loudly.
 */
import { z } from "zod";

export const BRIDGE_API_VERSION = 1;

export const BlockPosSchema = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});
export type BlockPos = z.infer<typeof BlockPosSchema>;

/** Inclusive box in one world. The bridge normalizes min/max. */
export const BoxSchema = z.strictObject({
  world: z.string().min(1),
  min: BlockPosSchema,
  max: BlockPosSchema,
});
export type Box = z.infer<typeof BoxSchema>;

export const BridgeErrorSchema = z.strictObject({
  error: z.string(),
  code: z.enum([
    "unauthorized",
    "bad_request",
    "not_found",
    "too_large",
    "unsupported",
    "world_edit",
    "timeout",
    "internal",
  ]),
});
export type BridgeError = z.infer<typeof BridgeErrorSchema>;

// GET /v1/health
export const HealthResponseSchema = z.strictObject({
  ok: z.literal(true),
  apiVersion: z.number().int(),
  bridgeVersion: z.string(),
});

// GET /v1/info
export const WorldInfoSchema = z.strictObject({
  name: z.string(),
  /** Namespaced dimension key, e.g. minecraft:overworld or minecraft:wilds. */
  key: z.string(),
  environment: z.enum(["NORMAL", "NETHER", "THE_END", "CUSTOM"]),
  minY: z.number().int(),
  maxY: z.number().int(),
});
export const InfoResponseSchema = z.strictObject({
  apiVersion: z.number().int(),
  bridgeVersion: z.string(),
  minecraftVersion: z.string(),
  serverVersion: z.string(),
  dataVersion: z.number().int(),
  onlineMode: z.boolean(),
  worlds: z.array(WorldInfoSchema),
  plugins: z.array(
    z.strictObject({
      name: z.string(),
      version: z.string(),
      enabled: z.boolean(),
    }),
  ),
  capabilities: z.array(z.enum(["worldedit", "citizens"])),
});
export type InfoResponse = z.infer<typeof InfoResponseSchema>;

// GET /v1/registry — every block type with its property enums (from WorldEdit's registry).
export const RegistryResponseSchema = z.strictObject({
  dataVersion: z.number().int(),
  minecraftVersion: z.string(),
  blocks: z.array(
    z.strictObject({
      id: z.string(),
      defaultState: z.string(),
      properties: z.record(z.string(), z.array(z.string())),
    }),
  ),
});
export type RegistryResponse = z.infer<typeof RegistryResponseSchema>;

// POST /v1/command — console dispatch with captured feedback. `success` is the
// dispatcher's result: false for unknown commands, but vanilla commands that fail
// at runtime (e.g. "That position is not loaded") still report true, so read
// `output`. The dispatch is also recorded as a `command` event.
export const CommandRequestSchema = z.strictObject({
  command: z.string().min(1),
});
export const CommandResponseSchema = z.strictObject({
  success: z.boolean(),
  output: z.array(z.string()),
});
export type CommandResponse = z.infer<typeof CommandResponseSchema>;

// POST /v1/regions/read — exact block states. `blocks` is base64 of
// little-endian uint32 palette indices in YZX order (index = (y*sizeZ + z)*sizeX + x).
export const RegionReadRequestSchema = BoxSchema;
export const RegionReadResponseSchema = z.strictObject({
  world: z.string(),
  min: BlockPosSchema,
  max: BlockPosSchema,
  size: BlockPosSchema,
  palette: z.array(z.string()),
  blocks: z.string(),
  /** `id` is the holder block id (e.g. minecraft:chest), not the block-entity type. */
  blockEntities: z.array(
    z.strictObject({ pos: BlockPosSchema, id: z.string() }),
  ),
});
export type RegionReadResponse = z.infer<typeof RegionReadResponseSchema>;

// POST /v1/snapshots — Sponge v3 .schem saved under plugins/MCBridge/snapshots.
export const SnapshotCreateRequestSchema = z.strictObject({
  box: BoxSchema,
  label: z.string().max(80).optional(),
});
export const SnapshotSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  box: BoxSchema,
  label: z.string().optional(),
  createdAt: z.string(),
  bytes: z.number().int(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
// GET /v1/snapshots/:id → application/octet-stream (.schem bytes)
// GET /v1/snapshots → { snapshots: Snapshot[] }
export const SnapshotListResponseSchema = z.strictObject({
  snapshots: z.array(SnapshotSchema),
});
// POST /v1/snapshots/:id/restore → pastes the snapshot at its original box (air included).
export const SnapshotRestoreResponseSchema = z.strictObject({
  changed: z.number().int(),
});

// POST /v1/we/run — WorldEdit commands as the synthetic actor `agent:<session>`.
// Per op the bridge sets world override, then pos1/pos2 (if given), then
// placement=POS1 at `at` (if given) before dispatching `command`.
export const WeOpSchema = z.strictObject({
  command: z.string().regex(/^\/\//, "WorldEdit commands start with //"),
  pos1: BlockPosSchema.optional(),
  pos2: BlockPosSchema.optional(),
  at: BlockPosSchema.optional(),
});
export type WeOp = z.infer<typeof WeOpSchema>;
export const SessionNameSchema = z.string().regex(/^[a-z0-9-]{1,32}$/);
export const WeRunRequestSchema = z.strictObject({
  session: SessionNameSchema,
  world: z.string().min(1),
  ops: z.array(WeOpSchema).min(1).max(64),
});
export const WeOpResultSchema = z.strictObject({
  command: z.string(),
  ok: z.boolean(),
  /**
   * Blocks whose state actually changed, counted where edits reach the world.
   * WorldEdit's own "N blocks affected" messages count attempted sets instead.
   */
  changed: z.number().int(),
  messages: z.array(z.string()),
  errors: z.array(z.string()),
});
/**
 * `historySize` counts this session's edit sessions not yet undone. WorldEdit
 * exposes no history size, so the bridge counts the actor's edit sessions
 * (capped at WorldEdit's history limit). Each op is also recorded as a `command`
 * event whose `player` is the actor name (`agent:<session>`).
 */
export const WeRunResponseSchema = z.strictObject({
  results: z.array(WeOpResultSchema),
  historySize: z.number().int(),
});
export type WeRunResponse = z.infer<typeof WeRunResponseSchema>;

// POST /v1/we/paste — paste a .schem (base64) through the WorldEdit API.
// Like `//paste`, `at` is where the schematic's origin lands and `rotate`
// pivots around that origin (bridge snapshots use their min corner as origin).
export const WePasteRequestSchema = z.strictObject({
  session: SessionNameSchema,
  world: z.string().min(1),
  schematic: z.string().min(1),
  at: BlockPosSchema,
  rotate: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
  ignoreAir: z.boolean(),
});
export const WePasteResponseSchema = z.strictObject({
  changed: z.number().int(),
  min: BlockPosSchema,
  max: BlockPosSchema,
  historySize: z.number().int(),
});

// POST /v1/we/undo
export const WeUndoRequestSchema = z.strictObject({
  session: SessionNameSchema,
  steps: z.number().int().min(1).max(100),
});
export const WeUndoResponseSchema = z.strictObject({
  undone: z.number().int(),
  historySize: z.number().int(),
});

// GET /v1/players
export const PlayerSchema = z.strictObject({
  name: z.string(),
  uuid: z.string(),
  world: z.string(),
  pos: z.strictObject({ x: z.number(), y: z.number(), z: z.number() }),
  gameMode: z.string(),
  /** True for Citizens NPC players (harness actors or otherwise). */
  npc: z.boolean(),
});
export const PlayersResponseSchema = z.strictObject({
  players: z.array(PlayerSchema),
});
export type Player = z.infer<typeof PlayerSchema>;

// GET /v1/events?since=<seq>&limit=<n> — ring buffer (capacity 2000), oldest first.
export const BridgeEventSchema = z.strictObject({
  seq: z.number().int(),
  ts: z.string(),
  type: z.enum(["chat", "command", "join", "quit", "death", "log"]),
  player: z.string().optional(),
  text: z.string(),
});
export type BridgeEvent = z.infer<typeof BridgeEventSchema>;
export const EventsResponseSchema = z.strictObject({
  /** Pass as `since` next time. */
  cursor: z.number().int(),
  /** True when events between `since` and the oldest retained event were dropped. */
  truncated: z.boolean(),
  events: z.array(BridgeEventSchema),
});

/** Request limits enforced by the bridge (413 too_large beyond these). */
export const BRIDGE_LIMITS = {
  maxBodyBytes: 32 * 1024 * 1024,
  maxReadVolume: 4_000_000,
  maxSnapshotVolume: 4_000_000,
} as const;
