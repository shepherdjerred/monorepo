import { z } from "zod/v4";
import type { AgentChatObjectStore } from "./session-store.ts";

export const SESSION_CHUNK_BYTES = 1024 * 1024;
export const MAX_SESSION_FILE_BYTES = 128 * SESSION_CHUNK_BYTES;
export const MAX_SESSION_BUNDLE_BYTES = 256 * SESSION_CHUNK_BYTES;
const Sha256Schema = z.string().regex(/^[a-f\d]{64}$/);
const ChunkSchema = z.strictObject({
  key: z.string().min(1),
  bytes: z.number().int().positive().max(SESSION_CHUNK_BYTES),
  sha256: Sha256Schema,
});
export const SessionCheckpointSchema = z
  .strictObject({
    bytes: z.number().int().nonnegative().max(MAX_SESSION_FILE_BYTES),
    sha256: Sha256Schema,
    chunks: z
      .array(ChunkSchema)
      .max(MAX_SESSION_FILE_BYTES / SESSION_CHUNK_BYTES),
  })
  .refine(
    (file) =>
      file.bytes ===
      file.chunks.reduce((total, chunk) => total + chunk.bytes, 0),
    { message: "Session file chunk sizes do not match" },
  );
export type SessionCheckpoint = z.infer<typeof SessionCheckpointSchema>;

async function* fileChunks(filePath: string): AsyncGenerator<Uint8Array> {
  const reader = Bun.file(filePath).stream().getReader();
  let chunk = new Uint8Array(SESSION_CHUNK_BYTES);
  let used = 0;
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SESSION_FILE_BYTES)
        throw new Error("Provider session file exceeds 128 MiB");
      let offset = 0;
      while (offset < value.byteLength) {
        const length = Math.min(
          chunk.byteLength - used,
          value.byteLength - offset,
        );
        chunk.set(value.subarray(offset, offset + length), used);
        used += length;
        offset += length;
        if (used === SESSION_CHUNK_BYTES) {
          yield chunk;
          chunk = new Uint8Array(SESSION_CHUNK_BYTES);
          used = 0;
        }
      }
    }
    if (used > 0) yield chunk.subarray(0, used);
  } finally {
    await reader.cancel();
  }
}

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export async function pushSessionCheckpoint(input: {
  store: AgentChatObjectStore;
  filePath: string;
  blobsPrefix: string;
  forbiddenTokens: readonly string[];
  onChunkCreated?: (key: string) => void;
}): Promise<SessionCheckpoint> {
  const file = Bun.file(input.filePath);
  if (file.size > MAX_SESSION_FILE_BYTES)
    throw new Error("Provider session file exceeds 128 MiB");
  const tokens = input.forbiddenTokens
    .filter((token) => token !== "")
    .map((token) => Buffer.from(token));
  const overlapBytes = tokens.reduce(
    (largest, token) => Math.max(largest, token.byteLength - 1),
    0,
  );
  let overlap: Uint8Array = new Uint8Array();
  const fileHash = new Bun.CryptoHasher("sha256");
  const chunks: SessionCheckpoint["chunks"] = [];
  let bytes = 0;
  // Validate the entire file before uploading any part of it, including secrets
  // split across chunk boundaries. The second pass verifies the file is unchanged.
  for await (const chunk of fileChunks(input.filePath)) {
    const scanned = Buffer.concat([overlap, chunk]);
    if (tokens.some((token) => scanned.includes(token)))
      throw new Error(
        "Provider session state contains a mounted credential and cannot be persisted",
      );
    overlap = scanned.subarray(Math.max(0, scanned.byteLength - overlapBytes));
    fileHash.update(chunk);
    bytes += chunk.byteLength;
    const hash = sha256(chunk);
    chunks.push({
      key: `${input.blobsPrefix}${hash}`,
      bytes: chunk.byteLength,
      sha256: hash,
    });
  }
  const checkpoint = SessionCheckpointSchema.parse({
    bytes,
    sha256: fileHash.digest("hex"),
    chunks,
  });
  let index = 0;
  for await (const chunk of fileChunks(input.filePath)) {
    const expected = ChunkSchema.parse(checkpoint.chunks[index]);
    if (sha256(chunk) !== expected.sha256)
      throw new Error("Provider session file changed during checkpoint");
    if (!(await input.store.has(expected.key))) {
      input.onChunkCreated?.(expected.key);
      await input.store.put(expected.key, chunk);
    }
    index += 1;
  }
  if (index !== checkpoint.chunks.length)
    throw new Error("Provider session file changed during checkpoint");
  return checkpoint;
}

export async function pullSessionCheckpoint(input: {
  store: AgentChatObjectStore;
  checkpoint: SessionCheckpoint;
  destination: string;
  blobsPrefix: string;
}): Promise<void> {
  const checkpoint = SessionCheckpointSchema.parse(input.checkpoint);
  const writer = Bun.file(input.destination).writer();
  const hasher = new Bun.CryptoHasher("sha256");
  try {
    for (const chunk of checkpoint.chunks) {
      if (chunk.key !== `${input.blobsPrefix}${chunk.sha256}`)
        throw new Error("Session chunk key does not match its content hash");
      const bytes = await input.store.get(chunk.key);
      if (bytes.byteLength !== chunk.bytes || sha256(bytes) !== chunk.sha256)
        throw new Error("Session bundle integrity check failed");
      hasher.update(bytes);
      await writer.write(bytes);
      await writer.flush();
    }
    if (hasher.digest("hex") !== checkpoint.sha256)
      throw new Error("Session file integrity check failed");
  } finally {
    await writer.end();
  }
}
