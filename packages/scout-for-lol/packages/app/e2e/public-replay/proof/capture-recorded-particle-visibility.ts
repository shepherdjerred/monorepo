import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { PublicReplayDescriptorSchema } from "@scout-for-lol/domain/artifacts/public-replay.ts";
import { seek } from "#replay-e2e/recorded-replay-fixture.ts";
import { comparePixels } from "./compare-recorded-pixels.ts";

type Geometry =
  "world-ribbon" | "billboard" | "depth-test-off" | "masked-ground";
type RecordedSubmission = {
  selected: boolean;
  mode: number;
  indexCount: number;
  indexType: number;
  depthTest: boolean;
  offset: number;
  vertexBytes: number;
  indexBytes: number;
  vertexHash: number;
  indexHash: number;
  vertexHex?: string;
  indexHex?: string;
};
type RecordedFrame = {
  generation: number;
  suppressed: boolean;
  draws: RecordedSubmission[];
};

declare global {
  var recordedParticleVisibility: {
    suppress: boolean;
    frame: RecordedFrame;
  };
}

async function installAttributionProbe(page: Page, geometry: Geometry) {
  await page.addInitScript((targetGeometry) => {
    const prototype = WebGL2RenderingContext.prototype;
    // All calls below apply the original method to its receiving context.
    const originalMethod = <Key extends keyof WebGL2RenderingContext>(
      key: Key,
    ): WebGL2RenderingContext[Key] => Reflect.get(prototype, key);
    const bufferData = originalMethod("bufferData");
    const clear = originalMethod("clear");
    const drawElements = originalMethod("drawElements");
    const getUniformBlockIndex = originalMethod("getUniformBlockIndex");
    const getUniformLocation = originalMethod("getUniformLocation");
    const useProgram = originalMethod("useProgram");
    const programs = new WeakSet<WebGLProgram>();
    const maskedGroundPrograms = new WeakSet<WebGLProgram>();
    let uploads = new Map<number, { bytes: Uint8Array; hash: number }>();
    let particleProgramActive = false;
    let maskedGroundActive = false;
    globalThis.recordedParticleVisibility = {
      suppress: false,
      frame: { generation: 0, suppressed: false, draws: [] },
    };

    prototype.getUniformBlockIndex = function (program, name) {
      const index = getUniformBlockIndex.call(this, program, name);
      if (
        name === "VFXDynamicPerParticleInstanceCBVS_vs" &&
        index !== this.INVALID_INDEX
      )
        programs.add(program);
      return index;
    };
    prototype.getUniformLocation = function (program, name) {
      const location = getUniformLocation.call(this, program, name);
      if (location !== null && name === "NAVMESH_MASK_TEXTURE_SharedTexture")
        maskedGroundPrograms.add(program);
      return location;
    };
    prototype.useProgram = function (program) {
      particleProgramActive = program !== null && programs.has(program);
      maskedGroundActive =
        program !== null && maskedGroundPrograms.has(program);
      uploads = new Map();
      useProgram.call(this, program);
    };
    prototype.bufferData = new Proxy(bufferData, {
      apply(original, context: WebGL2RenderingContext, args: unknown[]) {
        const [target, data] = args;
        if (
          (particleProgramActive || maskedGroundActive) &&
          (target === context.ARRAY_BUFFER ||
            target === context.ELEMENT_ARRAY_BUFFER) &&
          args.length === 3 &&
          ArrayBuffer.isView(data)
        ) {
          const bytes = new Uint8Array(
            data.buffer,
            data.byteOffset,
            data.byteLength,
          );
          let hash = 0x81_1c_9d_c5;
          for (const byte of bytes)
            hash = Math.imul(hash ^ byte, 0x01_00_01_93) >>> 0;
          uploads.set(target, { bytes: bytes.slice(), hash });
        }
        Reflect.apply(original, context, args);
      },
    });
    prototype.clear = function (mask) {
      if (
        (mask & this.DEPTH_BUFFER_BIT) !== 0 &&
        this.canvas instanceof HTMLCanvasElement &&
        this.canvas.getAttribute("aria-label") ===
          "League of Legends replay scene"
      ) {
        const proof = globalThis.recordedParticleVisibility;
        proof.frame = {
          generation: proof.frame.generation + 1,
          suppressed: proof.suppress,
          draws: [],
        };
      }
      clear.call(this, mask);
    };
    function matchesGeometry(
      indexCount: number,
      depthTest: boolean,
      worldRibbon: boolean,
    ) {
      if (maskedGroundActive)
        return (
          targetGeometry === "masked-ground" &&
          indexCount === 12 &&
          !depthTest &&
          !worldRibbon
        );
      if (targetGeometry === "world-ribbon") return worldRibbon;
      if (worldRibbon || indexCount !== 6) return false;
      return targetGeometry === "billboard"
        ? depthTest
        : targetGeometry === "depth-test-off" && !depthTest;
    }
    prototype.drawElements = function (mode, indexCount, indexType, offset) {
      if (particleProgramActive || maskedGroundActive) {
        const worldRibbon = this.isEnabled(this.POLYGON_OFFSET_FILL);
        const depthTest = this.isEnabled(this.DEPTH_TEST);
        const selected =
          mode === this.TRIANGLES &&
          indexType === this.UNSIGNED_SHORT &&
          matchesGeometry(indexCount, depthTest, worldRibbon);
        const vertices = uploads.get(this.ARRAY_BUFFER);
        const indices = uploads.get(this.ELEMENT_ARRAY_BUFFER);
        const hex = (data: Uint8Array) =>
          Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join(
            "",
          );
        const { frame } = globalThis.recordedParticleVisibility;
        frame.draws.push({
          selected,
          mode,
          indexCount,
          indexType,
          depthTest,
          offset,
          vertexBytes: vertices?.bytes.byteLength ?? 0,
          indexBytes: indices?.bytes.byteLength ?? 0,
          vertexHash: vertices?.hash ?? 0,
          indexHash: indices?.hash ?? 0,
          ...(selected && vertices !== undefined && indices !== undefined
            ? { vertexHex: hex(vertices.bytes), indexHex: hex(indices.bytes) }
            : {}),
        });
        if (selected && frame.suppressed) return;
      }
      drawElements.call(this, mode, indexCount, indexType, offset);
    };
  }, geometry);
}

