import { getQuickJS } from "quickjs-emscripten";
import { z } from "zod";

const RequestSchema = z.strictObject({
  code: z.string().max(32_768),
  datasets: z.string().max(64 * 1024 * 1024),
  deadline: z.number().int(),
});

// User code executes in WebAssembly, never in the Bun worker's JS realm.
globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  void handleMessage(event);
});

async function handleMessage(event: MessageEvent<unknown>) {
  try {
    await executeMessage(event);
  } catch (error) {
    globalThis.postMessage({
      ok: false,
      message:
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Analysis worker failed.",
    });
  }
}

async function executeMessage(event: MessageEvent<unknown>) {
  const input = RequestSchema.parse(event.data);
  const quickjs = await getQuickJS();
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(256 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const deadline = input.deadline;
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const vm = runtime.newContext();
  try {
    const data = vm.newString(input.datasets);
    vm.setProp(vm.global, "__datasetJson", data);
    data.dispose();
    const result = vm.evalCode(`"use strict";
      (() => {
        const datasets = JSON.parse(__datasetJson);
        delete globalThis.__datasetJson;
        const result = (function(datasets) { ${input.code}\n })(datasets);
        if (result instanceof Promise) throw new Error("Return a synchronous JSON result.");
        const json = JSON.stringify(result);
        if (typeof json !== "string") throw new Error("Return a JSON value.");
        if (json.length > 65536) throw new Error("Output exceeds 64 KiB; aggregate or select fewer values.");
        return json;
      })()`);
    if (result.error === undefined) {
      const json = z.string().parse(vm.dump(result.value));
      result.value.dispose();
      if (new TextEncoder().encode(json).byteLength > 65_536) {
        globalThis.postMessage({
          ok: false,
          message: "Output exceeds 64 KiB; aggregate or select fewer values.",
        });
      } else
        globalThis.postMessage({
          ok: true,
          value: z.json().parse(JSON.parse(json)),
        });
    } else {
      const error: unknown = vm.dump(result.error);
      result.error.dispose();
      const message = z.looseObject({ message: z.string() }).safeParse(error);
      globalThis.postMessage({
        ok: false,
        message: message.success
          ? message.data.message.slice(0, 1000)
          : "JavaScript execution failed.",
      });
    }
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
