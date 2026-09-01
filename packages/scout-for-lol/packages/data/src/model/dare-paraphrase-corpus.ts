import { z } from "zod";
import {
  DareCompiledPlanV2Schema,
  DareDeadlineSpecV2Schema,
} from "#src/model/dare-contract-v2.ts";
import { BucksStakeSchema } from "#src/model/bryan-bucks.ts";

export const DARE_V2_PARAPHRASE_CORPUS_VERSION = 1;
export const DARE_V2_PROMPT_VERSION = "explore-dare-v2-2";

export const DareParaphraseCategorySchema = z.enum([
  "same_game",
  "separate_games",
  "nested_boolean",
  "target_relationship",
  "first_n",
  "queue",
  "dated_window",
  "aggregate",
  "timeline",
  "match_context",
  "item",
]);

export const DareParaphraseCorpusCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]+$/),
  categories: z.array(DareParaphraseCategorySchema).min(1),
  paraphrases: z.array(z.string().min(1)).min(1),
  targetAliases: z.record(z.string().min(1), z.string().min(1)),
  plan: DareCompiledPlanV2Schema,
  deadlineSpec: DareDeadlineSpecV2Schema,
  openingStake: BucksStakeSchema,
  expectedCanonicalSha256: z.string().regex(/^[a-f0-9]{64}$/),
  expectedMeaning: z.string().min(1),
});

export const DareParaphraseCorpusSchema = z.strictObject({
  $schema: z.string().min(1),
  version: z.literal(DARE_V2_PARAPHRASE_CORPUS_VERSION),
  promptVersion: z.literal(DARE_V2_PROMPT_VERSION),
  cases: z.array(DareParaphraseCorpusCaseSchema).min(1),
});

export type DareParaphraseCorpus = z.infer<typeof DareParaphraseCorpusSchema>;
