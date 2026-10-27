import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { DataOperationSchema } from "./contract.ts";
import {
  contentSHA,
  decodeBlob,
  encodeBlob,
  FileFingerprintSchema,
  GuestBindingSchema,
  maximumFileBytes,
  RelativePathSchema,
  SHA256Schema,
  type GuestBinding,
} from "./fields.ts";
import {
  ownedPath,
  readOwnedBytes,
  readScopedBytes,
  referenceApply,
  writableReferencePath,
  type GuestPaths,
} from "./owned-files.ts";

type DataOperation = z.infer<typeof DataOperationSchema>;
type Stage = Extract<DataOperation, { kind: "referenceStage" }>;
const StageSchema = z.strictObject({
  binding: GuestBindingSchema,
  path: RelativePathSchema,
  expected: FileFingerprintSchema,
  expectedSHA256: SHA256Schema.nullable(),
  offset: z.number().int().min(0).max(maximumFileBytes),
});

export async function fileInfo(
  root: string,
  relative: string,
  evidence: boolean,
) {
  const bytes = await readScopedBytes(root, relative, evidence);
  return { size: bytes.length, sha256: contentSHA(bytes) };
}
export async function fileChunk(
  root: string,
  operation: Extract<DataOperation, { kind: "readFileChunk" }>,
) {
  const bytes = await readScopedBytes(
    root,
    operation.path,
    operation.target === "evidence",
  );
  assert.deepEqual(
    { size: bytes.length, sha256: contentSHA(bytes) },
    operation.expected,
  );
  assert.ok(operation.offset + operation.length <= bytes.length);
  assert.ok(
    operation.length > 0 || (bytes.length === 0 && operation.offset === 0),
  );
  return encodeBlob(
    bytes.subarray(operation.offset, operation.offset + operation.length),
  );
}

/** Chunk files remain outside Sync until their complete bytes and expected preimage validate. */
export async function stageReference(
  paths: GuestPaths,
  binding: GuestBinding,
  operation: Stage,
  requestID: string,
) {
  writableReferencePath(operation.path);
  const block = decodeBlob(operation.blob);
  assert.ok(operation.offset + block.length <= operation.expected.size);
  assert.ok(block.length > 0 || operation.expected.size === 0);
  const dataPath = await ownedPath(
    paths.evidenceDirectory,
    `transport-staging/${operation.transferID}.bin`,
    true,
  );
  const metadataPath = path.join(
    path.dirname(dataPath),
    `${operation.transferID}.json`,
  );
  const expected = {
    binding,
    path: operation.path,
    expected: operation.expected,
    expectedSHA256: operation.expectedSHA256,
  };
  if (operation.offset === 0) {
    await writeFile(metadataPath, JSON.stringify({ ...expected, offset: 0 }), {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(dataPath, new Uint8Array(), { flag: "wx", mode: 0o600 });
  }
  const raw: unknown = JSON.parse(
    new TextDecoder().decode(
      await readOwnedBytes(
        paths.evidenceDirectory,
        `transport-staging/${operation.transferID}.json`,
      ),
    ),
  );
  const metadata = StageSchema.parse(raw);
  assert.deepEqual(metadata.binding, binding);
  assert.equal(metadata.path, expected.path);
  assert.deepEqual(metadata.expected, expected.expected);
  assert.equal(metadata.expectedSHA256, expected.expectedSHA256);
  assert.equal(metadata.offset, operation.offset);
  const handle = await open(
    dataPath,
    constants.O_WRONLY | constants.O_NOFOLLOW,
  );
  try {
    const file = await handle.stat();
    assert.ok(
      file.isFile() &&
        file.uid === process.getuid?.() &&
        file.size === operation.offset,
    );
    let written = 0;
    while (written < block.length) {
      const result = await handle.write(
        block,
        written,
        block.length - written,
        operation.offset + written,
      );
      assert.ok(result.bytesWritten > 0);
      written += result.bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  const nextOffset = operation.offset + block.length;
  const temporary = path.join(
    path.dirname(metadataPath),
    `${operation.transferID}-${requestID}.tmp`,
  );
  await writeFile(
    temporary,
    JSON.stringify({ ...expected, offset: nextOffset }),
    { flag: "wx", mode: 0o600 },
  );
  await rename(temporary, metadataPath);
  const metadataFile = await lstat(metadataPath);
  assert.ok(
    metadataFile.isFile() &&
      !metadataFile.isSymbolicLink() &&
      metadataFile.uid === process.getuid(),
  );
  const committed = nextOffset === operation.expected.size;
  if (committed) {
    const bytes = await readOwnedBytes(
      paths.evidenceDirectory,
      `transport-staging/${operation.transferID}.bin`,
    );
    assert.equal(bytes.length, operation.expected.size);
    assert.equal(contentSHA(bytes), operation.expected.sha256);
    await referenceApply(
      paths,
      {
        kind: "write",
        path: operation.path,
        expectedSHA256: operation.expectedSHA256,
        blob: encodeBlob(bytes),
      },
      requestID,
    );
  }
  return {
    kind: "referenceStage" as const,
    transferID: operation.transferID,
    nextOffset,
    committed,
  };
}
