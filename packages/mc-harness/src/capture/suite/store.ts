import { createHash } from "node:crypto";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

export type BlobStore = {
  read: (key: string) => Promise<Uint8Array>;
  write: (key: string, bytes: Uint8Array) => Promise<void>;
};
export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function blobKey(hash: string): string {
  if (!/^[a-f0-9]{64}$/u.test(hash))
    throw new Error("Invalid capture blob hash");
  return `blobs/sha256/${hash}`;
}

/** Publication succeeds only after verifying remote bytes, never just ETags. */
export async function retainBlob(
  store: BlobStore,
  bytes: Uint8Array,
): Promise<string> {
  const hash = digest(bytes);
  await store.write(blobKey(hash), bytes);
  if (digest(await store.read(blobKey(hash))) !== hash)
    throw new Error("Capture blob readback differs");
  return hash;
}

export async function cachedBlob(
  store: BlobStore,
  cache: string,
  hash: string,
): Promise<string> {
  blobKey(hash);
  const file = path.join(cache, hash);
  if (await Bun.file(file).exists()) {
    if (digest(new Uint8Array(await Bun.file(file).arrayBuffer())) !== hash)
      throw new Error("Cached capture blob is corrupt");
    return file;
  }
  const bytes = await store.read(blobKey(hash));
  if (digest(bytes) !== hash)
    throw new Error("Downloaded capture blob differs");
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporary, bytes);
  await rename(temporary, file);
  return file;
}
