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

// Management-only audit views. They are separate endpoints, so the document,
// snapshot and evaluate shapes above stay unchanged for runtime consumers.

export const FlagsActorSchema = z.strictObject({
  kind: z.enum(["human", "machine", "system"]),
  id: z.string().min(1),
});

export const FlagsAuditActionSchema = z.enum(["create", "update", "retire"]);

export const FlagsHistoryResponseSchema = z.strictObject({
  entries: z.array(
    z.strictObject({
      id: z.number().int().positive(),
      at: z.iso.datetime(),
      action: FlagsAuditActionSchema,
      actor: FlagsActorSchema,
      revisionAfter: z.number().int().nonnegative(),
      // Stored bodies as written; older bodies may not match today's schema.
      before: z.unknown(),
      after: z.unknown(),
    }),
  ),
  nextBefore: z.number().int().positive().nullable(),
  auditStartedAt: z.iso.datetime(),
});

export const FlagsCreatedAtBasisSchema = z.enum([
  "recorded",
  "first-declared",
  "on-or-before",
  "unknown",
]);

export const FlagsMetadataResponseSchema = z.strictObject({
  deployment: z.string().min(1),
  auditStartedAt: z.iso.datetime(),
  flags: z.array(
    z.strictObject({
      key: z.string().min(1),
      purpose: z.string().min(1).optional(),
      owner: z.string().min(1).optional(),
      namespace: z.string().min(1).optional(),
      source: z.string().min(1).optional(),
      declared: z.boolean(),
      createdAt: z.iso.datetime().nullable(),
      createdAtBasis: FlagsCreatedAtBasisSchema,
      lastChangedAt: z.iso.datetime().nullable(),
      lastChangedBy: FlagsActorSchema.nullable(),
    }),
  ),
});

export const FlagsArchiveResponseSchema = z.strictObject({
  deployments: z.array(
    z.strictObject({
      id: z.string().min(1),
      flags: z.array(
        z.strictObject({
          key: z.string().min(1),
          retiredAt: z.iso.datetime().nullable(),
          retiredBy: FlagsActorSchema.nullable(),
          // The last stored body; null when retired before the audit trail.
          final: z.unknown(),
          revision: z.number().int().nonnegative().nullable(),
          basis: z.enum(["recorded", "declared-retired"]),
        }),
      ),
    }),
  ),
});

export type FlagsActorWire = z.infer<typeof FlagsActorSchema>;
export type FlagsHistoryResponse = z.infer<typeof FlagsHistoryResponseSchema>;
export type FlagsMetadataResponse = z.infer<typeof FlagsMetadataResponseSchema>;
export type FlagsArchiveResponse = z.infer<typeof FlagsArchiveResponseSchema>;
