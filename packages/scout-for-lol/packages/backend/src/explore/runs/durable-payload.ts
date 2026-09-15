import { z } from "zod";
import { DiscordChannelIdSchema } from "@scout-for-lol/data";
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
   * runs were previously enqueued only by the web surface, so `"web"` restores
   * what those rows already meant rather than guessing at it. Voice started
   * using this path only after the field existed.
   */
  surface: ExploreSurfaceSchema.default("web"),
  /** Discord channel metadata for mutation drafts; old and non-Discord rows have none. */
  originChannelId: DiscordChannelIdSchema.nullable().default(null),
});
