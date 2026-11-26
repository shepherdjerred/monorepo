import { z } from "zod";

// The Flags management API's response shapes. This module imports only Zod,
// so browser code (the Flags operator UI) can parse responses with the same
// schemas the server-side clients use.

const SegmentConstraintSchema = z.strictObject({
  property: z.string().min(1),
  value: z.string().min(1),
});

const SegmentRolloutSchema = z.strictObject({
  constraints: z.array(SegmentConstraintSchema).min(1),
  result: z.boolean(),
});

export const FlagsValueSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("boolean"),
    key: z.string().min(1),
    default: z.boolean(),
    rollouts: z.array(SegmentRolloutSchema),
  }),
  z.strictObject({
    type: z.literal("variant"),
    key: z.string().min(1),
    value: z.string(),
  }),
]);

export const FlagsDeploymentDocumentSchema = z.strictObject({
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  flags: z.array(FlagsValueSchema),
});

export const FlagsDeploymentSnapshotSchema = z.strictObject({
  deployment: z.string().min(1),
  revision: z.number().int().nonnegative(),
  flags: z.array(FlagsValueSchema),
});

export const FlagsDiffResponseSchema = z.strictObject({
  deployments: z.array(
    z.strictObject({
      id: z.string().min(1),
      revision: z.number().int().nonnegative(),
      missing: z.array(FlagsValueSchema),
      extra: z.array(z.string().min(1)),
      drift: z.array(
        z.strictObject({
          key: z.string().min(1),
          live: FlagsValueSchema,
          declared: FlagsValueSchema,
        }),
      ),
      // A Flags server older than the value registry omits `invalid`; until
      // every server reports it, absence means nothing was found invalid.
      invalid: z
        .array(
          z.strictObject({
            key: z.string().min(1),
            value: z.string(),
            issues: z.array(
              z.strictObject({ path: z.string(), message: z.string().min(1) }),
            ),
          }),
        )
        .default([]),
    }),
  ),
});

export type FlagsDeploymentDocument = z.infer<
  typeof FlagsDeploymentDocumentSchema
>;
export type FlagsDeploymentSnapshot = z.infer<
  typeof FlagsDeploymentSnapshotSchema
>;
export type FlagsDiffResponse = z.infer<typeof FlagsDiffResponseSchema>;
