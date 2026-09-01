import { describe, expect, test } from "vitest";
import { visibleDareScoutQlV2 } from "#src/betting/dare-view-v2.ts";
import { TWISTED_FATE_SAME_GAME_PLAN } from "#src/betting/dare-v2-test-fixtures.ts";

describe("Dare v2 draft inspection", () => {
  test("regenerates current editable ScoutQL from a stored semantic plan", () => {
    const query = visibleDareScoutQlV2({
      state: "draft",
      plan: TWISTED_FATE_SAME_GAME_PLAN,
      storedCanonicalScoutQl: "legacy expanded ScoutQL",
    });

    expect(query).toContain("dare_rate('virmel', 'cs_per_minute') >= 8");
    expect(query).toContain("dare_matching_games('qualifying_game', 'gte', 1)");
    expect(query).not.toContain("legacy expanded ScoutQL");
  });

  test("preserves the immutable funded query", () => {
    expect(
      visibleDareScoutQlV2({
        state: "active",
        plan: TWISTED_FATE_SAME_GAME_PLAN,
        storedCanonicalScoutQl: "immutable funded ScoutQL",
      }),
    ).toBe("immutable funded ScoutQL");
  });
});
