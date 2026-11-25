import type { S3Client } from "@aws-sdk/client-s3";
import catalogDocumentJson from "@shepherdjerred/ops-model/catalog-document.json" with { type: "json" };
import { z } from "zod";
import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type {
  BugsinkFacet,
  FlagsFacet,
  GitHubFacet,
  MonorepoAudit,
  MonorepoFacet,
  RenovateFacet,
} from "@shepherdjerred/ops-model/facets.ts";
import { monorepoTurboHitRatio7d } from "#observability/metrics-ops.ts";
import {
  clearDiagnosticsCache,
  fetchRecentDiagnostics,
} from "./monorepo-diagnostics.ts";

const CatalogDocLooseSchema = z
  .object({
    groups: z
      .array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            kind: z.string(),
            package: z.string().optional(),
          })
          .loose(),
      )
      .default([]),
    components: z.array(z.unknown()).optional(),
  })
  .loose();

const VersionCatalogLooseSchema = z
  .object({ entries: z.array(z.unknown()) })
  .loose();

const RootPackageJsonSchema = z
  .object({ workspaces: z.array(z.string()).default([]) })
  .loose();

const WorkspaceManifestSchema = z
  .object({ name: z.string().optional() })
  .loose();

const CiTestsManifestSchema = z
  .object({
    steps: z
      .array(z.object({ tier: z.string().optional() }).loose())
      .optional(),
  })
  .loose();

type PackageInventoryItem = {
  name: string;
  path: string;
  category: string;
  serviceId: string | null;
  hasExtendedTests: boolean;
};

let cachedWorkspaceInventory:
  { packages: PackageInventoryItem[]; catalogPinsCount: number } | undefined;

export function clearMonorepoCacheForTests(): void {
  clearDiagnosticsCache();
  cachedWorkspaceInventory = undefined;
}

async function readCatalogPinsCount(repoRootUrl: URL): Promise<number> {
  try {
    const file = Bun.file(
      new URL("packages/version-catalog/src/catalog.json", repoRootUrl),
    );
    if (await file.exists()) {
      const parsed = VersionCatalogLooseSchema.safeParse(await file.json());
      if (parsed.success) {
        return parsed.data.entries.length;
      }
    }
  } catch {
    // Scoped container image falls back to catalog-document.json below.
  }
  const doc = CatalogDocLooseSchema.safeParse(catalogDocumentJson);
  return doc.success
    ? (doc.data.components?.length ?? doc.data.groups.length)
    : 0;
}

async function hasExtendedTier(
  wsPath: string,
  repoRootUrl: URL,
): Promise<boolean> {
  const file = Bun.file(new URL(`${wsPath}/ci-tests.json`, repoRootUrl));
  if (!(await file.exists())) {
    return false;
  }
  const parsed = CiTestsManifestSchema.safeParse(await file.json());
  return (
    parsed.success &&
    (parsed.data.steps?.some((s) => s.tier === "extended") ?? false)
  );
}

async function readWorkspaceEntry(
  wsPath: string,
  repoRootUrl: URL,
  serviceByPkg: ReadonlyMap<string, { id: string; kind: string }>,
): Promise<PackageInventoryItem | undefined> {
  const manifestFile = Bun.file(new URL(`${wsPath}/package.json`, repoRootUrl));
  if (!(await manifestFile.exists())) {
    return undefined;
  }
  const manifest = WorkspaceManifestSchema.safeParse(await manifestFile.json());
  const dirKey = wsPath.startsWith("packages/")
    ? (wsPath.split("/")[1] ?? wsPath)
    : wsPath;
  const svc = serviceByPkg.get(dirKey);
  const manifestName = manifest.success ? manifest.data.name : undefined;
  return {
    name: manifestName ?? `@shepherdjerred/${dirKey}`,
    path: wsPath,
    category: svc?.kind ?? "library",
    serviceId: svc?.id ?? null,
    hasExtendedTests: await hasExtendedTier(wsPath, repoRootUrl),
  };
}

