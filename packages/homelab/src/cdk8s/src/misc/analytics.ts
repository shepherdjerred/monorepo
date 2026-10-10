import { z } from "zod";
import analyticsRegistryJson from "@shepherdjerred/monorepo/config/analytics-sites.json" with { type: "json" };

const AnalyticsRegistrySchema = z.object({
  provider: z.literal("posthog"),
  projectToken: z.string().min(1),
  apiHost: z.url(),
  sites: z.array(
    z.object({ key: z.string().min(1), hostname: z.string().min(1) }),
  ),
});

/** Public capture bootstrap shared by hosted applications; never an operator API key. */
export function siteAnalyticsConfiguration(siteKey: string) {
  const registry = AnalyticsRegistrySchema.parse(analyticsRegistryJson);
  const site = registry.sites.find((candidate) => candidate.key === siteKey);
  if (site === undefined) {
    throw new Error(`Analytics registry is missing site ${siteKey}`);
  }
  return {
    projectToken: registry.projectToken,
    apiHost: registry.apiHost,
    siteKey: site.key,
    siteHostname: site.hostname,
  };
}
