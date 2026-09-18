import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CompetitionCriteriaFields } from "#src/components/competition/competition-criteria-fields.tsx";

/**
 * The queue checkboxes are the last thing between someone and a competition
 * that can never score a game: ARAM Mayhem is live, so it is offered like any
 * other mode, but Riot publishes no results for it. A user already spent hours
 * discovering that by hand, so the warning is pinned here rather than reviewed
 * by eye.
 */

const noop = () => {
  /* render-only tests never submit */
};

const NO_ERRORS = {
  gameVariant: undefined,
  criteriaType: undefined,
  queues: undefined,
  aggregation: undefined,
  championId: undefined,
  minGames: undefined,
};

function renderQueues(gameVariant: "MODERN" | "CLASSIC"): string {
  return renderToStaticMarkup(
    <CompetitionCriteriaFields
      value={{
        criteriaType: "MOST_WINS_PLAYER",
        queues: ["ALL"],
        aggregation: "MAX",
        championId: "",
        minGames: "10",
      }}
      gameVariant={gameVariant}
      errors={NO_ERRORS}
      onChange={noop}
      onGameVariantChange={noop}
    />,
  );
}

describe("competition queue notes", () => {
  test("warns that ARAM Mayhem cannot be scored", () => {
    const markup = renderQueues("MODERN");
    // The checkbox label is the picker's own wording, not the queue value.
    expect(markup).toContain("<span>ARAM Mayhem</span>");
    expect(markup).toContain(
      "Pre-match only — Riot publishes no results for this mode, so it cannot be scored",
    );
  });

  test("warns on League Classic under the Classic variant", () => {
    expect(renderQueues("CLASSIC")).toContain("Pre-match only");
  });

  test("leaves scorable queues unannotated", () => {
    const markup = renderQueues("MODERN");
    // One note for ARAM Mayhem and nothing else: ARAM, solo and the rest all
    // produce results, and a blanket warning would train people to ignore it.
    expect(markup.split("Pre-match only")).toHaveLength(2);
  });
});
