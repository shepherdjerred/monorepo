import { z } from "zod";

export const MediaName = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u);
const unit = z.number().min(0).max(1);
const point = z.tuple([unit, unit]);
export const AnnotationSchema = z
  .strictObject({
    atStep: z.string().min(1).max(80).optional(),
    kind: z.enum(["arrow", "box", "label"]),
    from: point,
    to: point,
    text: z.string().max(160),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  })
  .refine(
    (cue) => cue.endMs > cue.startMs,
    "Annotation must have positive duration",
  );
export type Annotation = z.infer<typeof AnnotationSchema>;
export const PresentationSchema = z.strictObject({
  schema: z.literal(1),
  name: MediaName,
  alt: z.string().min(1).max(600),
  caption: z.string().max(1000),
  annotations: z.array(AnnotationSchema).max(100),
});
export type Presentation = z.infer<typeof PresentationSchema>;

const camera = z.strictObject({
  position: z.tuple([z.number(), z.number(), z.number()]),
  yaw: z.number(),
  pitch: z.number(),
  fov: z.number(),
  hud: z.boolean(),
  nameplates: z.boolean(),
});
export const DocsFramesSchema = z
  .strictObject({
    markers: z
      .array(
        z.strictObject({
          name: z.string().min(1).max(80),
          frame: z.number().int().nonnegative(),
        }),
      )
      .max(200),
    schema: z.literal(4),
    kind: z.literal("mc-docs-frames"),
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
          observation: z.strictObject({
            world: z.string(),
            screen: z.string(),
          }),
        }),
      )
      .min(1)
      .max(1800),
  })
  .superRefine((receipt, ctx) => {
    if (
      new Set(receipt.markers.map((marker) => marker.name)).size !==
        receipt.markers.length ||
      receipt.markers.some((marker) => marker.frame >= receipt.requestedFrames)
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid or duplicated recording markers",
      });
    if (receipt.frames.length !== receipt.requestedFrames)
      ctx.addIssue({ code: "custom", message: "Incomplete frame inventory" });
    receipt.frames.forEach(({ frame, file }, index) => {
      if (
        index !== frame.index ||
        file !== `${index.toString().padStart(6, "0")}.png` ||
        frame.elapsedNanos < Math.floor((index * 1e9) / 30) ||
        frame.elapsedNanos >= Math.floor(((index + 1) * 1e9) / 30)
      )
        ctx.addIssue({
          code: "custom",
          message: `Invalid frame sampling slot ${index.toString()}`,
        });
    });
  });

/** Only these fields are exported; private run observations never enter the docs. */
export const PublicMediaSchema = z
  .strictObject({
    schema: z.literal(1),
    name: MediaName,
    kind: z.enum(["image", "video"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    src: z
      .string()
      .regex(/^\/media\/[a-z0-9-]+\/(?:original\.webp|clip\.mp4)$/u),
    poster: z.string().regex(/^\/media\/[a-z0-9-]+\/poster\.webp$/u),
    alt: z.string(),
    caption: z.string(),
    annotations: z.array(AnnotationSchema),
  })
  .superRefine((media, ctx) => {
    const base = `/media/${media.name}`;
    if (
      media.src !==
        `${base}/${media.kind === "video" ? "clip.mp4" : "original.webp"}` ||
      media.poster !== `${base}/poster.webp` ||
      media.annotations.some((cue) => cue.atStep !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "Public media identity or resolved annotation differs",
      });
  });
export type PublicMedia = z.infer<typeof PublicMediaSchema>;
