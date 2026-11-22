import { z } from "zod";
import {
  CloudflareClient,
  lookupRdapExpiryDays,
  type CloudflareZone,
  type ZoneDnsBaseline,
} from "@shepherdjerred/ops-clients/cloudflare.ts";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import type {
  CloudflareCheckStatus,
  CloudflareFacet,
} from "@shepherdjerred/ops-model/facets.ts";
import { cloudflareR2StorageBytes } from "#observability/metrics-ops.ts";

const RDAP_CACHE_TTL_MS = 60 * 60_000;
const CF_API_BASE = "https://api.cloudflare.com/client/v4";

const rdapCache = new Map<
  string,
  { expiresAtMs: number; days: number | null }
>();
let cachedAccountId: string | undefined;

const CfAccountsEnvelopeSchema = z.object({
  success: z.boolean(),
  result: z.array(z.object({ id: z.string().min(1) })).default([]),
});

const CfDnsCountEnvelopeSchema = z.object({
  success: z.boolean(),
  result_info: z
    .object({ total_count: z.number().int().nonnegative().optional() })
    .optional(),
});

export function clearRdapCacheForTests(): void {
  rdapCache.clear();
  cachedAccountId = undefined;
}

export async function cachedRdapExpiryDays(input: {
  domain: string;
  fetchImpl?: Fetch;
  now: Date;
}): Promise<number | null> {
  const key = input.domain.trim().toLowerCase();
  const nowMs = input.now.getTime();
  const hit = rdapCache.get(key);
  if (hit !== undefined && nowMs < hit.expiresAtMs) {
    return hit.days;
  }
  const days = await lookupRdapExpiryDays(
    key,
    input.fetchImpl ?? fetch,
    input.now,
  );
  rdapCache.set(key, { expiresAtMs: nowMs + RDAP_CACHE_TTL_MS, days });
  return days;
}

async function resolveAccountId(
  apiToken: string,
  explicitAccountId: string | undefined,
  fetchImpl: Fetch,
): Promise<string | undefined> {
  const configured = (
    explicitAccountId ??
    Bun.env["CLOUDFLARE_ACCOUNT_ID"] ??
    ""
  ).trim();
  if (configured !== "") {
    return configured;
  }
  if (cachedAccountId !== undefined) {
    return cachedAccountId;
  }
  try {
    const response = await fetchImpl(`${CF_API_BASE}/accounts?per_page=1`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiToken}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    const parsed = CfAccountsEnvelopeSchema.safeParse(await response.json());
    const id = parsed.success ? parsed.data.result[0]?.id : undefined;
    if (id !== undefined) {
      cachedAccountId = id;
    }
    return id;
  } catch {
    return undefined;
  }
}

