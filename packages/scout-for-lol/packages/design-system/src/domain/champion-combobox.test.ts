import { describe, expect, test } from "vitest";
import { syncedChampionQuery } from "./champion-combobox.tsx";

const aatrox = { key: "Aatrox", id: 266, name: "Aatrox" };
const ahri = { key: "Ahri", id: 103, name: "Ahri" };

describe("ChampionCombobox", () => {
  test("preserves an in-progress query when the controlled value clears", () => {
    expect(
      syncedChampionQuery({
        query: "Ahr",
        previous: aatrox,
        next: undefined,
      }),
    ).toBe("Ahr");
  });

  test("adopts explicit clears and new selections", () => {
    expect(
      syncedChampionQuery({
        query: "Aatrox",
        previous: aatrox,
        next: undefined,
      }),
    ).toBe("");
    expect(
      syncedChampionQuery({
        query: "Ahr",
        previous: aatrox,
        next: ahri,
      }),
    ).toBe("Ahri");
  });
});
