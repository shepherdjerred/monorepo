import { z } from "zod";
import {
  DareCompiledPlanV2Schema,
  DARE_V2_PARAPHRASE_CORPUS_VERSION,
  DARE_V2_PROMPT_VERSION,
  DiscordAccountIdSchema,
  type DareTargetBindingV2,
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

export function resolveDareModelEvalTargets(input: {
  targetKeys: string[];
  targetAliases: Readonly<Record<string, string>>;
}): { targets: DareTargetBindingV2[]; issues: string[] } {
  const available = Object.entries(input.targetAliases).map(
    ([key, alias], index) => ({
      key,
      alias,
      discordId: DiscordAccountIdSchema.parse(
        `2000000000000000${index.toString()}`,
      ),
      playerId: index + 1,
      accounts: [
        {
          puuid: `${key}-eval-puuid`,
          trackingStartedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
  );
  const expectedKeys = available.map((target) => target.key);
  const issues: string[] = [];
  if (new Set(input.targetKeys).size !== input.targetKeys.length) {
    issues.push("Emitted target keys contain duplicates.");
  }
  if (JSON.stringify(input.targetKeys) !== JSON.stringify(expectedKeys)) {
    issues.push(
      "Emitted target keys drifted from the expected frozen targets.",
    );
  }
  const targets: DareTargetBindingV2[] = [];
  for (const key of input.targetKeys) {
    const target = available.find((candidate) => candidate.key === key);
    if (target === undefined) {
      issues.push(`Emitted target key ${key} is not available.`);
    } else {
      targets.push(target);
    }
  }
  return { targets, issues };
}
