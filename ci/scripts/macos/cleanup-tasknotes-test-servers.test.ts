import { describe, expect, test } from "vitest";
import {
  commandHasCompleteRunMarker,
  completeRunMarkerPattern,
  tasknotesServerRunMarker,
} from "./cleanup-tasknotes-test-servers.ts";

describe("TaskNotes test server run markers", () => {
  const marker = "--tasknotes-server-ci-run=woodpecker-12";

  test("requires the complete run id at process argument boundaries", () => {
    expect(completeRunMarkerPattern(marker)).toBe(
      `(^|[[:space:]])${marker}([[:space:]]|$)`,
    );
    expect(commandHasCompleteRunMarker(`bun server.ts ${marker}`, marker)).toBe(
      true,
    );
    expect(
      commandHasCompleteRunMarker(
        "bun server.ts --tasknotes-server-ci-run=woodpecker-123",
        marker,
      ),
    ).toBe(false);
  });

  test("accepts only valid Woodpecker run identifiers", () => {
    expect(tasknotesServerRunMarker("woodpecker-12")).toBe(marker);
    expect(() => tasknotesServerRunMarker("woodpecker-0")).toThrow(
      "expected a Woodpecker TaskNotes run identifier",
    );
  });
});
