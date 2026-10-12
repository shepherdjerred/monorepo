import { z } from "zod";

export const GameEventKindSchema = z.enum([
  "faint",
  "whiteout",
  "badge",
  "evolution",
  "catch",
  "levelUp",
  "dexEntry",
]);

/** One in-game event worth telling everyone about. */
export type GameEventEntry = z.infer<typeof GameEventEntrySchema>;
export const GameEventEntrySchema = z.strictObject({
  id: z.string(),
  /** ISO 8601. */
  at: z.string(),
  event: GameEventKindSchema,
  title: z.string(),
  text: z.string(),
});

export type EventsResponse = z.infer<typeof EventsResponseSchema>;
export const EventsResponseSchema = z.strictObject({
  kind: z.literal("events"),
  /** The most recent events, oldest first. */
  value: z.array(GameEventEntrySchema),
});

export const InputSourceSchema = z.enum(["discord", "web"]);

/** One accepted command, and who sent it from where. */
export type InputRecord = z.infer<typeof InputRecordSchema>;
export const InputRecordSchema = z.strictObject({
  id: z.string(),
  /** ISO 8601. */
  at: z.string(),
  user: z.string(),
  source: InputSourceSchema,
  /** The chord as typed, e.g. `3a up`. */
  command: z.string(),
});

export type InputsResponse = z.infer<typeof InputsResponseSchema>;
export const InputsResponseSchema = z.strictObject({
  kind: z.literal("inputs"),
  /** The most recent inputs, oldest first. */
  value: z.array(InputRecordSchema),
});

/** Why the server did not run a command this client sent. */
export const InputRejectionSchema = z.enum([
  "no-session",
  "invalid",
  "goal-mode",
]);

export type InputResultResponse = z.infer<typeof InputResultResponseSchema>;
export const InputResultResponseSchema = z.strictObject({
  kind: z.literal("input-result"),
  value: z.discriminatedUnion("accepted", [
    z.strictObject({ accepted: z.literal(true), command: z.string() }),
    z.strictObject({
      accepted: z.literal(false),
      command: z.string(),
      reason: InputRejectionSchema,
    }),
  ]),
});
