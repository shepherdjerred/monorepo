import { z } from "zod";
import { managedFlagInventory } from "../packages/feature-flags/src/managed-flag-inventory.ts";

const SegmentConstraintSchema = z.object({
  property: z.string(),
  value: z.string(),
});

const SegmentRolloutSchema = z.object({
  type: z.literal("SEGMENT_ROLLOUT_TYPE"),
  segment: z.object({
    value: z.boolean(),
    segments: z.array(
      z.object({
        key: z.string(),
        constraints: z.array(SegmentConstraintSchema),
      }),
    ),
  }),
});

const SnapshotFlagSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  type: z.enum(["BOOLEAN_FLAG_TYPE", "VARIANT_FLAG_TYPE"]),
  rollouts: z.array(SegmentRolloutSchema),
  defaultVariant: z.object({ key: z.string() }).optional(),
});

const SnapshotSchema = z.object({ flags: z.array(SnapshotFlagSchema) });

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  const value = Bun.argv[index + 1];
  return index !== -1 && value !== undefined ? value : undefined;
}

function requiredUrl(): string {
  const url = argument("--url") ?? Bun.env["FLIPT_URL"];
  if (url === undefined || url.length === 0) {
    throw new Error(
      "FLIPT_URL or --url is required; this operator-only check never guesses a Flipt endpoint",
    );
  }
  return url.replace(/\/$/, "");
}

function normalizeRollouts(
  rollouts: z.infer<typeof SegmentRolloutSchema>[],
): { segmentKey: string; property: string; value: string; result: boolean }[] {
  return rollouts.flatMap((rollout) =>
    rollout.segment.segments.flatMap((segment) =>
      segment.constraints.map((constraint) => ({
        segmentKey: segment.key,
        property: constraint.property,
        value: constraint.value,
        result: rollout.segment.value,
      })),
    ),
  );
}

type ManagedFlag = (typeof managedFlagInventory.flags)[number];
type SnapshotFlag = z.infer<typeof SnapshotFlagSchema>;

function keySetError(
  expectedByKey: Map<string, ManagedFlag>,
  actualByKey: Map<string, SnapshotFlag>,
): string | undefined {
  const expectedKeys = [...expectedByKey.keys()].sort();
  const actualKeys = [...actualByKey.keys()].sort();
  if (JSON.stringify(expectedKeys) === JSON.stringify(actualKeys)) {
    return undefined;
  }
  const missing = expectedKeys.filter((key) => !actualByKey.has(key));
  const unexpected = actualKeys.filter((key) => !expectedByKey.has(key));
  return `key set mismatch: expected ${expectedKeys.length.toString()}, got ${actualKeys.length.toString()}; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`;
}

function flagErrors(expected: ManagedFlag, actual: SnapshotFlag): string[] {
  const actualType =
    actual.type === "BOOLEAN_FLAG_TYPE" ? "boolean" : "variant";
  if (actualType !== expected.type) {
    return [
      `${expected.key}: expected type ${expected.type}, got ${actualType}`,
    ];
  }

  const actualDefault =
    expected.type === "boolean" ? actual.enabled : actual.defaultVariant?.key;
  const errors: string[] = [];
  if (actualDefault !== expected.default) {
    errors.push(
      `${expected.key}: expected default ${JSON.stringify(expected.default)}, got ${JSON.stringify(actualDefault)}`,
    );
  }
  const actualRollouts = normalizeRollouts(actual.rollouts);
  if (JSON.stringify(actualRollouts) !== JSON.stringify(expected.rollouts)) {
    errors.push(
      `${expected.key}: rollout contract mismatch; expected ${JSON.stringify(expected.rollouts)}, got ${JSON.stringify(actualRollouts)}`,
    );
  }
  return errors;
}

function compareSnapshot(snapshot: z.infer<typeof SnapshotSchema>): string[] {
  const expectedByKey = new Map(
    managedFlagInventory.flags.map((flag) => [flag.key, flag]),
  );
  const actualByKey = new Map(snapshot.flags.map((flag) => [flag.key, flag]));
  const errors = keySetError(expectedByKey, actualByKey);
  return [
    ...(errors === undefined ? [] : [errors]),
    ...managedFlagInventory.flags.flatMap((expected) => {
      const actual = actualByKey.get(expected.key);
      return actual === undefined ? [] : flagErrors(expected, actual);
    }),
  ];
}

async function main(): Promise<void> {
  const namespace =
    argument("--namespace") ??
    Bun.env["FLIPT_NAMESPACE"] ??
    managedFlagInventory.namespace;
  const environment =
    argument("--environment") ??
    Bun.env["FLIPT_ENVIRONMENT"] ??
    managedFlagInventory.environment;
  const url = requiredUrl();
  const response = await fetch(
    `${url}/internal/v1/evaluation/snapshot/namespace/${encodeURIComponent(namespace)}`,
    {
      headers: {
        Accept: "application/json",
        "x-flipt-accept-server-version": "1.47.0",
        "x-flipt-environment": environment,
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Flipt snapshot request failed: ${response.status.toString()} ${response.statusText}`,
    );
  }

  const snapshot = SnapshotSchema.parse(await response.json());
  const errors = compareSnapshot(snapshot);
  if (errors.length > 0) {
    throw new Error(
      `Flipt managed-flag drift detected:\n- ${errors.join("\n- ")}`,
    );
  }
  console.log(
    `Flipt managed-flag inventory is aligned: ${managedFlagInventory.flags.length.toString()} keys in ${namespace}/${environment}`,
  );
}

await main();
