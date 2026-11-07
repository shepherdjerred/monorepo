import type { BlobStore } from "#src/capture/suite/store.ts";

export function integer(name: string, value: number): Buffer {
  const bytes = Buffer.alloc(7 + name.length);
  bytes[0] = 3;
  bytes.writeUInt16BE(name.length, 1);
  bytes.write(name, 3);
  bytes.writeInt32BE(value, 3 + name.length);
  return bytes;
}

export function memoryStore(): BlobStore {
  const objects = new Map<string, Uint8Array>();
  return {
    write: (key, bytes) => {
      objects.set(key, bytes);
      return Promise.resolve();
    },
    read: (key) => {
      const bytes = objects.get(key);
      if (bytes === undefined) throw new Error("Missing blob");
      return Promise.resolve(bytes);
    },
  };
}