// Use a clock with one active effect family when multiple families share the
// same draw class. The report includes every intercepted particle submission.
const [previewArgument, output, secondsArgument, follow, geometry] =
  Bun.argv.slice(2);
assert.ok(
  previewArgument !== undefined &&
    output !== undefined &&
    secondsArgument !== undefined &&
    follow !== undefined &&
    (geometry === "world-ribbon" ||
      geometry === "billboard" ||
      geometry === "depth-test-off" ||
      geometry === "masked-ground"),
  "Usage: bun capture-recorded-particle-visibility.ts <loopback replay URL> <new evidence directory> <seconds> <follow ID> <world-ribbon|billboard|depth-test-off|masked-ground>",
);
const preview = new URL(previewArgument);
assert.equal(preview.protocol, "http:");
assert.equal(preview.hostname, "127.0.0.1");
assert.notEqual(preview.port, "");
assert.equal(preview.username + preview.password, "");
const replayId = /^\/app\/replays\/([\da-f-]+)$/.exec(preview.pathname)?.[1];
assert.ok(replayId !== undefined);
assert.match(follow, /^\d+$/u);
assert.match(secondsArgument, /^\d+(?:\.\d)?$/u);
const seconds = Number(secondsArgument);
const resetSeconds = Number(
  (seconds >= 1 ? seconds - 1 : seconds + 1).toFixed(1),
);
preview.search = new URLSearchParams({ t: String(seconds), follow }).toString();
await mkdir(output);

