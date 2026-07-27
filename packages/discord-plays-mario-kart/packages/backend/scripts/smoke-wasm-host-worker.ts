import { z } from "zod";
import { initializeWasmHost } from "#src/emulator/wasm-host.ts";

const RequestSchema = z.strictObject({ wasmDir: z.string().min(1) });

type SmokeResult =
  | { readonly kind: "ready" }
  | { readonly kind: "error"; readonly message: string };

function requireCallable(host: object, name: string): void {
  const value: unknown = Reflect.get(host, name);
  if (typeof value !== "function") {
    throw new TypeError(`required runtime export is not callable: ${name}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function initialize(data: unknown): Promise<void> {
  try {
    const { wasmDir } = RequestSchema.parse(data);
    const { module, fs } = await initializeWasmHost({
      wasmDir,
      print: (message) => {
        console.warn(`[n64 smoke] ${message}`);
      },
      printErr: (message) => {
        console.error(`[n64 smoke] ${message}`);
      },
    });

    requireCallable(module, "_runMainLoop");
    requireCallable(module, "callMain");
    requireCallable(fs, "writeFile");

    const result: SmokeResult = { kind: "ready" };
    postMessage(result);
  } catch (error) {
    const result: SmokeResult = {
      kind: "error",
      message: errorMessage(error),
    };
    postMessage(result);
  }
}

addEventListener(
  "message",
  (event: MessageEvent<unknown>) => {
    void initialize(event.data);
  },
  { once: true },
);
