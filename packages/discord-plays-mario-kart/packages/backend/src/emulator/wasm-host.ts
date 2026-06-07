// Minimal browser environment so the (browser-built) N64Wasm emscripten glue
// runs under Bun/Node headless. Ported from the validated spike (run.mjs).
//
// CRITICAL: we deliberately do NOT define `window`. emscripten must detect
// ENVIRONMENT_IS_NODE only; if both WEB and NODE are detected, its FS/syscall
// path null-traps `fseek`. The GL calls go to a no-op stub (no real GPU) — the
// frame is read out of wasm memory via _neilGetVideoBuffer, not via GL.
import { createRequire } from "node:module";

type Globals = Record<string, unknown>;

// Shared no-op for the many browser/DOM methods the glue calls but we ignore.
const noop = (): void => {
  /* intentional shim no-op */
};

const rect = () => ({
  left: 0,
  top: 0,
  right: 640,
  bottom: 480,
  width: 640,
  height: 480,
});

function setGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

/** A permissive WebGL2 stub: enough for emscripten GL init + the textured-quad
 *  display path. We never read pixels through it. */
export function makeGLStub(): unknown {
  const obj: Globals = {
    getError: () => 0,
    getParameter: (p: number) => {
      switch (p) {
        case 0x1f_00:
          return "stub-vendor"; // VENDOR
        case 0x1f_01:
          return "stub-renderer"; // RENDERER
        case 0x1f_02:
          return "OpenGL ES 3.0 (WebGL stub)"; // VERSION
        case 0x8b_8c:
          return "OpenGL ES GLSL ES 3.00"; // SHADING_LANGUAGE_VERSION
        default:
          return 16_384;
      }
    },
    getExtension: () => null,
    getSupportedExtensions: () => [],
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    createTexture: () => ({}),
    createFramebuffer: () => ({}),
    createRenderbuffer: () => ({}),
    createVertexArray: () => ({}),
    getShaderParameter: (_s: unknown, p: number) => p === 0x8b_81, // COMPILE_STATUS
    getProgramParameter: (_pr: unknown, p: number) =>
      p === 0x8b_82 ? true : 0, // LINK_STATUS else 0 uniforms/attrs
    getActiveUniform: () => ({ name: "", size: 0, type: 0 }),
    getActiveAttrib: () => ({ name: "", size: 0, type: 0 }),
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    checkFramebufferStatus: () => 0x8c_d5, // FRAMEBUFFER_COMPLETE
    texImage2D: noop, // frame is read via _neilGetVideoBuffer, not GL
    texSubImage2D: noop,
  };
  return new Proxy(obj, {
    get(target, prop) {
      if (typeof prop !== "string") return;
      if (prop in target) return target[prop];
      return noop;
    },
  });
}

let installed = false;
let fakeCanvas: Globals | undefined;

/** Install the headless browser environment (idempotent). */
export function installBrowserStubs(): void {
  if (installed) return;
  installed = true;

  // emscripten glue's NODE branch references these CommonJS globals.
  setGlobal("require", createRequire(import.meta.url));
  setGlobal("__filename", import.meta.path);
  setGlobal("__dirname", import.meta.dir);

  const glStub = makeGLStub();
  const el = (): Globals => ({
    style: {},
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    setAttribute: noop,
    getContext: () => glStub,
    click: noop,
    classList: { add: noop, remove: noop },
    value: "",
    innerHTML: "",
    textContent: "",
    width: 640,
    height: 480,
    clientWidth: 640,
    clientHeight: 480,
    getBoundingClientRect: rect,
  });
  fakeCanvas = {
    width: 640,
    height: 480,
    style: {},
    getContext: () => glStub,
    addEventListener: noop,
    removeEventListener: noop,
    getBoundingClientRect: rect,
  };

  setGlobal("screen", {
    width: 640,
    height: 480,
    availWidth: 640,
    availHeight: 480,
  });
  setGlobal("alert", noop);
  setGlobal("prompt", () => null);
  setGlobal("requestAnimationFrame", (cb: (t: number) => void) =>
    setTimeout(() => {
      cb(Date.now());
    }, 0),
  );
  setGlobal("cancelAnimationFrame", noop);
  setGlobal("localStorage", {
    getItem: () => null,
    setItem: noop,
    removeItem: noop,
  });
  setGlobal("addEventListener", noop);
  setGlobal("document", {
    getElementById: () => el(),
    createElement: (t: string) => (t === "canvas" ? fakeCanvas : el()),
    querySelector: () => el(),
    addEventListener: noop,
    body: el(),
    documentElement: el(),
  });
  setGlobal("navigator", {
    userAgent: "headless",
    platform: "MacIntel",
    language: "en",
    hardwareConcurrency: 4,
    getGamepads: () => [],
    vibrate: noop,
    maxTouchPoints: 0,
  });
  const audioContextStub = class {
    readonly destination = {};
    readonly sampleRate = 44_100;
    readonly currentTime = 0;
    createBuffer() {
      return { getChannelData: () => new Float32Array(0) };
    }
    createBufferSource() {
      return { connect: noop, start: noop, buffer: null };
    }
    createGain() {
      return { connect: noop, gain: {} };
    }
    resume = noop;
  };
  setGlobal("AudioContext", audioContextStub);
  setGlobal("webkitAudioContext", audioContextStub);
}

/** The fake canvas to hand to Module.canvas (after installBrowserStubs). */
export function getFakeCanvas(): unknown {
  return fakeCanvas;
}
