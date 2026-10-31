import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as host from "./host.ts";
import { guestReadFiles, guestReferenceApply, guestStatus } from "./client.ts";
import { createGuestDispatcher } from "./guest.ts";
import {
  manifest,
  runID,
  guestDirectories,
  dispatcherOptions,
  emptyStatus,
} from "./fixtures.test-support.ts";
import {
  contentSHA,
  encodeBlob,
  maximumChunkBytes,
  maximumWireBytes,
} from "./fields.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});
async function fixture() {
  const { paths } = await guestDirectories(roots, "facet-live-chunks-");
  const options = dispatcherOptions(paths);
  const dispatch = createGuestDispatcher(options);
  const operations: string[] = [];
  vi.spyOn(host, "guestCall").mockImplementation(async (_, operation) => {
    operations.push(operation.kind);
    const request = {
      schemaVersion: 1,
      binding: options.binding,
      requestID: crypto.randomUUID(),
      issuedAt: new Date().toISOString(),
      operation,
    };
    expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThan(
      maximumWireBytes,
    );
    const reply = await dispatch(request);
    expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThan(
      maximumWireBytes,
    );
    if ("outcome" in reply) throw new Error(`Rejected ${reply.reason}`);
    return reply.result;
  });
  return { paths, dispatch, operations };
}

test("real two-MiB-plus fixture and chunk edges round-trip through bounded private messages", async () => {
  const { paths, operations } = await fixture();
  for (const size of [
    0,
    maximumChunkBytes - 1,
    maximumChunkBytes,
    maximumChunkBytes + 1,
    2 * 1024 * 1024 + 1024,
  ]) {
    const bytes = Uint8Array.from({ length: size }, (_, index) => index % 251);
    const relative = `Attachments/binary-${size}.bin`;
    await guestReferenceApply(manifest, {
      kind: "write",
      path: relative,
      expectedSHA256: null,
      bytes,
    });
    const files = await guestReadFiles(manifest, "official", [relative]);
    expect(contentSHA(files[relative] ?? new Uint8Array())).toBe(
      contentSHA(bytes),
    );
    const saved = await readFile(path.join(paths.referenceDirectory, relative));
    expect(saved.length).toBe(size);
  }
  expect(operations.filter((kind) => kind === "referenceStage")).toHaveLength(
    8,
  );
  expect(operations.filter((kind) => kind === "readFileChunk")).toHaveLength(8);
});

function requestHeader() {
  return {
    schemaVersion: 1,
    binding: {
      runID,
      round: 1,
      allowedRemoteVaultID: manifest.allowedRemoteVaultID,
    },
    requestID: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
  };
}
test("a peer preimage change before final chunk cannot be overwritten", async () => {
  const { paths, dispatch } = await fixture();
  const bytes = new Uint8Array(maximumChunkBytes + 1),
    transferID = crypto.randomUUID();
  const operation = {
    kind: "referenceStage",
    transferID,
    path: "Tasks/Peer.md",
    expectedSHA256: null,
    expected: { size: bytes.length, sha256: contentSHA(bytes) },
    offset: 0,
    blob: encodeBlob(bytes.subarray(0, maximumChunkBytes)),
  };
  expect(await dispatch({ ...requestHeader(), operation })).toMatchObject({
    result: { committed: false },
  });
  await mkdir(path.join(paths.referenceDirectory, "Tasks"));
  await writeFile(
    path.join(paths.referenceDirectory, "Tasks/Peer.md"),
    "peer change",
  );
  expect(
    await dispatch({
      ...requestHeader(),
      operation: {
        ...operation,
        offset: maximumChunkBytes,
        blob: encodeBlob(bytes.subarray(maximumChunkBytes)),
      },
    }),
  ).toMatchObject({ outcome: "rejected", reason: "operation" });
  expect(
    await readFile(
      path.join(paths.referenceDirectory, "Tasks/Peer.md"),
      "utf8",
    ),
  ).toBe("peer change");
});

test("out-of-order or corrupt chunks cannot publish a partial reference file", async () => {
  const { paths, dispatch } = await fixture();
  const block = new Uint8Array([1, 2, 3]);
  const operation = {
    kind: "referenceStage",
    transferID: crypto.randomUUID(),
    path: "Tasks/Partial.md",
    expectedSHA256: null,
    expected: { size: 6, sha256: contentSHA(new Uint8Array(6)) },
    offset: 3,
    blob: encodeBlob(block),
  };
  const request = {
    schemaVersion: 1,
    binding: {
      runID,
      round: 1,
      allowedRemoteVaultID: manifest.allowedRemoteVaultID,
    },
    issuedAt: new Date().toISOString(),
  };
  expect(
    await dispatch({ ...request, requestID: crypto.randomUUID(), operation }),
  ).toMatchObject({ outcome: "rejected" });
  expect(
    await dispatch({
      ...request,
      requestID: crypto.randomUUID(),
      operation: {
        ...operation,
        offset: 0,
        blob: { ...operation.blob, sha256: "a".repeat(64) },
      },
    }),
  ).toMatchObject({ outcome: "rejected" });
  expect(
    await Bun.file(
      path.join(paths.referenceDirectory, "Tasks/Partial.md"),
    ).exists(),
  ).toBe(false);
});

test("complete status survives both dispatcher and client without stripping boundary fields", async () => {
  const { paths } = await fixture();
  await mkdir(path.join(paths.stateDirectory, "control"));
  const status = emptyStatus();
  await writeFile(
    path.join(paths.stateDirectory, "control/status.json"),
    JSON.stringify(status),
  );
  expect(await guestStatus(manifest)).toEqual(status);
});
