import { z } from "zod";

/** Shared lossless framebuffer inventory; each capture contract supplies its camera rules. */
export function framebufferShape<Camera extends z.ZodType>(camera: Camera) {
  return {
    source: z.literal("minecraft-framebuffer"),
    fps: z.literal(30),
    requestedFrames: z.number().int().min(1).max(1800),
    complete: z.literal(true),
    error: z.literal(""),
    frames: z
      .array(
        z.strictObject({
          frame: z.strictObject({
            index: z.number().int().nonnegative(),
            elapsedNanos: z.number().int().nonnegative(),
            worldTick: z.number().int().nonnegative(),
            camera,
          }),
          file: z.string().regex(/^\d{6}\.png$/u),
          sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        }),
      )
      .min(1)
      .max(1800),
  };
}
