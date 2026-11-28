import type { Page } from "@playwright/test";

type RecordedDraw = {
  textures: number;
  texturedIndices: number;
  terrainDrawOffsets: number[];
  terrainBlendDraws: {
    indexCount: number;
    depthWrites: boolean;
    factors: number[];
  }[];
  firstActorState?: { blend: boolean; depthWrites: boolean };
  actorOrigins: number[][];
  actorIndexCounts: number[];
  animationPaletteDraws: { indexCount: number; hash: number }[];
  recordedParticleDraws: number;
  recordedDepthDisabledParticleDraws: number;
  viewProjection: number[];
};

declare global {
  var recordedReplayDraw: RecordedDraw;
}

export async function installRecordedDrawProbe(page: Page) {
  await page.addInitScript(() => {
    const draw: RecordedDraw = {
      textures: 0,
      texturedIndices: 0,
      terrainDrawOffsets: [],
      terrainBlendDraws: [],
      actorOrigins: [],
      actorIndexCounts: [],
      animationPaletteDraws: [],
      recordedParticleDraws: 0,
      recordedDepthDisabledParticleDraws: 0,
      viewProjection: [],
    };
    globalThis.recordedReplayDraw = draw;
    const gl = WebGL2RenderingContext.prototype;
    // Each wrapper applies its original method to the receiving context.
    const originalMethod = <Key extends keyof WebGL2RenderingContext>(
      key: Key,
    ) => Reflect.get(gl, key);
    const getUniformLocation = originalMethod("getUniformLocation");
    const getUniformBlockIndex = originalMethod("getUniformBlockIndex");
    const uniform1i = originalMethod("uniform1i");
    const uniform3fv = originalMethod("uniform3fv");
    const uniformMatrix4fv = originalMethod("uniformMatrix4fv");
    const useProgram = originalMethod("useProgram");
    const clear = originalMethod("clear");
    const drawElements = originalMethod("drawElements");
    const texture = originalMethod("texImage2D");
    const updateTexture = originalMethod("texSubImage2D");
    const terrainUniforms = new WeakSet<WebGLUniformLocation>();
    const terrainPrograms = new WeakSet<WebGLProgram>();
    const particlePrograms = new WeakSet<WebGLProgram>();
    const actorUniforms = new WeakSet<WebGLUniformLocation>();
    const viewUniforms = new WeakSet<WebGLUniformLocation>();
    let terrainActive = false;
    let particlesActive = false;
    let textured = false;
    let pendingActor: number[] | undefined;
    let paletteHash: number | undefined;

    gl.getUniformLocation = function (program, name) {
      const location = getUniformLocation.call(this, program, name);
      if (location !== null && name === "textured") {
        terrainUniforms.add(location);
        terrainPrograms.add(program);
      }
      if (location !== null && name === "actorOrigin")
        actorUniforms.add(location);
      if (location !== null && name === "viewProjection")
        viewUniforms.add(location);
      return location;
    };
    gl.getUniformBlockIndex = function (program, name) {
      const index = getUniformBlockIndex.call(this, program, name);
      if (
        name === "VFXDynamicPerParticleInstanceCBVS_vs" &&
        index !== this.INVALID_INDEX
      )
        particlePrograms.add(program);
      return index;
    };
    gl.useProgram = function (program) {
      terrainActive = program !== null && terrainPrograms.has(program);
      particlesActive = program !== null && particlePrograms.has(program);
      pendingActor = undefined;
      paletteHash = undefined;
      useProgram.call(this, program);
    };
    gl.uniform1i = function (location, value) {
      if (location !== null && terrainUniforms.has(location))
        textured = value !== 0;
      uniform1i.call(this, location, value);
    };
    gl.uniform3fv = function (location, values, srcOffset, srcLength) {
      if (location !== null && actorUniforms.has(location)) {
        pendingActor = [...values].slice(0, 3);
        paletteHash = undefined;
      }
      uniform3fv.call(this, location, values, srcOffset, srcLength);
    };
    gl.uniformMatrix4fv = function (location, transpose, values, ...offsets) {
      if (location !== null && viewUniforms.has(location))
        draw.viewProjection = [...values].slice(
          offsets[0] ?? 0,
          (offsets[0] ?? 0) + 16,
        );
      uniformMatrix4fv.call(
        this,
        location,
        transpose,
        values,
        offsets[0],
        offsets[1],
      );
    };
    gl.clear = function (mask) {
      if ((mask & this.DEPTH_BUFFER_BIT) !== 0) {
        draw.texturedIndices = 0;
        draw.terrainDrawOffsets = [];
        draw.terrainBlendDraws = [];
        delete draw.firstActorState;
        draw.actorOrigins = [];
        draw.actorIndexCounts = [];
        draw.animationPaletteDraws = [];
        draw.recordedParticleDraws = 0;
        draw.recordedDepthDisabledParticleDraws = 0;
        pendingActor = undefined;
        paletteHash = undefined;
      }
      clear.call(this, mask);
    };
    gl.drawElements = function (mode, count, type, offset) {
      if (particlesActive && count > 0 && mode === this.TRIANGLES) {
        draw.recordedParticleDraws += 1;
        if (!this.isEnabled(this.DEPTH_TEST))
          draw.recordedDepthDisabledParticleDraws += 1;
      }
      if (terrainActive && textured) {
        draw.texturedIndices += count;
        draw.terrainDrawOffsets.push(offset);
        if (this.isEnabled(this.BLEND))
          draw.terrainBlendDraws.push({
            indexCount: count,
            depthWrites: Boolean(this.getParameter(this.DEPTH_WRITEMASK)),
            factors: [
              this.BLEND_SRC_RGB,
              this.BLEND_DST_RGB,
              this.BLEND_SRC_ALPHA,
              this.BLEND_DST_ALPHA,
            ].map((name) => Number(this.getParameter(name))),
          });
      }
      // The model renderer sets the origin once for all its material ranges.
      if (pendingActor !== undefined) {
        draw.firstActorState ??= {
          blend: this.isEnabled(this.BLEND),
          depthWrites: Boolean(this.getParameter(this.DEPTH_WRITEMASK)),
        };
        draw.actorOrigins.push(pendingActor);
        draw.actorIndexCounts.push(count);
        if (paletteHash !== undefined) {
          draw.animationPaletteDraws.push({
            indexCount: count,
            hash: paletteHash,
          });
          paletteHash = undefined;
        }
      }
      drawElements.call(this, mode, count, type, offset);
    };
    gl.texImage2D = new Proxy(texture, {
      apply(original, context: WebGL2RenderingContext, args: unknown[]) {
        if (args.at(-1) instanceof ImageBitmap) draw.textures += 1;
        Reflect.apply(original, context, args);
      },
    });
    gl.texSubImage2D = new Proxy(updateTexture, {
      apply(original, context: WebGL2RenderingContext, args: unknown[]) {
        const data = args[8];
        if (
          args[4] === 4 &&
          args[7] === context.FLOAT &&
          data instanceof Float32Array
        ) {
          const words = new Uint32Array(
            data.buffer,
            data.byteOffset,
            data.length,
          );
          let hash = 0x81_1c_9d_c5;
          for (const word of words)
            hash = Math.imul(hash ^ word, 0x01_00_01_93) >>> 0;
          paletteHash = hash;
        }
        Reflect.apply(original, context, args);
      },
    });
  });
}

export function readRecordedDraw(page: Page): Promise<RecordedDraw> {
  return page.evaluate(() => globalThis.recordedReplayDraw);
}
