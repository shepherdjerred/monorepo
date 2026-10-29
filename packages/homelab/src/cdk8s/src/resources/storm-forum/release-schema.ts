import { z } from "zod";
import { ForumReleaseIdSchema } from "@shepherdjerred/ops-model/forum-recovery.ts";

const ItemIdSchema = z.string().regex(/^[a-z0-9]{26}$/);

/** Fields every forum stage and release carries. */
const forumStageFields = {
  stage: z.enum(["beta", "prod"]),
  secretItemId: ItemIdSchema,
  observationItemId: ItemIdSchema.optional(),
  storageSlot: z.enum(["primary", "recovery"]).optional(),
  trustedConnectorCidr: z
    .cidrv4()
    .refine(
      (value) => value !== "0.0.0.0/0",
      "Trust only the connector's network",
    ),
};

function recoveryOnlyInBeta(value: {
  stage: "beta" | "prod";
  storageSlot?: "primary" | "recovery" | undefined;
}) {
  return value.storageSlot !== "recovery" || value.stage === "beta";
}

export const ForumStageSchema = z
  .object(forumStageFields)
  .strict()
  .refine(recoveryOnlyInBeta, "Recovery storage belongs only to private beta");
export type ForumStage = z.infer<typeof ForumStageSchema>;

export const ReleaseSchema = z
  .object({
    ...forumStageFields,
    image: z
      .string()
      .regex(/^docker\.io\/shepherdjerred\/storm-forum@sha256:[a-f0-9]{64}$/)
      .refine(
        (value) => !value.endsWith("0".repeat(64)),
        "An active release requires a published image",
      ),
    bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
    bundleKey: z.string().regex(/^releases\/[\w.-]+\.zip$/),
    releaseId: ForumReleaseIdSchema,
  })
  .strict()
  .refine(recoveryOnlyInBeta, "Recovery storage belongs only to private beta");
export type ForumRelease = z.infer<typeof ReleaseSchema>;
