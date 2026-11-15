import { z } from "zod";
import { SCOUT_CLIENT_PROTOCOL_CONTRACT as contract } from "./protocol.generated.ts";

/**
 * The `live_game_recording` observation: a finished game's local recording,
 * a series of allowlisted live snapshots.
 *
 * The shape mirrors the desktop client's `LiveSnapshot` allowlist
 * (`scout-client-core/src/live/snapshot.rs`) field for field, in its
 * snake_case wire form. There is deliberately no field for a Riot ID,
 * summoner name, skin, ward score, cooldown or position, and every object is
 * strict, so a recording that carries one is refused rather than stored.
 */

export const LIVE_GAME_RECORDING_RESOURCE = "live_game_recording";
export const LIVE_GAME_RECORDING_MAX_PAYLOAD_BYTES =
  contract.liveGameRecording.maxPayloadBytes;
const FORBIDDEN_KEY_FRAGMENTS: readonly string[] =
  contract.liveGameRecording.forbiddenKeyFragments;

const WholeSeconds = z.number().int().nonnegative();
const Count = z.number().int().nonnegative().max(1_000_000);
const Text = z.string().max(128);

const LiveItemSchema = z.strictObject({
  item_id: Count,
  name: Text,
  count: z.number().int().nonnegative().max(255),
});

const LiveParticipantSchema = z.strictObject({
  team: z.enum(["order", "chaos"]),
  is_self: z.boolean(),
  champion: Text,
  level: z.number().int().nonnegative().max(255),
  kills: Count,
  deaths: Count,
  assists: Count,
  creep_score: Count,
  items: z.array(LiveItemSchema).max(16),
  summoner_spells: z.tuple([Text, Text]),
  keystone: Text.nullable(),
});

const OwnStatsSchema = z.strictObject({
  gold: Count,
  max_health: z.number(),
  health: z.number(),
  resource: Text,
  max_resource: z.number(),
  current_resource: z.number(),
  armor: z.number(),
  magic_resist: z.number(),
  attack_damage: z.number(),
  ability_power: z.number(),
  attack_speed: z.number(),
  move_speed: z.number(),
  crit_chance: z.number(),
});

export const LiveSnapshotSchema = z.strictObject({
  game: z.strictObject({
    mode: Text,
    map: Text,
    game_time_secs: WholeSeconds,
  }),
  own: OwnStatsSchema,
  participants: z.array(LiveParticipantSchema).max(20),
  event_count: Count,
  latest_event: z
    .strictObject({ id: Count, kind: Text, time_secs: z.number() })
    .nullable(),
});

export const LiveGameRecordingSampleSchema = z.strictObject({
  game_time_secs: WholeSeconds,
  trigger: z.enum(["interval", "event"]),
  recorded_at: z.iso.datetime({ offset: true }),
  snapshot: LiveSnapshotSchema,
});

export const LiveGameRecordingPayloadSchema = z.strictObject({
  resource: z.literal(LIVE_GAME_RECORDING_RESOURCE),
  data: z.strictObject({
    started_at: z.iso.datetime({ offset: true }),
    ended_at: z.iso.datetime({ offset: true }),
    samples: z.array(LiveGameRecordingSampleSchema).min(1).max(5000),
  }),
});

export type LiveGameRecordingPayload = z.infer<
  typeof LiveGameRecordingPayloadSchema
>;
export type LiveSnapshot = z.infer<typeof LiveSnapshotSchema>;

/** Why a recording was refused. */
export const LiveGameRecordingRefusalReasonSchema = z.enum([
  "too_large",
  "forbidden_key",
  "invalid_shape",
]);
export type LiveGameRecordingRefusalReason = z.infer<
  typeof LiveGameRecordingRefusalReasonSchema
>;

export type LiveGameRecordingCheck =
  | { readonly accepted: true; readonly recording: LiveGameRecordingPayload }
  | {
      readonly accepted: false;
      readonly reason: LiveGameRecordingRefusalReason;
      /** A key name, schema path or size; never a value from the payload. */
      readonly detail: string;
    };

/** The first key, at any depth, whose name carries a forbidden fragment. */
function forbiddenKey(value: unknown, depth = 0): string | null {
  if (depth > contract.payload.maxDepth) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = forbiddenKey(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    if (
      FORBIDDEN_KEY_FRAGMENTS.some((fragment) => lowered.includes(fragment))
    ) {
      return key;
    }
    const found = forbiddenKey(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Check a `live_game_recording` payload without touching storage: size first,
 * then forbidden keys (so the refusal names the identity field rather than a
 * generic schema failure), then the strict allowlist shape.
 */
export function checkLiveGameRecording(
  payload: unknown,
): LiveGameRecordingCheck {
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (bytes > LIVE_GAME_RECORDING_MAX_PAYLOAD_BYTES) {
    return {
      accepted: false,
      reason: "too_large",
      detail: `${String(bytes)} bytes`,
    };
  }
  const key = forbiddenKey(payload);
  if (key !== null) {
    return { accepted: false, reason: "forbidden_key", detail: key };
  }
  const parsed = LiveGameRecordingPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      accepted: false,
      reason: "invalid_shape",
      detail: issue?.path.join(".") ?? "",
    };
  }
  return { accepted: true, recording: parsed.data };
}

/** The typed refusal body the ingress answers with. */
export const LiveGameRecordingRefusalSchema = z.strictObject({
  error: z.literal("live_game_recording_refused"),
  reason: LiveGameRecordingRefusalReasonSchema,
  /** The refused observation, so the client drops exactly that entry. */
  observationId: z.uuid(),
  detail: z.string(),
});
export type LiveGameRecordingRefusal = z.infer<
  typeof LiveGameRecordingRefusalSchema
>;
