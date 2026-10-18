import { z } from "zod";
import { ForumReleaseIdSchema } from "@shepherdjerred/ops-model/forum-recovery.ts";

export const ForumStageSchema = z
  .object({
    stage: z.enum(["beta", "prod"]),
    secretItemId: z.string().regex(/^[a-z0-9]{26}$/),
    observationItemId: z
      .string()
      .regex(/^[a-z0-9]{26}$/)
      .optional(),
    storageSlot: z.enum(["primary", "recovery"]).optional(),
    trustedConnectorCidr: z
      .cidrv4()
      .refine(
        (value) => value !== "0.0.0.0/0",
        "Trust only the connector's network",
      ),
  })
  .strict()
  .refine(
    (value) => value.storageSlot !== "recovery" || value.stage === "beta",
    "Recovery storage belongs only to private beta",
  );
export type ForumStage = z.infer<typeof ForumStageSchema>;

export const ReleaseSchema = z
  .object({
    stage: z.enum(["beta", "prod"]),
    image: z
      .string()
      .regex(/^docker\.io\/shepherdjerred\/storm-forum@sha256:[a-f0-9]{64}$/)
      .refine(
        (value) => !value.endsWith("0".repeat(64)),
        "An active release requires a published image",
      ),
    secretItemId: z.string().regex(/^[a-z0-9]{26}$/),
    observationItemId: z
      .string()
      .regex(/^[a-z0-9]{26}$/)
      .optional(),
    bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
    bundleKey: z.string().regex(/^releases\/[\w.-]+\.zip$/),
    releaseId: ForumReleaseIdSchema,
    preUpgradeBackup: z
      .object({
        bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
        xenforoVersion: z.string().min(1),
        runtimeImage: z
          .string()
          .regex(
            /^(?:ghcr\.io|docker\.io)\/shepherdjerred\/storm-forum@sha256:[a-f0-9]{64}$/,
          ),
      })
      .strict()
      .optional(),
    storageSlot: z.enum(["primary", "recovery"]).optional(),
    restore: z
      .object({
        manifestKey: z
          .string()
          .regex(/^snapshots\/(?:beta|prod)\/[a-f0-9-]{36}\/manifest\.json$/),
        runtimeImage: z
          .string()
          .regex(
            /^(?:ghcr\.io|docker\.io)\/shepherdjerred\/storm-forum@sha256:[a-f0-9]{64}$/,
          ),
      })
      .strict()
      .optional(),
    trustedConnectorCidr: z
      .cidrv4()
      .refine(
        (value) => value !== "0.0.0.0/0",
        "Trust only the connector's network",
      ),
  })
  .strict()
  .refine(
    (value) =>
      (value.storageSlot !== "recovery" || value.stage === "beta") &&
      (!value.restore ||
        (value.stage === "beta" && value.storageSlot === "recovery")),
    "Recovery uses only the dedicated private beta storage pair",
  )
  .refine(
    (value) =>
      !value.restore ||
      value.restore.runtimeImage.replace(/^ghcr\.io\//, "docker.io/") ===
        value.image,
    "Recovery must run the snapshot's exact runtime digest",
  );
export type ForumRelease = z.infer<typeof ReleaseSchema>;
