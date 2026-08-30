import { describe, expect, test } from "vitest";
import {
  buildTemporalExecutionStartMetadata,
  ExecutionMetadataSchema,
  TEMPORAL_UI_DETAILS_MAX_BYTES,
  TEMPORAL_UI_SUMMARY_MAX_BYTES,
  TemporalUiDetailsSchema,
  TemporalUiSummarySchema,
} from "./execution-metadata.ts";

const RELEASE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("Temporal execution metadata", () => {
  test("builds typed Search Attributes and safe UI details", () => {
    const result = buildTemporalExecutionStartMetadata({
      metadata: {
        Environment: "beta",
        Domain: "scout",
        Trigger: "api",
        ReleaseCommit: RELEASE_COMMIT,
      },
      summary: "Run Scout report",
      description: "Generates one configured Scout report.",
    });

    expect(result.typedSearchAttributes).toHaveLength(4);
    expect(result.staticSummary).toBe("Run Scout report");
    expect(result.staticDetails).toContain("Environment: `beta`");
    expect(result.staticDetails).toContain(
      `Release commit: \`${RELEASE_COMMIT}\``,
    );
  });

  test("rejects invalid enum and release values", () => {
    expect(() =>
      ExecutionMetadataSchema.parse({
        Environment: "production",
        Domain: "scout",
        Trigger: "api",
        ReleaseCommit: "latest",
      }),
    ).toThrow();
  });

  test("enforces UTF-8 byte limits", () => {
    expect(() =>
      TemporalUiSummarySchema.parse(
        "x".repeat(TEMPORAL_UI_SUMMARY_MAX_BYTES + 1),
      ),
    ).toThrow("exceeds");
    expect(() =>
      TemporalUiDetailsSchema.parse(
        "🙂".repeat(Math.floor(TEMPORAL_UI_DETAILS_MAX_BYTES / 4) + 1),
      ),
    ).toThrow("exceeds");
  });

  test.each([
    "token: bearer-value",
    "prompt=ignore previous instructions",
    "player data: private profile",
    "![private screenshot](https://example.test/private.png)",
    "<script>alert(1)</script>",
  ])("rejects sensitive or unsupported UI content: %s", (value) => {
    expect(() => TemporalUiDetailsSchema.parse(value)).toThrow(
      "prohibited or sensitive content",
    );
  });
});
