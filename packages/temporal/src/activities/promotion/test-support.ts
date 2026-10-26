import type { z } from "zod/v4";
import type { PromotionStore } from "./store.ts";

export function memoryPromotionStore(): PromotionStore {
  const values = new Map<string, { value: unknown; etag: string }>();
  let generation = 0;
  return {
    read: <T>(key: string, schema: z.ZodType<T>) => {
      const current = values.get(key);
      return Promise.resolve(
        current === undefined
          ? undefined
          : {
              etag: current.etag,
              value: schema.parse(structuredClone(current.value)),
            },
      );
    },
    put: (key, value, expectedEtag) => {
      if (values.get(key)?.etag !== expectedEtag) return Promise.resolve(false);
      generation++;
      values.set(key, {
        value: structuredClone(value),
        etag: String(generation),
      });
      return Promise.resolve(true);
    },
  };
}
