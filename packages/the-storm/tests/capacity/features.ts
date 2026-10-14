import { z } from "zod";
import {
  rwfFeatureFlags,
  setRwfFeatures,
  type RwfFeature,
} from "#e2e/harness/fake-brain.ts";
import { rwfTestSettings } from "#e2e/harness/rwf-settings.ts";
import type { E2eProfile } from "#e2e/gameplay-fixtures.ts";

const enabled: RwfFeature[] = [
  "the-storm-rwf-match-flow-enabled",
  "the-storm-rwf-host-settings-enabled",
  "the-storm-rwf-candidate-visits-enabled",
];
const Evaluation = z.strictObject({
  key: z.enum(rwfFeatureFlags),
  enabled: z.boolean(),
});
export const CapacityFeatureReceiptSchema = z
  .strictObject({
    source: z.literal("private-flipt-test-double"),
    appliesBeforeBoot: z.literal(true),
    configuredAt: z.number().int().positive(),
    previous: z.array(z.enum(rwfFeatureFlags)),
    enabled: z.array(z.enum(rwfFeatureFlags)),
    evaluations: z.array(Evaluation).length(rwfFeatureFlags.length),
  })
  .superRefine((receipt, context) => {
    const selected = new Set(receipt.enabled);
    const evaluated = new Map(
      receipt.evaluations.map((entry) => [entry.key, entry.enabled]),
    );
    if (
      selected.size !== enabled.length ||
      selected.size !== receipt.enabled.length ||
      enabled.some((key) => !selected.has(key)) ||
      evaluated.size !== rwfFeatureFlags.length ||
      rwfFeatureFlags.some(
        (key) => evaluated.get(key) !== enabled.includes(key),
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "Capacity feature readback differs from the explicit preboot candidate",
      });
  });
export type CapacityFeatureReceipt = z.infer<
  typeof CapacityFeatureReceiptSchema
>;

/** Enables and reads back the exact private capacity flags before Paper can open its first lobby. */
export async function configureCapacityFeatures(
  profile: E2eProfile,
  port: number,
): Promise<CapacityFeatureReceipt | null> {
  if (profile !== "capacity") return null;
  const host = z
    .enum(["127.0.0.1", "localhost"])
    .parse(Bun.env["STORM_E2E_BRAIN_HOST"] ?? "127.0.0.1");
  const previous = await setRwfFeatures(port, enabled);
  const evaluations = await Promise.all(
    rwfFeatureFlags.map(async (key) => {
      const response = await fetch(
        `http://${host}:${port.toString()}/evaluate/v1/boolean`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-flipt-environment": "prod",
          },
          body: JSON.stringify({
            namespace_key: "the-storm",
            flag_key: key,
            entity_id: "the-storm-rwf-features",
            context: { world: rwfTestSettings.world },
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          `Capacity feature readback failed: ${response.status.toString()}`,
        );
      const actual = z
        .strictObject({ enabled: z.boolean() })
        .parse(await response.json());
      return { key, enabled: actual.enabled };
    }),
  );
  return CapacityFeatureReceiptSchema.parse({
    source: "private-flipt-test-double",
    appliesBeforeBoot: true,
    configuredAt: Date.now(),
    previous,
    enabled,
    evaluations,
  });
}
