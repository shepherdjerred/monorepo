import { z } from "zod";
import { match } from "ts-pattern";
import {
  QueueTypeSchema,
  queueTypeToDisplayString,
  type QueueType,
} from "./state.ts";

// One filter dimension. Discriminated union keyed by `type`. Each variant is an
// ALLOW-LIST: a match passes the dimension iff its value is in the set. Add new
// dimensions (champion, role, win/loss) as additional members here — no DB
// migration is needed because the whole spec is stored as JSON.
export type QueueFilter = z.infer<typeof QueueFilterSchema>;
export const QueueFilterSchema = z.object({
  type: z.literal("queue"),
  // Non-empty on purpose: "no constraint" is the ABSENCE of the filter, never
  // an empty allow-list. This keeps notify-all semantics unambiguous.
  queues: z.array(QueueTypeSchema).min(1),
});

export type SubscriptionFilter = z.infer<typeof SubscriptionFilterSchema>;
export const SubscriptionFilterSchema = z.discriminatedUnion("type", [
  QueueFilterSchema,
]);

// Stored envelope. Versioned so future shape changes migrate in code (parse old
// version -> upgrade) instead of via a DB migration. At most one filter per
// `type`; distinct types are AND-ed together during evaluation.
export type SubscriptionFilterSpec = z.infer<
  typeof SubscriptionFilterSpecSchema
>;
export const SubscriptionFilterSpecSchema = z
  .object({
    version: z.literal(1),
    filters: z.array(SubscriptionFilterSchema),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>();
    for (const filter of spec.filters) {
      if (seen.has(filter.type)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate filter type: ${filter.type}`,
        });
      }
      seen.add(filter.type);
    }
  });

// The serialized, persisted form. Branded so the only way to obtain a value of
// this type is `serializeSubscriptionFilters` — an arbitrary string can never be
// written into the `Subscription.filters` column. Mirrors the branding style of
// DiscordChannelId / LeaguePuuid.
export type SerializedSubscriptionFilters = z.infer<
  typeof SerializedSubscriptionFiltersSchema
>;
export const SerializedSubscriptionFiltersSchema = z
  .string()
  .brand<"SerializedSubscriptionFilters">();

// The facts about a specific match, evaluated against a subscription's filters.
// Grow this as filter dimensions are added.
export type FilterMatchContext = {
  queueType: QueueType | undefined;
  // future: championIds?: number[]; roles?: Role[]; win?: boolean;
};

/**
 * Pure filter evaluation. AND across present filter types; a null or empty spec
 * means "notify all" (backward-compatible with subscriptions that never set a
 * filter).
 *
 * Note: an unknown queue (`ctx.queueType === undefined`, e.g. a brand-new Riot
 * queue id not yet mapped by `parseQueueType`) does NOT pass a queue filter.
 * This is deliberate — a solo-only filter shouldn't match an unrecognized queue
 * — but it means new queue ids are dropped for filtered subs until the mapping
 * is added. Subscriptions with no filter are unaffected.
 */
export function filtersPass(
  spec: SubscriptionFilterSpec | null,
  ctx: FilterMatchContext,
): boolean {
  if (spec === null || spec.filters.length === 0) {
    return true;
  }
  return spec.filters.every((filter) =>
    match(filter)
      .with(
        { type: "queue" },
        (queueFilter) =>
          ctx.queueType !== undefined &&
          queueFilter.queues.includes(ctx.queueType),
      )
      .exhaustive(),
  );
}

/**
 * The ONLY producer of a `SerializedSubscriptionFilters`. Its branded return is
 * assignable to the plain `string` Prisma expects, but a bare string is not
 * assignable to it — so the persistence layer can only ever receive a validated,
 * serialized spec.
 */
export function serializeSubscriptionFilters(
  spec: SubscriptionFilterSpec,
): SerializedSubscriptionFilters {
  return SerializedSubscriptionFiltersSchema.parse(JSON.stringify(spec));
}

/** The queues a spec allows (empty = no queue constraint / notify all). */
export function subscriptionFilterQueues(
  spec: SubscriptionFilterSpec | null,
): QueueType[] {
  if (spec === null) {
    return [];
  }
  return spec.filters.flatMap((filter) =>
    match(filter)
      .with({ type: "queue" }, (queueFilter) => queueFilter.queues)
      .exhaustive(),
  );
}

/** Short human-readable summary of a filter spec (e.g. for UI / replies). */
export function describeSubscriptionFilters(
  spec: SubscriptionFilterSpec | null,
): string {
  const queues = subscriptionFilterQueues(spec);
  if (queues.length === 0) {
    return "all queues";
  }
  return queues.map((queue) => queueTypeToDisplayString(queue)).join(", ");
}

/**
 * Reads the untrusted raw TEXT stored in the DB. FAIL-OPEN on malformed or
 * unknown data (returns null = notify all) so a corrupt blob never silently
 * swallows notifications; the caller may log the anomaly.
 */
export function parseSubscriptionFilters(
  raw: string | null | undefined,
): SubscriptionFilterSpec | null {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = SubscriptionFilterSpecSchema.safeParse(json);
  return result.success ? result.data : null;
}
