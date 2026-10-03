import { describe, expect, test } from "vitest";
import {
  DareSqlCompilationSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { retainedDareDraftSemantics } from "#src/betting/dares/lifecycle/dare-draft.ts";
import { relationalDareActionEnabled } from "#src/betting/dares/dare-common.ts";
import { prisma } from "#src/database/index.ts";

describe("Dare rollout policy", () => {
  test("blocks new funding after disablement without blocking funded actions", async () => {
    const serverId = DiscordGuildIdSchema.parse("1337623164146155593");
    const dependencies = {
      prismaClient: prisma,
      isPolicyEnabled: (flag: string) =>
        Promise.resolve(flag === "betting_enabled"),
    };
    await expect(
      relationalDareActionEnabled(serverId, true, dependencies),
    ).resolves.toBe(false);
    await expect(
      relationalDareActionEnabled(serverId, false, dependencies),
    ).resolves.toBe(true);
  });

  test("retains competition and activation semantics across revisions", () => {
    const competition = {
      kind: "race",
      lanes: [
        { targetKey: "T1", gameSet: "t1_lane" },
        { targetKey: "T2", gameSet: "t2_lane" },
      ],
    } as const;
    const activation = {
      kind: "rank",
      queue: "solo",
      goal: { kind: "gain", normalizedLp: 50 },
    } as const;
    const compilation = DareSqlCompilationSchema.parse({
      compilerVersion: "dare-scoutql-3",
      canonicalSql: "SELECT FALSE AS achieved",
      immutableAst: "{}",
      queryHash: "a".repeat(64),
      maxEligibleGames: 100,
      facts: {
        cteCount: 2,
        joinedRelations: 0,
        predicates: 0,
        maxExpressionDepth: 1,
        physicalSources: ["match_participants"],
        functions: [],
        targetKeys: ["T1", "T2"],
      },
      resultStructure: {
        gameSets: [
          {
            name: "t1_lane",
            projectionColumns: [],
            targetDependencies: ["T1"],
          },
          {
            name: "t2_lane",
            projectionColumns: [],
            targetDependencies: ["T2"],
          },
        ],
      },
      finality: "deadline_only",
      competition,
      activation,
    });

    expect(retainedDareDraftSemantics(JSON.stringify(compilation))).toEqual({
      competition,
      activation,
    });
  });
});
