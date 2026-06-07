// Headless N64Wasm in Bun: run the angrylion SOFTWARE renderer (no GPU), and
// capture the frame by intercepting the glTexImage2D upload of get_video_buffer()
// (mymain.cpp:1689, 640 x angryVerticalResolution, RGBA). No browser, no GPU.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// emscripten glue's NODE branch references these CommonJS globals; provide them
// for the (0,eval) of the web-built glue running under Bun.
globalThis.require = createRequire(import.meta.url);
globalThis.__filename = fileURLToPath(import.meta.url);
globalThis.__dirname = fileURLToPath(new URL("./dist", import.meta.url));

const DIST = new URL("./dist/", import.meta.url);
const ROM = process.argv[2] ?? "../roms/mk64.z64";
const FRAMES = Number(process.argv[3] ?? 600);
const OUT = process.argv[4] ?? "../out/n64wasm_frame.ppm";

// ---- capture state -----------------------------------------------------------
let lastFrame = null; // {w,h,rgba}
let texCalls = 0;
function captureTex(args) {
  // texImage2D(target, level, internalformat, width, height, border, format, type, pixels)
  const w = args[3], h = args[4], pixels = args[8];
  texCalls++;
  if (w === 640 && pixels && pixels.length >= w * h * 4) {
    lastFrame = { w, h, rgba: Uint8Array.from(pixels.subarray(0, w * h * 4)) };
  }
}

// ---- a permissive WebGL stub (no real GL; just enough for emscripten + the
//      simple textured-quad display path, capturing texture uploads) ----------
function makeGLStub() {
  const obj = {
    getError: () => 0,
    getParameter: (p) => {
      switch (p) {
        case 0x1f00: return "stub-vendor";              // VENDOR
        case 0x1f01: return "stub-renderer";            // RENDERER
        case 0x1f02: return "OpenGL ES 3.0 (WebGL stub)"; // VERSION
        case 0x8b8c: return "OpenGL ES GLSL ES 3.00";   // SHADING_LANGUAGE_VERSION
        default: return 16384;
      }
    },
    getExtension: () => null,
    getSupportedExtensions: () => [],
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    createTexture: () => ({}), createFramebuffer: () => ({}), createRenderbuffer: () => ({}),
    createVertexArray: () => ({}),
    getShaderParameter: (s, p) => (p === 0x8b81 ? true : 0),  // COMPILE_STATUS
    getProgramParameter: (pr, p) => {
      if (p === 0x8b82) return true; // LINK_STATUS
      return 0;                      // ACTIVE_UNIFORMS / ACTIVE_ATTRIBUTES / etc -> 0
    },
    getActiveUniform: () => ({ name: "", size: 0, type: 0 }),
    getActiveAttrib: () => ({ name: "", size: 0, type: 0 }),
    getShaderInfoLog: () => "", getProgramInfoLog: () => "",
    checkFramebufferStatus: () => 0x8cd5, // FRAMEBUFFER_COMPLETE
    getUniformLocation: () => ({}), getAttribLocation: () => 0,
    texImage2D: (...a) => captureTex(a),
    texSubImage2D: (...a) => captureTex(a),
  };
  return new Proxy(obj, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === "string") return () => {};
      return undefined;
    },
  });
}

// ---- minimal browser environment --------------------------------------------
const glStub = makeGLStub();
const fakeCanvas = {
  width: 640, height: 480, style: {},
  getContext: () => glStub,
  addEventListener() {}, removeEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
};
const el = () => ({
  style: {}, addEventListener() {}, removeEventListener() {}, appendChild() {},
  setAttribute() {}, getContext: () => glStub, click() {}, classList: { add() {}, remove() {} },
  value: "", innerHTML: "", textContent: "",
  width: 640, height: 480, clientWidth: 640, clientHeight: 480,
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 480, width: 640, height: 480 }),
});
// NOTE: deliberately do NOT define `window` -> emscripten runs as ENVIRONMENT_IS_NODE
// only (avoids the dual WEB+NODE FS/syscall confusion that null-trapped fseek).
globalThis.screen = { width: 640, height: 480, availWidth: 640, availHeight: 480 };
globalThis.alert = () => {};
globalThis.prompt = () => null;
globalThis.location = { href: "file:///", search: "", pathname: "/" };
// navigator is read-only on Node; define it portably.
Object.defineProperty(globalThis, "navigator", {
  configurable: true, writable: true,
  value: {
    userAgent: "headless", platform: "MacIntel", language: "en", hardwareConcurrency: 4,
    getGamepads: () => [], vibrate: () => {}, maxTouchPoints: 0,
  },
});
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.addEventListener = () => {};
globalThis.document = {
  getElementById: () => el(),
  createElement: (t) => (t === "canvas" ? fakeCanvas : el()),
  querySelector: () => el(),
  addEventListener() {}, body: el(), documentElement: el(),
};
class AC { constructor() { this.destination = {}; this.sampleRate = 44100; } createBuffer() { return { getChannelData: () => new Float32Array(0) }; } createBufferSource() { return { connect() {}, start() {}, buffer: null }; } get currentTime() { return 0; } resume() {} createGain() { return { connect() {}, gain: {} }; } }
globalThis.AudioContext = AC;
globalThis.webkitAudioContext = AC;

