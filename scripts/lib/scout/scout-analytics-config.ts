import { z } from "zod";

const ANALYTICS_REGISTRY_PATH = "config/analytics-sites.json";
const AnalyticsRegistrySchema = z
  .object({
    provider: z.literal("posthog"),
    projectToken: z.string().regex(/^phc_[A-Za-z0-9]+$/),
    apiHost: z.literal("https://us.i.posthog.com"),
    assetHost: z.literal("https://us-assets.i.posthog.com"),
    sites: z.array(
      z.object({
        key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        hostname: z.string().min(1),
        sessionReplay: z.boolean(),
        marketing: z
          .object({
            pinterestTagId: z.string().min(1),
            redditPixelId: z.string().min(1),
          })
          .optional(),
      }),
    ),
  })
  .superRefine((registry, context) => {
    const hostnames = new Set<string>();
    const siteKeys = new Set<string>();
    for (const site of registry.sites) {
      if (hostnames.has(site.hostname)) {
        context.addIssue({
          code: "custom",
          path: ["sites"],
          message: `Duplicate analytics hostname: ${site.hostname}`,
        });
      }
      if (siteKeys.has(site.key)) {
        context.addIssue({
          code: "custom",
          path: ["sites"],
          message: `Duplicate analytics site key: ${site.key}`,
        });
      }
      hostnames.add(site.hostname);
      siteKeys.add(site.key);
    }
    const scoutProd = registry.sites.find((site) => site.key === "scout-prod");
    if (scoutProd?.marketing === undefined) {
      context.addIssue({
        code: "custom",
        path: ["sites"],
        message: "scout-prod must declare its public marketing identifiers",
      });
    }
  });
type AnalyticsRegistry = z.infer<typeof AnalyticsRegistrySchema>;

export function parseAnalyticsRegistry(input: unknown): AnalyticsRegistry {
  return AnalyticsRegistrySchema.parse(input);
}

export type ScoutPostHogSite = {
  projectToken: string;
  apiHost: "https://us.i.posthog.com";
  assetHost: "https://us-assets.i.posthog.com";
  key: string;
  domain: string;
  sessionReplay: boolean;
  marketing: { pinterestTagId: string; redditPixelId: string } | undefined;
};

export function selectPostHogSite(
  registryRaw: unknown,
  flavor: "prod" | "beta",
): ScoutPostHogSite {
  const registry = parseAnalyticsRegistry(registryRaw);
  const domain =
    flavor === "prod" ? "scout-for-lol.com" : "beta.scout-for-lol.com";
  const matchingSites = registry.sites.filter(
    (candidate) => candidate.hostname === domain,
  );
  if (matchingSites.length !== 1) {
    throw new Error(
      `Analytics registry must have exactly one PostHog site for ${domain}`,
    );
  }
  const site = matchingSites[0];
  if (site === undefined) {
    throw new Error(`Analytics registry has no PostHog site for ${domain}`);
  }
  return {
    projectToken: registry.projectToken,
    apiHost: registry.apiHost,
    assetHost: registry.assetHost,
    key: site.key,
    domain: site.hostname,
    sessionReplay: site.sessionReplay,
    marketing: site.marketing,
  };
}

export async function readScoutPostHogSite(
  repositoryRoot: string,
  flavor: "prod" | "beta",
): Promise<ScoutPostHogSite> {
  const registryRaw: unknown = JSON.parse(
    await Bun.file(`${repositoryRoot}/${ANALYTICS_REGISTRY_PATH}`).text(),
  );
  return selectPostHogSite(registryRaw, flavor);
}

export function requireMarketingIdentifiers(site: ScoutPostHogSite): {
  pinterestTagId: string;
  redditPixelId: string;
} {
  if (site.marketing === undefined) {
    throw new Error("Scout production marketing identifiers are missing");
  }
  return site.marketing;
}