async function fetchZoneRecordCount(
  zoneId: string,
  apiToken: string,
  fetchImpl: Fetch,
  fallbackCount: number,
): Promise<number> {
  try {
    const response = await fetchImpl(
      `${CF_API_BASE}/zones/${encodeURIComponent(zoneId)}/dns_records?per_page=1`,
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiToken}`,
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return fallbackCount;
    }
    const parsed = CfDnsCountEnvelopeSchema.safeParse(await response.json());
    return parsed.success
      ? (parsed.data.result_info?.total_count ?? fallbackCount)
      : fallbackCount;
  } catch {
    return fallbackCount;
  }
}

function classifySpf(baseline: ZoneDnsBaseline): CloudflareCheckStatus {
  if (!baseline.hasSpf) {
    return "missing";
  }
  const spf = baseline.spfRecord ?? "";
  return spf.includes("-all") || spf.includes("~all") ? "ok" : "warn";
}

function classifyDmarc(baseline: ZoneDnsBaseline): CloudflareCheckStatus {
  if (!baseline.hasDmarc) {
    return "missing";
  }
  return /p=(?:quarantine|reject)/iu.test(baseline.dmarcRecord ?? "")
    ? "ok"
    : "warn";
}

function classifyDnssec(baseline: ZoneDnsBaseline): CloudflareCheckStatus {
  if (baseline.dnssecEnabled) {
    return "ok";
  }
  return baseline.dnssecStatus === "pending" ? "warn" : "missing";
}

function mapDomainRow(input: {
  zone: CloudflareZone;
  baseline: ZoneDnsBaseline;
  registrarExpiryDays: number | null;
  recordCount: number;
}): CloudflareFacet["domains"][number] {
  const { zone, baseline } = input;
  const tlsStatus: CloudflareCheckStatus =
    zone.status === "active" && !zone.paused ? "ok" : "warn";
  return {
    domain: baseline.zoneName,
    zoneId: zone.id,
    registrarExpiryDays: input.registrarExpiryDays,
    dnssec: classifyDnssec(baseline),
    spf: classifySpf(baseline),
    dmarc: classifyDmarc(baseline),
    mx: baseline.hasMx ? "ok" : "missing",
    mtaSts: baseline.hasMtaSts ? "ok" : "missing",
    tls: tlsStatus,
    recordCount: input.recordCount,
  };
}

export async function collectCloudflareFacet(options?: {
  apiToken?: string | undefined;
  accountId?: string | undefined;
  client?: CloudflareClient;
  fetchImpl?: Fetch;
  now?: Date;
}): Promise<CloudflareFacet | undefined> {
  const apiToken = (
    options?.apiToken ??
    Bun.env["CLOUDFLARE_API_TOKEN"] ??
    ""
  ).trim();
  if (apiToken === "" && options?.client === undefined) {
    return undefined;
  }
  const fetchImpl = options?.fetchImpl ?? fetch;
  const now = options?.now ?? new Date();
  const accountId =
    apiToken === ""
      ? options?.accountId
      : await resolveAccountId(apiToken, options?.accountId, fetchImpl);

  const client =
    options?.client ??
    new CloudflareClient({
      apiToken,
      ...(accountId === undefined ? {} : { accountId }),
      fetch: fetchImpl,
    });

  const zones = await client.listZones();
  const domains = await Promise.all(
    zones.map(async (zone) => {
      const [baseline, registrarExpiryDays] = await Promise.all([
        client.evaluateZoneDnsBaseline(zone.id, zone.name),
        cachedRdapExpiryDays({ domain: zone.name, fetchImpl, now }),
      ]);
      const fallbackCount =
        baseline.mxRecords.length +
        (baseline.hasSpf ? 1 : 0) +
        (baseline.hasDmarc ? 1 : 0) +
        (baseline.hasMtaSts ? 1 : 0);
      const recordCount =
        apiToken === ""
          ? fallbackCount
          : await fetchZoneRecordCount(
              zone.id,
              apiToken,
              fetchImpl,
              fallbackCount,
            );
      return mapDomainRow({
        zone,
        baseline,
        registrarExpiryDays,
        recordCount,
      });
    }),
  );
  domains.sort((a, b) => a.domain.localeCompare(b.domain));

  const [r2Settled, tunnelSettled] =
    accountId === undefined
      ? [
          { status: "fulfilled" as const, value: [] },
          { status: "fulfilled" as const, value: [] },
        ]
      : await Promise.allSettled([
          client.listR2Buckets(accountId),
          client.listTunnelRoutes(accountId),
        ]);

  const rawBuckets = r2Settled.status === "fulfilled" ? r2Settled.value : [];
  cloudflareR2StorageBytes.reset();
  const r2Buckets: CloudflareFacet["r2Buckets"] = rawBuckets.map((bucket) => {
    const storageBytes = bucket.payloadBytes ?? 0;
    if (bucket.payloadBytes !== null) {
      cloudflareR2StorageBytes.set({ bucket: bucket.name }, storageBytes);
    }
    return {
      name: bucket.name,
      storageBytes,
      objectCount: bucket.objectCount ?? 0,
      classAOpsMonth: null,
      classBOpsMonth: null,
    };
  });

  const rawRoutes =
    tunnelSettled.status === "fulfilled" ? tunnelSettled.value : [];
  const tunnelRoutes: CloudflareFacet["tunnelRoutes"] = rawRoutes.map(
    (route) => ({
      hostname: route.hostname ?? route.tunnelName,
      service: route.service,
      status: route.tunnelStatus,
    }),
  );

  return { domains, r2Buckets, tunnelRoutes };
}
