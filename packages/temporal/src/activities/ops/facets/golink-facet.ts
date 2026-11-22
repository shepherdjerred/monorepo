import { GolinkClient } from "@shepherdjerred/ops-clients/golink.ts";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import type { GolinkFacet } from "@shepherdjerred/ops-model/facets.ts";

export async function collectGolinkFacet(options?: {
  golinkUrl?: string | undefined;
  client?: GolinkClient;
  fetchImpl?: Fetch;
}): Promise<GolinkFacet | undefined> {
  const baseUrl = (options?.golinkUrl ?? Bun.env["GOLINK_URL"] ?? "").trim();
  if (baseUrl === "" && options?.client === undefined) {
    return undefined;
  }
  const client =
    options?.client ??
    new GolinkClient({
      baseUrl,
      ...(options?.fetchImpl === undefined ? {} : { fetch: options.fetchImpl }),
    });

  const rawLinks = await client.listLinks();
  const countsByTier: Record<string, number> = {};
  const links: GolinkFacet["links"] = rawLinks.map((item) => {
    countsByTier[item.tier] = (countsByTier[item.tier] ?? 0) + 1;
    return {
      slug: item.slug,
      targetUrl: item.targetUrl,
      tier: item.tier,
      clicks: item.clicks,
      ...(item.shadows === undefined ? {} : { shadows: [item.shadows.tier] }),
    };
  });

  return {
    totalLinks: links.length,
    countsByTier,
    links,
  };
}
