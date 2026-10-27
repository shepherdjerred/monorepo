import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { z } from "zod";
import accountDefinition from "./account-input.schema.json";

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
    kind: z.literal("fill"),
    email: z.string().min(1).max(256),
    password: z.string().min(1).max(512),
  }),
  z.strictObject({
    ...correlated,
    kind: z.enum(["submit", "submit-verification", "observe", "finish"]),
  }),
  z.strictObject({
    ...correlated,
    kind: z.literal("fill-verification"),
    code: z.string().regex(/^\d{6}$/u),
  }),
  z.strictObject({
    ...correlated,
    kind: z.literal("fill-vault-password"),
    vaultPassword: z.string().min(1).max(512),
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
    ...envelope,
    kind: z.literal("ready"),
    runnerPID: z.number().int().positive(),
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
};

function boundaryCheck(definition: "command" | "reply", value: unknown) {
  if (!validators[definition](value))
    throw new Error("Private iOS input violated its closed contract");
}

export function encodeAccountCommand(command: AccountCommand) {
  boundaryCheck("command", command);
  const encoded = Buffer.from(JSON.stringify(command) + "\n");
  assert.ok(encoded.length <= 8192, "Private iOS command exceeds its bound");
  return encoded;
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
        end > 0 && end <= 8192 && ++this.frames <= 13,
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
