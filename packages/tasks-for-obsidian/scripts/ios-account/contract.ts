import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { z } from "zod";
import accountDefinition from "./account-input.schema.json";

export const AccountOperationSchema = z.enum([
  "probe",
  "fixture-verification",
  "auth-only",
  "connect-only",
]);
export type AccountOperation = z.infer<typeof AccountOperationSchema>;
export const VerificationTiming = z
  .strictObject({
    minimumValidityMilliseconds: z.literal(15_000),
    maximumClockSkewMilliseconds: z.literal(2000),
    maximumValidityMilliseconds: z.literal(120_000),
  })
  .parse(accountDefinition.$defs["verification-timing"].const);
export const VerificationValueSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/u),
  expiresAtUnixMilliseconds: z.number().int().positive(),
});
export type VerificationValue = z.infer<typeof VerificationValueSchema>;
export type VerificationSource = {
  waitUntilFresh: () => Promise<void>;
  issue: () => VerificationValue;
};
export function assertVerificationFresh(
  expires: number,
  margin: number = VerificationTiming.maximumClockSkewMilliseconds,
) {
  const remaining = expires - Date.now();
  if (
    remaining <= margin ||
    remaining > VerificationTiming.maximumValidityMilliseconds
  )
    throw new Error(
      "Verification validity is insufficient; no automatic retry",
    );
}
export function assertInputClock(clock: number, roundTripMilliseconds = 0) {
  if (
    roundTripMilliseconds < 0 ||
    roundTripMilliseconds > VerificationTiming.maximumClockSkewMilliseconds ||
    Math.abs(clock - Date.now()) >
      VerificationTiming.maximumClockSkewMilliseconds
  )
    throw new Error("Private input clocks do not agree");
}
export async function issueVerificationAfterValidation(
  validate: () => Promise<void>,
  source: VerificationSource,
  validateLive: () => Promise<void>,
) {
  await validate();
  await source.waitUntilFresh();
  await validateLive();
  const value = VerificationValueSchema.parse(source.issue());
  assertVerificationFresh(
    value.expiresAtUnixMilliseconds,
    VerificationTiming.minimumValidityMilliseconds,
  );
  return value;
}

export const AccountIdentitySchema = z.strictObject({
  sessionID: z.uuid(),
  runID: z.uuid(),
  deviceID: z.uuid(),
});
export type AccountIdentity = z.infer<typeof AccountIdentitySchema>;
const envelope = {
  schemaVersion: z.literal(1),
  ...AccountIdentitySchema.shape,
};
const correlated = { ...envelope, requestID: z.uuid() };
export const AccountCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...correlated,
    kind: z.enum([
      "checkpoint-empty",
      "checkpoint-email",
      "checkpoint-vault-empty",
      "fill",
      "fill-vault-password",
      "submit",
      "observe",
      "finish",
    ]),
  }),
  z.strictObject({
    ...correlated,
    kind: z.enum(["fill-verification", "submit-verification"]),
    expiresAtUnixMilliseconds: z.number().int().positive(),
  }),
  z.strictObject({
    ...correlated,
    kind: z.literal("connect"),
    remoteVaultID: z.string().min(1).max(256),
    profileID: z.uuid().optional(),
  }),
]);
export type AccountCommand = z.infer<typeof AccountCommandSchema>;
const AccountReplySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...correlated,
    kind: z.literal("checkpoint"),
    point: z.enum(["empty", "email", "vault-empty"]),
    signInEnabled: z.literal(false).optional(),
    connectEnabled: z.literal(false).optional(),
    submitActionCount: z.literal(0),
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal("ready"),
    runnerPID: z.number().int().positive(),
    operation: AccountOperationSchema,
    clockUnixMilliseconds: z.number().int().positive(),
    stage: z.enum(["credentials", "verification", "vaults"]),
    signInEnabled: z.boolean(),
    connectEnabled: z.boolean().optional(),
  }),
  z.strictObject({
    ...correlated,
    kind: z.literal("filled"),
    disabledCheckpoints: z.literal(2),
    signInEnabled: z.literal(true),
    submitActionCount: z.literal(0),
  }),
  z.strictObject({
    ...correlated,
    kind: z.literal("submitted"),
    submitActionCount: z.literal(1),
    intentRecorded: z.literal(true),
  }),
  z.strictObject({
    ...correlated,
    kind: z.literal("observed"),
    stage: z.enum(["verification", "vaults", "connected", "rejected"]),
    busy: z.literal(false),
    connectEnabled: z.boolean().optional(),
  }),
  z.strictObject({
    ...correlated,
    kind: z.literal("verification-filled"),
    signInEnabled: z.literal(true),
    submitActionCount: z.literal(0),
  }),
  z.strictObject({
    ...correlated,
    kind: z.enum(["verification-submitted", "connect-submitted"]),
    submitActionCount: z.literal(1),
    intentRecorded: z.literal(true),
  }),
  z.strictObject({
    ...correlated,
    kind: z.literal("vault-password-filled"),
    disabledCheckpoints: z.literal(1),
    connectEnabled: z.literal(true),
    submitActionCount: z.literal(0),
  }),
  z.strictObject({
    ...correlated,
    kind: z.literal("finished"),
    submitActionCount: z.number().int().min(0).max(3),
  }),
  z.strictObject({
    ...envelope,
    kind: z.literal("rejected"),
    requestID: z.uuid().optional(),
    reason: z.enum([
      "input",
      "ownership",
      "form",
      "focus",
      "deadline",
      "socket",
    ]),
  }),
]);
export type AccountReply = z.infer<typeof AccountReplySchema>;
const contract = new Ajv2020({ strict: false, allErrors: true });
addFormats(contract);
const schema = z.record(z.string(), z.unknown()).parse(accountDefinition);
const validators = {
  command: contract.compile({ ...schema, $ref: "#/$defs/command" }),
  reply: contract.compile({ ...schema, $ref: "#/$defs/reply" }),
  "app-command": contract.compile({ ...schema, $ref: "#/$defs/app-command" }),
  "app-reply": contract.compile({ ...schema, $ref: "#/$defs/app-reply" }),
  "bridge-packet": contract.compile({
    ...schema,
    $ref: "#/$defs/bridge-packet",
  }),
  "submit-intent": contract.compile({
    ...schema,
    $ref: "#/$defs/submit-intent",
  }),
};

