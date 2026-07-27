#!/usr/bin/env bun

import { z } from "zod";

const TIMEOUT_MS = 30_000;
const SmokeResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ready") }),
  z.strictObject({ kind: z.literal("error"), message: z.string() }),
]);

const wasmDir = Bun.argv[2] ?? Bun.env["WASM_DIR"] ?? "assets/n64wasm";
const worker = new Worker(
  new URL("smoke-wasm-host-worker.ts", import.meta.url),
);

try {
  const result = await new Promise<z.infer<typeof SmokeResultSchema>>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`WASM host smoke timed out after ${String(TIMEOUT_MS)}ms`),
        );
      }, TIMEOUT_MS);

      worker.addEventListener(
        "message",
        (event: MessageEvent<unknown>) => {
          clearTimeout(timer);
          try {
            resolve(SmokeResultSchema.parse(event.data));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        { once: true },
      );
      worker.addEventListener(
        "error",
        (event) => {
          clearTimeout(timer);
          const cause: unknown = event.error;
          reject(cause instanceof Error ? cause : new Error(event.message));
        },
        { once: true },
      );

      worker.postMessage({ wasmDir });
    },
  );

  if (result.kind === "error") {
    throw new Error(result.message);
  }

  console.warn(`WASM host smoke passed using ${wasmDir}`);
} finally {
  worker.terminate();
}
