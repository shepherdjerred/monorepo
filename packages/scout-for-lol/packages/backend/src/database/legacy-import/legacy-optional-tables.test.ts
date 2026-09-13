import { describe, expect, it } from "vitest";
import { assertPuuidRemapIsIntact } from "#src/database/legacy-import/legacy-optional-tables.ts";

describe("assertPuuidRemapIsIntact", () => {
  it("accepts a snapshot that never crossed key domains", () => {
    expect(() => {
      assertPuuidRemapIsIntact({ mapMissing: true, appliedCutovers: 0 });
    }).not.toThrow();
  });

  it("accepts an interrupted migration, which the phases resume", () => {
    expect(() => {
      assertPuuidRemapIsIntact({ mapMissing: false, appliedCutovers: 0 });
    }).not.toThrow();
  });

  it("accepts a completed migration carrying its map", () => {
    expect(() => {
      assertPuuidRemapIsIntact({ mapMissing: false, appliedCutovers: 1 });
    }).not.toThrow();
  });

  it("refuses an applied cutover whose map did not come with it", () => {
    // The combination that imports as a clean cutover while leaving the raw S3
    // corpus untranslatable. Only the retired key could rebuild the mapping.
    expect(() => {
      assertPuuidRemapIsIntact({ mapMissing: true, appliedCutovers: 1 });
    }).toThrow(/applied PUUID key cutover but has no/);
  });
});
