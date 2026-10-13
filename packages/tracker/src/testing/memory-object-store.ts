import type { ObjectStore } from "#application/object-store.ts";

/** Test adapter only; production always uses the configured S3 bucket. */
export function memoryObjectStore(): ObjectStore {
  const objects = new Map<string, ArrayBuffer>();
  return {
    async put(key, stream) {
      objects.set(key, await new Response(stream).arrayBuffer());
    },
    get(key) {
      const object = objects.get(key);
      if (object === undefined) throw new Error("Test object not found");
      return new Blob([object]).stream();
    },
    delete(key) {
      objects.delete(key);
      return Promise.resolve();
    },
  };
}
