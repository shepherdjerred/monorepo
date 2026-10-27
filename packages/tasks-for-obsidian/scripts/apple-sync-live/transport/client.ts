import assert from "node:assert/strict";
import { guestCall, type GuestManifest } from "./host.ts";
import type { GuestOperation, GuestResult } from "./contract.ts";
import {
  contentSHA,
  encodeBlob,
  decodeBlob,
  maximumChunkBytes,
  maximumTotalBytes,
  type GuestTarget,
} from "./fields.ts";

export async function requestGuest(
  manifest: GuestManifest,
  operation: GuestOperation,
): Promise<GuestResult> {
  return guestCall(manifest, operation);
}
export async function guestStatus(manifest: GuestManifest): Promise<unknown> {
  const result = await requestGuest(manifest, { kind: "status" });
  if (result.kind !== "status") throw new Error("Wrong guest response");
  const { StatusSchema: schema, validate } = await import("../model.ts");
  validate("status", result.status);
  schema.parse(result.status);
  return result.status;
}
export async function guestSnapshot(
  manifest: GuestManifest,
  target: GuestTarget,
) {
  const result = await requestGuest(manifest, { kind: "snapshot", target });
  if (result.kind !== "snapshot")
    throw new Error("Wrong guest snapshot response");
  assert.deepEqual(result.target, target);
  return result.files;
}
export async function guestReadFiles(
  manifest: GuestManifest,
  target: GuestTarget,
  paths: string[],
): Promise<Record<string, Uint8Array>> {
  assert.ok(paths.length > 0 && new Set(paths).size === paths.length);
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  for (const path of paths) {
    const info = await requestGuest(manifest, {
      kind: "fileInfo",
      target,
      path,
    });
    if (info.kind !== "fileInfo")
      throw new Error("Wrong guest file metadata response");
    assert.deepEqual(info.target, target);
    assert.equal(info.path, path);
    total += info.fingerprint.size;
    assert.ok(total <= maximumTotalBytes);
    const bytes = new Uint8Array(info.fingerprint.size);
    let offset = 0;
    do {
      const length = Math.min(maximumChunkBytes, bytes.length - offset);
      const chunk = await requestGuest(manifest, {
        kind: "readFileChunk",
        target,
        path,
        expected: info.fingerprint,
        offset,
        length,
      });
      if (chunk.kind !== "readFileChunk")
        throw new Error("Wrong guest file chunk response");
      assert.deepEqual(chunk.target, target);
      assert.equal(chunk.path, path);
      assert.deepEqual(chunk.expected, info.fingerprint);
      assert.equal(chunk.offset, offset);
      const block = decodeBlob(chunk.blob);
      assert.equal(block.length, length);
      bytes.set(block, offset);
      offset += block.length;
    } while (offset < bytes.length);
    assert.equal(contentSHA(bytes), info.fingerprint.sha256);
    files[path] = bytes;
  }
  return files;
}
export async function guestOutbox(manifest: GuestManifest, profileID: string) {
  const result = await requestGuest(manifest, { kind: "outbox", profileID });
  if (result.kind !== "outbox") throw new Error("Wrong guest outbox response");
  assert.equal(result.profileID, profileID);
  return { count: result.count, sha256: result.sha256 };
}
export async function guestControl(
  manifest: GuestManifest,
  action: "refresh" | "interrupt" | "resume",
  profileID?: string,
): Promise<void> {
  const result = await requestGuest(manifest, {
    kind: "control",
    action,
    ...(profileID === undefined ? {} : { profileID }),
  });
  if (result.kind !== "control")
    throw new Error("Wrong guest control response");
}
export async function guestReferenceApply(
  manifest: GuestManifest,
  change: {
    kind: "write" | "delete" | "rename";
    path: string;
    destination?: string;
    expectedSHA256: string | null;
    bytes?: Uint8Array;
  },
): Promise<void> {
  let operation: GuestOperation;
  if (change.kind === "write") {
    assert.ok(change.bytes !== undefined && change.destination === undefined);
    const transferID = crypto.randomUUID(),
      expected = {
        size: change.bytes.length,
        sha256: contentSHA(change.bytes),
      };
    let offset = 0;
    do {
      const block = change.bytes.subarray(offset, offset + maximumChunkBytes);
      const result = await requestGuest(manifest, {
        kind: "referenceStage",
        transferID,
        path: change.path,
        expectedSHA256: change.expectedSHA256,
        expected,
        offset,
        blob: encodeBlob(block),
      });
      if (result.kind !== "referenceStage")
        throw new Error("Wrong guest file staging response");
      offset += block.length;
      assert.equal(result.transferID, transferID);
      assert.equal(result.nextOffset, offset);
      assert.equal(result.committed, offset === change.bytes.length);
    } while (offset < change.bytes.length);
    return;
  } else {
    assert.ok(change.expectedSHA256 !== null && change.bytes === undefined);
    if (change.kind === "rename") {
      assert.ok(change.destination !== undefined);
      operation = {
        kind: "referenceApply",
        change: {
          kind: "rename",
          path: change.path,
          destination: change.destination,
          expectedSHA256: change.expectedSHA256,
        },
      };
    } else {
      assert.equal(change.destination, undefined);
      operation = {
        kind: "referenceApply",
        change: {
          kind: "delete",
          path: change.path,
          expectedSHA256: change.expectedSHA256,
        },
      };
    }
  }
  const result = await requestGuest(manifest, operation);
  if (result.kind !== "referenceApply")
    throw new Error("Wrong guest write response");
}
