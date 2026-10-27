import assert from "node:assert/strict";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { RelativePathSchema } from "../apple-sync-live/transport/fields";

function sentinelPatterns(needles: string[]) {
  assert.ok(
    needles.length > 0 &&
      needles.length <= 4 &&
      needles.every((value) => value.length >= 16),
  );
  return needles.flatMap((needle) =>
    [...new Set([needle, needle.slice(0, 16), needle.slice(-16)])].flatMap(
      (value) => [
        Buffer.from(value),
        Buffer.from(value, "utf16le"),
        Buffer.from(value, "utf16le").swap16(),
        Buffer.from(JSON.stringify(value).slice(1, -1)),
        Buffer.from(Buffer.from(value).toString("base64")),
      ],
    ),
  );
}

function rejectUnsafeEvidence(
  bytes: Buffer,
  patterns: Buffer[],
  relative: string,
) {
  if (patterns.some((needle) => bytes.includes(needle)))
    throw new Error(
      "Synthetic iOS private-input sentinel appeared in retained evidence",
    );
  if (/\.(?:png|jpe?g|heic|mov|mp4)$/iu.test(relative))
    throw new Error(
      "Private account input retained unexpected visual evidence",
    );
}

/** Probe credentials are synthetic; failed raw evidence stays private for diagnosis. */
export async function scanPrivateInputEvidence(
  directory: string,
  sentinels: string[],
) {
  assert.equal(await realpath(directory), directory);
  const root = await lstat(directory);
  assert.ok(
    root.isDirectory() &&
      !root.isSymbolicLink() &&
      root.uid === process.getuid?.(),
  );
  const patterns = sentinelPatterns(sentinels);
  const inventory: Record<string, { size: number; sha256: string }> = {};
  const pending = [directory];
  let total = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    assert.ok(current !== undefined);
    for (const name of await readdir(current)) {
      const absolute = path.join(current, name),
        metadata = await lstat(absolute);
      assert.ok(!metadata.isSymbolicLink() && metadata.uid === root.uid);
      if (metadata.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      assert.ok(metadata.isFile() && metadata.size <= 128 * 1024 * 1024);
      total += metadata.size;
      assert.ok(
        total <= 512 * 1024 * 1024 && Object.keys(inventory).length < 20_000,
      );
      const relative = path.relative(directory, absolute);
      const bytes = await readFile(absolute);
      rejectUnsafeEvidence(bytes, patterns, relative);
      inventory[relative] = {
        size: bytes.length,
        sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      };
    }
  }
  assert.ok(
    Object.keys(inventory).length > 0,
    "Private input proof requires retained native evidence",
  );
  return { files: inventory, bytes: total };
}

export const InputProbeProofSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("ios-private-account-input-probe"),
  runID: z.uuid(),
  sourceHead: z.string().regex(/^[a-f0-9]{40}$/u),
  probeID: z.uuid(),
  selector: z.literal("AccountInputUITests/testPrivateAccountInput"),
  sourceFiles: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)),
  runnerFiles: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)),
  status: z.literal("private-input-ready"),
  nativeCaseCount: z.literal(1),
  disabledCheckpoints: z.literal(2),
  submitActionCount: z.literal(0),
  scannedRawEvidence: z.literal(true),
  decodedActivityAndConsoleLogs: z.literal(true),
  attachmentsCount: z.literal(0),
  evidence: z.record(
    RelativePathSchema,
    z.strictObject({
      size: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    }),
  ),
});

export function assertPrivateInputProof(
  value: unknown,
  expected: {
    runID: string;
    sourceHead: string;
    sourceFiles: Record<string, string>;
    runnerFiles: Record<string, string>;
  },
) {
  const parsed = InputProbeProofSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Real iOS credentials require a complete synthetic private-input proof",
    );
  const proof = parsed.data;
  assert.equal(
    proof.runID,
    expected.runID,
    "Private input proof belongs to another live run",
  );
  assert.equal(
    proof.sourceHead,
    expected.sourceHead,
    "Private input source changed after its probe",
  );
  assert.deepEqual(
    proof.sourceFiles,
    expected.sourceFiles,
    "Private input source changed after its probe",
  );
  assert.deepEqual(
    proof.runnerFiles,
    expected.runnerFiles,
    "Private input runner changed after its probe",
  );
  assert.ok(
    Object.keys(proof.sourceFiles).length > 0 &&
      Object.keys(proof.runnerFiles).length > 0 &&
      Object.keys(proof.evidence).length > 0,
  );
  return proof;
}

export async function verifyPrivateInputEvidence(
  directory: string,
  proof: z.infer<typeof InputProbeProofSchema>,
) {
  assert.equal(await realpath(directory), directory);
  const pending = [directory];
  const actual: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    assert.ok(current !== undefined);
    for (const name of await readdir(current)) {
      const file = path.join(current, name),
        metadata = await lstat(file);
      assert.ok(
        !metadata.isSymbolicLink() && metadata.uid === process.getuid?.(),
      );
      if (metadata.isDirectory()) pending.push(file);
      else {
        assert.ok(metadata.isFile());
        actual.push(path.relative(directory, file));
      }
      assert.ok(actual.length <= 20_000);
    }
  }
  assert.deepEqual(
    actual.toSorted(),
    Object.keys(proof.evidence).sort(),
    "Private input evidence inventory changed",
  );
  for (const [relative, expected] of Object.entries(proof.evidence)) {
    RelativePathSchema.parse(relative);
    const file = path.join(directory, relative),
      metadata = await lstat(file);
    assert.ok(
      metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        metadata.uid === process.getuid?.() &&
        metadata.size === expected.size,
    );
    const bytes = await readFile(file);
    assert.equal(
      new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      expected.sha256,
      "Private input evidence changed after its probe",
    );
  }
}
