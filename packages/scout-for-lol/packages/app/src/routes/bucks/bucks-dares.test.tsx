import {
  DareList,
  dareDisplayTitle,
  dareListStatusLines,
  dareListTitle,
} from "#src/components/bucks/dare-list.tsx";
import { Loaded } from "@shepherdjerred/loaded";
import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { DareProgressSchema } from "@scout-for-lol/data";
import {
  DareDetail,
  parseBucksDareId,
} from "#src/routes/bucks/bucks-dares.tsx";
import { formatDareEvidenceJson } from "#src/components/bucks/bucks-dare-progress.tsx";

const noAction = vi.fn();
const progress = DareProgressSchema.parse({
  value: false,
  final: false,
  finalityReason: "in_progress",
  matchedGames: 2,
  eligibleGames: 3,
  evidenceGames: 3,
  conditions: [
    {
      key: "0",
      kind: "matching_games",
      label: "wins: gte 3 matching games",
      targetKeys: ["virmel"],
      gameSet: "wins",
      operator: "gte",
      current: 2,
      target: 3,
      remaining: 1,
      matchedGames: 2,
      eligibleGames: 3,
      unknownGames: 0,
      value: false,
    },
  ],
  targets: [
    {
      targetKey: "virmel",
      conditionKeys: ["0"],
      matchedGames: 2,
      eligibleGames: 3,
      value: false,
    },
  ],
  coverageGaps: [],
  latestMaterialChange: null,
  summary: "1 remaining for wins: gte 3 matching games.",
});

describe("parseBucksDareId", () => {
  test("selects the list when the optional route segment is absent", () => {
    expect(parseBucksDareId(undefined)).toEqual({ kind: "list" });
  });

  test("selects a positive integer Dare deep link", () => {
    expect(parseBucksDareId("42")).toEqual({ kind: "detail", dareId: 42 });
  });

  test.each(["", "0", "-1", "1.5", "not-a-dare"])(
    "rejects invalid Dare id %s",
    (value) => {
      expect(parseBucksDareId(value)).toEqual({ kind: "invalid" });
    },
  );
});

test("renders skill sequence slots as Q W E R", () => {
  expect(
    formatDareEvidenceJson({ steps: [{ skill_slot: 1 }, { skill_slot: 4 }] }),
  ).toContain('"skill_slot": "Q"');
  expect(formatDareEvidenceJson({ skillSlot: 3 })).toContain(
    '"skillSlot": "E"',
  );
});

describe("dareDisplayTitle", () => {
  test("uses the challenger's wording and drops the stake suffix", () => {
    expect(
      dareDisplayTitle(
        "I bet Aaron can't win a game playing support in the next 7d\nOpening stake: 5 BB.",
      ),
    ).toBe("I bet Aaron can't win a game playing support in the next 7d");
  });
});

describe("dareListTitle", () => {
  test("prefers authored English over original wording", () => {
    expect(
      dareListTitle({
        displayTitle: "Aaron wins a game as support",
        originalText: "I bet Aaroncan't win a game playing support",
      }),
    ).toBe("Aaron wins a game as support");
  });
});

