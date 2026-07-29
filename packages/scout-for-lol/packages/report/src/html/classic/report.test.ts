import { describe, expect, test } from "bun:test";
import { classicMatchFixture } from "#src/testing/classic-fixtures.ts";
import {
  CLASSIC_MATCH_BASE_HEIGHT,
  CLASSIC_MATCH_ROW_HEIGHT,
  CLASSIC_MATCH_WIDTH,
  classicMatchHeight,
} from "./report.tsx";

describe("Classic match report geometry", () => {
  test("uses the approved fixed width and roster-dependent height", () => {
    const match = classicMatchFixture();
    expect(CLASSIC_MATCH_WIDTH).toBe(1920);
    expect(classicMatchHeight(match)).toBe(
      CLASSIC_MATCH_BASE_HEIGHT +
        CLASSIC_MATCH_ROW_HEIGHT *
          (match.teams.blue.length + match.teams.red.length),
    );
    expect(classicMatchHeight(match)).toBe(1200);
  });
});
