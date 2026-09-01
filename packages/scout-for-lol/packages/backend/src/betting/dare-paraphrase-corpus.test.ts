import { describe, expect, test } from "vitest";
import {
  DareParaphraseCategorySchema,
  DareParaphraseCorpusSchema,
  DiscordAccountIdSchema,
  type DareParaphraseCorpus,
  type DareTargetBindingV2,
} from "@scout-for-lol/data";
import { darePlanSemanticIssues } from "#src/betting/dare-contract-compiler-v2.ts";
import { prepareDareDraftV2 } from "#src/betting/dare-draft-v2.ts";
import { renderDarePlanV2 } from "#src/betting/dare-render-v2.ts";
import { canonicalDarePlanJsonV2 } from "#src/betting/dare-plan-canonical-v2.ts";

const CORPUS_URL = new URL(
  "../../../data/src/model/dare-v2-paraphrase-corpus.json",
  import.meta.url,
);
const FIXED_NOW = new Date("2026-09-01T00:00:00.000Z");

async function loadCorpus(): Promise<DareParaphraseCorpus> {
  const raw: unknown = await Bun.file(CORPUS_URL).json();
  return DareParaphraseCorpusSchema.parse(raw);
}

function targetBindings(
  targetAliases: Readonly<Record<string, string>>,
): DareTargetBindingV2[] {
  return Object.entries(targetAliases).map(([key, alias], index) => ({
    key,
    alias,
    discordId: DiscordAccountIdSchema.parse(
      `1000000000000000${index.toString()}`,
    ),
    playerId: index + 1,
    accounts: [
      {
        puuid: `${key}-frozen-puuid`,
        trackingStartedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  }));
}

function sha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

describe("Dare v2 paraphrase corpus", () => {
  test("covers every required semantic category", async () => {
    const corpus = await loadCorpus();
    const covered = new Set(corpus.cases.flatMap((entry) => entry.categories));

    expect([...covered].sort()).toEqual(
      [...DareParaphraseCategorySchema.options].sort(),
    );
  });

  test("pins canonical plans and rendered meanings", async () => {
    const corpus = await loadCorpus();

    for (const entry of corpus.cases) {
      const targets = targetBindings(entry.targetAliases);
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
