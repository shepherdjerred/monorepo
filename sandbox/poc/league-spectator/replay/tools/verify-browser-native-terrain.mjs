import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const [url, outputPath] = process.argv.slice(2);
assert.ok(
  url && outputPath,
  "Usage: bun verify-browser-native-terrain.mjs <loopback URL> <private output directory>",
);
assert.equal(new URL(url).hostname, "127.0.0.1");
const require = createRequire(
  new URL(
    "../../../../../packages/scout-for-lol/packages/app/package.json",
    import.meta.url,
  ),
);
const { chromium } = require("@playwright/test");
await mkdir(outputPath, { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
try {
  const profiles = [
    { name: "desktop", width: 960, height: 680, deviceScaleFactor: 1 },
    { name: "mobile", width: 390, height: 685, deviceScaleFactor: 2 },
  ];
  const summaries = [];
  for (const { name, deviceScaleFactor, ...viewport } of profiles) {
    const page = await browser.newPage({ viewport, deviceScaleFactor });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const state = (window.terrainCheck = {});
      const proto = WebGL2RenderingContext.prototype;
      const bufferData = proto.bufferData;
      const uniformMatrix4fv = proto.uniformMatrix4fv;
      const drawArrays = proto.drawArrays;
      const drawElements = proto.drawElements;
      proto.bufferData = function (target, data, usage) {
        if (usage === this.DYNAMIC_DRAW) state.markerVertices = [...data];
        return bufferData.apply(this, arguments);
      };
      proto.uniformMatrix4fv = function (location, transpose, data) {
        state.matrix = [...data];
        return uniformMatrix4fv.apply(this, arguments);
      };
      proto.drawElements = function (mode, count) {
        state.depth = {
          test: this.isEnabled(this.DEPTH_TEST),
          bits: this.getParameter(this.DEPTH_BITS),
          writes: this.getParameter(this.DEPTH_WRITEMASK),
        };
        if (state.ignoreDepth) this.disable(this.DEPTH_TEST);
        state.markerCount = 0;
        state.terrainIndices = count;
        drawElements.apply(this, arguments);
        // FNV-1a over the actual terrain framebuffer before diagnostic markers.
        const pixels = new Uint8Array(
          this.drawingBufferWidth * this.drawingBufferHeight * 4,
        );
        this.readPixels(
          0,
          0,
          this.drawingBufferWidth,
          this.drawingBufferHeight,
          this.RGBA,
          this.UNSIGNED_BYTE,
          pixels,
        );
        let hash = 2166136261;
        for (const value of pixels) hash = Math.imul(hash ^ value, 16777619);
        state.terrainHash = hash >>> 0;
      };
      proto.drawArrays = function (mode, start, count) {
        drawArrays.apply(this, arguments);
        if (mode !== this.POINTS) return;
        state.markerCount = count;
        const { matrix, markerVertices } = state;
        state.markerPixels = [];
        state.clippedMarkers = 0;
        const multiply = (row, x, y, z) =>
          matrix[row] * x +
          matrix[row + 4] * y +
          matrix[row + 8] * z +
          matrix[row + 12];
        for (let offset = 0; offset < markerVertices.length; offset += 4) {
          const [x, y, z] = markerVertices.slice(offset, offset + 3);
          const w = multiply(3, x, y, z);
          if (
            w <= 0 ||
            [0, 1, 2].some((axis) => Math.abs(multiply(axis, x, y, z)) > w)
          )
            state.clippedMarkers++;
          const pixel = new Uint8Array(4);
          this.readPixels(
            Math.floor(
              ((multiply(0, x, y, z) / w + 1) * this.drawingBufferWidth) / 2,
            ),
            Math.floor(
              ((multiply(1, x, y, z) / w + 1) * this.drawingBufferHeight) / 2,
            ),
            1,
            1,
            this.RGBA,
            this.UNSIGNED_BYTE,
            pixel,
          );
          state.markerPixels.push([...pixel]);
        }
        state.glError = this.getError();
      };
    });
    await page.goto(url);
    const time = page.locator("#time");
    const angle = page.locator("#angle");
    await time.locator("option").first().waitFor({ state: "attached" });
    const scene = await page.evaluate(async () =>
      (await fetch("/scene.json")).json(),
    );
    const state = () => page.evaluate(() => window.terrainCheck);
    const recorded = scene.frames.filter(({ markers }) => markers.length);
    assert.ok(recorded.length >= 2);
    let validatedMarkers = 0;
    let paintedCenters = 0;
    for (const { timeSeconds, markers } of recorded) {
      await time.selectOption(String(timeSeconds));
      const check = await state();
      assert.equal(check.markerCount, markers.length);
      assert.equal(check.clippedMarkers, 0);
      assert.equal(check.glError, 0);
      const expected = markers.flatMap(({ position, teamId }) => [
        ...position,
        teamId,
      ]);
      assert.deepEqual(check.markerVertices, [...Float32Array.from(expected)]);
      assert.ok(
        check.markerPixels.some(
          ([r, g, b]) =>
            (r === 79 && g === 209 && b === 255) ||
            (r === 255 && g === 145 && b === 61),
        ),
      );
      paintedCenters += check.markerPixels.filter(
        ([r, g, b]) =>
          (r === 79 && g === 209 && b === 255) ||
          (r === 255 && g === 145 && b === 61),
      ).length;
      validatedMarkers += markers.length;
    }
    await time.selectOption(String(recorded.at(-1).timeSeconds));
    const oblique = await state();
    assert.equal(oblique.terrainIndices, scene.staticMesh.meshTriangles * 3);
    assert.equal(oblique.depth.test && oblique.depth.writes, true);
    assert.ok(oblique.depth.bits >= 16);
    await page.screenshot({ path: join(outputPath, `${name}-oblique.png`) });
    await angle.fill("88");
    const overhead = await state();
    assert.notDeepEqual(overhead.matrix, oblique.matrix);
    assert.notEqual(overhead.terrainHash, oblique.terrainHash);
    assert.ok(
      overhead.matrix
        .slice(0, 3)
        .some((value, index) => value !== oblique.matrix[index]),
    );
    assert.ok(oblique.matrix[7] !== 0 && oblique.matrix[11] !== 0);
    await page.screenshot({ path: join(outputPath, `${name}-overhead.png`) });
    await angle.fill("53");
    const gap = (recorded[0].timeSeconds + recorded[1].timeSeconds) / 2;
    await time.selectOption(String(gap));
    const empty = await state();
    assert.equal(empty.markerCount, 0);
    assert.equal(empty.terrainHash, oblique.terrainHash);
    await page.screenshot({ path: join(outputPath, `${name}-gap.png`) });
    await page.evaluate(() => {
      window.terrainCheck.ignoreDepth = true;
      document.querySelector("#angle").dispatchEvent(new Event("input"));
    });
    const flatOrder = await state();
    assert.notEqual(flatOrder.terrainHash, empty.terrainHash);
    assert.deepEqual(errors, []);
    summaries.push({
      name,
      validatedMarkers,
      paintedCenters,
      frames: recorded.length,
      depthBits: oblique.depth.bits,
      triangles: oblique.terrainIndices / 3,
      framebufferHashes: {
        oblique: oblique.terrainHash,
        overhead: overhead.terrainHash,
        obliqueDepthDisabled: flatOrder.terrainHash,
      },
      gap,
      markersInGap: empty.markerCount,
    });
    await page.close();
  }
  await writeFile(
    join(outputPath, "verification.json"),
    JSON.stringify(summaries, null, 2),
  );
  console.log(JSON.stringify(summaries, null, 2));
} finally {
  await browser.close();
}
