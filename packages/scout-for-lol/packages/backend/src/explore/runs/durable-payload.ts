import { z } from "zod";
import { ExploreSurfaceSchema } from "#src/explore/surface.ts";

/**
 * The `ScoutInteractiveRun.payload` of a durable `kind: "explore"` run.
 *
 * Shared by the writer (`explore/durable-runs.ts`) and the reader
 * (`temporal/interactive-activities.ts`) so a field cannot be added on one side
 * and silently dropped on the other. It is serialized into the database, which
 * is why every addition has to say what a row written before it means.
 */
export const ExploreDurablePayloadSchema = z.strictObject({
  summary: z.looseObject({ runId: z.uuid() }),
  started: z.strictObject({
    conversationId: z.uuid(),
    title: z.string(),
    messageId: z.uuid(),
    question: z.string(),
    expectedCurrentLeafId: z.uuid().nullable(),
    previousCurrentLeafId: z.uuid().nullable(),
    createdConversation: z.boolean(),
    createdQuestion: z.boolean(),
  }),
  guildIds: z.array(z.string()),
  /**
   * Rows written before this field existed carry no surface. Durable Explore
   * runs are enqueued from exactly one place — `run-manager-start.ts`, the web
   * run manager — so `"web"` restores what those rows already meant rather than
   * guessing at it. A Discord ask never becomes a durable run: it runs the turn
   * inline inside the interaction.
   */
  surface: ExploreSurfaceSchema.default("web"),
});
