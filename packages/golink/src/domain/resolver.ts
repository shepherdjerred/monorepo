import {
  normalizeShortSlug,
  RESERVED_SLUGS,
  validateShortSlug,
  type DynamicLinkKind,
  type LinkItem,
  type LinkKind,
  type ShadowedLink,
  type ShortcutSpec,
} from "#shared/contract.ts";
import type { PlatformSiteEntry } from "./platform-sites.ts";
import {
  builtinShortcuts,
  FIXED_SHORTCUT_BASES,
  forwardSubpathAndQuery,
  parseSafeHttpUrl,
  resolveShortcut,
} from "./shortcuts.ts";

export type ManualLinkRecord = {
  readonly short: string;
  readonly targetUrl: string;
  readonly createdBy: string;
  readonly clicks: number;
  readonly lastClickedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type ResolverCatalogOptions = {
  readonly manualLinks: readonly ManualLinkRecord[];
  readonly ingressHosts: readonly string[];
  readonly platformSites: readonly PlatformSiteEntry[];
  readonly tailnetDomain: string;
  readonly dynamicAliasesEnabled: boolean;
};

export type CatalogResult = {
  readonly links: LinkItem[];
  readonly shortcuts: ShortcutSpec[];
};

export type ResolveRedirectOptions = ResolverCatalogOptions & {
  readonly short: string;
  readonly subpath?: string;
  readonly search?: string;
};

export type ResolvedRedirect = {
  readonly kind: LinkKind;
  readonly matchedShort: string;
  readonly location: string;
};

type DynamicEntry = {
  readonly short: string;
  readonly targetUrl: string;
  readonly kind: Exclude<DynamicLinkKind, "shortcut">;
  readonly detail: string;
};

const STRIPPABLE_SUFFIXES = [
  "-build-cache",
  "-dashboard",
  "-frontend",
  "-service",
  "-server",
  "-admin",
  "-web",
  "-ui",
] as const;

/**
 * Tailnet `Ingress` and `LoadBalancer` slugs excluded from dynamic Tier 2
 * discovery (and Tier 4 suffix-stripping). Manual Tier 1 overrides for any of
 * these slugs remain allowed.
 * - Migrated aliases: `alerts` and `ops` (canonical app is `hub`).
 * - Headless gRPC, OTLP push, S3 API, LogQL, and build-cache endpoints.
 */
export const EXCLUDED_DYNAMIC_INGRESS_SHORTS: ReadonlySet<string> = new Set([
  "alerts",
  "gradle-build-cache",
  "loki",
  "ops",
  "otlp-metrics",
  "seaweedfs-s3",
  "temporal",
  "turbo-cache",
  "woodpecker-grpc",
]);

function isAllowedDynamicSlug(slug: string): boolean {
  return (
    slug.length > 0 &&
    slug !== "go" &&
    !RESERVED_SLUGS.has(slug) &&
    validateShortSlug(slug) === null
  );
}

function parseIngressEntry(
  rawHost: string,
  tailnetDomain: string,
): DynamicEntry | null {
  const cleaned = rawHost.trim().toLowerCase().replace(/\.$/u, "");
  if (cleaned.length === 0) {
    return null;
  }
  const domainSuffix = `.${tailnetDomain.toLowerCase()}`;
  let short: string;
  let fqdn: string;
  if (cleaned.endsWith(domainSuffix)) {
    short = cleaned.slice(0, -domainSuffix.length);
    fqdn = cleaned;
  } else if (cleaned.includes(".")) {
    const firstLabel = cleaned.split(".")[0] ?? "";
    short = firstLabel;
    fqdn = cleaned;
  } else {
    short = cleaned;
    fqdn = `${cleaned}.${tailnetDomain.toLowerCase()}`;
  }

  if (
    !isAllowedDynamicSlug(short) ||
    EXCLUDED_DYNAMIC_INGRESS_SHORTS.has(short)
  ) {
    return null;
  }
  const targetUrl = `https://${fqdn}/`;
  if (parseSafeHttpUrl(targetUrl) === null) {
    return null;
  }
  return {
    short,
    targetUrl,
    kind: "ingress",
    detail: `Tailscale cluster ingress (${fqdn})`,
  };
}

function stripKnownSuffix(slug: string): string | null {
  for (const suffix of STRIPPABLE_SUFFIXES) {
    if (slug.endsWith(suffix)) {
      const stripped = slug.slice(0, -suffix.length);
      return stripped.length > 0 ? stripped : null;
    }
  }
  return null;
}

function collectIngressEntries(
  ingressHosts: readonly string[],
  tailnetDomain: string,
  entries: Map<string, DynamicEntry>,
): void {
  const sortedHosts = [...ingressHosts].sort((left, right) =>
    left.localeCompare(right),
  );
  for (const rawHost of sortedHosts) {
    const entry = parseIngressEntry(rawHost, tailnetDomain);
    if (entry !== null && !entries.has(entry.short)) {
      entries.set(entry.short, entry);
    }
  }
}

function collectSiteEntries(
  platformSites: readonly PlatformSiteEntry[],
  entries: Map<string, DynamicEntry>,
): void {
  const sortedSites = [...platformSites].sort((left, right) =>
    left.short.localeCompare(right.short),
  );
  for (const site of sortedSites) {
    const usable =
      isAllowedDynamicSlug(site.short) &&
      !entries.has(site.short) &&
      parseSafeHttpUrl(site.targetUrl) !== null;
    if (usable) {
      entries.set(site.short, {
        short: site.short,
        targetUrl: site.targetUrl,
        kind: "site",
        detail: site.detail,
      });
    }
  }
}

function recordAliasCandidate(
  baseEntry: DynamicEntry,
  entries: ReadonlyMap<string, DynamicEntry>,
  aliasCandidates: Map<
    string,
    { readonly targetUrl: string; readonly sourceShort: string }
  >,
  collisions: Set<string>,
): void {
  const aliasShort = stripKnownSuffix(baseEntry.short);
  if (
    aliasShort === null ||
    !isAllowedDynamicSlug(aliasShort) ||
    entries.has(aliasShort) ||
    collisions.has(aliasShort)
  ) {
    return;
  }
  const existing = aliasCandidates.get(aliasShort);
  if (existing === undefined) {
    aliasCandidates.set(aliasShort, {
      targetUrl: baseEntry.targetUrl,
      sourceShort: baseEntry.short,
    });
    return;
  }
  if (existing.targetUrl !== baseEntry.targetUrl) {
    aliasCandidates.delete(aliasShort);
    collisions.add(aliasShort);
  }
}

function buildDynamicEntries(options: {
  readonly ingressHosts: readonly string[];
  readonly platformSites: readonly PlatformSiteEntry[];
  readonly tailnetDomain: string;
}): Map<string, DynamicEntry> {
  const entries = new Map<string, DynamicEntry>();
  collectIngressEntries(options.ingressHosts, options.tailnetDomain, entries);
  collectSiteEntries(options.platformSites, entries);

  const aliasCandidates = new Map<
    string,
    { readonly targetUrl: string; readonly sourceShort: string }
  >();
  const collisions = new Set<string>();
  for (const baseEntry of entries.values()) {
    recordAliasCandidate(baseEntry, entries, aliasCandidates, collisions);
  }

  const sortedAliases = [...aliasCandidates.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [aliasShort, candidate] of sortedAliases) {
    entries.set(aliasShort, {
      short: aliasShort,
      targetUrl: candidate.targetUrl,
      kind: "alias",
      detail: `Alias for ${candidate.sourceShort}`,
    });
  }

  return entries;
}

function findShadowedLink(
  short: string,
  dynamicEntries: ReadonlyMap<string, DynamicEntry>,
): ShadowedLink | undefined {
  const dynamic = dynamicEntries.get(short);
  if (dynamic !== undefined) {
    return {
      kind: dynamic.kind,
      targetUrl: dynamic.targetUrl,
      detail: dynamic.detail,
    };
  }
  const shortcutBase = FIXED_SHORTCUT_BASES[short];
  if (shortcutBase !== undefined) {
    return {
      kind: "shortcut",
      targetUrl: shortcutBase.targetUrl,
      detail: shortcutBase.detail,
    };
  }
  return undefined;
}

export function toManualLinkItem(
  record: ManualLinkRecord,
  shadows?: ShadowedLink,
): LinkItem | null {
  if (parseSafeHttpUrl(record.targetUrl) === null) {
    return null;
  }
  return {
    short: normalizeShortSlug(record.short),
    targetUrl: record.targetUrl,
    kind: "manual",
    createdBy: record.createdBy,
    clicks: record.clicks,
    lastClickedAt:
      record.lastClickedAt === null ? null : record.lastClickedAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ...(shadows === undefined ? {} : { shadows }),
  };
}

export function computeManualShadows(options: {
  readonly short: string;
  readonly ingressHosts: readonly string[];
  readonly platformSites: readonly PlatformSiteEntry[];
  readonly tailnetDomain: string;
  readonly dynamicAliasesEnabled: boolean;
}): ShadowedLink | undefined {
  if (!options.dynamicAliasesEnabled) {
    return undefined;
  }
  const dynamicEntries = buildDynamicEntries(options);
  return findShadowedLink(normalizeShortSlug(options.short), dynamicEntries);
}

export function buildCatalog(options: ResolverCatalogOptions): CatalogResult {
  const dynamicEntries = options.dynamicAliasesEnabled
    ? buildDynamicEntries(options)
    : new Map<string, DynamicEntry>();

  const manualShorts = new Set<string>();
  const manualItems: LinkItem[] = [];
  const sortedManual = [...options.manualLinks].sort((left, right) =>
    left.short.localeCompare(right.short),
  );

  for (const record of sortedManual) {
    const normalizedShort = normalizeShortSlug(record.short);
    if (manualShorts.has(normalizedShort)) {
      continue;
    }
    const shadows = options.dynamicAliasesEnabled
      ? findShadowedLink(normalizedShort, dynamicEntries)
      : undefined;
    const item = toManualLinkItem(record, shadows);
    if (item !== null) {
      manualShorts.add(normalizedShort);
      manualItems.push(item);
    }
  }

  const dynamicItems: LinkItem[] = [];
  if (options.dynamicAliasesEnabled) {
    const sortedDynamic = [...dynamicEntries.values()].sort((left, right) =>
      left.short.localeCompare(right.short),
    );
    for (const entry of sortedDynamic) {
      if (!manualShorts.has(entry.short)) {
        dynamicItems.push({
          short: entry.short,
          targetUrl: entry.targetUrl,
          kind: entry.kind,
          detail: entry.detail,
        });
      }
    }
  }

  return {
    links: [...manualItems, ...dynamicItems],
    shortcuts: options.dynamicAliasesEnabled
      ? builtinShortcuts(options.tailnetDomain)
      : [],
  };
}

export function resolveRedirect(
  options: ResolveRedirectOptions,
): ResolvedRedirect | null {
  const short = normalizeShortSlug(options.short);
  if (short.length === 0 || RESERVED_SLUGS.has(short)) {
    return null;
  }

  const cleanSubpath = (options.subpath ?? "").replace(/^\/+/u, "");
  const search = options.search ?? "";

  // Tier 1: Manual database links always win
  for (const manual of options.manualLinks) {
    const normalizedManual = normalizeShortSlug(manual.short);
    if (normalizedManual === short) {
      const location = forwardSubpathAndQuery(
        manual.targetUrl,
        cleanSubpath,
        search,
      );
      return location === null
        ? null
        : { kind: "manual", matchedShort: normalizedManual, location };
    }
  }

  if (!options.dynamicAliasesEnabled) {
    return null;
  }

  // Tiers 2, 3, and 4: Ingress -> Site -> Stripped Alias
  const dynamicEntries = buildDynamicEntries(options);
  const matchedDynamic = dynamicEntries.get(short);
  if (matchedDynamic !== undefined) {
    const location = forwardSubpathAndQuery(
      matchedDynamic.targetUrl,
      cleanSubpath,
      search,
    );
    return location === null
      ? null
      : {
          kind: matchedDynamic.kind,
          matchedShort: matchedDynamic.short,
          location,
        };
  }

  // Tier 5: Parameterized shortcuts
  return resolveShortcut(short, cleanSubpath, search, options.tailnetDomain);
}