const graphics = Bun.env["SCOUT_REPLAY_E2E_PERF_GRAPHICS"] ?? "swiftshader";
assert.ok(graphics === "edge" || graphics === "swiftshader");
const browser = await chromium.launch({
  ...(graphics === "edge" ? { channel: "msedge" } : {}),
  headless: true,
  args:
    graphics === "edge"
      ? ["--enable-gpu"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 930 },
    serviceWorkers: "block",
  });
  const errors: string[] = [];
  const credentialed = new Set<string>();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== preview.origin) return route.abort();
    const headers = await request.allHeaders();
    if ("cookie" in headers || "authorization" in headers)
      credentialed.add(url.pathname);
    return route.continue();
  });
  await installAttributionProbe(page, geometry);
  const descriptorRequest = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/replays/${replayId}`,
    { timeout: 90_000 },
  );
  const response = await page.goto(preview.href);
  assert.equal(response?.status(), 200);
  const descriptorResponse = await descriptorRequest;
  const descriptor = PublicReplayDescriptorSchema.parse(
    await descriptorResponse.json(),
  );
  assert.equal(descriptor.playback.status, "available");
  assert.ok(seconds <= (descriptor.durationSeconds ?? 0));
  assert.ok(resetSeconds <= (descriptor.durationSeconds ?? 0));
  const play = page.getByRole("button", { name: "Play", exact: true });
  await expect(play).toBeEnabled({ timeout: 90_000 });
  const camera = page.getByRole("combobox", { name: "Camera" });
  const canvas = page.getByLabel("League of Legends replay scene");
  const readFrame = () =>
    page.evaluate(() => globalThis.recordedParticleVisibility.frame);
  const waitForFrame = async (after: number, suppressed: boolean) => {
    await expect
      .poll(async () => {
        const frame = await readFrame();
        return frame.generation > after && frame.suppressed === suppressed;
      })
      .toBe(true);
    return readFrame();
  };
  const frames = [];
  for (const [name, suppress] of [
    ["enabled", false],
    ["suppressed", true],
    ["suppressed-repeat", true],
    ["restored", false],
  ] as const) {
    const initialFrame = await readFrame();
    await page.evaluate((shouldSuppress) => {
      globalThis.recordedParticleVisibility.suppress = shouldSuppress;
    }, suppress);
    await seek(page, resetSeconds);
    const resetFrame = await waitForFrame(initialFrame.generation, suppress);
    await seek(page, seconds);
    await expect(camera).toHaveValue(`player:${follow}`);
    await expect(play).toBeEnabled();
    const beforeScreenshot = await waitForFrame(
      resetFrame.generation,
      suppress,
    );
    const image = await canvas.screenshot({
      path: path.join(output, `${name}.png`),
    });
    const afterScreenshot = await readFrame();
    assert.equal(afterScreenshot.suppressed, suppress);
    assert.ok(afterScreenshot.generation >= beforeScreenshot.generation);
    // A paused redraw may advance the generation while taking the screenshot.
    // Only accept that interval if both render receipts identify the same draws.
    assert.deepEqual(afterScreenshot.draws, beforeScreenshot.draws);
    frames.push({
      name,
      image,
      draws: beforeScreenshot.draws,
      suppressed: suppress,
      resetGeneration: resetFrame.generation,
      firstScreenshotGeneration: beforeScreenshot.generation,
      lastScreenshotGeneration: afterScreenshot.generation,
    });
  }
  const { metrics, mask } = await comparePixels(
    page,
    frames.map(({ image }) => image),
  );
  if (mask === undefined)
    throw new Error("The attribution mask was not encoded.");
  await writeFile(
    path.join(output, "causal-pixel-mask.png"),
    Buffer.from(mask, "base64"),
  );
  await writeFile(
    path.join(output, "attribution.json"),
    JSON.stringify(
      {
        replaySha256: descriptor.sha256,
        packageSha256: descriptor.playback.package.sha256,
        seconds,
        follow,
        geometry,
        graphics,
        metrics,
        errors,
        credentialed: [...credentialed],
        submissions: frames.map(({ image: _image, ...receipt }) => receipt),
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual([...credentialed], []);
  const draws = frames[0]?.draws ?? [];
  const selected = draws.filter((draw) => draw.selected);
  assert.ok(
    selected.length > 0,
    "No selected particle submissions were observed.",
  );
  for (const draw of selected) {
    assert.notEqual(draw.vertexHex, undefined);
    assert.notEqual(draw.indexHex, undefined);
    assert.equal(draw.indexBytes, draw.indexCount * 2);
  }
  for (const frame of frames) assert.deepEqual(frame.draws, draws);
  assert.ok(
    metrics.causal > 0,
    "Selected submissions did not produce stable visible pixels.",
  );
  process.stdout.write(JSON.stringify(metrics, null, 2) + "\n");
} finally {
  await browser.close();
}
