import { z } from "zod";

export type DareTruthValue = boolean | null;

export const DareMatchEvidenceV2Schema = z.strictObject({
  matchId: z.string().min(1),
  gameStartAt: z.iso.datetime(),
  gameEndAt: z.iso.datetime(),
  queue: z.string().min(1),
  candidateSets: z.record(z.string(), z.boolean()),
  setResults: z.record(z.string(), z.boolean().nullable()),
  setValues: z.record(z.string(), z.record(z.string(), z.number().nullable())),
  coverageState: z.enum(["complete", "missing", "not_required"]),
  targetDependencies: z.record(z.string(), z.array(z.string().min(1))),
  sourceReferences: z.array(z.string().min(1)),
  evaluationTrace: z.array(z.string()),
});

export type DareMatchEvidenceV2 = z.infer<typeof DareMatchEvidenceV2Schema>;
