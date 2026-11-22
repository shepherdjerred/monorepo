import { z } from "zod";
import {
  bearer,
  fetchJson,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";

export const POSTHOG_PROJECT_ID = 549_883;
const POSTHOG_API = "https://us.posthog.com";
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

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

export type SiteTrafficSummary = {
  siteKey: string | undefined;
  host: string;
  pageviews24h: number;
  dau24h: number;
  wau7d: number;
  dailySeries7d: number[];
  exceptions24h: number;
  rageclicks24h: number;
};

export type HostWebVitals = {
  host: string;
  lcpP75: number | null;
  inpP75: number | null;
  samples: number;
};

export type ExternalReferrer = {
  domain: string;
  count: number;
};

export type EventWindowCount = {
  event: string;
  count24h: number;
  count7d: number;
};

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

const WEB_VITALS_BY_HOST_24H = `
SELECT
  properties.$host AS host,
  quantile(0.75)(toFloat(properties.$web_vitals_LCP_value)) AS lcp_p75,
  quantile(0.75)(toFloat(properties.$web_vitals_INP_value)) AS inp_p75,
  count() AS samples
FROM events
WHERE event = '$web_vitals' AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY host
ORDER BY samples DESC
LIMIT 100`;

const TOP_REFERRERS_24H = `
SELECT
  properties.$referring_domain AS referring_domain,
  count() AS count
FROM events
WHERE event = '$pageview'
  AND timestamp > now() - INTERVAL 24 HOUR
  AND properties.$referring_domain IS NOT NULL
  AND properties.$referring_domain != ''
  AND properties.$referring_domain != '$direct'
GROUP BY referring_domain
ORDER BY count DESC
LIMIT 15`;

function buildSiteTrafficQuery(
  windowStartIso: string,
  cutoff24hIso: string,
): string {
  return `
SELECT
  d.site_key AS site_key,
  d.host AS host,
  d.day AS day,
  d.pageviews AS pageviews,
  t.pageviews_24h AS pageviews_24h,
  t.dau_24h AS dau_24h,
  t.wau_7d AS wau_7d,
  t.exceptions_24h AS exceptions_24h,
  t.rageclicks_24h AS rageclicks_24h
FROM (
  SELECT
    ifNull(toString(properties.site_key), '') AS site_key,
    ifNull(toString(properties.$host), '(none)') AS host,
    toString(toDate(timestamp)) AS day,
    countIf(event = '$pageview') AS pageviews
  FROM events
  WHERE event IN ('$pageview', '$exception', '$rageclick')
    AND timestamp >= parseDateTimeBestEffort('${windowStartIso}')
  GROUP BY site_key, host, day
) AS d
INNER JOIN (
  SELECT
    ifNull(toString(properties.site_key), '') AS site_key,
    ifNull(toString(properties.$host), '(none)') AS host,
    countIf(event = '$pageview' AND timestamp > parseDateTimeBestEffort('${cutoff24hIso}')) AS pageviews_24h,
    count(DISTINCT if(event = '$pageview' AND timestamp > parseDateTimeBestEffort('${cutoff24hIso}'), distinct_id, NULL)) AS dau_24h,
    count(DISTINCT if(event = '$pageview', distinct_id, NULL)) AS wau_7d,
    countIf(event = '$exception' AND timestamp > parseDateTimeBestEffort('${cutoff24hIso}')) AS exceptions_24h,
    countIf(event = '$rageclick' AND timestamp > parseDateTimeBestEffort('${cutoff24hIso}')) AS rageclicks_24h
  FROM events
  WHERE event IN ('$pageview', '$exception', '$rageclick')
    AND timestamp >= parseDateTimeBestEffort('${windowStartIso}')
  GROUP BY site_key, host
) AS t
ON d.site_key = t.site_key AND d.host = t.host
ORDER BY t.pageviews_24h DESC, d.host ASC, d.day ASC
LIMIT 2000`;
}

function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 127 || code < 32) {
      return true;
    }
  }
  return false;
}

