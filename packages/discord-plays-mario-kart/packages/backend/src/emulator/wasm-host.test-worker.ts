import { installBrowserStubs, makeGLStub } from "./wasm-host.ts";

type TestResult =
  | {
      readonly kind: "result";
      readonly webGl2Accepted: boolean;
      readonly webGlAccepted: boolean;
    }
  | { readonly kind: "error"; readonly message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emscriptenAcceptsContext(
  version: string,
  isWebGlRenderingContext: boolean,
): boolean {
  return (version === "webgl") === isWebGlRenderingContext;
}

try {
  installBrowserStubs();

  const webGlRenderingContext: unknown = Reflect.get(
    globalThis,
    "WebGLRenderingContext",
  );
  if (typeof webGlRenderingContext !== "function") {
    throw new TypeError("WebGLRenderingContext is not callable");
  }

  const gl = makeGLStub();
  const isWebGlRenderingContext = gl instanceof webGlRenderingContext;
  const result: TestResult = {
    kind: "result",
    // Mirrors the generated Emscripten compatibility predicate:
    // ver == "webgl" == gl instanceof WebGLRenderingContext
    webGl2Accepted: emscriptenAcceptsContext("webgl2", isWebGlRenderingContext),
    webGlAccepted: emscriptenAcceptsContext("webgl", isWebGlRenderingContext),
  };
  postMessage(result);
} catch (error) {
  const result: TestResult = { kind: "error", message: errorMessage(error) };
  postMessage(result);
}
