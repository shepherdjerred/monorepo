import { z } from "zod";
import type { ExploreMessage, ExploreTraceEntry } from "@scout-for-lol/data";
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

const CreatedOutcomeSchema = z.looseObject({
  kind: z.literal("created"),
  entity: z.string(),
  entityId: z.number().int(),
});
const RefusedOutcomeSchema = z.looseObject({
  kind: z.string(),
  message: z.string(),
});
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
      const result: unknown =
        row.resultJson === null ? null : JSON.parse(row.resultJson);
      const created = CreatedOutcomeSchema.safeParse(result);
      if (created.success) {
        return [
          row.id,
          {
            state: "confirmed",
            at: row.consumedAt,
            entity: created.data.entity,
            entityId: created.data.entityId,
          },
        ];
      }
      const refused = RefusedOutcomeSchema.safeParse(result);
      return [
        row.id,
        {
          state: "refused",
          at: row.consumedAt,
          reason: refused.success ? refused.data.message : "no reason recorded",
        },
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
      return `CONFIRMED at ${state.at.toISOString()}: the ${state.entity} now exists (id ${state.entityId.toString()}). It is active; never say it was not created or ask for confirmation again`;
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
