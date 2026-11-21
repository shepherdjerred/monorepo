import { z } from "zod";
import analyticsSiteJson from "./analytics-site.json" with { type: "json" };

/**
 * The browser analytics identity of the web remote: the public values registered for
 * `streambot.sjer.red` in `config/analytics-sites.json` (the project token is a publishable `phc_`
 * key, safe in a browser bundle). `scripts/checks/check-analytics-sites.ts` fails when
 * `analytics-site.json` drifts from the registry. Every browser request goes through the managed
 * proxy, never to PostHog directly.
 */
export const ANALYTICS_SITE = z
  .strictObject({
    projectToken: z.string().regex(/^phc_[A-Za-z0-9]+$/u),
    proxyHost: z.literal("https://j.sjer.red"),
    siteKey: z.literal("streambot"),
    hostname: z.literal("streambot.sjer.red"),
  })
  .parse(analyticsSiteJson);
