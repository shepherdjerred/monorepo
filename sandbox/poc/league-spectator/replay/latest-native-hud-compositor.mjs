// Static QA primitive compositor. Layout and UV values are original-program
// outputs; caller-owned visibility, draw order and canvas blending are explicit
// inspection inputs, never an inferred native controller or layer default.
export async function createLatestNativeHudCompositor({
  canvas,
  manifest,
  readbackForQa = false,
}) {
  if (
    manifest?.schema !== 1 ||
    manifest.kind !== "original-native-hud-static-qa" ||
    manifest.build !== "16.21.829.8620" ||
    manifest.protocol !== "20e09df23c66b85e" ||
    !Array.isArray(manifest.primitives) ||
    !canvas?.getContext ||
    typeof readbackForQa !== "boolean"
  )
    throw Error("Original native HUD QA package and canvas required");
  // Newly Available readback hint: older implementations ignore the option.
  // Ordinary2D remains the rendering fallback; QA records acceptance separately
  // and never labels that fallback as a deterministic readback guarantee.
  const context = canvas.getContext("2d", {
      willReadFrequently: readbackForQa,
    }),
    controller = new AbortController(),
    images = new Map(),
    primitives = new Map(manifest.primitives.map((row) => [row.id, row]));
  if (!context || primitives.size !== manifest.primitives.length)
    throw Error("Unique native HUD primitives and 2D canvas required");
  let closed = false;
  async function bytes(asset) {
    if (
      !/^\/assets\/[a-f0-9]{64}\.(png|otf|ttf)$/.test(asset.url) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      asset.bytes > 64 * 1024 * 1024
    )
      throw Error("Explicit bounded original HUD asset required");
    const response = await fetch(asset.url, { signal: controller.signal });
    if (!response.ok) throw Error("Original HUD asset could not be loaded");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== asset.bytes)
      throw Error("Original HUD asset length changed");
    const digest = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    if (digest !== asset.sha256)
      throw Error("Original HUD asset bytes changed");
    return buffer;
  }
  try {
    await Promise.all(
      Object.entries(manifest.textures).map(async ([key, asset]) => {
        const image = await createImageBitmap(
          new Blob([await bytes(asset)], { type: "image/png" }),
        );
        if (image.width !== asset.width || image.height !== asset.height) {
          image.close();
          throw Error("Original HUD texture dimensions changed");
        }
        if (closed) image.close();
        else images.set(key, image);
      }),
    );
    if (closed) throw Error("Native HUD compositor closed during loading");
    return Object.freeze({
      async loadQaFonts() {
        if (closed) throw Error("Closed native HUD compositor");
        const faces = [];
        try {
          for (const font of manifest.fonts) {
            const face = new FontFace(font.family, await bytes(font));
            await face.load();
            if (closed)
              throw Error("Native HUD compositor closed during font loading");
            document.fonts.add(face);
            faces.push(face);
          }
          return {
            fonts: manifest.fonts,
            close() {
              for (const face of faces) document.fonts.delete(face);
            },
          };
        } catch (error) {
          for (const face of faces) document.fonts.delete(face);
          throw error;
        }
      },
      draw({ width, height, visibleIds, annotate = false }) {
        if (closed) throw Error("Closed native HUD compositor");
        if (
          !Number.isInteger(width) ||
          !Number.isInteger(height) ||
          width <= 0 ||
          height <= 0 ||
          !Array.isArray(visibleIds) ||
          new Set(visibleIds).size !== visibleIds.length
        )
          throw Error(
            "Explicit viewport and ordered unique visible primitives required",
          );
        canvas.width = width;
        canvas.height = height;
        context.clearRect(0, 0, width, height);
        context.globalCompositeOperation = "source-over";
        const drawn = [],
          omitted = [];
        for (const id of visibleIds) {
          const primitive = primitives.get(id);
          if (!primitive)
            throw Error("Requested HUD primitive is not admitted");
          const candidates = primitive.rectangles.filter(
            (row) => row.viewport[0] === width && row.viewport[1] === height,
          );
          if (candidates.length !== 1)
            throw Error(
              "Original HUD viewport rectangle is not uniquely established",
            );
          const rect = candidates[0].rect,
            uv = primitive.uv,
            image = images.get(primitive.texture);
          if (
            !image ||
            rect.length !== 4 ||
            uv.length !== 4 ||
            ![...rect, ...uv].every(Number.isFinite)
          )
            throw Error("Original HUD image rectangle/UV is unresolved");
          const [left, top, right, bottom] = rect,
            [u0, v0, u1, v1] = uv,
            destinationWidth = (right - left) * width,
            destinationHeight = (bottom - top) * height;
          if (
            destinationWidth <= 0 ||
            destinationHeight <= 0 ||
            u1 <= u0 ||
            v1 <= v0
          ) {
            omitted.push({ id, reason: "nonpositive-rectangle-or-uv" });
            continue;
          }
          context.drawImage(
            image,
            u0 * image.width,
            v0 * image.height,
            (u1 - u0) * image.width,
            (v1 - v0) * image.height,
            left * width,
            top * height,
            destinationWidth,
            destinationHeight,
          );
          if (annotate) {
            context.strokeStyle = "#ffcc66";
            context.lineWidth = 1;
            context.strokeRect(
              left * width,
              top * height,
              destinationWidth,
              destinationHeight,
            );
          }
          drawn.push(id);
        }
        return {
          drawn,
          omitted,
          viewport: [width, height],
          controlledBlend: "canvas-source-over",
          nativeBlendingEstablished: false,
          controlledReadback: readbackForQa,
          readbackOptimizationAccepted:
            context.getContextAttributes?.().willReadFrequently === true,
        };
      },
      close() {
        if (closed) return;
        closed = true;
        controller.abort();
        for (const image of images.values()) image.close();
        images.clear();
      },
    });
  } catch (error) {
    closed = true;
    controller.abort();
    for (const image of images.values()) image.close();
    images.clear();
    throw error;
  }
}
