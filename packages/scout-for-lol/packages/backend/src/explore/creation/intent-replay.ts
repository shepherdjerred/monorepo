import { z } from "zod";
import {
  DiscordGuildIdSchema,
  type ExploreMessage,
  type ExploreTraceEntry,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { CreationPrepareResultSchema } from "#src/explore/creation/schemas.ts";

/**
 * What happened to the confirmation cards earlier turns showed.
 *
 * History replays an assistant turn's prose, and that prose always says
 * "nothing has been created yet" — true when it was written. The card's fate
 * lives only on the intent row, so a later turn could not know it. In prod a
 * user confirmed a report, typed "Confirm" twice more, and was told both times
 * that nothing had been created. Each replayed turn now carries its cards'
 * current state.
 */

export type CreationIntentState =
  | { readonly state: "pending"; readonly expiresAt: Date }
  | { readonly state: "expired"; readonly expiresAt: Date }
  | {
      readonly state: "confirmed";
      readonly at: Date;
      readonly entity: string;
      readonly entityId: number;
    }
  | { readonly state: "refused"; readonly at: Date; readonly reason: string };

/**
 * What a confirmation stores when it is consumed: the created entity, or the
 * refusal it met. Closed on every discriminant — an outcome the confirm path
 * never writes is a broken producer, not a refusal to report.
 */
export const CreationStoredOutcomeSchema = z.union([
  z.strictObject({
    kind: z.literal("created"),
    entity: z.enum(["report", "subscription", "competition"]),
    entityId: z.number().int(),
    guildId: DiscordGuildIdSchema,
  }),
  z.strictObject({
    kind: z.enum([
      "limit_reached",
      "invalid_query",
      "invalid_configuration",
      "rate_limited",
      "missing_permission",
      "account_already_subscribed",
      "subscription_already_exists",
      "riot_id_not_found",
    ]),
    message: z.string(),
  }),
]);

const PreparedOutputSchema = z.looseObject({
  kind: z.literal("value"),
  value: CreationPrepareResultSchema,
});

/** Each card a turn prepared, in order, with what it said it would create. */
export function preparedIntents(
  trace: readonly ExploreTraceEntry[],
): readonly { readonly intentId: string; readonly summary: string }[] {
  return trace.flatMap((entry) => {
    if (entry.status !== "succeeded") return [];
    const parsed = PreparedOutputSchema.safeParse(entry.rawOutput);
    const intent = parsed.success ? parsed.data.value.intent : null;
    return intent === null
      ? []
      : [{ intentId: intent.intentId, summary: intent.summary }];
  });
}

/** The current state of every card the replayed history prepared. */
export async function loadCreationIntentStates(
  db: ExtendedPrismaClient,
  history: readonly ExploreMessage[],
  now: Date,
): Promise<ReadonlyMap<string, CreationIntentState>> {
  const ids = history.flatMap((message) =>
    preparedIntents(message.trace).map((intent) => intent.intentId),
  );
  if (ids.length === 0) return new Map();
  const rows = await db.confirmationIntent.findMany({
    where: { id: { in: ids } },
    select: { id: true, consumedAt: true, expiresAt: true, resultJson: true },
  });
  return new Map(
    rows.map((row): [string, CreationIntentState] => {
      if (row.consumedAt === null) {
        return [
          row.id,
          row.expiresAt.getTime() <= now.getTime()
            ? { state: "expired", expiresAt: row.expiresAt }
            : { state: "pending", expiresAt: row.expiresAt },
        ];
      }
      // Every consumed row is written by the confirm path in one of these
      // shapes; anything else throws rather than reading as a refusal.
      const outcome = CreationStoredOutcomeSchema.parse(
        row.resultJson === null ? null : JSON.parse(row.resultJson),
      );
      return [
        row.id,
        outcome.kind === "created"
          ? {
              state: "confirmed",
              at: row.consumedAt,
              entity: outcome.entity,
              entityId: outcome.entityId,
            }
          : { state: "refused", at: row.consumedAt, reason: outcome.message },
      ];
    }),
  );
}

function describeState(state: CreationIntentState | undefined): string {
  if (state === undefined) return "its status is unknown";
  switch (state.state) {
    case "pending": {
      return `still waiting for confirmation until ${state.expiresAt.toISOString()}`;
    }
    case "expired": {
      return "expired unconfirmed, so it was never created; it must be prepared again";
    }
    case "confirmed": {
      return `CONFIRMED at ${state.at.toISOString()}: it created the ${state.entity} (id ${state.entityId.toString()}). Never say it was not created or ask for this card to be confirmed again. That is a past event: it may since have been edited or removed, so read the server's setup before saying it is active now`;
    }
    case "refused": {
      return `confirmation was refused at ${state.at.toISOString()}: ${state.reason}`;
    }
  }
}

/** The `[Confirmation cards]` block appended to a replayed assistant turn. */
export function creationIntentReplayContext(
  trace: readonly ExploreTraceEntry[],
  states: ReadonlyMap<string, CreationIntentState>,
): string {
  const intents = preparedIntents(trace);
  if (intents.length === 0) return "";
  const lines = intents.map(
    (intent) =>
      `- ${intent.summary} — ${describeState(states.get(intent.intentId))}.`,
  );
  return `\n\n[Confirmation cards, current state]\n${lines.join("\n")}`;
}
