import { describe, expect, test } from "vitest";
import { DEMO_CATALOG_SUMMARY } from "./fixtures.ts";
import {
  buildSearchSuffix,
  computeCatalogCounts,
  filterCharts,
  formatBytes,
  isFirstPartyVersion,
  latestBuildSummary,
  parseCatalogSummary,
  parseUrlState,
  quotaMeterState,
  shortFingerprint,
} from "./model.ts";

describe("charts client model", () => {
  test("classifies first-party 2.0.0-N build versions vs upstream versions", () => {
    expect(isFirstPartyVersion("2.0.0-101844")).toBe(true);
    expect(isFirstPartyVersion("v1.21.2")).toBe(false);
    expect(isFirstPartyVersion("2.0.0-rc1")).toBe(false);
  });

  test("computes catalog counts and highest build summary", () => {
    const counts = computeCatalogCounts(DEMO_CATALOG_SUMMARY.charts);
    expect(counts).toEqual({
      all: 7,
      "first-party": 4,
      upstream: 3,
    });
    expect(latestBuildSummary(DEMO_CATALOG_SUMMARY.charts)).toEqual({
      version: "2.0.0-101844",
      hint: "delivery",
    });
    expect(latestBuildSummary([])).toEqual({ version: "—" });
  });

  test("filters by catalog kind and search query across retained releases", () => {
    const firstParty = filterCharts(
      DEMO_CATALOG_SUMMARY.charts,
      "first-party",
      "",
    );
    expect(firstParty.map((c) => c.name)).toEqual([
      "delivery",
      "flags",
      "golink",
      "scout-beta",
    ]);

    // Matches retained non-latest version `2.0.0-101831` on `delivery`.
    const byRetainedVersion = filterCharts(
      DEMO_CATALOG_SUMMARY.charts,
      "all",
      "101831",
    );
    expect(byRetainedVersion.map((c) => c.name)).toEqual(["delivery"]);

    // Matches content fingerprint substring.
    const byFingerprint = filterCharts(
      DEMO_CATALOG_SUMMARY.charts,
      "all",
      "90ab43e211cf",
    );
    expect(byFingerprint.map((c) => c.name)).toEqual(["golink"]);
  });

  test("formats byte units, quota severity, and URL query state", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(18_940)).toBe("18.5 KiB");
    expect(formatBytes(8_589_934_592)).toBe("8.00 GiB");

    expect(quotaMeterState(500_000, 8_589_934_592)).toEqual({
      severity: "ok",
      percentText: "<1%",
    });
    expect(quotaMeterState(80, 100)).toEqual({
      severity: "warning",
      percentText: "80%",
    });
    expect(quotaMeterState(95, 100)).toEqual({
      severity: "error",
      percentText: "95%",
    });

    const parsed = parseUrlState(
      "?fixture=demo&kind=upstream&q=cert&expand=delivery,golink",
    );
    expect(parsed.fixture).toBe("demo");
    expect(parsed.filter).toBe("upstream");
    expect(parsed.query).toBe("cert");
    expect([...parsed.expanded]).toEqual(["delivery", "golink"]);

    expect(
      buildSearchSuffix({
        query: " scout ",
        filter: "first-party",
        fixture: "demo",
      }),
    ).toBe("?fixture=demo&kind=first-party&q=scout");
    expect(buildSearchSuffix({ query: "", filter: "all", fixture: null })).toBe(
      "",
    );

    expect(shortFingerprint("sha256:0123456789abcdef9999")).toBe(
      "0123456789ab",
    );
    expect(shortFingerprint(null)).toBeNull();
  });

  test("validates CatalogSummary JSON payload strictly", () => {
    const roundTripped = parseCatalogSummary(
      structuredClone(DEMO_CATALOG_SUMMARY),
    );
    expect(roundTripped.chartCount).toBe(DEMO_CATALOG_SUMMARY.chartCount);
    expect(() => parseCatalogSummary({ invalid: true })).toThrow();
  });
});
