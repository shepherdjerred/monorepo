import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  assertPrivateInputProof,
  scanPrivateInputEvidence,
  verifyPrivateInputEvidence,
} from "./leak-check";

const roots: string[] = [];
const email = "synthetic-email-needle@example.invalid";
const password = "synthetic-password-needle-q7!";
async function directory() {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-ios-input-proof-")),
  );
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});

test.each([
  { name: "email UTF8", bytes: () => Buffer.from(email) },
  { name: "password UTF8", bytes: () => Buffer.from(password) },
  { name: "email UTF16", bytes: () => Buffer.from(email, "utf16le") },
  { name: "password UTF16", bytes: () => Buffer.from(password, "utf16le") },
  {
    name: "email UTF16BE",
    bytes: () => Buffer.from(email, "utf16le").swap16(),
  },
  {
    name: "password UTF16BE",
    bytes: () => Buffer.from(password, "utf16le").swap16(),
  },
  {
    name: "truncated email log",
    bytes: () => Buffer.from(`Type ${email.slice(0, 20)}…`),
  },
  {
    name: "truncated password log",
    bytes: () => Buffer.from(`Type ${password.slice(0, 20)}…`),
  },
  {
    name: "email base64",
    bytes: () => Buffer.from(Buffer.from(email).toString("base64")),
  },
  {
    name: "password base64",
    bytes: () => Buffer.from(Buffer.from(password).toString("base64")),
  },
])(
  "raw retained evidence rejects $name without exposing the sentinel",
  async ({ bytes }) => {
    const root = await directory();
    await mkdir(path.join(root, "AccountInput.xcresult/Data"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, "AccountInput.xcresult/Data/raw-object"),
      bytes(),
      { mode: 0o600 },
    );
    try {
      await scanPrivateInputEvidence(root, [email, password]);
      throw new Error("Expected private input leak rejection");
    } catch (error) {
      expect(String(error)).toContain("sentinel appeared");
      expect(String(error)).not.toContain(email);
      expect(String(error)).not.toContain(password);
    }
  },
);

test("visual or symlinked evidence cannot silently establish a secrecy proof", async () => {
  const root = await directory();
  const image = path.join(root, "account.png");
  await writeFile(image, Buffer.from([1]), { mode: 0o600 });
  await expect(
    scanPrivateInputEvidence(root, [email, password]),
  ).rejects.toThrow("visual evidence");
  await rm(image);
  const outside = await directory();
  await writeFile(path.join(outside, "owned.txt"), "safe", { mode: 0o600 });
  await symlink(path.join(outside, "owned.txt"), path.join(root, "linked.txt"));
  await expect(
    scanPrivateInputEvidence(root, [email, password]),
  ).rejects.toThrow();
});

test("proof binds exact native source, Runner and raw evidence inventory before any real lookup", async () => {
  const root = await directory();
  await writeFile(path.join(root, "console.json"), "{}", { mode: 0o600 });
  const scan = await scanPrivateInputEvidence(root, [email, password]);
  const expected = {
    runID: "12345678-1234-4234-9234-123456789abc",
    sourceHead: "a".repeat(40),
    sourceFiles: { "owned.ts": "b".repeat(64) },
    runnerFiles: { Runner: "c".repeat(64) },
  };
  const proof = {
    schemaVersion: 1,
    kind: "ios-private-account-input-probe",
    ...expected,
    probeID: "22345678-1234-4234-9234-123456789abc",
    selector: "AccountInputUITests/testPrivateAccountInput",
    status: "private-input-ready",
    nativeCaseCount: 1,
    disabledCheckpoints: 2,
    submitActionCount: 0,
    scannedRawEvidence: true,
    decodedActivityAndConsoleLogs: true,
    attachmentsCount: 0,
    evidence: scan.files,
  };
  const parsed = assertPrivateInputProof(proof, expected);
  await verifyPrivateInputEvidence(root, parsed);
  expect(() =>
    assertPrivateInputProof({ ...proof, submitActionCount: 1 }, expected),
  ).toThrow();
  expect(() =>
    assertPrivateInputProof(proof, { ...expected, sourceHead: "d".repeat(40) }),
  ).toThrow("source changed");
  expect(() =>
    assertPrivateInputProof(proof, {
      ...expected,
      runnerFiles: { Runner: "e".repeat(64) },
    }),
  ).toThrow("runner changed");
  await writeFile(path.join(root, "unexpected.txt"), "extra", { mode: 0o600 });
  await expect(verifyPrivateInputEvidence(root, parsed)).rejects.toThrow(
    "inventory changed",
  );
});
