import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  collectManagedSegmentPayloads,
  FLIPT_SEGMENT_TYPE_URL,
} from "./flipt-resource-payloads.ts";
import type { ManagedFlag } from "./managed-flag-inventory.ts";
import type { FliptFetcher } from "./managed-flag-drift.ts";

const SegmentPayloadSchema = z.object({
  "@type": z.literal(FLIPT_SEGMENT_TYPE_URL),
  key: z.string(),
  matchType: z.string(),
  constraints: z
    .array(
      z.object({
        type: z.string(),
        property: z.string(),
        operator: z.string(),
        value: z.string(),
      }),
    )
    .default([]),
});
const SegmentResourceSchema = z.object({
  resource: z.object({
    key: z.string(),
    namespaceKey: z.string(),
    payload: SegmentPayloadSchema,
  }),
  revision: z.string(),
});

function behavior(payload: z.infer<typeof SegmentPayloadSchema>) {
  return {
    matchType: payload.matchType,
    constraints: payload.constraints
      .map((constraint) => JSON.stringify(constraint))
      .sort(),
  };
}

/** Shared audiences are read-only prerequisites, including on an idempotent apply. */
export async function validateDeclaredSegments(options: {
  flags: readonly ManagedFlag[];
  endpoint: string;
  namespace: string;
  revision: string;
  fetcher: FliptFetcher;
}): Promise<void> {
  for (const expected of collectManagedSegmentPayloads(options.flags)) {
    const response = await options.fetcher(
      `${options.endpoint}/${encodeURIComponent(FLIPT_SEGMENT_TYPE_URL)}/${encodeURIComponent(expected.key)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok)
      throw new Error(
        `Cannot read rollout segment ${expected.key}: HTTP ${String(response.status)}`,
      );
    const current = SegmentResourceSchema.parse(await response.json());
    if (current.revision !== options.revision)
      throw new Error(
        "Flipt revision changed during segment preflight; read and plan again",
      );
    if (
      current.resource.namespaceKey !== options.namespace ||
      current.resource.key !== expected.key ||
      current.resource.payload.key !== expected.key
    )
      throw new Error(`Rollout segment identity differs for ${expected.key}`);
    if (
      !isDeepStrictEqual(
        behavior(current.resource.payload),
        behavior(SegmentPayloadSchema.parse(expected)),
      )
    )
      throw new Error(
        `Rollout segment behavior differs for ${expected.key}; shared segments were not modified`,
      );
  }
}
