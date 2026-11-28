import type { Page } from "@playwright/test";

export async function comparePixels(page: Page, screenshots: Buffer[]) {
  return page.evaluate(
    async (imageData) => {
      const frames = await Promise.all(
        imageData.map(async (base64) => {
          const bytes = Uint8Array.from(
            globalThis.atob(base64),
            (byte) => byte.codePointAt(0) ?? 0,
          );
          return globalThis.createImageBitmap(
            new globalThis.Blob([bytes], { type: "image/png" }),
          );
        }),
      );
      try {
        const size = frames[0];
        if (
          size === undefined ||
          frames.some(
            ({ width, height }) =>
              width !== size.width || height !== size.height,
          )
        )
          throw new Error(
            "Attribution screenshots must have identical dimensions.",
          );
        const { width, height } = size;
        const canvas = globalThis.document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx === null)
          throw new Error("Unable to read attribution screenshots.");
        const [enabled, suppressed, suppressedRepeat, restored] = frames.map(
          (frame) => {
            ctx.drawImage(frame, 0, 0);
            return ctx.getImageData(0, 0, width, height).data;
          },
        );
        if (!enabled || !suppressed || !suppressedRepeat || !restored)
          throw new Error("Missing attribution control screenshots.");
        const diff = ctx.createImageData(width, height);
        const distance = (
          a: Uint8ClampedArray,
          b: Uint8ClampedArray,
          at: number,
        ) =>
          Math.max(
            Math.abs((a[at] ?? 0) - (b[at] ?? 0)),
            Math.abs((a[at + 1] ?? 0) - (b[at + 1] ?? 0)),
            Math.abs((a[at + 2] ?? 0) - (b[at + 2] ?? 0)),
          );
        let causal = 0;
        let unstable = 0;
        let maxChannelDelta = 0;
        const deltaHistogram: Record<number, number> = {};
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;
        for (let i = 0; i < enabled.length; i += 4) {
          const stable =
            distance(enabled, restored, i) === 0 &&
            distance(suppressed, suppressedRepeat, i) === 0;
          if (!stable) unstable++;
          const delta = distance(enabled, suppressed, i);
          if (!stable || delta === 0) {
            for (let channel = 0; channel < 3; channel++)
              diff.data[i + channel] = (enabled[i + channel] ?? 0) / 3;
            diff.data[i + 3] = 255;
            continue;
          }
          causal++;
          deltaHistogram[delta] = (deltaHistogram[delta] ?? 0) + 1;
          maxChannelDelta = Math.max(maxChannelDelta, delta);
          const x = (i / 4) % width;
          const y = Math.floor(i / 4 / width);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          diff.data.set([255, 185, 41, 255], i);
        }
        ctx.putImageData(diff, 0, 0);
        return {
          metrics: {
            width,
            height,
            causal,
            unstable,
            maxChannelDelta,
            deltaHistogram,
            bounds: causal === 0 ? null : { minX, minY, maxX, maxY },
          },
          mask: canvas.toDataURL("image/png").split(",", 2)[1],
        };
      } finally {
        for (const frame of frames) frame.close();
      }
    },
    screenshots.map((image) => image.toString("base64")),
  );
}
