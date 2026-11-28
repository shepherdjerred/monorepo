import type { PlatformSiteEntry } from "#domain/platform-sites.ts";
import {
  buildCatalog,
  computeManualShadows,
  toManualLinkItem,
} from "#domain/resolver.ts";
import type { ManualLinkRepository } from "#infrastructure/db.ts";
import type { GolinkMetrics } from "#infrastructure/telemetry.ts";
import type {
  LinkItem,
  LinksDirectoryResponse,
  UpsertManualLinkInput,
  Viewer,
} from "#shared/contract.ts";

export type LinksServiceDeps = {
  readonly repo: ManualLinkRepository;
  readonly getIngressHosts: () => readonly string[];
  readonly platformSites: readonly PlatformSiteEntry[];
  readonly tailnetDomain: string;
  readonly dynamicAliasesEnabled: () => Promise<boolean>;
  readonly writesEnabled: () => Promise<boolean>;
  readonly metrics: GolinkMetrics;
};

/** A request the directory refuses; REST and tRPC map `kind` to their codes. */
export class LinksError extends Error {
  override readonly name = "LinksError";
  readonly kind: "writes-disabled" | "invalid-stored-url";

  constructor(kind: LinksError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

/**
 * The directory's operations, shared by the `/api/links` REST routes and the
 * `links` tRPC procedures while both are served.
 */
export function createLinksService(deps: LinksServiceDeps) {
  const requireWrites = async (): Promise<void> => {
    if (!(await deps.writesEnabled())) {
      throw new LinksError(
        "writes-disabled",
        "Golink writes are currently disabled.",
      );
    }
  };

  return {
    async directory(viewer: Viewer): Promise<LinksDirectoryResponse> {
      const [manualLinks, dynamicAliasesEnabled, writesEnabled] =
        await Promise.all([
          deps.repo.list(),
          deps.dynamicAliasesEnabled(),
          deps.writesEnabled(),
        ]);
      const catalog = buildCatalog({
        manualLinks,
        ingressHosts: deps.getIngressHosts(),
        platformSites: deps.platformSites,
        tailnetDomain: deps.tailnetDomain,
        dynamicAliasesEnabled,
      });
      deps.metrics.updateLinksConfigured(
        catalog.links,
        catalog.shortcuts.length,
      );
      return {
        viewer,
        dynamicAliasesEnabled,
        writesEnabled,
        links: catalog.links,
        shortcuts: catalog.shortcuts,
      };
    },

    async upsert(
      input: UpsertManualLinkInput,
      viewer: Viewer,
    ): Promise<LinkItem> {
      await requireWrites();
      const saved = await deps.repo.upsert(input, viewer.login ?? "manual");
      const shadows = computeManualShadows({
        short: saved.short,
        ingressHosts: deps.getIngressHosts(),
        platformSites: deps.platformSites,
        tailnetDomain: deps.tailnetDomain,
        dynamicAliasesEnabled: await deps.dynamicAliasesEnabled(),
      });
      const item = toManualLinkItem(saved, shadows);
      if (item === null) {
        throw new LinksError(
          "invalid-stored-url",
          "Stored destination URL is invalid.",
        );
      }
      return item;
    },

    async remove(short: string): Promise<{ readonly deleted: true }> {
      await requireWrites();
      await deps.repo.delete(short);
      return { deleted: true };
    },
  };
}

export type LinksService = ReturnType<typeof createLinksService>;
