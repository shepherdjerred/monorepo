import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { TofuPlanReceiptSchema } from "@shepherdjerred/delivery/contract";
import { encryptDeliveryPlan, decryptDeliveryPlan } from "./plan-crypto.ts";

const passphrase = "fixture-only-delivery-plan-passphrase";
const bytes = new TextEncoder().encode("private fixture saved plan bytes");
const now = Date.parse("2026-10-17T21:00:00.000Z");
const receipt = TofuPlanReceiptSchema.parse({
  schema: "delivery-tofu-plan/v1",
  deploymentId: "plan/1",
  sourceBuildId: "build/1",
  sourceRevision: "a".repeat(40),
  stack: "cloudflare",
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 60_000).toISOString(),
  planDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  state: { lineage: "original-state", serial: 12 },
  nativeJob: {
    namespace: "delivery-platform-jobs",
    name: `delivery-${"a".repeat(40)}`,
    uid: "f651bfc6-0bc4-4d1c-9c16-b8cd1680df84",
    specFingerprint: "b".repeat(64),
    requestId: "plan/1",
  },
  changes: { create: 1, update: 2, delete: 0, replace: 1 },
});
test("encrypts private bytes and authenticates every source, state and native execution identity", () => {
  const record = encryptDeliveryPlan(receipt, bytes, passphrase);
  expect(JSON.stringify(record)).not.toContain(
    "private fixture saved plan bytes",
  );
  expect(decryptDeliveryPlan(record, passphrase, now)).toEqual(bytes);
  for (const changed of [
    { ...receipt, sourceRevision: "c".repeat(40) },
    { ...receipt, state: { ...receipt.state, serial: 13 } },
    {
      ...receipt,
      nativeJob: { ...receipt.nativeJob, uid: crypto.randomUUID() },
    },
    { ...receipt, changes: { ...receipt.changes, delete: 1 } },
    { ...receipt, expiresAt: new Date(now + 120_000).toISOString() },
  ])
    expect(() =>
      decryptDeliveryPlan({ ...record, receipt: changed }, passphrase, now),
    ).toThrow();
  expect(() =>
    decryptDeliveryPlan(record, "different-fixture-encryption-passphrase", now),
  ).toThrow();
});
test("rejects stale plans, modified ciphertext and unbounded or digest-mismatched input", () => {
  const record = encryptDeliveryPlan(receipt, bytes, passphrase);
  expect(() => decryptDeliveryPlan(record, passphrase, now + 61_000)).toThrow(
    "approval lifetime",
  );
  expect(() =>
    decryptDeliveryPlan(
      {
        ...record,
        encryptedPlan: {
          ...record.encryptedPlan,
          ciphertext: Buffer.from("corrupt").toString("base64"),
        },
      },
      passphrase,
      now,
    ),
  ).toThrow();
  expect(() =>
    encryptDeliveryPlan(
      receipt,
      new Uint8Array(8 * 1024 * 1024 + 1),
      passphrase,
    ),
  ).toThrow("bounded immutable digest");
  expect(() =>
    encryptDeliveryPlan(receipt, new Uint8Array([1]), passphrase),
  ).toThrow("bounded immutable digest");
});
