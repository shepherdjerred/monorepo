import assert from "node:assert/strict";
import { z } from "zod";
import definition from "tasknotes-macos/scripts/native/mac-account/mac-account.protocol.json";
import timingDefinition from "../../../../ios-account/account-input.schema.json";
import { SHA256Schema, UuidSchema } from "../../fields";

export const MacInputOperationSchema = z.enum([
  "credentials-probe",
  "verification-probe",
  "credentials",
  "verification",
  "vault",
]);
export type MacInputOperation = z.infer<typeof MacInputOperationSchema>;
const phase = z.enum(["credentials", "verification", "vaults"]);
const absolute = z
  .string()
  .startsWith("/")
  .max(4096)
  .regex(/^\P{Cc}+$/u);
const lifetime = {
  pid: z.number().int().positive(),
  startSeconds: z.number().int().nonnegative(),
  startMicroseconds: z.number().int().min(0).max(999_999),
  launchDate: z.number().positive(),
};
const envelope = {
  schemaVersion: z.literal(1),
  sessionID: UuidSchema,
  runID: UuidSchema,
  operation: MacInputOperationSchema,
  phase,
};
const lifecycle = z.strictObject({
  round: z.number().int().min(1).max(3),
  profileID: UuidSchema,
  pendingCount: z.number().int().positive(),
  outboxSHA256: SHA256Schema,
  checkpointSHA256: SHA256Schema,
});
export const MacInputInitSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("mac-private-account-input"),
  mode: z.literal("private_session"),
  operation: MacInputOperationSchema,
  sessionID: UuidSchema,
  runID: UuidSchema,
  remoteID: z.string().min(1).max(256),
  runDirectory: absolute,
  executable: absolute,
  container: absolute,
  stateDirectory: absolute,
  lifecycle: lifecycle.nullable(),
  guestConfigSHA256: SHA256Schema,
  ...lifetime,
  requestID: UuidSchema.nullable(),
  helperSHA256: SHA256Schema,
  protocolSHA256: SHA256Schema,
  timingSHA256: SHA256Schema,
  approvalSHA256: SHA256Schema.nullable(),
});
export const MacInputReadySchema = z.strictObject({
  ...envelope,
  kind: z.literal("ready"),
  ...lifetime,
  requestID: UuidSchema.nullable(),
  clockUnixMilliseconds: z.number().int().positive(),
});
export const MacInputFinishedSchema = z.strictObject({
  ...envelope,
  kind: z.literal("finished"),
  cleared: z.boolean(),
  secureField: z.boolean(),
  submitActionCount: z.number().int().min(0).max(1),
  verificationCodeSubmitActionCount: z.number().int().min(0).max(1),
  intentRecorded: z.boolean(),
});
export const MacInputApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("mac-private-account-input-approval"),
  runID: UuidSchema,
  guestConfigSHA256: SHA256Schema,
  helperSHA256: SHA256Schema,
  protocolSHA256: SHA256Schema,
  timingSHA256: SHA256Schema,
  credentialsProofSHA256: SHA256Schema,
  verificationProofSHA256: SHA256Schema,
  measurementSHA256: SHA256Schema,
  credentialsPassed: z.literal(true),
  verificationPassed: z.literal(true),
});
const secret = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\P{Cc}+$/u);
const actionBase = { sessionID: UuidSchema };
const schemas = {
  init: MacInputInitSchema,
  ready: MacInputReadySchema,
  finished: MacInputFinishedSchema,
  approval: MacInputApprovalSchema,
  intent: z.strictObject({
    ...envelope,
    ...lifetime,
    requestID: UuidSchema.nullable(),
    remoteID: z.string().min(1).max(256),
    helperSHA256: SHA256Schema,
    protocolSHA256: SHA256Schema,
  }),
  credentials: z.strictObject({
    ...actionBase,
    kind: z.literal("credentials"),
    email: secret.max(256),
    password: secret,
  }),
  verification: z.strictObject({
    ...actionBase,
    kind: z.literal("verification"),
    code: z.string().regex(/^\d{6}$/u),
    expiresAtUnixMilliseconds: z.number().int().positive(),
  }),
  vault: z.strictObject({
    ...actionBase,
    kind: z.literal("vault"),
    vaultPassword: secret,
  }),
  probe: z.strictObject({
    ...actionBase,
    kind: z.literal("probe"),
    email: secret.max(256),
    password: secret,
    code: z.string().regex(/^\d{6}$/u),
  }),
};
type Frame = keyof typeof schemas;
export const macInputProtocol = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("mac-private-account-input"),
    limits: z.strictObject({
      frameBytes: z.literal(8192),
      sessionMilliseconds: z.literal(120_000),
    }),
    timingDefinition: z.literal(
      "account-input.schema.json#/$defs/verification-timing/const",
    ),
    operations: z.record(
      MacInputOperationSchema,
      z.strictObject({
        phase,
        probe: z.boolean(),
        initialStage: phase,
        accountSubmits: z.number().int().min(0).max(1),
        codeSubmits: z.number().int().min(0).max(1),
        connects: z.number().int().min(0).max(1),
      }),
    ),
    frames: z.record(z.string(), z.array(z.string()).nonempty()),
    failureReasons: z.array(z.string()).nonempty(),
  })
  .parse(definition);
export const macVerificationTiming = z
  .strictObject({
    minimumValidityMilliseconds: z.number().int().positive(),
    maximumClockSkewMilliseconds: z.number().int().positive(),
    maximumValidityMilliseconds: z.number().int().positive(),
  })
  .parse(timingDefinition.$defs["verification-timing"].const);

export function macInputFrame(
  frame: Frame,
  value: unknown,
): Record<string, unknown> {
  const parsed = schemas[frame].safeParse(value);
  if (!parsed.success) throw new Error("Mac private input frame rejected");
  const keys = macInputProtocol.frames[frame];
  assert.ok(keys !== undefined);
  assert.deepEqual(
    Object.keys(parsed.data).sort(),
    [...keys].sort(),
    "Mac private input field contract changed",
  );
  return parsed.data;
}
export function macInputWire(frame: Frame, value: unknown) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(macInputFrame(frame, value)) + "\n",
  );
  if (bytes.length > macInputProtocol.limits.frameBytes)
    throw new Error("Mac private input frame exceeded bound");
  return bytes;
}
export const MacInputPreparedSchema = z.strictObject({
  kind: z.literal("mac-input-prepared"),
  program: absolute,
  input: MacInputInitSchema,
  evidenceDirectory: absolute,
  probe: z.boolean(),
});
export const MacInputCollectedSchema = z.strictObject({
  kind: z.literal("mac-input-collected"),
  sessionID: UuidSchema,
  evidenceDirectory: absolute,
  files: z.array(z.string().min(1).max(4096)).max(32),
  passed: z.boolean(),
  failure: z.enum(["none", "fd", "log", "output", "owner", "capture"]),
});
export const MacInputInstalledSchema = z.strictObject({
  kind: z.literal("mac-input-approved"),
  approvalSHA256: SHA256Schema,
});
export type MacInputPrepared = z.infer<typeof MacInputPreparedSchema>;
export type MacInputFinished = z.infer<typeof MacInputFinishedSchema>;
export function assertMacInputCorrelation(
  prepared: MacInputPrepared,
  operation: MacInputOperation,
  sessionID: string,
) {
  assert.equal(
    prepared.input.operation,
    operation,
    "Mac private preparation operation changed",
  );
  assert.equal(
    prepared.input.sessionID,
    sessionID,
    "Mac private preparation request changed",
  );
}
