import type { Severity } from "@shepherdjerred/console-ui";
import type {
  NamespaceCounts,
  NamespaceFilter,
  SummaryEntry,
  SummaryNamespace,
  SummaryResponse,
} from "./types.ts";

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;
const KIB = 1024;

export const DEMO_NOW_SECS = 1_795_564_800;

export const DEMO_SUMMARY: SummaryResponse = {
  generatedAt: DEMO_NOW_SECS * 1000,
  quotaBytes: 1024 * GIB,
  highWatermarkBytes: 850 * GIB,
  lowWatermarkBytes: 780 * GIB,
  totalStoredBytes: Math.round(612.8 * GIB),
  totalEntries: 48_920,
  window24h: {
    hits: 38_420,
    misses: 2190,
    hitRate: 38_420 / (38_420 + 2190),
    bytesServed: Math.round(186.4 * GIB),
    bytesIngested: Math.round(14.2 * GIB),
    puts: 2145,
    evictions: 412,
  },
  namespaces: [
    {
      namespace: "turbo:monorepo",
      protocol: "turbo",
      entries: 18_450,
      storedBytes: Math.round(318.5 * GIB),
      ttlSeconds: 14 * 86_400,
      hits24h: 16_820,
      misses24h: 640,
      hitRate24h: 16_820 / (16_820 + 640),
      bytesServed24h: Math.round(98.2 * GIB),
      evictions24h: 180,
      lastAccessedAt: DEMO_NOW_SECS - 42,
    },
    {
      namespace: "turbo:monorepo-pull-request",
      protocol: "turbo",
      entries: 9620,
      storedBytes: Math.round(142.1 * GIB),
      ttlSeconds: 14 * 86_400,
      hits24h: 8140,
      misses24h: 890,
      hitRate24h: 8140 / (8140 + 890),
      bytesServed24h: Math.round(44.6 * GIB),
      evictions24h: 164,
      lastAccessedAt: DEMO_NOW_SECS - 115,
    },
    {
      namespace: "gradle:main",
      protocol: "gradle",
      entries: 4210,
      storedBytes: Math.round(18.4 * GIB),
      ttlSeconds: 30 * 86_400,
      hits24h: 3490,
      misses24h: 120,
      hitRate24h: 3490 / (3490 + 120),
      bytesServed24h: Math.round(9.8 * GIB),
      evictions24h: 12,
      lastAccessedAt: DEMO_NOW_SECS - 310,
    },
    {
      namespace: "sccache:trusted",
      protocol: "sccache",
      entries: 12_380,
      storedBytes: Math.round(96.2 * GIB),
      ttlSeconds: 30 * 86_400,
      hits24h: 7650,
      misses24h: 230,
      hitRate24h: 7650 / (7650 + 230),
      bytesServed24h: Math.round(25.1 * GIB),
      evictions24h: 18,
      lastAccessedAt: DEMO_NOW_SECS - 19,
    },
    {
      namespace: "sccache:pr",
      protocol: "sccache",
      entries: 4260,
      storedBytes: Math.round(37.6 * GIB),
      ttlSeconds: 14 * 86_400,
      hits24h: 2320,
      misses24h: 310,
      hitRate24h: 2320 / (2320 + 310),
      bytesServed24h: Math.round(8.7 * GIB),
      evictions24h: 38,
      lastAccessedAt: DEMO_NOW_SECS - 78,
    },
  ],
  largestEntries: [
    {
      namespace: "turbo:monorepo",
      protocol: "turbo",
      key: "scout-frontend-dist-0001",
      sizeBytes: Math.round(214.6 * MIB),
      sha256Hex: "0".repeat(64),
      hasSignatureTag: true,
      durationMs: 41_200,
      createdAt: DEMO_NOW_SECS - 36_000,
      lastAccessedAt: DEMO_NOW_SECS - 42,
      hitCount: 84,
    },
    {
      namespace: "turbo:monorepo-pull-request",
      protocol: "turbo",
      key: "design-system-dist-0002",
      sizeBytes: Math.round(182.3 * MIB),
      sha256Hex: "1".repeat(64),
      hasSignatureTag: true,
      durationMs: 36_850,
      createdAt: DEMO_NOW_SECS - 14_400,
      lastAccessedAt: DEMO_NOW_SECS - 115,
      hitCount: 19,
    },
    {
      namespace: "sccache:trusted",
      protocol: "sccache",
      key: "a4/9c/rustc-axum-rlib-0003",
      sizeBytes: Math.round(68.4 * MIB),
      sha256Hex: "2".repeat(64),
      hasSignatureTag: false,
      durationMs: null,
      createdAt: DEMO_NOW_SECS - 86_400,
      lastAccessedAt: DEMO_NOW_SECS - 19,
      hitCount: 142,
    },
    {
      namespace: "sccache:pr",
      protocol: "sccache",
      key: "1f/8b/rustc-tokio-rlib-0004",
      sizeBytes: Math.round(44.9 * MIB),
      sha256Hex: "3".repeat(64),
      hasSignatureTag: false,
      durationMs: null,
      createdAt: DEMO_NOW_SECS - 7200,
      lastAccessedAt: DEMO_NOW_SECS - 78,
      hitCount: 9,
    },
    {
      namespace: "gradle:main",
      protocol: "gradle",
      key: "storm-plugin-compile-0005",
      sizeBytes: Math.round(19.2 * MIB),
      sha256Hex: "4".repeat(64),
      hasSignatureTag: false,
      durationMs: null,
      createdAt: DEMO_NOW_SECS - 172_800,
      lastAccessedAt: DEMO_NOW_SECS - 310,
      hitCount: 63,
    },
  ],
  recentEntries: [
    {
      namespace: "sccache:trusted",
      protocol: "sccache",
      key: "a4/9c/rustc-axum-rlib-0003",
      sizeBytes: Math.round(68.4 * MIB),
      sha256Hex: "2".repeat(64),
      hasSignatureTag: false,
      durationMs: null,
      createdAt: DEMO_NOW_SECS - 86_400,
      lastAccessedAt: DEMO_NOW_SECS - 19,
      hitCount: 142,
    },
    {
      namespace: "turbo:monorepo",
      protocol: "turbo",
      key: "scout-frontend-dist-0001",
      sizeBytes: Math.round(214.6 * MIB),
      sha256Hex: "0".repeat(64),
      hasSignatureTag: true,
      durationMs: 41_200,
      createdAt: DEMO_NOW_SECS - 36_000,
      lastAccessedAt: DEMO_NOW_SECS - 42,
      hitCount: 84,
    },
    {
      namespace: "sccache:pr",
      protocol: "sccache",
      key: "1f/8b/rustc-tokio-rlib-0004",
      sizeBytes: Math.round(44.9 * MIB),
      sha256Hex: "3".repeat(64),
      hasSignatureTag: false,
      durationMs: null,
      createdAt: DEMO_NOW_SECS - 7200,
      lastAccessedAt: DEMO_NOW_SECS - 78,
      hitCount: 9,
    },
    {
      namespace: "turbo:monorepo-pull-request",
      protocol: "turbo",
      key: "design-system-dist-0002",
      sizeBytes: Math.round(182.3 * MIB),
      sha256Hex: "1".repeat(64),
      hasSignatureTag: true,
      durationMs: 36_850,
      createdAt: DEMO_NOW_SECS - 14_400,
      lastAccessedAt: DEMO_NOW_SECS - 115,
      hitCount: 19,
    },
    {
      namespace: "gradle:main",
      protocol: "gradle",
      key: "storm-plugin-compile-0005",
      sizeBytes: Math.round(19.2 * MIB),
      sha256Hex: "4".repeat(64),
      hasSignatureTag: false,
      durationMs: null,
      createdAt: DEMO_NOW_SECS - 172_800,
      lastAccessedAt: DEMO_NOW_SECS - 310,
      hitCount: 63,
    },
  ],
};

