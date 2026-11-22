import { z } from "zod";
import {
  bearer,
  fetchJson,
  UpstreamError,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";
import { postGraphql } from "@shepherdjerred/ops-clients/graphql.ts";
import {
  cfEnvelope,
  R2_STORAGE_QUERY,
  R2GraphqlSchema,
  R2ListResultSchema,
  RawDnsRecordSchema,
  RawDnssecSchema,
  RawTunnelConfigSchema,
  RawTunnelSchema,
  RawZoneSchema,
  RdapDomainSchema,
} from "@shepherdjerred/ops-clients/cloudflare-schemas.ts";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";
const CF_GRAPHQL_URL = `${CF_API_BASE}/graphql`;
const RDAP_TIMEOUT_MS = 8000;
const DAY_MS = 86_400_000;
const MAX_PAGES = 20;

export type CloudflareZone = {
  id: string;
  name: string;
  status: string;
  paused: boolean;
  plan: string | undefined;
  nameServers: string[];
};

export type ZoneDnsBaseline = {
  zoneId: string;
  zoneName: string;
  dnssecStatus: string;
  dnssecEnabled: boolean;
  hasSpf: boolean;
  hasDmarc: boolean;
  hasMx: boolean;
  hasMtaSts: boolean;
  spfRecord: string | undefined;
  dmarcRecord: string | undefined;
  mxRecords: string[];
  mtaStsRecord: string | undefined;
};

export type CloudflareR2Bucket = {
  name: string;
  createdAt: string | undefined;
  location: string | undefined;
  payloadBytes: number | null;
  objectCount: number | null;
};

export type CloudflareTunnelRoute = {
  tunnelId: string;
  tunnelName: string;
  tunnelStatus: string;
  activeConnections: number;
  hostname: string | undefined;
  path: string | undefined;
  service: string;
};

function stripTxtQuotes(content: string): string {
  return content
    .trim()
    .replaceAll(/^"+|"+$/gu, "")
    .trim();
}

function normalizeDnsName(name: string): string {
  const lowered = name.trim().toLowerCase();
  return lowered.endsWith(".") ? lowered.slice(0, -1) : lowered;
}

function summarizeMailRecords(
  records: readonly z.infer<typeof RawDnsRecordSchema>[],
  apex: string,
): {
  spfRecord: string | undefined;
  dmarcRecord: string | undefined;
  mtaStsRecord: string | undefined;
  mxRecords: string[];
} {
  const dmarcHost = `_dmarc.${apex}`;
  const mtaStsHost = `_mta-sts.${apex}`;
  let spfRecord: string | undefined;
  let dmarcRecord: string | undefined;
  let mtaStsRecord: string | undefined;
  const mxRecords: string[] = [];

  for (const record of records) {
    const name = normalizeDnsName(record.name);
    const type = record.type.toUpperCase();
    const unquoted = stripTxtQuotes(record.content);
    const isApex = name === apex || name === "@";

    if (isApex && type === "MX") {
      mxRecords.push(record.content.trim());
    } else if (isApex && type === "TXT" && /^v=spf1\b/iu.test(unquoted)) {
      spfRecord ??= unquoted;
    } else if (
      type === "TXT" &&
      (name === dmarcHost || name === "_dmarc") &&
      /^v=DMARC1\b/iu.test(unquoted)
    ) {
      dmarcRecord ??= unquoted;
    } else if (
      (name === mtaStsHost || name === "_mta-sts") &&
      (type === "CNAME" || (type === "TXT" && /^v=STSv1\b/iu.test(unquoted)))
    ) {
      mtaStsRecord ??= unquoted;
    }
  }
  return { spfRecord, dmarcRecord, mtaStsRecord, mxRecords };
}

/**
 * Query RDAP (`https://rdap.org/domain/<domain>`) with an 8s timeout and return
 * integer days until domain expiration, or `null` on unsupported TLD / timeout.
 */
export async function lookupRdapExpiryDays(
  domain: string,
  fetchImpl: Fetch = fetch,
  now = new Date(),
): Promise<number | null> {
  const cleaned = normalizeDnsName(domain);
  if (cleaned === "") {
    return null;
  }
  let response: Response;
  try {
    response = await fetchImpl(
      `https://rdap.org/domain/${encodeURIComponent(cleaned)}`,
      {
        headers: { accept: "application/rdap+json, application/json" },
        signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
      },
    );
  } catch {
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch {
    return null;
  }
  const parsed = RdapDomainSchema.safeParse(rawJson);
  if (!parsed.success) {
    return null;
  }
  const expiration = parsed.data.events?.find(
    (event) => event.eventAction.toLowerCase() === "expiration",
  );
  if (expiration === undefined) {
    return null;
  }
  const expiresMs = Date.parse(expiration.eventDate);
  return Number.isFinite(expiresMs)
    ? Math.floor((expiresMs - now.getTime()) / DAY_MS)
    : null;
}

/** Read-only Cloudflare v4 REST + GraphQL client for zones, DNS, R2, and Tunnels. */
export class CloudflareClient {
  readonly #apiToken: string;
  readonly #accountId: string | undefined;
  readonly #fetch: Fetch;

  constructor(options: {
    apiToken: string;
    accountId?: string;
    fetch?: Fetch;
  }) {
    this.#apiToken = options.apiToken;
    this.#accountId = options.accountId;
    this.#fetch = options.fetch ?? fetch;
  }

  #resolveAccountId(accountId: string | undefined): string {
    const resolved = accountId ?? this.#accountId;
    if (resolved === undefined || resolved === "") {
      throw new Error(
        "CloudflareClient requires an accountId for account calls",
      );
    }
    return resolved;
  }

  async #getEnvelope<T extends z.ZodType>(
    path: string,
    resultSchema: T,
  ): Promise<{ result: z.infer<T>; totalPages: number }> {
    const EnvelopeSchema = cfEnvelope(resultSchema);
    const body = await fetchJson(
      this.#fetch,
      {
        upstream: "cloudflare",
        url: `${CF_API_BASE}${path}`,
        init: {
          headers: { accept: "application/json", ...bearer(this.#apiToken) },
        },
      },
      EnvelopeSchema,
    );
    if (!body.success || body.result === undefined || body.result === null) {
      const msg = body.errors[0]?.message ?? "API returned success=false";
      throw new UpstreamError("cloudflare", msg);
    }
    return {
      result: body.result,
      totalPages: body.result_info?.total_pages ?? 1,
    };
  }

  async #getPaginated<T extends z.ZodType>(
    basePath: string,
    perPage: number,
    itemSchema: T,
  ): Promise<z.infer<T>[]> {
    const ArraySchema = z.array(itemSchema);
    const items: z.infer<T>[] = [];
    const joiner = basePath.includes("?") ? "&" : "?";
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { result, totalPages } = await this.#getEnvelope(
        `${basePath}${joiner}per_page=${String(perPage)}&page=${String(page)}`,
        ArraySchema,
      );
      items.push(...result);
      if (page >= totalPages || result.length < perPage) {
        return items;
      }
    }
    throw new UpstreamError(
      "cloudflare",
      `exceeded ${String(MAX_PAGES)} pages`,
    );
  }

  async listZones(): Promise<CloudflareZone[]> {
    const zones = await this.#getPaginated("/zones", 50, RawZoneSchema);
    return zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      status: zone.status,
      paused: zone.paused,
      plan: zone.plan?.name,
      nameServers: zone.name_servers,
    }));
  }

  /** Inspect DNSSEC status and apex/mail security records (SPF, DMARC, MX, MTA-STS). */
  async evaluateZoneDnsBaseline(
    zoneId: string,
    zoneName: string,
  ): Promise<ZoneDnsBaseline> {
    const encodedZone = encodeURIComponent(zoneId);
    const [dnssec, records] = await Promise.all([
      this.#getEnvelope(`/zones/${encodedZone}/dnssec`, RawDnssecSchema),
      this.#getPaginated(
        `/zones/${encodedZone}/dns_records`,
        100,
        RawDnsRecordSchema,
      ),
    ]);
    const apex = normalizeDnsName(zoneName);
    const summary = summarizeMailRecords(records, apex);
    const dnssecStatus = dnssec.result.status ?? "disabled";
    return {
      zoneId,
      zoneName: apex,
      dnssecStatus,
      dnssecEnabled: dnssecStatus === "active",
      hasSpf: summary.spfRecord !== undefined,
      hasDmarc: summary.dmarcRecord !== undefined,
      hasMx: summary.mxRecords.length > 0,
      hasMtaSts: summary.mtaStsRecord !== undefined,
      spfRecord: summary.spfRecord,
      dmarcRecord: summary.dmarcRecord,
      mxRecords: summary.mxRecords,
      mtaStsRecord: summary.mtaStsRecord,
    };
  }

  async #fetchR2Metrics(
    accountId: string,
  ): Promise<Map<
    string,
    { payloadBytes: number; objectCount: number }
  > | null> {
    try {
      const since = new Date(Date.now() - 2 * DAY_MS).toISOString();
      const data = await postGraphql(
        this.#fetch,
        {
          upstream: "cloudflare",
          url: CF_GRAPHQL_URL,
          headers: bearer(this.#apiToken),
          query: R2_STORAGE_QUERY,
          variables: { accountTag: accountId, since },
        },
        R2GraphqlSchema,
      );
      const groups = data.viewer?.accounts[0]?.r2StorageAdaptiveGroups;
      if (groups === undefined) {
        return null;
      }
      const metrics = new Map<
        string,
        { payloadBytes: number; objectCount: number }
      >();
      for (const group of groups) {
        const bytes =
          (group.max.payloadSize ?? 0) + (group.max.metadataSize ?? 0);
        const objects = group.max.objectCount ?? 0;
        const prev = metrics.get(group.dimensions.bucketName);
        if (prev === undefined || bytes >= prev.payloadBytes) {
          metrics.set(group.dimensions.bucketName, {
            payloadBytes: bytes,
            objectCount: objects,
          });
        }
      }
      return metrics;
    } catch {
      return null;
    }
  }

  /** List R2 buckets and enrich with GraphQL storage/object metrics when permitted. */
  async listR2Buckets(accountId?: string): Promise<CloudflareR2Bucket[]> {
    const acct = this.#resolveAccountId(accountId);
    const [{ result }, metrics] = await Promise.all([
      this.#getEnvelope(
        `/accounts/${encodeURIComponent(acct)}/r2/buckets`,
        R2ListResultSchema,
      ),
      this.#fetchR2Metrics(acct),
    ]);
    const rawBuckets = Array.isArray(result) ? result : result.buckets;
    return rawBuckets.map((bucket) => {
      const stat = metrics?.get(bucket.name);
      return {
        name: bucket.name,
        createdAt: bucket.creation_date,
        location: bucket.location,
        payloadBytes: metrics === null ? null : (stat?.payloadBytes ?? 0),
        objectCount: metrics === null ? null : (stat?.objectCount ?? 0),
      };
    });
  }

  async #fetchTunnelIngress(
    encodedAccount: string,
    tunnelId: string,
  ): Promise<
    {
      hostname?: string | undefined;
      path?: string | undefined;
      service: string;
    }[]
  > {
    try {
      const { result } = await this.#getEnvelope(
        `/accounts/${encodedAccount}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`,
        RawTunnelConfigSchema,
      );
      return (result.config?.ingress ?? []).filter(
        (rule) =>
          rule.hostname !== undefined ||
          !rule.service.startsWith("http_status:"),
      );
    } catch {
      return [];
    }
  }

  /** List active Cloudflare Tunnels and their configured public ingress routes. */
  async listTunnelRoutes(accountId?: string): Promise<CloudflareTunnelRoute[]> {
    const acct = encodeURIComponent(this.#resolveAccountId(accountId));
    const tunnels = await this.#getPaginated(
      `/accounts/${acct}/cfd_tunnel?is_deleted=false`,
      100,
      RawTunnelSchema,
    );
    const routes: CloudflareTunnelRoute[] = [];
    for (const tunnel of tunnels) {
      const ingressRules = await this.#fetchTunnelIngress(acct, tunnel.id);
      if (ingressRules.length === 0) {
        routes.push({
          tunnelId: tunnel.id,
          tunnelName: tunnel.name,
          tunnelStatus: tunnel.status,
          activeConnections: tunnel.connections.length,
          hostname: undefined,
          path: undefined,
          service: "(tunnel)",
        });
        continue;
      }
      for (const rule of ingressRules) {
        routes.push({
          tunnelId: tunnel.id,
          tunnelName: tunnel.name,
          tunnelStatus: tunnel.status,
          activeConnections: tunnel.connections.length,
          hostname: rule.hostname,
          path: rule.path,
          service: rule.service,
        });
      }
    }
    return routes;
  }
}
