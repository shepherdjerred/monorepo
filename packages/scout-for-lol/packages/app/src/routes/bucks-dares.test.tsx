import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { DareProgressSchema } from "@scout-for-lol/data";
import {
  DareDetail,
  DareList,
  parseBucksDareId,
} from "#src/routes/bucks-dares.tsx";

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

describe("DareList", () => {
  test("renders loading, error, and empty states", () => {
    expect(
      renderToStaticMarkup(
        <DareList
          loading
          error={null}
          dares={[]}
          onRetry={noAction}
          onSelect={noAction}
        />,
      ),
    ).toContain("Loading dares");
    expect(
      renderToStaticMarkup(
        <DareList
          loading={false}
          error={{ message: "Dares could not load" }}
          dares={[]}
          onRetry={noAction}
          onSelect={noAction}
        />,
      ),
    ).toContain("Dares could not load");
    expect(
      renderToStaticMarkup(
        <DareList
          loading={false}
          error={null}
          dares={[]}
          onRetry={noAction}
          onSelect={noAction}
        />,
      ),
    ).toContain("No dares match");
  });

  test("renders searchable list results with lifecycle and evidence", () => {
    const html = renderToStaticMarkup(
      <DareList
        loading={false}
        error={null}
        dares={[
          {
            id: 42,
            state: "active",
            plainLanguage: "Virmel wins three games",
            targetAliases: ["Virmel"],
            potTotal: 40,
            evidenceGames: 2,
            updatedAt: "2026-09-01T00:00:00.000Z",
            progress,
            requiresViewerAction: true,
          },
        ]}
        onRetry={noAction}
        onSelect={noAction}
      />,
    );
    expect(html).toContain("Dare #42");
    expect(html).toContain("active");
    expect(html).toContain("Virmel wins three games");
    expect(html).toContain("40 BB");
    expect(html).toContain("2 evidence games");
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
});
