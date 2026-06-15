import { z } from "zod/v4";
import { TimerStateSchema } from "#lib/timer/schemas.ts";

export const SessionTypeSchema = z.enum(["leetcode", "system-design"]);

export const SessionModeSchema = z.enum([
  "full",
  "text_ai",
  "minimal_ai",
  "offline",
]);

export const SessionStatusSchema = z.enum([
  "in-progress",
  "completed",
  "abandoned",
]);

export const SessionMetadataSchema = z.object({
  id: z.uuid(),
  type: SessionTypeSchema,
  questionId: z.uuid(),
  questionTitle: z.string(),
  difficulty: z.string(),
  status: SessionStatusSchema,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  currentPart: z.number().int().min(1),
  language: z.string(),
  workspacePath: z.string(),
  voiceEnabled: z.boolean(),
  mode: SessionModeSchema,
  timer: TimerStateSchema,
  hintsGiven: z.number().int(),
  testsRun: z.number().int(),
  editsGiven: z.number().int(),
  debugHelpsGiven: z.number().int(),
});

export type SessionType = z.infer<typeof SessionTypeSchema>;
export type SessionMode = z.infer<typeof SessionModeSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;
