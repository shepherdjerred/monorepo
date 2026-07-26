import { describe, expect, test } from "bun:test";
import {
  parseCodexSeverity,
  parseGreptileSeverity,
  parseSeverityLevel,
  severityFromLevel,
  severityLabel,
} from "./severity.ts";

describe("parseGreptileSeverity", () => {
  test("parses the alt attribute", () => {
    expect(
      parseGreptileSeverity(
        '<a href="#"><img alt="P2" src="https://x/badges/p2.svg?v=9"></a>',
      ),
    ).toBe(2);
  });
  test("parses the badge path", () => {
    expect(parseGreptileSeverity("see https://x/badges/p0.svg here")).toBe(0);
  });
  test("null when no badge", () => {
    expect(parseGreptileSeverity("plain comment, priority P1 in prose")).toBe(
      null,
    );
  });
  test("null body", () => {
    expect(parseGreptileSeverity(null)).toBe(null);
  });
});

describe("parseCodexSeverity", () => {
  test("parses the shields badge url", () => {
    expect(
      parseCodexSeverity(
        "**![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)  Title**",
      ),
    ).toBe(2);
  });
  test("parses the markdown alt text without a shields url", () => {
    expect(parseCodexSeverity("![P1 Badge](https://example/other.png)")).toBe(
      1,
    );
  });
  test("null when no badge", () => {
    expect(parseCodexSeverity("just a comment mentioning P3 casually")).toBe(
      null,
    );
  });
});

describe("parseSeverityLevel (generic, most-severe wins)", () => {
  test("matches greptile alt", () => {
    expect(parseSeverityLevel('alt="P2"')).toBe(2);
  });
  test("matches codex badge text", () => {
    expect(parseSeverityLevel("![P2 Badge](...) and P0 mentioned")).toBe(0);
  });
  test("null when absent", () => {
    expect(parseSeverityLevel("no severity here")).toBe(null);
  });
});

describe("labels", () => {
  test("severityLabel", () => {
    expect(severityLabel(2)).toBe("P2");
    expect(severityLabel(null)).toBe("P?");
  });
  test("severityFromLevel", () => {
    expect(severityFromLevel(0)).toBe("P0");
    expect(severityFromLevel(3)).toBe("P3");
    expect(severityFromLevel(null)).toBe(undefined);
  });
});