function catalogFallbackPackages(): PackageInventoryItem[] {
  const doc = CatalogDocLooseSchema.safeParse(catalogDocumentJson);
  const seen = new Set<string>();
  const items: PackageInventoryItem[] = [];
  for (const group of doc.success ? doc.data.groups : []) {
    const pkg = group.package ?? group.id;
    if (!seen.has(pkg)) {
      seen.add(pkg);
      items.push({
        name: `@shepherdjerred/${pkg}`,
        path: `packages/${pkg}`,
        category: group.kind,
        serviceId: group.id,
        hasExtendedTests: false,
      });
    }
  }
  return items;
}

async function loadWorkspaceInventory(services: ServiceIndex) {
  if (cachedWorkspaceInventory !== undefined) {
    return cachedWorkspaceInventory;
  }
  const repoRootUrl = new URL("../../../../../", import.meta.url);
  const catalogPinsCount = await readCatalogPinsCount(repoRootUrl);
  const serviceByPkg = new Map<string, { id: string; kind: string }>();
  for (const svc of services.services) {
    if (svc.package !== undefined && !serviceByPkg.has(svc.package)) {
      serviceByPkg.set(svc.package, { id: svc.id, kind: svc.kind });
    }
  }

  let packages: PackageInventoryItem[] = [];
  try {
    const rootPkgFile = Bun.file(new URL("package.json", repoRootUrl));
    if (await rootPkgFile.exists()) {
      const rootPkg = RootPackageJsonSchema.safeParse(await rootPkgFile.json());
      const workspaces = rootPkg.success ? rootPkg.data.workspaces : [];
      const entries = await Promise.all(
        workspaces.map((wsPath) =>
          readWorkspaceEntry(wsPath, repoRootUrl, serviceByPkg),
        ),
      );
      packages = entries.flatMap((entry) =>
        entry === undefined ? [] : [entry],
      );
    }
  } catch {
    packages = [];
  }

  if (packages.length === 0) {
    packages = catalogFallbackPackages();
  }
  packages.sort((a, b) => a.path.localeCompare(b.path));
  cachedWorkspaceInventory = { packages, catalogPinsCount };
  return cachedWorkspaceInventory;
}

function countOpenPrsByService(
  services: ServiceIndex,
  github: GitHubFacet | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const pr of github?.openPrs ?? []) {
    if (pr.isRenovate) {
      continue;
    }
    const scope = /^[a-z]+\(([^)]+)\)!?:/u.exec(pr.title)?.[1];
    const svc = scope === undefined ? undefined : services.byId(scope);
    if (svc !== undefined) {
      map.set(svc.id, (map.get(svc.id) ?? 0) + 1);
    }
  }
  return map;
}

function buildCrossPackageCounts(input: {
  services: ServiceIndex;
  github?: GitHubFacet | undefined;
  renovate?: RenovateFacet | undefined;
  bugsink?: BugsinkFacet | undefined;
  flags?: FlagsFacet | undefined;
}) {
  const bugsinkByService = new Map<string, number>();
  for (const proj of input.bugsink?.projects ?? []) {
    const svc = input.services.byBugsinkProject(proj.slug);
    if (svc !== undefined) {
      bugsinkByService.set(
        svc.id,
        (bugsinkByService.get(svc.id) ?? 0) +
          proj.activeIssues7d +
          proj.staleIssues,
      );
    }
  }

  const flagsByService = new Map<string, number>();
  for (const flag of input.flags?.flags ?? []) {
    const svc = input.services.byId(flag.namespace);
    if (svc !== undefined) {
      flagsByService.set(svc.id, (flagsByService.get(svc.id) ?? 0) + 1);
    }
  }

  const renovateByPkg = new Map<string, number>();
  for (const item of input.renovate?.items ?? []) {
    if (item.state !== "ignored") {
      renovateByPkg.set(
        item.packageName,
        (renovateByPkg.get(item.packageName) ?? 0) + 1,
      );
    }
  }

  return {
    prByService: countOpenPrsByService(input.services, input.github),
    bugsinkByService,
    flagsByService,
    renovateByPkg,
  };
}