// ---- configure + load the emscripten module ---------------------------------
const wasmBinary = readFileSync(new URL("n64wasm.wasm", DIST));
const romBytes = new Uint8Array(readFileSync(ROM));

// angrylion software-renderer config.txt: the flags are read line-by-line by the
// core; forceAngry is near the end. We write a config with angrylion enabled.
// (Order mirrors script.js writeConfig: many flags; we set a safe-ish minimal set
// and rely on the core's defaults. forceAngry must be "1".)

let runtimeReady;
const ready = new Promise((r) => (runtimeReady = r));

globalThis.Module = {
  wasmBinary,
  canvas: fakeCanvas,
  noInitialRun: true,
  print: (s) => console.log("[wasm]", s),
  printErr: (s) => console.error("[wasm:err]", s),
  onRuntimeInitialized: () => runtimeReady(),
  locateFile: (p) => new URL(p, DIST).pathname,
};

// Positional config.txt (see script.js writeConfig): 15 gamepad + 19 keyboard
// mappings (0 = unmapped), 3 save flags, then feature flags. forceAngry=1 selects
// the angrylion SOFTWARE renderer; disableAudioSync=1 lets us step frames freely.
function buildConfig() {
  const lines = [];
  for (let i = 0; i < 15 + 19; i++) lines.push("0"); // input mappings (unmapped)
  lines.push("0", "0", "0"); // eep / sra / fla present
  lines.push("0"); // showFPS
  lines.push("0"); // swapSticks
  lines.push("0"); // disableAudioSync=0 -> main() returns after init and we drive
                   // _runMainLoop ourselves (the manual stepper script.js uses).
  lines.push("0", "0", "0"); // invert 2P/3P/4P
  lines.push("0"); // mobile mode
  lines.push("1"); // *** angrylion software renderer ***
  lines.push("0"); // mouse mode
  lines.push("0"); // use vbo
  lines.push("0"); // rice plugin
  return lines.join("\r\n") + "\r\n";
}

console.log("[run] loading n64wasm.js …");
const glue = readFileSync(new URL("n64wasm.js", DIST), "utf8");
(0, eval)(glue); // emscripten glue picks up globalThis.Module

await ready;
const M = globalThis.Module;
const FS = globalThis.FS;
console.log("[run] runtime initialized. FS:", !!FS, "runMainLoop:", typeof M._runMainLoop);
FS.writeFile("config.txt", buildConfig());
// The app's loadFile() (no null check) reads these from FS during init; in the
// browser they're served, headless they must be in MEMFS or fopen->NULL->fseek
// traps. Provide the real shaders (+ overlay/font best-effort).
const CODE = new URL("./code/", import.meta.url);
for (const f of ["shader_vert.hlsl", "shader_frag.hlsl"]) FS.writeFile(f, readFileSync(new URL(f, CODE)));
try { FS.mkdir("res"); } catch {}
for (const [src, dst] of [["overlay.png", "overlay.png"], ["res/arial.ttf", "res/arial.ttf"]]) {
  try { FS.writeFile(dst, readFileSync(new URL(src, CODE))); } catch {}
}
console.log("[run] staged shaders + assets into FS");
// Inject the ROM straight into wasm memory and register it (bypasses the
// fopen/fseek path that traps under Node's emscripten musl stdio).
const romPtr = M._malloc(romBytes.length);
M.HEAPU8.set(romBytes, romPtr);
M._neilSetRom(romPtr, romBytes.length);
console.log("[run] injected ROM:", romBytes.length, "bytes @", romPtr, "+ wrote config (angrylion)");
M.callMain(["custom.v64"]);
// Read the angrylion software-rendered frame out of wasm memory -> PPM.
function dumpFrame(path) {
  const vbuf = M._neilGetVideoBuffer();
  const h = M._neilGetVideoHeight();
  const w = 640;
  if (!vbuf || !h) return false;
  const rgba = M.HEAPU8.subarray(vbuf, vbuf + w * h * 4);
  const header = `P6\n${w} ${h}\n255\n`;
  const body = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++) { body[j++] = rgba[i * 4]; body[j++] = rgba[i * 4 + 1]; body[j++] = rgba[i * 4 + 2]; }
  writeFileSync(path, Buffer.concat([Buffer.from(header), body]));
  return true;
}

console.log("[run] callMain done, stepping frames…");
const DUMP_EVERY = Number(process.env.DUMP_EVERY ?? 0);
const t0 = Date.now();
for (let i = 0; i < FRAMES; i++) {
  M._runMainLoop();
  if (DUMP_EVERY && i > 0 && i % DUMP_EVERY === 0) {
    dumpFrame(OUT.replace(/\.ppm$/, `_${String(i).padStart(5, "0")}.ppm`));
    console.log(`[run] frame ${i}  ${((Date.now() - t0) / i).toFixed(1)} ms/frame avg`);
  }
}
const ms = (Date.now() - t0) / FRAMES;
dumpFrame(OUT);
console.log(`[run] ${FRAMES} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s = ${ms.toFixed(2)} ms/frame (${(1000 / ms).toFixed(1)} fps) | wrote ${OUT}`);