export function boundaryCheck(
  definition: keyof typeof validators,
  value: unknown,
) {
  if (!validators[definition](value))
    throw new Error("Private iOS input violated its closed contract");
}

export function encodeAccountCommand(command: unknown) {
  boundaryCheck("command", command);
  const encoded = Buffer.from(JSON.stringify(command) + "\n");
  assert.ok(encoded.length <= 8192, "Private iOS command exceeds its bound");
  return encoded;
}

export const AppReplySchema = z.strictObject({
  ...envelope,
  formEpoch: z.uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/u),
  kind: z.enum(["hello", "ready", "applied", "rejected"]),
  stage: z.enum(["credentials", "verification", "vaults"]),
  requestID: z.uuid().optional(),
  appPID: z.number().int().positive().optional(),
  mode: z.enum(["account", "fixture-verification"]).optional(),
  fixtureConfirmed: z.boolean().optional(),
  clockUnixMilliseconds: z.number().int().positive().optional(),
  action: z
    .enum([
      "clear",
      "email",
      "password",
      "verification",
      "clear-vault",
      "vault-password",
      "finish",
    ])
    .optional(),
  reason: z
    .enum(["input", "ownership", "form", "focus", "deadline", "socket"])
    .optional(),
});
export type AppReply = z.infer<typeof AppReplySchema>;
export function decodeAppReply(value: unknown): AppReply {
  boundaryCheck("app-reply", value);
  const parsed = AppReplySchema.safeParse(value);
  if (!parsed.success)
    throw new Error("Private app input returned an invalid frame");
  return parsed.data;
}
export function decodeCorrelatedAppReply(value: unknown, expected: AppReply) {
  const reply = decodeAppReply(value);
  for (const field of [
    "token",
    "formEpoch",
    "runID",
    "sessionID",
    "deviceID",
  ] as const)
    if (reply[field] !== expected[field])
      throw new Error("Private app reply ownership changed");
  return reply;
}
export function encodeAppCommand(value: unknown) {
  boundaryCheck("app-command", value);
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  if (bytes.length > 8192)
    throw new Error("Private app input exceeded its frame bound");
  return bytes;
}

export function decodeAccountReply(
  bytes: Uint8Array,
  expected: AccountIdentity,
): AccountReply {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Private iOS input returned an invalid frame");
  }
  boundaryCheck("reply", value);
  const parsed = AccountReplySchema.safeParse(value);
  if (!parsed.success)
    throw new Error("Private iOS input returned an unsupported frame");
  const actual = parsed.data;
  if (
    actual.sessionID !== expected.sessionID ||
    actual.runID !== expected.runID ||
    actual.deviceID !== expected.deviceID
  )
    throw new Error("Private iOS input belongs to another owned session");
  return actual;
}

export class AccountFrameDecoder {
  private bytes = Buffer.alloc(0);
  private frames = 0;
  constructor(private readonly identity: AccountIdentity) {}
  push(chunk: Uint8Array): AccountReply[] {
    assert.ok(
      chunk.length <= 65_536,
      "Private iOS input exceeds its session bound",
    );
    this.bytes = Buffer.concat([this.bytes, chunk]);
    const replies: AccountReply[] = [];
    for (;;) {
      const end = this.bytes.indexOf(10);
      if (end === -1) break;
      assert.ok(
        end > 0 && end <= 8192 && ++this.frames <= 14,
        "Private iOS input exceeds its frame bound",
      );
      replies.push(
        decodeAccountReply(this.bytes.subarray(0, end), this.identity),
      );
      this.bytes = this.bytes.subarray(end + 1);
    }
    assert.ok(
      this.bytes.length <= 8192,
      "Private iOS input exceeds its frame bound",
    );
    return replies;
  }
}
