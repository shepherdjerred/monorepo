import { z } from "zod";
import {
  DareCompiledPlanV2Schema,
  DARE_V2_PARAPHRASE_CORPUS_VERSION,
  DARE_V2_PROMPT_VERSION,
} from "@scout-for-lol/data";

export const DARE_V2_EVAL_MODEL = "gpt-5.6-luna";

const DareModelEvalCaseSchema = z.strictObject({
  id: z.string(),
  paraphrase: z.string(),
  passed: z.boolean(),
  expectedCanonicalSha256: z.string(),
  actualCanonicalSha256: z.string().nullable(),
  actualCanonicalPlan: DareCompiledPlanV2Schema.nullable(),
  expectedMeaning: z.string(),
  actualMeaning: z.string().nullable(),
  issues: z.array(z.string()),
});

export const DareModelEvalReportSchema = z.strictObject({
  version: z.literal(2),
  corpusVersion: z.literal(DARE_V2_PARAPHRASE_CORPUS_VERSION),
  promptVersion: z.literal(DARE_V2_PROMPT_VERSION),
  promptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  corpusSha256: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.literal(DARE_V2_EVAL_MODEL),
  generatedAt: z.iso.datetime(),
  passed: z.boolean(),
  cases: z.array(DareModelEvalCaseSchema).min(1),
});

export function dareModelEvalSha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}