describe("dareListStatusLines", () => {
  test("phrases matching-game counts in English", () => {
    expect(
      dareListStatusLines(progress, "active").map((line) => line.text),
    ).toEqual(["2 of 3 wins"]);
    expect(
      dareListStatusLines(
        {
          ...progress,
          matchedGames: 0,
          conditions: progress.conditions.map((condition) => ({
            ...condition,
            current: 0,
            remaining: 1,
            matchedGames: 0,
            target: 1,
            gameSet: "support_win",
          })),
        },
        "active",
      ).map((line) => line.text),
    ).toEqual(["0 of 1 support win"]);
    expect(
      dareListStatusLines(progress, "active", { wins: "wins" }).map(
        (line) => line.text,
      ),
    ).toEqual(["2 of 3 wins"]);
    expect(
      dareListStatusLines(
        {
          ...progress,
          matchedGames: 0,
          conditions: progress.conditions.map((condition) => ({
            ...condition,
            current: 0,
            remaining: 1,
            matchedGames: 0,
            target: 1,
            gameSet: "games",
          })),
        },
        "active",
      ).map((line) => line.text),
    ).toEqual(["0 of 1 game"]);
    expect(
      dareListStatusLines(
        {
          ...progress,
          matchedGames: 0,
          conditions: progress.conditions.map((condition) => ({
            ...condition,
            current: 0,
            remaining: 1,
            matchedGames: 0,
            target: 1,
            gameSet: "qualifying_game",
          })),
        },
        "active",
        { qualifying_game: "game with a support win and 8 CS/min" },
      ).map((line) => line.text),
    ).toEqual(["0 of 1 game with a support win and 8 CS/min"]);
  });

  test("stacks one English line per live condition", () => {
    const wins = progress.conditions[0];
    if (wins === undefined) {
      throw new Error(
        "Progress fixture is missing its matching-games condition.",
      );
    }
    expect(
      dareListStatusLines(
        {
          ...progress,
          conditions: [
            wins,
            {
              ...wins,
              key: "1",
              gameSet: "farm",
              current: 0,
              target: 1,
              remaining: 1,
              matchedGames: 0,
              label: "farm: gte 1 matching games",
            },
          ],
        },
        "active",
        {
          wins: "wins",
          farm: "games with 8 CS/min",
        },
      ).map((line) => line.text),
    ).toEqual(["2 of 3 wins", "0 of 1 games with 8 CS/min"]);
  });

  test("names a finished outcome instead of restating compiler copy", () => {
    expect(
      dareListStatusLines(
        { ...progress, value: true, final: true },
        "achieved",
      ).map((line) => line.text),
    ).toEqual(["Achieved"]);
    expect(
      dareListStatusLines(
        { ...progress, value: false, final: true },
        "cancelled",
      ).map((line) => line.text),
    ).toEqual(["Cancelled"]);
    expect(
      dareListStatusLines(
        { ...progress, value: false, final: true },
        "expired",
      ).map((line) => line.text),
    ).toEqual(["Expired"]);
  });

  test("phrases rank and personal-best conditions in English", () => {
    const wins = progress.conditions[0];
    if (wins === undefined) {
      throw new Error(
        "Progress fixture is missing its matching-games condition.",
      );
    }
    expect(
      dareListStatusLines(
        {
          ...progress,
          conditions: [
            {
              ...wins,
              kind: "rank_progress",
              label: "T1 solo rank",
              gameSet: null,
              operator: "reach",
              current: "Gold II",
              target: "Diamond IV",
              remaining: null,
            },
          ],
        },
        "active",
      ).map((line) => line.text),
    ).toEqual(["Gold II, needs Diamond IV"]);
    expect(
      dareListStatusLines(
        {
          ...progress,
          conditions: [
            {
              ...wins,
              kind: "personal_improvement",
              label: "maximum cs_per_minute",
              gameSet: "attempts",
              operator: "higher",
              current: 7.2,
              target: 8,
              remaining: 0.8,
            },
          ],
        },
        "active",
        { attempts: "CS/min" },
      ).map((line) => line.text),
    ).toEqual(["Best 7.2 CS/min, needs 8"]);
  });
});

describe("DareList", () => {
  test("renders loading, error, and empty states", () => {
    expect(
      renderToStaticMarkup(
        <DareList
          dares={Loaded.loading()}
          onRetry={noAction}
          onSelect={noAction}
        />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <DareList
          dares={Loaded.failed(new Error("Dares could not load"))}
          onRetry={noAction}
          onSelect={noAction}
        />,
      ),
    ).toContain("Dares could not load");
    expect(
      renderToStaticMarkup(
        <DareList
          dares={Loaded.done([])}
          onRetry={noAction}
          onSelect={noAction}
        />,
      ),
    ).toContain("No dares match");
  });

  test("renders searchable list results with lifecycle and evidence", () => {
    const html = renderToStaticMarkup(
      <DareList
        dares={Loaded.done([
          {
            id: 7,
            state: "active",
            originalText:
              "I bet Aaron can't win a game playing support in the next 7d\nOpening stake: 5 BB.",
            displayTitle: null,
            statusPhrases: null,
            targetAliases: ["Aaron"],
            potTotal: 5,
            updatedAt: "2026-09-01T00:00:00.000Z",
            progress: {
              ...progress,
              matchedGames: 0,
              conditions: progress.conditions.map((condition) => ({
                ...condition,
                current: 0,
                remaining: 1,
                matchedGames: 0,
                target: 1,
                gameSet: "support_win",
              })),
            },
            requiresViewerAction: false,
          },
          {
            id: 42,
            state: "active",
            originalText:
              "I bet Virmel can't win three games\nOpening stake: 20 BB.",
            displayTitle: "Virmel wins three games",
            statusPhrases: { wins: "wins" },
            targetAliases: ["Virmel"],
            potTotal: 40,
            updatedAt: "2026-09-01T00:00:00.000Z",
            progress,
            requiresViewerAction: true,
          },
        ])}
        onRetry={noAction}
        onSelect={noAction}
      />,
    );
    expect(html).toContain("active");
    expect(html).toContain("playing support");
    expect(html).toContain("Aaron · 5 BB");
    expect(html).toContain("0 of 1 support win");
    expect(html).toContain("Virmel wins three games");
    expect(html).not.toContain("Opening stake: 20 BB.");
    expect(html).not.toContain("Dare #42");
    expect(html).not.toContain("evidence games");
    expect(html).not.toContain("gte");
    expect(html).toContain("Virmel · 40 BB");
    expect(html).toContain("2 of 3 wins");
  });
});

