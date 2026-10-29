import { z } from "zod";

export const RuntimeImageSchema = z
  .string()
  .regex(
    /^(?:ghcr\.io|docker\.io)\/shepherdjerred\/storm-forum@sha256:[a-f0-9]{64}$/,
  );
/** The exact release a Forum runtime installs: bundle, XenForo version and image. */
export const ReleaseSourceSchema = z
  .object({
    bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
    xenforoVersion: z.string().min(1),
    runtimeImage: RuntimeImageSchema,
  })
  .strict();
