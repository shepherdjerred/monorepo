import { z } from "zod";
import {
  bearer,
  fetchJson,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";

export const POSTHOG_PROJECT_ID = 549_883;
const POSTHOG_API = "https://us.posthog.com";

const HogqlResponseSchema = z.object({
  columns: z.array(z.string()),
  results: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
});

export type SitePageviews = {
  /** The `site_key` super property, when the site registers one. */
  siteKey: string | undefined;
  host: string;
  pageviews: number;
};

export type TopPage = { host: string; path: string; pageviews: number };

const PAGEVIEWS_BY_HOST = `
SELECT properties.site_key AS site_key, properties.$host AS host, count() AS pageviews
FROM events
WHERE event = '$pageview' AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY site_key, host
ORDER BY pageviews DESC
LIMIT 100`;

const TOP_PAGES = `
SELECT properties.$host AS host, properties.$pathname AS path, count() AS pageviews
FROM events
WHERE event = '$pageview' AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY host, path
ORDER BY pageviews DESC
LIMIT 20`;

function columnIndex(columns: readonly string[], name: string): number {
  const index = columns.indexOf(name);
  if (index === -1) {
    throw new Error(`PostHog query result has no ${name} column`);
  }
  return index;
}

function text(value: string | number | null | undefined): string | undefined {
  return value === null || value === undefined || value === ""
    ? undefined
    : String(value);
}

function count(value: string | number | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError("PostHog query returned a non-numeric count");
  }
  return parsed;
}

/** Read-only PostHog HogQL client using a personal API key. */
export class PostHogClient {
  readonly #apiKey: string;
  readonly #projectId: number;
  readonly #fetch: Fetch;

  constructor(options: { apiKey: string; projectId?: number; fetch?: Fetch }) {
    this.#apiKey = options.apiKey;
    this.#projectId = options.projectId ?? POSTHOG_PROJECT_ID;
    this.#fetch = options.fetch ?? fetch;
  }

  async hogql(query: string): Promise<z.infer<typeof HogqlResponseSchema>> {
    return await fetchJson(
      this.#fetch,
      {
        upstream: "posthog",
        url: `${POSTHOG_API}/api/projects/${String(this.#projectId)}/query`,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...bearer(this.#apiKey),
          },
          body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
        },
        timeoutMs: 30_000,
      },
      HogqlResponseSchema,
    );
  }

  /** Pageviews over the last 24 hours by site key and host. */
  async pageviewsByHost24h(): Promise<SitePageviews[]> {
    const response = await this.hogql(PAGEVIEWS_BY_HOST);
    const site = columnIndex(response.columns, "site_key");
    const host = columnIndex(response.columns, "host");
    const pageviews = columnIndex(response.columns, "pageviews");
    return response.results.map((row) => ({
      siteKey: text(row[site]),
      host: text(row[host]) ?? "(none)",
      pageviews: count(row[pageviews]),
    }));
  }

  async topPages24h(): Promise<TopPage[]> {
    const response = await this.hogql(TOP_PAGES);
    const host = columnIndex(response.columns, "host");
    const path = columnIndex(response.columns, "path");
    const pageviews = columnIndex(response.columns, "pageviews");
    return response.results.map((row) => ({
      host: text(row[host]) ?? "(none)",
      path: text(row[path]) ?? "/",
      pageviews: count(row[pageviews]),
    }));
  }
}
