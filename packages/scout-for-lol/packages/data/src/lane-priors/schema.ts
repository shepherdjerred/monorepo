import { z } from "zod";
import { LaneSchema } from "#src/model/lane.ts";

export const LanePriorVersionSchema = z.literal(1);

export const SpellPairKeySchema = z
  .string()
  .regex(/^\d+:\d+$/)
  .brand<"SpellPairKey">();

export type SpellPairKey = z.infer<typeof SpellPairKeySchema>;

export const LaneCountsSchema = z.strictObject({
  top: z.number().int().nonnegative(),
  jungle: z.number().int().nonnegative(),
  middle: z.number().int().nonnegative(),
  adc: z.number().int().nonnegative(),
  support: z.number().int().nonnegative(),
});

export type LaneCounts = z.infer<typeof LaneCountsSchema>;

export const LaneProbabilitiesSchema = z.strictObject({
  top: z.number().min(0).max(1),
  jungle: z.number().min(0).max(1),
  middle: z.number().min(0).max(1),
  adc: z.number().min(0).max(1),
  support: z.number().min(0).max(1),
});

export type LaneProbabilities = z.infer<typeof LaneProbabilitiesSchema>;

export const LanePriorEntrySchema = z.strictObject({
  total: z.number().int().positive(),
  counts: LaneCountsSchema,
  probabilities: LaneProbabilitiesSchema,
});

export type LanePriorEntry = z.infer<typeof LanePriorEntrySchema>;

export const ChampionLanePriorSchema = LanePriorEntrySchema.extend({
  championId: z.number().int().positive(),
});

export type ChampionLanePrior = z.infer<typeof ChampionLanePriorSchema>;

export const SpellPairLanePriorSchema = LanePriorEntrySchema.extend({
  spellPair: SpellPairKeySchema,
  spellIds: z.tuple([
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
  ]),
});

export type SpellPairLanePrior = z.infer<typeof SpellPairLanePriorSchema>;

export const LanePriorSourceSchema = z.strictObject({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  queueIds: z.array(z.number().int().positive()).min(1),
  matchCount: z.number().int().nonnegative(),
  participantCount: z.number().int().nonnegative(),
});

export type LanePriorSource = z.infer<typeof LanePriorSourceSchema>;

export const LanePriorArtifactSchema = z.strictObject({
  artifactVersion: LanePriorVersionSchema,
  generatedAt: z.iso.datetime({ offset: true }),
  source: LanePriorSourceSchema,
  champions: z.array(ChampionLanePriorSchema),
  spellPairs: z.array(SpellPairLanePriorSchema),
});

export type LanePriorArtifact = z.infer<typeof LanePriorArtifactSchema>;

export const LaneInferenceParticipantSchema = z.strictObject({
  participantKey: z.string().min(1),
  championId: z.number().int().positive(),
  spell1Id: z.number().int().nonnegative(),
  spell2Id: z.number().int().nonnegative(),
});

export type LaneInferenceParticipant = z.infer<
  typeof LaneInferenceParticipantSchema
>;

export const LaneAssignmentSchema = z.strictObject({
  participantKey: z.string().min(1),
  lane: LaneSchema,
  score: z.number(),
});

export type LaneAssignment = z.infer<typeof LaneAssignmentSchema>;

export const LaneInferenceResultSchema = z.strictObject({
  assignments: z.array(LaneAssignmentSchema).length(5),
  bestScore: z.number(),
  secondBestScore: z.number().nullable(),
});

export type LaneInferenceResult = z.infer<typeof LaneInferenceResultSchema>;
