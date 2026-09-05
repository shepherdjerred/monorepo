import {
  createDarePreviewLedger,
  dareContractNeedsPreview,
  darePreviewSummary,
  type DarePreviewSummaryInput,
} from "#src/explore/dare-draft-guardrails.ts";
import { dareValueDomainCatalog } from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";

describe("Dare authoring value-domain catalog", () => {
  // The model had no source of truth for these values anywhere — not the
  // prompt, not a tool description, not the JSON Schema. It inferred them, which
  // is how `team_position = 'MID'` reached three funded contracts.
  const catalog = dareValueDomainCatalog();

  test("publishes the lane values Riot actually records", () => {
    expect(catalog["team_position"]).toEqual([
      "TOP",
      "JUNGLE",
      "MIDDLE",
      "BOTTOM",
      "UTILITY",
    ]);
  });

  test("does not publish the spellings the model invented", () => {
    expect(catalog["team_position"]).not.toContain("MID");
    expect(catalog["team_position"]).not.toContain("SUPPORT");
    expect(catalog["event_type"]).not.toContain("DRAGON_KILL");
  });

  test("publishes the objective discriminators", () => {
    expect(catalog["monster_type"]).toContain("DRAGON");
    expect(catalog["monster_type"]).toContain("BARON_NASHOR");
    expect(catalog["building_type"]).toContain("TOWER_BUILDING");
  });

  // ~170 champion keys is not a useful thing to recite at an author, and the
  // registry resolves display names anyway.
  test("omits champions, which are resolved rather than listed", () => {
    expect(Object.keys(catalog)).not.toContain("champion_name");
  });
});

describe("Dare preview ledger", () => {
  test("gates a contract nobody previewed and clears one that was", () => {
    const ledger = createDarePreviewLedger();
    expect(dareContractNeedsPreview(ledger, "SELECT ... A")).toBe(true);
    ledger.record("SELECT ... A");
    expect(dareContractNeedsPreview(ledger, "SELECT ... A")).toBe(false);
  });

  // The revision bypass: previewing one contract must not clear a different
  // one, which is exactly what an author revising a funded dare produces.
  test("does not clear a different contract", () => {
    const ledger = createDarePreviewLedger();
    ledger.record("SELECT ... A");
    expect(dareContractNeedsPreview(ledger, "SELECT ... B")).toBe(true);
  });

  // A contract that did not compile is rejected by the domain call with its own
  // issues; telling the author to preview it would bury the real reason.
  test("does not demand a preview for a contract that did not compile", () => {
    const ledger = createDarePreviewLedger();
    expect(dareContractNeedsPreview(ledger, null)).toBe(false);
  });
});

function preview(
  overrides: Partial<DarePreviewSummaryInput>,
): DarePreviewSummaryInput {
  return {
    achieved: false,
    eligibleGames: 0,
    coverageComplete: true,
    evidence: [],
    ...overrides,
  };
}

