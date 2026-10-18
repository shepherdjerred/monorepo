import { z } from "zod";
import policy from "./forum-bundle-policy.json" with { type: "json" };

export const ForumBundlePolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    xenforoVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    vendorDependencies: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z][a-z-]+$/u),
            version: z.string().regex(/^\d+\.\d+\.\d+$/u),
            kind: z.literal("style"),
            path: z.string().regex(/^vendor\/[a-z][\w.-]+\.zip$/u),
            mode: z.enum(["light", "dark"]),
            sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .strict(),
      )
      .length(2),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (["path", "key", "mode"] as const).some(
        (key) =>
          new Set(value.vendorDependencies.map((dependency) => dependency[key]))
            .size !== value.vendorDependencies.length,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Licensed dependency paths must be unique",
      });
  });
export const forumBundlePolicy = ForumBundlePolicySchema.parse(policy);
