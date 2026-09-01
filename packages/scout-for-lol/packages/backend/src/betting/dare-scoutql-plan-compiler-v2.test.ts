import { describe, expect, test } from "vitest";
import {
  DARE_V2_MAX_GAME_SETS,
  DareCompiledPlanV2Schema,
  DareParaphraseCorpusSchema,
  DiscordAccountIdSchema,
  type DareParaphraseCorpus,
  type DareTargetBindingV2,
} from "@scout-for-lol/data";
import { formatDareScoutQlV2 } from "#src/betting/dare-contract-compiler-v2.ts";
import { canonicalDarePlanJsonV2 } from "#src/betting/dare-plan-canonical-v2.ts";
import { compileDareScoutQlPlanV2 } from "#src/betting/dare-scoutql-plan-compiler-v2.ts";

const CORPUS_URL = new URL(
  "../../../data/src/model/dare-v2-paraphrase-corpus.json",
  import.meta.url,
);

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

describe("Dare v2 ScoutQL plan compiler", () => {
  test("round-trips every canonical plan in the paraphrase corpus", async () => {
    const corpus = await loadCorpus();

    for (const entry of corpus.cases) {
      const queryText = formatDareScoutQlV2(entry.plan);
      const result = await compileDareScoutQlPlanV2({
        queryText,
        targets: targetBindings(entry.targetAliases),
      });

      expect(result.kind, `${entry.id}: ${JSON.stringify(result)}`).toBe(
        "valid",
      );
      if (result.kind !== "valid") continue;
      expect(canonicalDarePlanJsonV2(result.compilation.plan), entry.id).toBe(
        canonicalDarePlanJsonV2(entry.plan),
      );
      const recompiled = await compileDareScoutQlPlanV2({
        queryText: result.compilation.canonicalScoutQl,
        targets: targetBindings(entry.targetAliases),
      });
      expect(recompiled.kind, entry.id).toBe("valid");
      if (recompiled.kind !== "valid") continue;
      expect(recompiled.compilation.planHash, entry.id).toBe(
        result.compilation.planHash,
      );
    }
  });

  test("turns a threshold edit into a new immutable plan", async () => {
    const corpus = await loadCorpus();
    const example = corpus.cases.find(
      (entry) => entry.id === "twisted_fate_same_game",
    );
    expect(example).toBeDefined();
    if (example === undefined) return;

    const originalQuery = formatDareScoutQlV2(example.plan);
    const editedQuery = originalQuery.replace(
      "dare_rate('T1', 'cs_per_minute') >= 8",
      "dare_rate('T1', 'cs_per_minute') >= 9",
    );
    const result = await compileDareScoutQlPlanV2({
      queryText: editedQuery,
      targets: targetBindings(example.targetAliases),
    });

    expect(editedQuery).not.toBe(originalQuery);
    expect(result.kind).toBe("valid");
    if (result.kind !== "valid") return;
    expect(result.compilation.plan.gameSets[0]?.predicate).toMatchObject({
      kind: "and",
      operands: expect.arrayContaining([
        expect.objectContaining({
          kind: "comparison",
          operator: "gte",
          threshold: 9,
        }),
      ]),
    });
  });

  test("rejects an edit that drops a frozen target", async () => {
    const corpus = await loadCorpus();
    const example = corpus.cases.find(
      (entry) => entry.id === "twisted_fate_same_game",
    );
    expect(example).toBeDefined();
    if (example === undefined) return;

    const result = await compileDareScoutQlPlanV2({
      queryText: formatDareScoutQlV2(example.plan),
      targets: targetBindings({ ...example.targetAliases, T2: "Bryan" }),
    });

    expect(result).toEqual({
      kind: "invalid",
      issues: ["Frozen target T2 is not used by any game set."],
    });
  });

  test("round-trips canonical division with its zero guard", async () => {
    const plan = DareCompiledPlanV2Schema.parse({
      version: 2,
      gameSets: [
        {
          name: "ratio_game",
          targetKeys: ["virmel"],
          relationship: "independent",
          queues: ["solo"],
          predicate: {
            kind: "comparison",
            value: {
              kind: "arithmetic",
              operator: "divide",
              left: {
                kind: "participant",
                target: "virmel",
                field: "kills",
              },
              right: { kind: "game", field: "duration_seconds" },
            },
            operator: "gte",
            threshold: 0.01,
          },
          projections: [],
          orderBy: "game_end_at_asc_match_id_asc",
          limit: 100,
        },
      ],
      result: {
        kind: "matching_games",
        gameSet: "ratio_game",
        operator: "gte",
        threshold: 1,
      },
      maxEligibleGames: 100,
    });

    const result = await compileDareScoutQlPlanV2({
      queryText: formatDareScoutQlV2(plan),
      targets: targetBindings({ virmel: "Virmel" }),
    });

    expect(result.kind, JSON.stringify(result)).toBe("valid");
    if (result.kind !== "valid") return;
    expect(canonicalDarePlanJsonV2(result.compilation.plan)).toBe(
      canonicalDarePlanJsonV2(plan),
    );
  });

  test("rejects valid SQL outside the immutable Dare profile", async () => {
    const corpus = await loadCorpus();
    const example = corpus.cases[0];
    expect(example).toBeDefined();
    if (example === undefined) return;

    const queryText = formatDareScoutQlV2(example.plan).replace(
      "ORDER BY game_end_at ASC, match_id ASC",
      "ORDER BY match_id ASC, game_end_at ASC",
    );
    const result = await compileDareScoutQlPlanV2({
      queryText,
      targets: targetBindings(example.targetAliases),
    });

    expect(result).toEqual({
      kind: "invalid",
      issues: [
        "Dare ScoutQL uses a valid SQL construct outside the versioned contract profile. Format the generated contract query and edit only its Dare expressions.",
      ],
    });
  });

  test("accepts the full twenty-game-set contract limit", async () => {
    const gameSets = Array.from(
      { length: DARE_V2_MAX_GAME_SETS },
      (_unused, index) => ({
        name: `games_${index.toString()}`,
        targetKeys: ["virmel"],
        relationship: "independent",
        queues: ["solo"],
        predicate: {
          kind: "comparison",
          value: {
            kind: "participant",
            target: "virmel",
            field: "kills",
          },
          operator: "gte",
          threshold: 1,
        },
        projections: [],
        orderBy: "game_end_at_asc_match_id_asc",
        limit: 100,
      }),
    );
    const plan = DareCompiledPlanV2Schema.parse({
      version: 2,
      gameSets,
      result: {
        kind: "or",
        operands: gameSets.map((gameSet) => ({
          kind: "matching_games",
          gameSet: gameSet.name,
          operator: "gte",
          threshold: 1,
        })),
      },
      maxEligibleGames: 100,
    });

    const result = await compileDareScoutQlPlanV2({
      queryText: formatDareScoutQlV2(plan),
      targets: targetBindings({ virmel: "Virmel" }),
    });

    expect(result.kind, JSON.stringify(result)).toBe("valid");
    if (result.kind !== "valid") return;
    expect(result.compilation.plan.gameSets).toHaveLength(
      DARE_V2_MAX_GAME_SETS,
    );
    expect(result.compilation.facts.cteCount).toBe(
      DARE_V2_MAX_GAME_SETS * 2 + 1,
    );
  });
});
