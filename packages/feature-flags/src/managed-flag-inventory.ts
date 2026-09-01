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

const ManagedFlagBehaviorFields = {
  rollouts: z.array(ManagedFlagRolloutSchema),
  rules: z.array(ManagedFlagRuleSchema),
  thresholdRollouts: z.array(ManagedFlagThresholdRolloutSchema),
};

const ManagedFlagMetadataFields = {
  key: z.string().min(1),
  owner: z.string().min(1),
  namespace: z.string().min(1),
  source: z.string().min(1),
  purpose: z.string().min(1),
};

const ManagedFlagSchema = z.discriminatedUnion("type", [
  z.object({
    ...ManagedFlagMetadataFields,
    ...ManagedFlagBehaviorFields,
    type: z.literal("boolean"),
    default: z.boolean(),
  }),
  z.object({
    ...ManagedFlagMetadataFields,
    ...ManagedFlagBehaviorFields,
    type: z.literal("variant"),
    default: z.string(),
  }),
]);

const ManagedFlagOverrideSchema = z.discriminatedUnion("type", [
  z.object({
    key: z.string().min(1),
    ...ManagedFlagBehaviorFields,
    type: z.literal("boolean"),
    default: z.boolean(),
  }),
  z.object({
    key: z.string().min(1),
    ...ManagedFlagBehaviorFields,
    type: z.literal("variant"),
    default: z.string(),
  }),
]);

const ManagedEnvironmentSchema = z.object({
  key: z.string().min(1),
  overrides: z.array(ManagedFlagOverrideSchema),
});

const ManagedNamespaceSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
});

const ManagedFlagInventoryBaseSchema = z.object({
  version: z.literal(3),
  namespaces: z.array(ManagedNamespaceSchema).min(1),
  environments: z.array(ManagedEnvironmentSchema).min(1),
  flags: z.array(ManagedFlagSchema).min(1),
  exemptions: z.array(
    z.object({
      category: z.string().min(1),
      controls: z.array(z.string().min(1)),
      reason: z.string().min(1),
    }),
  ),
});

type ManagedFlagInventoryValue = z.infer<typeof ManagedFlagInventoryBaseSchema>;
type InventoryRefinementContext =
  z.core.$RefinementCtx<ManagedFlagInventoryValue>;

function validateNamespaces(
  value: ManagedFlagInventoryValue,
  context: InventoryRefinementContext,
): Set<string> {
  const namespaceKeys = new Set<string>();
  for (const [namespaceIndex, namespace] of value.namespaces.entries()) {
    if (namespaceKeys.has(namespace.key)) {
      context.addIssue({
        code: "custom",
        message: `duplicate managed namespace: ${namespace.key}`,
        path: ["namespaces", namespaceIndex, "key"],
      });
    }
    namespaceKeys.add(namespace.key);
  }
  return namespaceKeys;
}

function flagSegments(flag: ManagedFlagInventoryValue["flags"][number]) {
  return [
    ...flag.rollouts.map((rollout) => ({
      key: rollout.segmentKey,
      matchType: rollout.matchType,
      constraints: rollout.constraints,
    })),
    ...flag.rules.flatMap((rule) => rule.segments),
  ];
}

function validateFlags(
  value: ManagedFlagInventoryValue,
  namespaceKeys: ReadonlySet<string>,
  context: InventoryRefinementContext,
): Map<string, ManagedFlagInventoryValue["flags"][number]> {
  const flagsByKey = new Map(value.flags.map((flag) => [flag.key, flag]));
  if (flagsByKey.size !== value.flags.length) {
    context.addIssue({
      code: "custom",
      message: "duplicate managed flag key",
      path: ["flags"],
    });
  }

  const namespacesWithFlags = new Set<string>();
  const segmentDefinitions = new Map<string, string>();
  for (const [flagIndex, flag] of value.flags.entries()) {
    if (!namespaceKeys.has(flag.namespace)) {
      context.addIssue({
        code: "custom",
        message: `unknown managed namespace: ${flag.namespace}`,
        path: ["flags", flagIndex, "namespace"],
      });
    }
    namespacesWithFlags.add(flag.namespace);
    for (const segment of flagSegments(flag)) {
      const identity = `${flag.namespace}/${segment.key}`;
      const definition = JSON.stringify({
        matchType: segment.matchType,
        constraints: segment.constraints,
      });
      const existing = segmentDefinitions.get(identity);
      if (existing !== undefined && existing !== definition) {
        context.addIssue({
          code: "custom",
          message: `conflicting managed segment definition: ${identity}`,
          path: ["flags", flagIndex],
        });
      }
      segmentDefinitions.set(identity, definition);
    }
  }
  for (const [namespaceIndex, namespace] of value.namespaces.entries()) {
    if (!namespacesWithFlags.has(namespace.key)) {
      context.addIssue({
        code: "custom",
        message: `managed namespace has no flags: ${namespace.key}`,
        path: ["namespaces", namespaceIndex, "key"],
      });
    }
  }
  return flagsByKey;
}