export function matchesNamespaceFilter(
  namespace: string,
  filter: NamespaceFilter,
): boolean {
  switch (filter) {
    case "overview":
      return true;
    case "turbo-main":
      return (
        namespace.startsWith("turbo:") && !namespace.endsWith("-pull-request")
      );
    case "turbo-pr":
      return (
        namespace.startsWith("turbo:") && namespace.endsWith("-pull-request")
      );
    case "gradle":
      return namespace === "gradle:main" || namespace.startsWith("gradle:");
    case "sccache-main":
      return namespace === "sccache:trusted";
    case "sccache-pr":
      return namespace === "sccache:pr";
  }
}

export function computeNamespaceGroupCounts(
  namespaces: readonly SummaryNamespace[],
): NamespaceCounts {
  let overview = 0;
  let turboMain = 0;
  let turboPr = 0;
  let gradle = 0;
  let sccacheMain = 0;
  let sccachePr = 0;

  for (const item of namespaces) {
    overview += item.entries;
    if (matchesNamespaceFilter(item.namespace, "turbo-main")) {
      turboMain += item.entries;
    } else if (matchesNamespaceFilter(item.namespace, "turbo-pr")) {
      turboPr += item.entries;
    } else if (matchesNamespaceFilter(item.namespace, "gradle")) {
      gradle += item.entries;
    } else if (matchesNamespaceFilter(item.namespace, "sccache-main")) {
      sccacheMain += item.entries;
    } else if (matchesNamespaceFilter(item.namespace, "sccache-pr")) {
      sccachePr += item.entries;
    }
  }

  return {
    overview,
    "turbo-main": turboMain,
    "turbo-pr": turboPr,
    gradle,
    "sccache-main": sccacheMain,
    "sccache-pr": sccachePr,
  };
}

