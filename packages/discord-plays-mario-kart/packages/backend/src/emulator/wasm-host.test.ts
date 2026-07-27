import { expect, test } from "bun:test";
import { z } from "zod";

const TestResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("result"),
    webGl2Accepted: z.boolean(),
    webGlAccepted: z.boolean(),
  }),
  z.strictObject({ kind: z.literal("error"), message: z.string() }),
]);

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