function validateEnvironments(
  value: ManagedFlagInventoryValue,
  flagsByKey: ReadonlyMap<string, ManagedFlagInventoryValue["flags"][number]>,
  context: InventoryRefinementContext,
): void {
  const environmentKeys = new Set<string>();
  for (const [environmentIndex, environment] of value.environments.entries()) {
    if (environmentKeys.has(environment.key)) {
      context.addIssue({
        code: "custom",
        message: `duplicate managed environment: ${environment.key}`,
        path: ["environments", environmentIndex, "key"],
      });
    }
    environmentKeys.add(environment.key);

    const overrideKeys = new Set<string>();
    for (const [overrideIndex, override] of environment.overrides.entries()) {
      const path = [
        "environments",
        environmentIndex,
        "overrides",
        overrideIndex,
        "key",
      ];
      if (overrideKeys.has(override.key)) {
        context.addIssue({
          code: "custom",
          message: `duplicate override key: ${override.key}`,
          path,
        });
      }
      overrideKeys.add(override.key);

      const baseline = flagsByKey.get(override.key);
      if (baseline === undefined) {
        context.addIssue({
          code: "custom",
          message: `unknown override key: ${override.key}`,
          path,
        });
      } else if (baseline.type !== override.type) {
        context.addIssue({
          code: "custom",
          message: `override type mismatch for ${override.key}: expected ${baseline.type}, got ${override.type}`,
          path: [
            "environments",
            environmentIndex,
            "overrides",
            overrideIndex,
            "type",
          ],
        });
      }
    }
  }
}

export const ManagedFlagInventorySchema =
  ManagedFlagInventoryBaseSchema.superRefine((value, context) => {
    const namespaceKeys = validateNamespaces(value, context);
    const flagsByKey = validateFlags(value, namespaceKeys, context);
    validateEnvironments(value, flagsByKey, context);
  });

export type ManagedFlag = z.infer<typeof ManagedFlagSchema>;
export type ManagedEnvironment = z.infer<typeof ManagedEnvironmentSchema>;
export type ManagedNamespace = z.infer<typeof ManagedNamespaceSchema>;
export type ManagedFlagInventory = ManagedFlagInventoryValue;

export function materializeManagedNamespaceEnvironment(
  inventoryValue: ManagedFlagInventory,
  environmentKey: string,
  namespaceKey: string,
): ManagedFlag[] {
  const environment = inventoryValue.environments.find(
    (candidate) => candidate.key === environmentKey,
  );
  if (environment === undefined)
    throw new Error(`unknown managed environment: ${environmentKey}`);
  if (
    !inventoryValue.namespaces.some(
      (namespace) => namespace.key === namespaceKey,
    )
  )
    throw new Error(`unknown managed namespace: ${namespaceKey}`);

  const overridesByKey = new Map(
    environment.overrides.map((override) => [override.key, override]),
  );
  return inventoryValue.flags
    .map((flag) => {
      const override = overridesByKey.get(flag.key);
      if (override === undefined) return flag;
      if (flag.type === "boolean" && override.type === "boolean")
        return { ...flag, ...override };
      if (flag.type === "variant" && override.type === "variant")
        return { ...flag, ...override };
      throw new Error(`override type mismatch for ${flag.key}`);
    })
    .filter((flag) => flag.namespace === namespaceKey);
}

export const managedFlagInventory = ManagedFlagInventorySchema.parse(inventory);

export const managedFlagNamespaces = managedFlagInventory.namespaces.map(
  (namespace) => namespace.key,
);

export const managedFlagNames = managedFlagInventory.flags.map(
  (flag) => flag.key,
);
