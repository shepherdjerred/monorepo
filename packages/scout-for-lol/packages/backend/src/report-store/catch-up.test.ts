import { describe, expect, test } from "bun:test";
import { calculateCatchUpRunCounts } from "#src/report-store/catch-up.ts";

describe("calculateCatchUpRunCounts", () => {
  test("uses the full summary when there is no saved progress baseline", () => {
    const runCounts = calculateCatchUpRunCounts(
      {
        scannedObjects: 4,
        importedObjects: 2,
        skippedObjects: 1,
        failedObjects: 1,
      },
      null,
    );

    expect(runCounts).toEqual({
      scannedObjects: 4,
      importedObjects: 2,
      skippedObjects: 1,
      failedObjects: 1,
    });
  });

  test("subtracts the saved progress baseline from cumulative summary counts", () => {
    const runCounts = calculateCatchUpRunCounts(
      {
        scannedObjects: 9,
        importedObjects: 5,
        skippedObjects: 3,
        failedObjects: 1,
      },
      {
        scannedObjects: 5,
        importedObjects: 3,
        skippedObjects: 1,
        failedObjects: 1,
      },
    );

    expect(runCounts).toEqual({
      scannedObjects: 4,
      importedObjects: 2,
      skippedObjects: 2,
      failedObjects: 0,
    });
  });
});