describe("darePreviewSummary", () => {
  test("says an empty window proves nothing", () => {
    expect(darePreviewSummary(preview({ eligibleGames: 0 }))).toBe(
      "No retained eligible games were found in the preview window, so this preview says nothing about whether the dare can be satisfied.",
    );
  });

  test("reports satisfied games against distinct eligible matches", () => {
    const summary = darePreviewSummary(
      preview({
        achieved: true,
        eligibleGames: 4,
        evidence: [
          { matchId: "M1", matched: true },
          { matchId: "M2", matched: true },
          { matchId: "M3", matched: false },
          { matchId: "M4", matched: false },
        ],
      }),
    );
    expect(summary).toContain(
      "2 of 4 distinct eligible games satisfied at least one game set of this contract.",
    );
    expect(summary).toContain(
      "The contract itself evaluated to achieved over this window.",
    );
  });

  // The reported bug: evidence holds one row per (game set, match), so counting
  // rows against distinct eligible matches printed "4 of 2 eligible games".
  test("never claims more satisfied games than there are eligible games", () => {
    const summary = darePreviewSummary(
      preview({
        achieved: true,
        eligibleGames: 2,
        evidence: [
          { matchId: "M1", matched: true },
          { matchId: "M1", matched: true },
          { matchId: "M2", matched: true },
          { matchId: "M2", matched: true },
        ],
      }),
    );
    expect(summary).toContain(
      "2 of 2 distinct eligible games satisfied at least one game set of this contract.",
    );
    expect(summary).not.toContain("4 of 2");
  });

  test("counts a match once when only one of its game sets fired", () => {
    expect(
      darePreviewSummary(
        preview({
          eligibleGames: 2,
          evidence: [
            { matchId: "M1", matched: true },
            { matchId: "M1", matched: false },
            { matchId: "M2", matched: false },
            { matchId: "M2", matched: false },
          ],
        }),
      ),
    ).toContain(
      "1 of 2 distinct eligible games satisfied at least one game set of this contract.",
    );
  });

  // A null row means the match's timeline coverage was incomplete. Presenting
  // it as a failure manufactures the impossible-contract signal the guardrail
  // exists to detect honestly.
  test("reports unevaluable coverage instead of counting it as a failure", () => {
    const summary = darePreviewSummary(
      preview({
        achieved: null,
        eligibleGames: 3,
        coverageComplete: false,
        evidence: [
          { matchId: "M1", matched: true },
          { matchId: "M2", matched: null },
          { matchId: "M3", matched: false },
        ],
      }),
    );
    expect(summary).toContain(
      "1 of 3 distinct eligible games satisfied at least one game set of this contract.",
    );
    expect(summary).toContain(
      "1 of those games could not be evaluated because their timeline coverage is incomplete, so that count is a lower bound.",
    );
    expect(summary).toContain(
      "The contract itself could not be evaluated over this window.",
    );
  });

  test("prefers a satisfied game set over an unevaluable one for the same match", () => {
    const summary = darePreviewSummary(
      preview({
        eligibleGames: 1,
        coverageComplete: false,
        evidence: [
          { matchId: "M1", matched: null },
          { matchId: "M1", matched: true },
        ],
      }),
    );
    expect(summary).toContain(
      "1 of 1 distinct eligible games satisfied at least one game set of this contract.",
    );
    expect(summary).not.toContain("could not be evaluated because");
  });

  test("flags incomplete coverage even when no evidence row is unknown", () => {
    expect(
      darePreviewSummary(
        preview({
          eligibleGames: 2,
          coverageComplete: false,
          evidence: [
            { matchId: "M1", matched: true },
            { matchId: "M2", matched: false },
          ],
        }),
      ),
    ).toContain(
      "Timeline coverage is incomplete for at least one eligible game, so that count is a lower bound.",
    );
  });

  // The signal the whole guardrail exists for: a healthy sample that the
  // contract never once satisfied has to say so, not hedge.
  test("says loudly when nothing matched over a healthy sample", () => {
    const summary = darePreviewSummary(
      preview({
        achieved: false,
        eligibleGames: 12,
        evidence: Array.from({ length: 12 }, (_unused, index) => ({
          matchId: `M${index.toString()}`,
          matched: false,
        })),
      }),
    );
    expect(summary).toContain(
      "None of the 12 distinct eligible games satisfied any game set of this contract.",
    );
    expect(summary).toContain(
      "The contract itself evaluated to not achieved over this window.",
    );
    expect(summary).toContain(
      "Check the condition is achievable and spelled the way Riot records it before creating the dare.",
    );
  });

  test("does not tell the author to check a contract that did satisfy games", () => {
    expect(
      darePreviewSummary(
        preview({
          eligibleGames: 1,
          evidence: [{ matchId: "M1", matched: true }],
        }),
      ),
    ).not.toContain("Check the condition is achievable");
  });
});
