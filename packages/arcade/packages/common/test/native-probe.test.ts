import { expect, it, vi } from "vitest";
import {
  gameModule,
  mkwConfiguration,
  readProbe,
} from "@arcade/common/runtime/probe.ts";

it("attaches Wii media hooks before the SDK has initialized its heap exports", () => {
  const configuration = { canvas: {} };
  const callback = vi.fn();
  vi.stubGlobal("Module", configuration);
  try {
    expect(mkwConfiguration()).toBe(configuration);
    expect(() => gameModule()).toThrow();
    mkwConfiguration().onArcadeFrame = callback;
    expect(Reflect.get(configuration, "onArcadeFrame")).toBe(callback);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("copies shared WASM probe memory before passing it to the browser decoder", () => {
  const ActualDecoder = globalThis.TextDecoder;
  class BrowserDecoder extends ActualDecoder {
    override decode(
      input?: Parameters<TextDecoder["decode"]>[0],
      options?: Parameters<TextDecoder["decode"]>[1],
    ): string {
      if (
        input !== undefined &&
        ArrayBuffer.isView(input) &&
        input.buffer instanceof SharedArrayBuffer
      )
        throw new TypeError(
          "Shared input is not supported by the browser decoder",
        );
      return super.decode(input, options);
    }
  }
  const memory = new SharedArrayBuffer(64);
  const heap = new Uint8Array(memory);
  heap.set(new TextEncoder().encode('{"scene":2}'), 4);
  vi.stubGlobal("TextDecoder", BrowserDecoder);
  vi.stubGlobal("Module", {
    HEAPU8: heap,
    HEAP16: new Int16Array(memory),
    FS: { syncfs: vi.fn() },
    _arcade_melee_probe: () => 4,
  });
  try {
    expect(readProbe("melee", 0)).toEqual({ scene: 2 });
  } finally {
    vi.unstubAllGlobals();
  }
});
