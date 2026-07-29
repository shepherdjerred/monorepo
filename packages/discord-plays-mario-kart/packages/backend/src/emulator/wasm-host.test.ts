import { expect, test } from "bun:test";
import { z } from "zod";
import {
  REQUIRED_EMSCRIPTEN_FS_FUNCTIONS,
  REQUIRED_EMSCRIPTEN_MODULE_FUNCTIONS,
  validateWasmHostRuntime,
} from "./wasm-host.ts";

const TestResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("result"),
    webGl2Accepted: z.boolean(),
    webGlAccepted: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("error"), message: z.string() }),
]);

function callableRecord(names: readonly string[]): object {
  return Object.fromEntries(names.map((name) => [name, () => 0]));
}

function completeRuntime(): { module: object; fs: object } {
  return {
    module: Object.assign(
      callableRecord(REQUIRED_EMSCRIPTEN_MODULE_FUNCTIONS),
      { HEAPU8: new Uint8Array(1) },
    ),
    fs: callableRecord(REQUIRED_EMSCRIPTEN_FS_FUNCTIONS),
  };
}

test("validates the complete production Emscripten facade", () => {
  expect(() => {
    validateWasmHostRuntime(completeRuntime());
  }).not.toThrow();
});

test("rejects the missing malloc export that prevents ROM injection", () => {
  const runtime = completeRuntime();
  Reflect.deleteProperty(runtime.module, "_malloc");

  expect(() => {
    validateWasmHostRuntime(runtime);
  }).toThrow("emscripten export missing or not callable: _malloc");
});

test("browser stubs satisfy Emscripten's WebGL2 compatibility predicate", async () => {
  const worker = new Worker(
    new URL("wasm-host.test-worker.ts", import.meta.url),
  );

  try {
    const result = await new Promise<z.infer<typeof TestResultSchema>>(
      (resolve, reject) => {
        worker.addEventListener("message", (event: MessageEvent<unknown>) => {
          try {
            resolve(TestResultSchema.parse(event.data));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
        worker.addEventListener("error", (event) => {
          reject(
            event.error instanceof Error
              ? event.error
              : new Error(event.message),
          );
        });
      },
    );

    if (result.kind === "error") {
      throw new Error(result.message);
    }

    expect(result).toEqual({
      kind: "result",
      webGl2Accepted: true,
      webGlAccepted: false,
    });
  } finally {
    worker.terminate();
  }
});
