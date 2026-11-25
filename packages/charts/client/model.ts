import { z } from "zod";
import type { Severity } from "@shepherdjerred/console-ui";

export const ChartKindSchema = z.enum(["first-party", "upstream"]);
export type ChartKind = z.infer<typeof ChartKindSchema>;

export type CatalogFilter = "all" | "first-party" | "upstream";

export type FixtureMode = "demo" | "empty";

export const ChartReleaseViewSchema = z.object({
  name: z.string(),
  version: z.string(),
  appVersion: z.string(),
  apiVersion: z.string(),
  description: z.string(),
  urls: z.array(z.string()).readonly(),
  digest: z.string(),
  created: z.string(),
  sizeBytes: z.number(),
  contentFingerprint: z.string().nullable(),
});
export type ChartReleaseView = z.infer<typeof ChartReleaseViewSchema>;

export const ChartSummaryItemSchema = z.object({
  name: z.string(),
  kind: ChartKindSchema,
  latestVersion: z.string(),
  latestAppVersion: z.string(),
  description: z.string(),
  releaseCount: z.number(),
  totalBytes: z.number(),
  latestDigest: z.string(),
  latestContentFingerprint: z.string().nullable(),
  latestCreated: z.string(),
  latestUrl: z.string(),
  releases: z.array(ChartReleaseViewSchema).readonly(),
});
export type ChartSummaryItem = z.infer<typeof ChartSummaryItemSchema>;

export const CatalogSummarySchema = z.object({
  chartCount: z.number(),
  releaseCount: z.number(),
  totalBytes: z.number(),
  quotaBytes: z.number(),
  catalogRevision: z.number(),
  charts: z.array(ChartSummaryItemSchema).readonly(),
});
export type CatalogSummary = z.infer<typeof CatalogSummarySchema>;

export type CatalogCounts = Readonly<Record<CatalogFilter, number>>;

export type UrlState = {
  readonly query: string;
  readonly filter: CatalogFilter;
  readonly fixture: FixtureMode | null;
  readonly expanded: ReadonlySet<string>;
};

const FIRST_PARTY_VERSION_RE = /^2\.0\.0-(\d+)$/u;

export function isFirstPartyVersion(version: string): boolean {
  return FIRST_PARTY_VERSION_RE.test(version);
}

export function computeCatalogCounts(
  charts: readonly ChartSummaryItem[],
): CatalogCounts {
  let firstParty = 0;
  let upstream = 0;
  for (const chart of charts) {
    if (chart.kind === "first-party") {
      firstParty += 1;
    } else {
      upstream += 1;
    }
  }
  return {
    all: charts.length,
    "first-party": firstParty,
    upstream,
  };
}

export function filterCharts(
  charts: readonly ChartSummaryItem[],
  filter: CatalogFilter,
  rawQuery: string,
): ChartSummaryItem[] {
  const query = rawQuery.trim().toLowerCase();
  return charts.filter((chart) => {
    if (filter !== "all" && chart.kind !== filter) {
      return false;
    }
    if (query === "") {
      return true;
    }
    const matchesTopLevel =
      chart.name.toLowerCase().includes(query) ||
      chart.description.toLowerCase().includes(query) ||
      chart.latestVersion.toLowerCase().includes(query) ||
      chart.latestAppVersion.toLowerCase().includes(query) ||
      chart.latestDigest.toLowerCase().includes(query) ||
      (chart.latestContentFingerprint?.toLowerCase().includes(query) ?? false);
    return (
      matchesTopLevel ||
      chart.releases.some(
        (release) =>
          release.version.toLowerCase().includes(query) ||
          release.digest.toLowerCase().includes(query) ||
          (release.contentFingerprint?.toLowerCase().includes(query) ?? false),
      )
    );
  });
}

export function latestBuildSummary(charts: readonly ChartSummaryItem[]): {
  readonly version: string;
  readonly hint?: string;
} {
  let bestBuild = -1;
  let bestVersion = "—";
  let bestChartName: string | undefined;

  for (const chart of charts) {
    const match = FIRST_PARTY_VERSION_RE.exec(chart.latestVersion);
    if (match === null) continue;
    const num = Number.parseInt(match[1] ?? "", 10);
    if (Number.isSafeInteger(num) && num > bestBuild) {
      bestBuild = num;
      bestVersion = chart.latestVersion;
      bestChartName = chart.name;
    }
  }

  return bestChartName === undefined
    ? { version: bestVersion }
    : { version: bestVersion, hint: bestChartName };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const unit = units[unitIndex] ?? "B";
  if (unitIndex === 0) {
    return `${String(Math.round(value))} ${unit}`;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${unit}`;
}

export function quotaMeterState(
  totalBytes: number,
  quotaBytes: number,
): {
  readonly severity: Severity;
  readonly percentText: string;
} {
  if (quotaBytes <= 0) {
    return { severity: "unknown", percentText: "0%" };
  }
  const ratio = (totalBytes / quotaBytes) * 100;
  const severity: Severity =
    ratio >= 90 ? "error" : ratio >= 75 ? "warning" : "ok";
  const percentText =
    ratio > 0 && ratio < 1 ? "<1%" : `${String(Math.round(ratio))}%`;
  return { severity, percentText };
}

export function shortDigest(digest: string): string {
  return digest.slice(0, 12);
}

export function shortFingerprint(fingerprint: string | null): string | null {
  if (fingerprint === null || fingerprint === "") {
    return null;
  }
  const clean = fingerprint.startsWith("sha256:")
    ? fingerprint.slice("sha256:".length)
    : fingerprint;
  return clean.slice(0, 12);
}

export function formatUtcTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(parsed.getUTCFullYear())}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())} ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())} UTC`;
}

export function parseCatalogFilter(raw: string | null): CatalogFilter {
  return raw === "first-party" || raw === "upstream" ? raw : "all";
}

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const query = params.get("q") ?? "";
  const filter = parseCatalogFilter(params.get("kind"));
  const rawFixture = params.get("fixture");
  const fixture: FixtureMode | null =
    rawFixture === "demo" || rawFixture === "empty" ? rawFixture : null;
  const rawExpand = params.get("expand") ?? "";
  const expanded = new Set(
    rawExpand
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== ""),
  );
  return { query, filter, fixture, expanded };
}

export function buildSearchSuffix(input: {
  readonly query: string;
  readonly filter: CatalogFilter;
  readonly fixture: FixtureMode | null;
}): string {
  const params = new URLSearchParams();
  if (input.fixture !== null) {
    params.set("fixture", input.fixture);
  }
  if (input.filter !== "all") {
    params.set("kind", input.filter);
  }
  const trimmedQuery = input.query.trim();
  if (trimmedQuery !== "") {
    params.set("q", trimmedQuery);
  }
  const serialized = params.toString();
  return serialized === "" ? "" : `?${serialized}`;
}

export function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function parseCatalogSummary(raw: unknown): CatalogSummary {
  return CatalogSummarySchema.parse(raw);
}
