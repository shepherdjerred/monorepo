import type { Page } from "@playwright/test";

declare global {
  var recordedRiftTextures: {
    suppress: string | null;
    frame: {
      generation: number;
      suppressed: string | null;
      families: Record<string, number>;
    };
  };
}

// Bind a draw to the content-addressed base color texture used by the recorded
// renderer. Palette textures and other shaders cannot supply family evidence.
export async function installRiftFightTextureProbe(
  page: Page,
  textures: Readonly<Record<string, string>>,
) {
  await page.addInitScript((families) => {
    const bitmapFamilies = new WeakMap<ImageBitmap, string>();
    const textureFamilies = new WeakMap<WebGLTexture, string>();
    const createBitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = new Proxy(createBitmap, {
      async apply(
        original: typeof createBitmap,
        target: unknown,
        args:
          | [ImageBitmapSource, ImageBitmapOptions?]
          | [
              ImageBitmapSource,
              number,
              number,
              number,
              number,
              ImageBitmapOptions?,
            ],
      ) {
        const bitmap: unknown = await Reflect.apply(original, target, args);
        if (!(bitmap instanceof ImageBitmap))
          throw new TypeError("Image decoding did not return an ImageBitmap.");
        const [source, options] = args;
        if (
          typeof options !== "number" &&
          options?.colorSpaceConversion === "none" &&
          source instanceof Blob &&
          source.type === "image/png"
        ) {
          const digest = await crypto.subtle.digest(
            "SHA-256",
            await source.arrayBuffer(),
          );
          const hex = Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
          const family = families[hex];
          if (family !== undefined) bitmapFamilies.set(bitmap, family);
        }
        return bitmap;
      },
    });

    const gl = WebGL2RenderingContext.prototype;
    const probe: typeof globalThis.recordedRiftTextures = {
      suppress: null,
      frame: { generation: 0, suppressed: null, families: {} },
    };
    globalThis.recordedRiftTextures = probe;
    const originalMethod = <Key extends keyof WebGL2RenderingContext>(
      key: Key,
    ): WebGL2RenderingContext[Key] => Reflect.get(gl, key);
    const texImage = originalMethod("texImage2D");
    const bindTexture = originalMethod("bindTexture");
    const activeTexture = originalMethod("activeTexture");
    const getBlock = originalMethod("getUniformBlockIndex");
    const getUniform = originalMethod("getUniformLocation");
    const useProgram = originalMethod("useProgram");
    const clear = originalMethod("clear");
    const drawElements = originalMethod("drawElements");
    const recordedPrograms = new WeakSet<WebGLProgram>();
    let textureUnit: number | undefined;
    let baseTexture: WebGLTexture | null = null;
    let recordedProgramActive = false;

    gl.texImage2D = new Proxy(texImage, {
      apply(original, context: WebGL2RenderingContext, args: unknown[]) {
        const image = args.at(-1);
        if (image instanceof ImageBitmap) {
          const family = bitmapFamilies.get(image);
          if (family !== undefined) {
            const texture: unknown = context.getParameter(
              context.TEXTURE_BINDING_2D,
            );
            if (!(texture instanceof WebGLTexture))
              throw new TypeError(
                "A recorded texture upload has no bound texture.",
              );
            textureFamilies.set(texture, family);
          }
        }
        Reflect.apply(original, context, args);
      },
    });
    gl.activeTexture = function (unit) {
      textureUnit = unit;
      activeTexture.call(this, unit);
    };
    gl.bindTexture = function (target, texture) {
      if (textureUnit === this.TEXTURE1 && target === this.TEXTURE_2D)
        baseTexture = texture;
      bindTexture.call(this, target, texture);
    };
    gl.getUniformBlockIndex = function (program, name) {
      const index = getBlock.call(this, program, name);
      if (
        name === "VFXDynamicPerParticleInstanceCBVS_vs" &&
        index !== this.INVALID_INDEX
      )
        recordedPrograms.add(program);
      return index;
    };
    gl.getUniformLocation = function (program, name) {
      const location = getUniform.call(this, program, name);
      if (location !== null && name === "NAVMESH_MASK_TEXTURE_SharedTexture")
        recordedPrograms.add(program);
      return location;
    };
    gl.useProgram = function (program) {
      recordedProgramActive = program !== null && recordedPrograms.has(program);
      useProgram.call(this, program);
    };
    gl.clear = function (mask) {
      if (
        (mask & this.DEPTH_BUFFER_BIT) !== 0 &&
        this.canvas instanceof HTMLCanvasElement &&
        this.canvas.getAttribute("aria-label") ===
          "League of Legends replay scene"
      ) {
        probe.frame = {
          generation: probe.frame.generation + 1,
          suppressed: probe.suppress,
          families: {},
        };
      }
      clear.call(this, mask);
    };
    gl.drawElements = function (mode, count, type, offset) {
      if (
        recordedProgramActive &&
        baseTexture !== null &&
        mode === this.TRIANGLES &&
        count > 0
      ) {
        const family = textureFamilies.get(baseTexture);
        if (family !== undefined) {
          const { families: draws, suppressed } = probe.frame;
          draws[family] = (draws[family] ?? 0) + 1;
          if (family === suppressed) return;
        }
      }
      drawElements.call(this, mode, count, type, offset);
    };
  }, textures);
}
