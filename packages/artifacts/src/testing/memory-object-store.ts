import type { ObjectStore } from "#infrastructure/object-store.ts";

export type MemoryObjectStore = ObjectStore & {
  /** Keys currently stored, for assertions. */
  keys: () => string[];
  bytes: (key: string) => Uint8Array | undefined;
  put: (key: string, bytes: Uint8Array) => void;
  /** Backdates an object, for the orphan sweep. */
  setModified: (key: string, date: Date) => void;
};

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Test adapter only; production always uses the configured S3 bucket. */
export function memoryObjectStore(): MemoryObjectStore {
  const objects = new Map<string, Uint8Array>();
  const modified = new Map<string, Date>();
  const need = (key: string) => {
    const bytes = objects.get(key);
    if (bytes === undefined) throw new Error("Test object not found");
    return bytes;
  };
  return {
    read: (key) => streamOf(need(key)),
    readRange: (key, start, end) =>
      streamOf(need(key).subarray(start, end + 1)),
    openWriter: (key) => {
      const chunks: Uint8Array[] = [];
      return {
        write: (chunk) => {
          chunks.push(new Uint8Array(chunk));
          return Promise.resolve();
        },
        end: () => {
          objects.set(key, new Uint8Array(Buffer.concat(chunks)));
          modified.set(key, new Date());
          return Promise.resolve();
        },
      };
    },
    delete: (key) => {
      objects.delete(key);
      modified.delete(key);
      return Promise.resolve();
    },
    list: (prefix, startAfter, limit) => {
      const keys = [...objects.keys()]
        .filter((key) => key.startsWith(prefix) && key > (startAfter ?? ""))
        .toSorted();
      return Promise.resolve({
        objects: keys.slice(0, limit).map((key) => ({
          key,
          lastModified: modified.get(key) ?? new Date(),
        })),
        truncated: keys.length > limit,
      });
    },
    exists: (key) => Promise.resolve(objects.has(key)),
    keys: () => [...objects.keys()],
    bytes: (key) => objects.get(key),
    put: (key, bytes) => {
      objects.set(key, bytes);
      modified.set(key, new Date());
    },
    setModified: (key, date) => {
      modified.set(key, date);
    },
  };
}
