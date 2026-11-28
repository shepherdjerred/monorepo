// Pixel diagnostic for the exact .8428 quad DXBC translation, using synthetic inputs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { encodeParticleQuadRecord } from "./native-terrain-particle-quad-record.mjs";

const [vertexPath, pixelPath, ...extra] = process.argv.slice(2);
assert.ok(
  vertexPath && pixelPath && extra.length === 0,
  "Usage: bun verify-native-terrain-particle-quad-record.mjs <translated vertex.json> <translated pixel.json>",
);
const [vertex, fragment] = await Promise.all(
  [
    [
      vertexPath,
      "6809fb4a64b928575ded4a01dbdcb50b66a78b01baf79dde46206bfb8964a462",
    ],
    [
      pixelPath,
      "f603c39a5d8edb7c6d47b073e6a79cf3a6fc77f3228a7f27595070df6439b8f5",
    ],
  ].map(async ([path, digest]) => {
    const bytes = await readFile(path);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      digest,
      "Translated shader digest differs",
    );
    return JSON.parse(bytes);
  }),
);
const encoded = Array.from(
  encodeParticleQuadRecord({
    xAxis: [0.75, 0, 0],
    yAxis: [0.125, 0.5, 0],
    zAxis: [0, 0, 1],
    position: [0.125, 0, 0],
    baseUv: [1, 0, 0, 0, 1, 0],
    lookupUv: [0, 0, 0.5, 0, 0, 0.5],
    color: [0.875, 0.75, 0.625, 0.875],
    frame: 1,
  }),
);
const { chromium } = await import(
  Bun.resolveSync(
    "@playwright/test",
    fileURLToPath(
      new URL(
        "../../../../../../packages/scout-for-lol/packages/app/",
        import.meta.url,
      ),
    ),
  )
);
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage();
  const report = await page.evaluate(
    ({ vertex, fragment, encoded }) => {
      const extent = 64;
      const gl = new OffscreenCanvas(extent, extent).getContext("webgl2", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: false,
      });
      if (!gl) throw Error("WebGL2 unavailable");
      const program = gl.createProgram();
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertex.glsl],
        [gl.FRAGMENT_SHADER, fragment.glsl],
      ]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const texture = (name, unit, width, height, integer, pixels) => {
        const location = gl.getUniformLocation(program, name);
        if (location === null) throw Error("Missing sampler " + name);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          integer ? gl.R32UI : gl.RGBA8,
          width,
          height,
          0,
          integer ? gl.RED_INTEGER : gl.RGBA,
          integer ? gl.UNSIGNED_INT : gl.UNSIGNED_BYTE,
          pixels,
        );
        gl.uniform1i(location, unit);
      };
      const block = (name, index, size, fields) => {
        const location = gl.getUniformBlockIndex(program, name);
        if (location === gl.INVALID_INDEX) throw Error("Missing block " + name);
        const data = new ArrayBuffer(size),
          view = new Float32Array(data);
        for (const [offset, values] of fields) view.set(values, offset / 4);
        const handle = gl.createBuffer();
        gl.bindBuffer(gl.UNIFORM_BUFFER, handle);
        gl.bufferData(gl.UNIFORM_BUFFER, data, gl.DYNAMIC_DRAW);
        gl.uniformBlockBinding(program, location, index);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, index, handle);
        return handle;
      };
      block("Globals_vs", 0, 32, [
        [0, [2, 0.5, 1, 0]],
        [16, [0]],
      ]);
      block("PerFrameVertexCB_vs", 1, 592, [
        [0, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0.5, 0, 0, 0, 1]],
        [64, [0, 0, 3]],
        [560, [0, 0, -1]],
        [576, [0, 1, 0]],
      ]);
      const dynamic = block("VFXDynamicPerParticleInstanceCBVS_vs", 2, 64, []);
      const alpha = block("Globals_ps", 3, 16, [[0, [0.45]]]);
      block("PerFramePixelCB_ps", 4, 528, []);
      texture(
        "ParticleQuadInstanceInfo_SharedDataBuffer",
        0,
        40,
        1,
        true,
        Uint32Array.from(encoded),
      );
      texture(
        "TEXTURE_TX",
        1,
        4,
        1,
        false,
        new Uint8Array([
          0, 0, 0, 0, 0, 0, 0, 0, 155, 222, 83, 32, 172, 91, 232, 255,
        ]),
      );
      texture(
        "PARTICLE_COLOR_TEXTURE_TX",
        2,
        1,
        1,
        false,
        new Uint8Array([219, 200, 234, 255]),
      );
      texture(
        "PIXEL_COLOR_REMAP_RAMP_SharedTexture",
        3,
        1,
        1,
        false,
        new Uint8Array([120, 140, 100, 0]),
      );
      gl.bindVertexArray(gl.createVertexArray());
      const vertices = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
      let offset = 0;
      for (const [location, size] of [3, 4, 3, 2].entries()) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 48, offset * 4);
        offset += size;
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new Uint16Array([0, 1, 2, 0, 2, 3]),
        gl.STATIC_DRAW,
      );
      gl.viewport(0, 0, extent, extent);
      const draw = (instanced, threshold, drawEnabled = true) => {
        gl.bindBuffer(gl.UNIFORM_BUFFER, dynamic);
        gl.bufferSubData(
          gl.UNIFORM_BUFFER,
          44,
          new Uint32Array([instanced ? 1 : 0]),
        );
        gl.bindBuffer(gl.UNIFORM_BUFFER, alpha);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Float32Array([threshold]));
        gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
        const quad = [
          [-1, -1, 0, 0],
          [1, -1, 1, 0],
          [1, 1, 1, 1],
          [-1, 1, 0, 1],
        ].flatMap(([x, y, u, v]) => [
          ...(instanced
            ? [x, y, 0]
            : [x * 0.75 + y * 0.125 + 0.125, y * 0.5, 0]),
          0.625,
          0.75,
          0.875,
          0.875,
          u,
          v,
          1,
          0.5,
          0.5,
        ]);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(quad), gl.DYNAMIC_DRAW);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (drawEnabled) {
          if (instanced)
            gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, 1);
          else gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        }
        const pixels = new Uint8Array(extent * extent * 4);
        gl.readPixels(0, 0, extent, extent, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      const metrics = (pixels) => {
        let nonzero = 0,
          alphaMin = 255,
          alphaMax = 0;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] === 0) continue;
          nonzero++;
          alphaMin = Math.min(alphaMin, pixels[i]);
          alphaMax = Math.max(alphaMax, pixels[i]);
        }
        return { nonzero, alphaMin: nonzero ? alphaMin : 0, alphaMax };
      };
      const indexed = draw(false, 0.45);
      const instanced = draw(true, 0.45);
      return {
        scope: "Synthetic quad and textures for exact .8428 shader diagnostic",
        renderer: gl.getParameter(gl.VERSION),
        indexed: metrics(indexed),
        instanced: metrics(instanced),
        alphaThresholdZero: metrics(draw(false, 0)),
        noDraw: metrics(draw(false, 0.45, false)),
        alphaThresholdHigh: metrics(draw(false, 0.96)),
        alphaThresholdHighInstanced: metrics(draw(true, 0.96)),
        differingBytes: indexed.reduce(
          (total, value, index) => total + (value !== instanced[index]),
          0,
        ),
        glError: gl.getError(),
      };
    },
    { vertex, fragment, encoded },
  );
  assert.equal(report.glError, 0);
  assert.equal(report.noDraw.nonzero, 0);
  assert.equal(report.differingBytes, 0);
  assert.ok(report.indexed.nonzero > 0);
  assert.ok(report.alphaThresholdZero.nonzero > report.indexed.nonzero);
  assert.equal(report.alphaThresholdHigh.nonzero, 0);
  assert.equal(report.alphaThresholdHighInstanced.nonzero, 0);
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
