import { describe, expect, test } from "vitest";
import { DareParaphraseCategorySchema } from "@scout-for-lol/data";
import { darePlanSemanticIssues } from "#src/betting/dares/evaluation/dare-contract-compiler-v2.ts";
import { prepareDareDraftV2 } from "#src/betting/dares/lifecycle/dare-draft-v2.ts";
import { renderDarePlanV2 } from "#src/betting/dares/presentation/dare-render-v2.ts";
import { canonicalDarePlanJsonV2 } from "#src/betting/dares/evaluation/dare-plan-canonical-v2.ts";
import {
  dareTargetBindingsForAliases,
  loadDareParaphraseCorpus,
} from "#src/betting/dares/dare-v2-test-fixtures.ts";
const FIXED_NOW = new Date("2026-09-01T00:00:00.000Z");

function sha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

describe("Dare v2 paraphrase corpus", () => {
  test("covers every required semantic category", async () => {
    const corpus = await loadDareParaphraseCorpus();
    const covered = new Set(corpus.cases.flatMap((entry) => entry.categories));

    expect([...covered].sort()).toEqual(
      [...DareParaphraseCategorySchema.options].sort(),
    );
  });

  test("pins canonical plans and rendered meanings", async () => {
    const corpus = await loadDareParaphraseCorpus();

    for (const entry of corpus.cases) {
      const targets = dareTargetBindingsForAliases(entry.targetAliases);
      expect(darePlanSemanticIssues(entry.plan, targets), entry.id).toEqual([]);
      expect(sha256(canonicalDarePlanJsonV2(entry.plan)), entry.id).toBe(
        entry.expectedCanonicalSha256,
      );
      expect(renderDarePlanV2(entry.plan, targets), entry.id).toBe(
        entry.expectedMeaning,
      );

      const prepared = prepareDareDraftV2(
        {
          originalText: entry.paraphrases[0] ?? "",
          plan: entry.plan,
          targets,
          deadlineSpec: entry.deadlineSpec,
          openingStake: entry.openingStake,
        },
        FIXED_NOW,
      );
      expect(prepared.kind, entry.id).toBe("valid");
    }
  });
});
