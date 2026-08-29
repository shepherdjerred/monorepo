import inventory from "@shepherdjerred/feature-flags/managed-flag-inventory.json" with { type: "json" };
import { z } from "zod";

export type ManagedFlagType = "boolean" | "variant";

const ManagedFlagConstraintSchema = z.object({
  type: z.string().min(1),
  property: z.string().min(1),
  operator: z.string().min(1),
  value: z.string().min(1),
});

const ManagedFlagSegmentSchema = z.object({
  key: z.string().min(1),
  matchType: z.string().min(1),
  constraints: z.array(ManagedFlagConstraintSchema),
});

const ManagedFlagRuleSchema = z.object({
  rank: z.number().int().nonnegative(),
  segmentOperator: z.string().min(1),
  segments: z.array(ManagedFlagSegmentSchema),
  distributions: z.array(
    z.object({
      variantKey: z.string().min(1),
      rollout: z.number().min(0).max(100),
      variantAttachment: z.string(),
    }),
  ),
});

const ManagedFlagThresholdRolloutSchema = z.object({
  rank: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
  result: z.boolean(),
});

export const ManagedFlagRolloutSchema = z.object({
  segmentKey: z.string().min(1),
  segmentOperator: z.string().min(1),
  matchType: z.string().min(1),
  constraints: z.array(ManagedFlagConstraintSchema),
  result: z.boolean(),
});

const ManagedFlagFields = {
  key: z.string().min(1),
  owner: z.string().min(1),
  source: z.string().min(1),
  purpose: z.string().min(1),
  rollouts: z.array(ManagedFlagRolloutSchema),
  rules: z.array(ManagedFlagRuleSchema).default([]),
  thresholdRollouts: z.array(ManagedFlagThresholdRolloutSchema).default([]),
};

const ManagedFlagSchema = z.discriminatedUnion("type", [
  z.object({
    ...ManagedFlagFields,
    type: z.literal("boolean"),
    default: z.boolean(),
  }),
  z.object({
    ...ManagedFlagFields,
    type: z.literal("variant"),
    default: z.string(),
  }),
]);

export type ManagedFlag = z.infer<typeof ManagedFlagSchema>;

export const ManagedFlagInventorySchema = z
  .object({
    version: z.literal(1),
    namespace: z.string().min(1),
    environment: z.string().min(1),
    flags: z.array(ManagedFlagSchema).min(1),
    exemptions: z.array(
      z.object({
        category: z.string().min(1),
        controls: z.array(z.string().min(1)),
        reason: z.string().min(1),
      }),
    ),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const [index, flag] of value.flags.entries()) {
      if (seen.has(flag.key)) {
        context.addIssue({
          code: "custom",
          message: `duplicate managed flag key: ${flag.key}`,
          path: ["flags", index, "key"],
        });
      }
      seen.add(flag.key);
    }
  });

export const managedFlagInventory = ManagedFlagInventorySchema.parse(inventory);

export const managedFlagNames = managedFlagInventory.flags.map(
  (flag) => flag.key,
);