function escapeHogqlLiteral(value: string): string {
  if (value === "" || hasControlChar(value)) {
    throw new Error("Invalid PostHog event name");
  }
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

function utcDayStrings7d(now: Date): {
  days: string[];
  windowStartIso: string;
} {
  const endDayUtcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const startDayUtcMs = endDayUtcMs - 6 * DAY_MS;
  const days: string[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    days.push(
      new Date(startDayUtcMs + offset * DAY_MS).toISOString().slice(0, 10),
    );
  }
  return { days, windowStartIso: new Date(startDayUtcMs).toISOString() };
}

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

function nullableMetric(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

  /**
   * 7-day traffic, DAU/WAU, zero-filled daily pageview series, exceptions, and
   * rageclicks grouped by `(siteKey, host)`.
   */
  async siteTrafficSummary(now = new Date()): Promise<SiteTrafficSummary[]> {
    const { days, windowStartIso } = utcDayStrings7d(now);
    const cutoff24hIso = new Date(now.getTime() - 24 * HOUR_MS).toISOString();
    const response = await this.hogql(
      buildSiteTrafficQuery(windowStartIso, cutoff24hIso),
    );
    const siteIdx = columnIndex(response.columns, "site_key");
    const hostIdx = columnIndex(response.columns, "host");
    const dayIdx = columnIndex(response.columns, "day");
    const pvIdx = columnIndex(response.columns, "pageviews");
    const pv24Idx = columnIndex(response.columns, "pageviews_24h");
    const dauIdx = columnIndex(response.columns, "dau_24h");
    const wauIdx = columnIndex(response.columns, "wau_7d");
    const excIdx = columnIndex(response.columns, "exceptions_24h");
    const rageIdx = columnIndex(response.columns, "rageclicks_24h");

    type Bucket = Omit<SiteTrafficSummary, "dailySeries7d"> & {
      byDay: Map<string, number>;
    };
    const grouped = new Map<string, Bucket>();

    for (const row of response.results) {
      const siteKey = text(row[siteIdx]);
      const host = text(row[hostIdx]) ?? "(none)";
      const groupKey = `${siteKey ?? ""}\u0000${host}`;
      const day = (text(row[dayIdx]) ?? "").slice(0, 10);
      const existing = grouped.get(groupKey);
      if (existing === undefined) {
        const byDay = new Map<string, number>();
        if (day !== "") {
          byDay.set(day, count(row[pvIdx]));
        }
        grouped.set(groupKey, {
          siteKey,
          host,
          pageviews24h: count(row[pv24Idx]),
          dau24h: count(row[dauIdx]),
          wau7d: count(row[wauIdx]),
          exceptions24h: count(row[excIdx]),
          rageclicks24h: count(row[rageIdx]),
          byDay,
        });
      } else if (day !== "") {
        existing.byDay.set(
          day,
          (existing.byDay.get(day) ?? 0) + count(row[pvIdx]),
        );
      }
    }

    return [...grouped.values()]
      .map(({ byDay, ...summary }) => ({
        ...summary,
        dailySeries7d: days.map((day) => byDay.get(day) ?? 0),
      }))
      .sort(
        (left, right) =>
          right.pageviews24h - left.pageviews24h ||
          right.wau7d - left.wau7d ||
          left.host.localeCompare(right.host),
      );
  }

  /** 24-hour p75 LCP and INP web vitals grouped by `$host`. */
  async webVitalsByHost24h(): Promise<HostWebVitals[]> {
    const response = await this.hogql(WEB_VITALS_BY_HOST_24H);
    const hostIdx = columnIndex(response.columns, "host");
    const lcpIdx = columnIndex(response.columns, "lcp_p75");
    const inpIdx = columnIndex(response.columns, "inp_p75");
    const samplesIdx = columnIndex(response.columns, "samples");
    return response.results.map((row) => ({
      host: text(row[hostIdx]) ?? "(none)",
      lcpP75: nullableMetric(row[lcpIdx]),
      inpP75: nullableMetric(row[inpIdx]),
      samples: count(row[samplesIdx]),
    }));
  }

  /** Top 15 external `$referring_domain` counts over the last 24 hours. */
  async topReferrers24h(): Promise<ExternalReferrer[]> {
    const response = await this.hogql(TOP_REFERRERS_24H);
    const domainIdx = columnIndex(response.columns, "referring_domain");
    const countIdx = columnIndex(response.columns, "count");
    return response.results.flatMap((row) => {
      const domain = text(row[domainIdx]);
      return domain === undefined || domain === "$direct"
        ? []
        : [{ domain, count: count(row[countIdx]) }];
    });
  }

  /** Fetch 24h and 7d counts for product funnel events in a single round-trip. */
  async eventCountsWindow(
    eventNames: readonly string[],
  ): Promise<EventWindowCount[]> {
    const uniqueNames = [...new Set(eventNames)];
    if (uniqueNames.length === 0) {
      return [];
    }
    const literals = uniqueNames
      .map((name) => escapeHogqlLiteral(name))
      .join(", ");
    const query = `
SELECT
  event,
  countIf(timestamp > now() - INTERVAL 24 HOUR) AS count_24h,
  count() AS count_7d
FROM events
WHERE event IN (${literals}) AND timestamp > now() - INTERVAL 7 DAY
GROUP BY event
LIMIT ${String(uniqueNames.length + 10)}`;
    const response = await this.hogql(query);
    const eventIdx = columnIndex(response.columns, "event");
    const c24Idx = columnIndex(response.columns, "count_24h");
    const c7Idx = columnIndex(response.columns, "count_7d");

    const byEvent = new Map<string, { count24h: number; count7d: number }>();
    for (const row of response.results) {
      const name = text(row[eventIdx]);
      if (name !== undefined) {
        byEvent.set(name, {
          count24h: count(row[c24Idx]),
          count7d: count(row[c7Idx]),
        });
      }
    }

    return uniqueNames.map((event) => ({
      event,
      count24h: byEvent.get(event)?.count24h ?? 0,
      count7d: byEvent.get(event)?.count7d ?? 0,
    }));
  }
}
