import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  RecordTofuPlanSchema,
  TofuPlanReceiptSchema,
  PlatformRecoveryPlanReceiptSchema,
  RecordPlatformRecoveryPlanSchema,
  type PlatformRecoveryPlanReceipt,
  type RecordPlatformRecoveryPlan,
  type RecordTofuPlan,
  type TofuPlanReceipt,
} from "@shepherdjerred/delivery/contract";
import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";

const MAX_PLAN_BYTES = 8 * 1024 * 1024;
function key(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 32)
    throw new Error(
      "Delivery saved-plan encryption bootstrap is missing or invalid",
    );
  return scryptSync(
    passphrase,
    Buffer.concat([Buffer.from("delivery-tofu-plan-v1:"), salt]),
    32,
    { N: 1 << 15, maxmem: 64 * 1024 * 1024 },
  );
}
function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
const ReceiptSchema = z.union([
  TofuPlanReceiptSchema,
  PlatformRecoveryPlanReceiptSchema,
]);
const RecordSchema = z.union([
  RecordTofuPlanSchema,
  RecordPlatformRecoveryPlanSchema,
]);
function aad(receipt: z.infer<typeof ReceiptSchema>): Buffer {
  return Buffer.from(canonicalJson(ReceiptSchema.parse(receipt)));
}

/** Every public identity, including native Job UID, is authenticated with the private plan bytes. */
export function encryptDeliveryPlan(
  receipt: TofuPlanReceipt,
  bytes: Uint8Array,
  passphrase: string,
): RecordTofuPlan {
  return RecordTofuPlanSchema.parse(encryptPlan(receipt, bytes, passphrase));
}
export function encryptRecoveryPlan(
  receipt: PlatformRecoveryPlanReceipt,
  bytes: Uint8Array,
  passphrase: string,
): RecordPlatformRecoveryPlan {
  return RecordPlatformRecoveryPlanSchema.parse(
    encryptPlan(receipt, bytes, passphrase),
  );
}
function encryptPlan(
  receipt: z.infer<typeof ReceiptSchema>,
  bytes: Uint8Array,
  passphrase: string,
) {
  if (
    bytes.length === 0 ||
    bytes.length > MAX_PLAN_BYTES ||
    digest(bytes) !== receipt.planDigest
  )
    throw new Error(
      "Saved plan bytes differ from their bounded immutable digest",
    );
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(passphrase, salt), iv);
  cipher.setAAD(aad(receipt));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    receipt,
    encryptedPlan: {
      algorithm: "aes-256-gcm",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    },
  };
}

export function decryptDeliveryPlan(
  raw: unknown,
  passphrase: string,
  now = Date.now(),
): Uint8Array {
  return decryptPlan(RecordTofuPlanSchema.parse(raw), passphrase, now);
}
export function decryptRecoveryPlan(
  raw: unknown,
  passphrase: string,
  now = Date.now(),
): Uint8Array {
  return decryptPlan(
    RecordPlatformRecoveryPlanSchema.parse(raw),
    passphrase,
    now,
  );
}
function decryptPlan(
  raw: unknown,
  passphrase: string,
  now: number,
): Uint8Array {
  const { receipt, encryptedPlan } = RecordSchema.parse(raw);
  if (
    Date.parse(receipt.createdAt) > now + 5000 ||
    Date.parse(receipt.expiresAt) < now
  )
    throw new Error("Saved plan is outside its exact approval lifetime");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(passphrase, Buffer.from(encryptedPlan.salt, "base64")),
    Buffer.from(encryptedPlan.iv, "base64"),
  );
  decipher.setAAD(aad(receipt));
  decipher.setAuthTag(Buffer.from(encryptedPlan.tag, "base64"));
  const bytes = Buffer.concat([
    decipher.update(Buffer.from(encryptedPlan.ciphertext, "base64")),
    decipher.final(),
  ]);
  if (bytes.length === 0 || digest(bytes) !== receipt.planDigest)
    throw new Error("Decrypted saved plan differs from its immutable digest");
  return new Uint8Array(bytes);
}
