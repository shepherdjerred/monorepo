import { describe, expect, test } from "bun:test";
import { zonesForQuery } from "#src/components/timezone-select.tsx";

const SELECTED_LABEL = "America/New_York (GMT-04:00)";

describe("zonesForQuery", () => {
  test("returns the whole catalog when the field still holds the selection", () => {
    // The combobox hides its popover on an empty list, so a resting field that
    // filtered its own label would never open on first focus.
    const zones = zonesForQuery(SELECTED_LABEL, SELECTED_LABEL);
    expect(zones.length).toBeGreaterThan(100);
    expect(zones.map((zone) => zone.id)).toContain("America/New_York");
  });

  test("returns the whole catalog for an empty query", () => {
    expect(zonesForQuery("   ", SELECTED_LABEL)).toEqual(
      zonesForQuery(SELECTED_LABEL, SELECTED_LABEL),
    );
  });

  test("matches a typed zone id case-insensitively", () => {
    const ids = zonesForQuery("los_ang", SELECTED_LABEL).map((zone) => zone.id);
    expect(ids).toEqual(["America/Los_Angeles"]);
  });

  test("matches the rendered offset, not only the id", () => {
    const zones = zonesForQuery("Tokyo (GMT", SELECTED_LABEL);
    expect(zones.map((zone) => zone.id)).toEqual(["Asia/Tokyo"]);
  });

  test("returns nothing for a query that matches no zone", () => {
    expect(zonesForQuery("not-a-zone", SELECTED_LABEL)).toEqual([]);
  });
});
