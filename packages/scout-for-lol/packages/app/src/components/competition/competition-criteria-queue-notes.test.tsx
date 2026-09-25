import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CompetitionCriteriaFields } from "#src/components/competition/competition-criteria-fields.tsx";

/**
 * The queue checkboxes are the last thing between someone and a competition
 * that can never score a game: League Classic is live and selectable, but Riot
 * publishes no finished-match payload for it, so a competition scoped to it
 * stays permanently empty. The warning is pinned here rather than reviewed by
 * eye — and so is its absence everywhere else, since a mode that is merely
 * quiet must not be labelled unscorable.
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
  test("warns that League Classic cannot be scored", () => {
    const markup = renderQueues("CLASSIC");
    // The checkbox label is the picker's own wording, not the queue value.
    expect(markup).toContain("<span>League Classic</span>");
    expect(markup).toContain(
      "Pre-match only — Riot publishes no results for this mode, so it cannot be scored",
    );
  });

  test("leaves Classic ARAM Mayhem unannotated beside it", () => {
    // Same variant, adjacent checkbox, opposite answer: queue 2450 has a
    // captured production Match-V5 payload. Exactly one note in this list.
    const markup = renderQueues("CLASSIC");
    expect(markup).toContain("<span>Classic ARAM Mayhem</span>");
    expect(markup.split("Pre-match only")).toHaveLength(2);
  });

  test("warns on ARAM Mayhem and ARAM Clash in the modern queue list", () => {
    // Live, popular and unscorable: beta watched 964 ARAM Mayhem games start
    // and received no result for any of them. ARAM Clash is the same shape:
    // prod watched 52 start and received 0 finished matches.
    const markup = renderQueues("MODERN");
    expect(markup).toContain("<span>ARAM Mayhem</span>");
    expect(markup).toContain("<span>ARAM Clash</span>");
    expect(markup.split("Pre-match only")).toHaveLength(3);
  });
});
