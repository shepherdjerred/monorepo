import { z } from "zod";
import { SCOUT_CLIENT_PROTOCOL_CONTRACT as protocolContract } from "./protocol.generated.ts";

export const SCOUT_CLIENT_PROTOCOL_VERSION = protocolContract.protocolVersion;
export const SCOUT_CLIENT_OBSERVATION_SCHEMA_VERSION =
  protocolContract.observationSchemaVersion;
export const SCOUT_CLIENT_MAX_BATCH_BYTES = protocolContract.maxBatchBytes;
export const SCOUT_CLIENT_MAX_BATCH_OBSERVATIONS =
  protocolContract.maxBatchObservations;

const MAX_JSON_DEPTH = protocolContract.payload.maxDepth;
const MAX_ARRAY_ITEMS = protocolContract.payload.maxArrayItems;
const MAX_OBJECT_KEYS = protocolContract.payload.maxObjectKeys;
const MAX_STRING_BYTES = protocolContract.payload.maxStringBytes;
const MAX_KEY_BYTES = protocolContract.payload.maxKeyBytes;
const UNSAFE_KEYS = new Set<string>(protocolContract.payload.unsafeKeys);
const textEncoder = new TextEncoder();

export const ScoutClientObservationKindSchema = z.enum(
  protocolContract.observationKinds,
);
export const ScoutClientObservationQuarantineReasonSchema = z.enum(
  protocolContract.quarantineReasons,
);

function arrayBoundaryError(
  value: readonly unknown[],
  depth: number,
): string | null {
  if (value.length > MAX_ARRAY_ITEMS) return "payload array is too large";
  for (const item of value) {
    const error = jsonBoundaryError(item, depth + 1);
    if (error !== null) return error;
  }
  return null;
}

function objectBoundaryError(value: object, depth: number): string | null {
  const entries = Object.entries(value);
  if (entries.length > MAX_OBJECT_KEYS)
    return "payload object has too many keys";
  for (const [key, item] of entries) {
    const keyBytes = textEncoder.encode(key).byteLength;
    if (keyBytes === 0 || keyBytes > MAX_KEY_BYTES || UNSAFE_KEYS.has(key)) {
      return `payload contains unsafe key ${JSON.stringify(key)}`;
    }
    const error = jsonBoundaryError(item, depth + 1);
    if (error !== null) return error;
  }
  return null;
}

function jsonBoundaryError(value: unknown, depth = 0): string | null {
  if (depth > MAX_JSON_DEPTH) return "payload nesting exceeds 16 levels";
  if (value === null || typeof value === "boolean") return null;
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? null
      : "payload contains a non-finite number";
  }
  if (typeof value === "string") {
    return textEncoder.encode(value).byteLength <= MAX_STRING_BYTES
      ? null
      : "payload string exceeds 16 KiB";
  }
  if (Array.isArray(value)) return arrayBoundaryError(value, depth);
  return typeof value === "object"
    ? objectBoundaryError(value, depth)
    : "payload is not JSON";
}

const BoundedJsonSchema = z
  .unknown()
  .superRefine((value, context) => {
    const error = jsonBoundaryError(value);
    if (error !== null) context.addIssue({ code: "custom", message: error });
  })
  .pipe(z.json());

export const ScoutClientObservationSchema = z.strictObject({
  protocolVersion: z.literal(SCOUT_CLIENT_PROTOCOL_VERSION),
  schemaVersion: z.literal(SCOUT_CLIENT_OBSERVATION_SCHEMA_VERSION),
  observationId: z.uuid(),
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  capturedAt: z.iso.datetime({ offset: true }),
  appVersion: z
    .string()
    .min(1)
    .max(protocolContract.envelopeStringMaxBytes.appVersion),
  kind: ScoutClientObservationKindSchema,
  leaguePatch: z
    .string()
    .min(1)
    .max(protocolContract.envelopeStringMaxBytes.leaguePatch)
    .optional(),
  platformId: z
    .string()
    .min(1)
    .max(protocolContract.envelopeStringMaxBytes.platformId)
    .optional(),
  localPuuid: z
    .string()
    .min(1)
    .max(protocolContract.envelopeStringMaxBytes.localPuuid)
    .optional(),
  lobbyId: z
    .string()
    .min(1)
    .max(protocolContract.envelopeStringMaxBytes.lobbyId)
    .optional(),
  gameId: z
    .string()
    .regex(
      new RegExp(
        String.raw`^\d{1,${String(
          protocolContract.envelopeStringMaxBytes.gameId,
        )}}$`,
      ),
    )
    .optional(),
  payload: BoundedJsonSchema,
});

export const ScoutClientObservationBatchSchema = z.strictObject({
  observations: z
    .array(ScoutClientObservationSchema)
    .min(1)
    .max(SCOUT_CLIENT_MAX_BATCH_OBSERVATIONS),
});

export const ScoutClientCreatePairingSchema = z.strictObject({
  deviceName: z.string().trim().min(1).max(80),
  platform: z.enum(["windows", "macos"]),
  architecture: z.enum(["x86_64", "aarch64"]),
  appVersion: z.string().min(1).max(128),
  protocolVersion: z.literal(SCOUT_CLIENT_PROTOCOL_VERSION),
});

export const ScoutClientPairingExchangeSchema = z.strictObject({
  pairingSecret: z.string().min(32).max(256),
});

export const ScoutClientCheckInSchema = z.strictObject({
  appVersion: z.string().min(1).max(128),
  protocolVersion: z.literal(SCOUT_CLIENT_PROTOCOL_VERSION),
});

export const ScoutClientCheckInResponseSchema = z.strictObject({
  accepted: z.literal(true),
  nextSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export type ScoutClientObservation = z.infer<
  typeof ScoutClientObservationSchema
>;
export type ScoutClientObservationBatch = z.infer<
  typeof ScoutClientObservationBatchSchema
>;
export type ScoutClientObservationQuarantineReason = z.infer<
  typeof ScoutClientObservationQuarantineReasonSchema
>;