function buildAudits(input: {
  nowIso: string;
  flags?: FlagsFacet | undefined;
  renovate?: RenovateFacet | undefined;
}): MonorepoAudit[] {
  const audits: MonorepoAudit[] = [];
  if (input.flags !== undefined) {
    const hasDrift = input.flags.namespaces.some(
      (ns) => ns.prodStatus !== "ok" || ns.betaStatus !== "ok",
    );
    audits.push({
      id: "flags-drift",
      label: "Flags declaration alignment",
      status:
        hasDrift || input.flags.overdueExceptionsCount > 0 ? "warning" : "ok",
      lastRunAt: input.nowIso,
      ...(input.flags.overdueExceptionsCount > 0
        ? {
            detail: `${String(input.flags.overdueExceptionsCount)} overdue default-off exception(s)`,
          }
        : {}),
    });
  }
  if (input.renovate !== undefined) {
    const warnCount =
      input.renovate.lookupWarnings.length + input.renovate.deprecations.length;
    audits.push({
      id: "renovate-hygiene",
      label: "Renovate lookup & deprecation check",
      status: warnCount > 0 ? "warning" : "ok",
      lastRunAt: input.nowIso,
      ...(warnCount > 0 ? { detail: `${String(warnCount)} warning(s)` } : {}),
    });
  }
  return audits;
}

export async function collectMonorepoFacet(input: {
  services: ServiceIndex;
  now?: Date;
  s3Client?: S3Client;
  github?: GitHubFacet | undefined;
  renovate?: RenovateFacet | undefined;
  bugsink?: BugsinkFacet | undefined;
  flags?: FlagsFacet | undefined;
}): Promise<MonorepoFacet> {
  const now = input.now ?? new Date();
  const [inventory, diagnostics] = await Promise.all([
    loadWorkspaceInventory(input.services),
    fetchRecentDiagnostics(input.s3Client, now),
  ]);

  if (diagnostics.turboHitRatio7d !== null) {
    monorepoTurboHitRatio7d.set(diagnostics.turboHitRatio7d);
  }

  const cross = buildCrossPackageCounts(input);
  const packages: MonorepoFacet["packages"] = inventory.packages.map((pkg) => {
    const stats = diagnostics.byPackage.get(pkg.name);
    const sid = pkg.serviceId;
    return {
      name: pkg.name,
      path: pkg.path,
      category: pkg.category,
      serviceId: sid,
      hasExtendedTests: pkg.hasExtendedTests,
      openPrCount: sid === null ? 0 : (cross.prByService.get(sid) ?? 0),
      renovatePendingCount: cross.renovateByPkg.get(pkg.name) ?? 0,
      bugsinkOpenCount:
        sid === null ? 0 : (cross.bugsinkByService.get(sid) ?? 0),
      flagCount: sid === null ? 0 : (cross.flagsByService.get(sid) ?? 0),
      cacheHitRatio: stats?.hitRatio ?? null,
      medianDurationMs: stats?.medianMs ?? null,
    };
  });

  return {
    packageCount: packages.length,
    turboHitRatio7d: diagnostics.turboHitRatio7d,
    turboSavedHours7d: diagnostics.turboSavedHours7d,
    verifyRunsAnalyzed: diagnostics.verifyRunsAnalyzed,
    packages,
    expensiveTasks: diagnostics.expensiveTasks,
    catalogPinsCount: inventory.catalogPinsCount,
    audits: buildAudits({
      nowIso: now.toISOString(),
      flags: input.flags,
      renovate: input.renovate,
    }),
  };
}
