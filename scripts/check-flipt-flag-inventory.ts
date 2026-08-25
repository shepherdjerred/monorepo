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
  return index >= 0 && value !== undefined ? value : undefined;
}

function requiredUrl(): string {
  const url = argument("--url") ?? Bun.env.FLIPT_URL;
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

function expectedDefault(flag: (typeof managedFlagInventory.flags)[number]) {
  return flag.default;
}

async function main(): Promise<void> {
  const namespace =
    argument("--namespace") ??
    Bun.env.FLIPT_NAMESPACE ??
    managedFlagInventory.namespace;
  const environment =
    argument("--environment") ??
    Bun.env.FLIPT_ENVIRONMENT ??
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
  const expectedByKey = new Map(
    managedFlagInventory.flags.map((flag) => [flag.key, flag]),
  );
  const actualByKey = new Map(snapshot.flags.map((flag) => [flag.key, flag]));
  const errors: string[] = [];

  const expectedKeys = [...expectedByKey.keys()].sort();
  const actualKeys = [...actualByKey.keys()].sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    errors.push(
      `key set mismatch: expected ${expectedKeys.length}, got ${actualKeys.length}; missing=${expectedKeys.filter((key) => !actualByKey.has(key)).join(",") || "none"}; unexpected=${actualKeys.filter((key) => !expectedByKey.has(key)).join(",") || "none"}`,
    );
  }

  for (const expected of managedFlagInventory.flags) {
    const actual = actualByKey.get(expected.key);
    if (actual === undefined) continue;
    const actualType =
      actual.type === "BOOLEAN_FLAG_TYPE" ? "boolean" : "variant";
    if (actualType !== expected.type) {
      errors.push(
        `${expected.key}: expected type ${expected.type}, got ${actualType}`,
      );
      continue;
    }
    const actualDefault =
      expected.type === "boolean" ? actual.enabled : actual.defaultVariant?.key;
    if (actualDefault !== expectedDefault(expected)) {
      errors.push(
        `${expected.key}: expected default ${JSON.stringify(expectedDefault(expected))}, got ${JSON.stringify(actualDefault)}`,
      );
    }
    const actualRollouts = normalizeRollouts(actual.rollouts);
    if (JSON.stringify(actualRollouts) !== JSON.stringify(expected.rollouts)) {
      errors.push(
        `${expected.key}: rollout contract mismatch; expected ${JSON.stringify(expected.rollouts)}, got ${JSON.stringify(actualRollouts)}`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Flipt managed-flag drift detected:\n- ${errors.join("\n- ")}`,
    );
  }
  console.log(
    `Flipt managed-flag inventory is aligned: ${expectedKeys.length.toString()} keys in ${namespace}/${environment}`,
  );
}

await main();