describe("DareDetail", () => {
  test("renders contract metadata, ScoutQL, evidence, and proof", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DareDetail
          guildId="100000000000000061"
          dare={{
            id: 42,
            state: "settled",
            originConversationId: null,
            currentRevision: 2,
            fundedRevision: 1,
            plainLanguage: "Virmel wins three games",
            canonicalScoutQl: "FROM matches RETURN count(*) >= 3",
            semanticProofPlan: "Count qualifying wins.",
            compilerVersion: "2",
            evaluatorVersion: "2",
            scoutQlPlanHash: "a".repeat(64),
            originalText: "Virmel wins three games",
            deadlineSpec: { kind: "relative", days: 7 },
            targetAliases: ["Virmel"],
            openingStake: 20,
            potTotal: 40,
            evidenceGames: 3,
            acceptDeadline: "2026-09-01T00:00:00.000Z",
            deadlineAt: "2026-09-08T00:00:00.000Z",
            finalValue: true,
            proof: { eligibleGames: 3 },
            voidReason: null,
            progress: { ...progress, value: true, final: true },
            viewerRoles: ["challenger"],
            availableActions: [],
            requiresViewerAction: false,
            processingHealth: {
              status: "healthy",
              pollStartedAt: "2026-09-01T00:00:00.000Z",
              pollCompletedAt: "2026-09-01T00:00:30.000Z",
              evidenceWatermarkAt: "2026-09-01T00:00:00.000Z",
              lastSuccessfulProcessingAt: "2026-09-01T00:00:30.000Z",
              failureReason: null,
              incompleteReasons: [],
            },
            activationHealth: null,
          }}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Dare #42");
    expect(html).toContain("settled");
    expect(html).toContain("Revision");
    expect(html).toContain("3 games");
    expect(html).toContain("Settlement proof");
    expect(html).toContain("eligibleGames");
    expect(html).not.toContain("Revise in Explore");
  });

  test("identifies canonical standard SQL as the binding v3 contract", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DareDetail
          guildId="100000000000000061"
          dare={{
            id: 43,
            state: "active",
            originConversationId: "conversation-43",
            currentRevision: 1,
            fundedRevision: 1,
            plainLanguage: "Virmel reaches at least 70% kill participation.",
            canonicalScoutQl:
              "SELECT COUNT(*) FILTER (WHERE matched) >= 1 AS achieved FROM games",
            semanticProofPlan: "The canonical SQL is binding.",
            compilerVersion: "dare-scoutql-3",
            evaluatorVersion: "dare-evaluator-3",
            scoutQlPlanHash: "b".repeat(64),
            originalText: "Virmel gets 70% KP in one game",
            deadlineSpec: { kind: "relative", days: 7 },
            targetAliases: ["Virmel"],
            openingStake: 20,
            potTotal: 40,
            evidenceGames: 1,
            acceptDeadline: null,
            deadlineAt: "2026-09-08T00:00:00.000Z",
            finalValue: null,
            proof: null,
            voidReason: null,
            progress,
            viewerRoles: ["target"],
            availableActions: [],
            requiresViewerAction: false,
            processingHealth: {
              status: "healthy",
              pollStartedAt: "2026-09-01T00:00:00.000Z",
              pollCompletedAt: "2026-09-01T00:00:30.000Z",
              evidenceWatermarkAt: "2026-09-01T00:00:00.000Z",
              lastSuccessfulProcessingAt: "2026-09-01T00:00:30.000Z",
              failureReason: null,
              incompleteReasons: [],
            },
            activationHealth: null,
          }}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Original wording: Virmel gets 70% KP in one game");
    expect(html).toContain("Binding SQL contract");
    expect(html).toContain("canonical SQL is authoritative");
  });
});