export function filterNamespaces(
  namespaces: readonly SummaryNamespace[],
  filter: NamespaceFilter,
  query: string,
): SummaryNamespace[] {
  const needle = query.trim().toLowerCase();
  return namespaces.filter(
    (item) =>
      matchesNamespaceFilter(item.namespace, filter) &&
      (needle === "" ||
        item.namespace.toLowerCase().includes(needle) ||
        item.protocol.toLowerCase().includes(needle)),
  );
}

export function filterEntries(
  entries: readonly SummaryEntry[],
  filter: NamespaceFilter,
  query: string,
): SummaryEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      matchesNamespaceFilter(entry.namespace, filter) &&
      (needle === "" ||
        entry.key.toLowerCase().includes(needle) ||
        entry.namespace.toLowerCase().includes(needle) ||
        entry.protocol.toLowerCase().includes(needle) ||
        entry.sha256Hex.toLowerCase().includes(needle)),
  );
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * GIB) {
    const tib = bytes / (1024 * GIB);
    return `${tib.toFixed(tib >= 10 ? 0 : 2)} TiB`;
  }
  if (bytes >= GIB) {
    const gib = bytes / GIB;
    const rounded = Math.round(gib * 10) / 10;
    return Number.isInteger(rounded)
      ? `${String(rounded)} GiB`
      : `${rounded.toFixed(1)} GiB`;
  }
  if (bytes >= MIB) {
    const mib = bytes / MIB;
    const rounded = Math.round(mib * 10) / 10;
    return Number.isInteger(rounded)
      ? `${String(rounded)} MiB`
      : `${rounded.toFixed(1)} MiB`;
  }
  return bytes >= KIB
    ? `${(bytes / KIB).toFixed(1)} KiB`
    : `${String(Math.round(bytes))} B`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatTtlDays(seconds: number): string {
  const days = Math.round(seconds / 86_400);
  return `${String(days)}d`;
}

export function formatRelativeAge(
  epochSecs: number | null,
  nowMs: number,
): string {
  if (epochSecs === null || epochSecs <= 0) {
    return "never";
  }
  const diffSecs = Math.max(0, Math.floor(nowMs / 1000) - epochSecs);
  if (diffSecs < 60) {
    return `${String(diffSecs)}s ago`;
  }
  if (diffSecs < 3600) {
    return `${String(Math.floor(diffSecs / 60))}m ago`;
  }
  return diffSecs < 86_400
    ? `${String(Math.floor(diffSecs / 3600))}h ago`
    : `${String(Math.floor(diffSecs / 86_400))}d ago`;
}

export function hitRateSeverity(
  hits: number,
  misses: number,
  rate: number,
): Severity {
  if (hits + misses === 0) {
    return "unknown";
  }
  if (rate >= 0.85) {
    return "ok";
  }
  return rate >= 0.6 ? "info" : "warning";
}

export function storageWatermarkSeverity(
  storedBytes: number,
  lowWatermarkBytes: number,
  highWatermarkBytes: number,
): Severity {
  if (storedBytes >= highWatermarkBytes) {
    return "error";
  }
  return storedBytes >= lowWatermarkBytes ? "warning" : "ok";
}
