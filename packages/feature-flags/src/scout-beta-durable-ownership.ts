import { z } from "zod";
import { FLIPT_FLAG_TYPE_URL } from "./flipt-resource-payloads.ts";
import type { FliptFetcher } from "./managed-flag-drift.ts";

const MIGRATION_KEY = "scout_beta_durable_ownership_v1";
const FLAG_KEYS = [
  "initial_match_history_import_enabled",
  "scout_v2_progression_notifications_enabled",
] as const;
const FlagPayloadSchema = z.looseObject({
  "@type": z.literal(FLIPT_FLAG_TYPE_URL),
  key: z.string(),
  type: z.literal("BOOLEAN_FLAG_TYPE"),
  enabled: z.boolean().default(false),
  metadata: z.record(z.string(), z.string()).default({}),
  rules: z.array(z.unknown()).default([]),
  rollouts: z.array(z.unknown()).default([]),
});
const KnownRolloutsSchema = z.array(
  z.looseObject({
    type: z.literal("SEGMENT_ROLLOUT_TYPE"),
    segment: z.looseObject({
      value: z.literal(true),
      segments: z.array(z.literal("scout-guild-1337623164146155593")),
      segmentOperator: z.literal("OR_SEGMENT_OPERATOR"),
    }),
  }),
);
const ResourceSchema = z.object({
  resource: z.object({
    key: z.string(),
    namespaceKey: z.literal("scout"),
    payload: FlagPayloadSchema,
  }),
  revision: z.string().min(1),
});

/** Apply the two declared beta ownership switches once through the existing
 * inventory Activity. A revision guards each write. The metadata marker keeps
 * later operator pauses intact; arbitrary flag drift is never overwritten.
 * API contract: flipt v2.13.0 rpc/v2/environments/environments.proto. */
export async function applyScoutBetaDurableOwnership(input: {
  url: string;
  fetcher?: FliptFetcher;
}): Promise<string[]> {
  const fetcher = input.fetcher ?? fetch;
  const endpoint = `${input.url}/api/v2/environments/beta/namespaces/scout/resources`;
  const updated: string[] = [];
  for (const key of FLAG_KEYS) {
    const response = await fetcher(
      `${endpoint}/${encodeURIComponent(FLIPT_FLAG_TYPE_URL)}/${key}`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok)
      throw new Error(
        `Cannot read beta ownership flag ${key}: HTTP ${response.status.toString()}`,
      );
    const current = ResourceSchema.parse(await response.json());
    const payload = current.resource.payload;
    if (current.resource.key !== key || payload.key !== key)
      throw new Error(`Beta ownership resource identity differs for ${key}`);
    if (payload.metadata[MIGRATION_KEY] === "applied") continue;
    KnownRolloutsSchema.parse(payload.rollouts);
    if (
      payload.rules.length > 0 ||
      (key === FLAG_KEYS[0] && payload.rollouts.length > 0)
    )
      throw new Error(
        `Unexpected targeting on beta ownership flag ${key}; refusing to overwrite it`,
      );
    const result = await fetcher(endpoint, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        environmentKey: "beta",
        namespaceKey: "scout",
        key,
        revision: current.revision,
        payload: {
          ...payload,
          enabled: true,
          metadata: { ...payload.metadata, [MIGRATION_KEY]: "applied" },
        },
      }),
    });
    if (!result.ok)
      throw new Error(
        `Cannot apply beta ownership flag ${key}: HTTP ${result.status.toString()}`,
      );
    const applied = ResourceSchema.parse(await result.json());
    if (applied.resource.key !== key || applied.resource.payload.key !== key)
      throw new Error(
        `Applied beta ownership resource identity differs for ${key}`,
      );
    updated.push(key);
  }
  return updated;
}
