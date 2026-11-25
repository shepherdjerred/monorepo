import { z } from "zod/v4";
import {
  temporalDdnsLastSuccessTimestampSeconds,
  temporalDdnsUpdatesTotal,
} from "#observability/metrics-ops-schedules.ts";
import {
  discoverPublicAddresses,
  fetchPublicIpTrace,
  type IpTraceTransport,
} from "./ddns-trace.ts";

export const DDNS_ZONE_NAME = "sjer.red";
export const DDNS_TTL_SECONDS = 300;
export const DDNS_PROXIED = false;
export const DEFAULT_DDNS_API_TOKEN_FILE = "/run/secrets/ddns/api-token";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const HTTP_TIMEOUT_MS = 15_000;

export const DDNS_TARGETS = [
  { hostname: "ddns.sjer.red", allowIpv6: true },
  // arcade.sjer.red CNAMEs to ipv4.ddns.sjer.red because Mario Kart's public
  // forwards serve IPv4 only; never create an AAAA record on this hostname.
  { hostname: "ipv4.ddns.sjer.red", allowIpv6: false },
] as const;

export type DdnsTargetHostname = (typeof DDNS_TARGETS)[number]["hostname"];
export type DdnsRecordType = "A" | "AAAA";
export type DdnsTargetAction = "unchanged" | "updated";

export type DesiredDnsRecord = {
  readonly type: DdnsRecordType;
  readonly name: DdnsTargetHostname;
  readonly content: string;
  readonly proxied: boolean;
  readonly ttl: number;
};

export type DdnsRecordOutcome = {
  readonly type: DdnsRecordType;
  readonly name: DdnsTargetHostname;
  readonly content: string;
  readonly action: DdnsTargetAction;
  readonly recordId: string;
};

export type DdnsSyncResult = {
  readonly observedAt: string;
  readonly ipv4: string;
  readonly ipv6: string | null;
  readonly targets: readonly {
    readonly target: DdnsTargetHostname;
    readonly action: DdnsTargetAction;
    readonly records: readonly DdnsRecordOutcome[];
  }[];
};

export type CloudflareFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export type DdnsDependencies = {
  readonly readToken: () => Promise<string>;
  readonly traceTransport: IpTraceTransport;
  readonly cloudflareFetch: CloudflareFetch;
  readonly now: () => Date;
};

const CloudflareRawEnvelopeSchema = z.object({
  success: z.boolean(),
  errors: z
    .array(z.object({ code: z.number().optional(), message: z.string() }))
    .default([]),
  result: z.unknown(),
});

const CloudflareZoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const CloudflareDnsRecordSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  content: z.string().min(1),
  proxied: z.boolean(),
  ttl: z.number().int(),
});

type CloudflareDnsRecord = z.infer<typeof CloudflareDnsRecordSchema>;

function redactToken(text: string, token: string): string {
  return token === "" ? text : text.replaceAll(token, "<redacted>");
}

function rethrowRedactedDdnsError(error: unknown, token: string): never {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const safeMessage = redactToken(rawMessage, token);
  if (safeMessage !== rawMessage) {
    throw new Error(safeMessage);
  }
  throw error;
}

export function buildDesiredRecordsForTarget(
  target: (typeof DDNS_TARGETS)[number],
  addresses: { ipv4: string; ipv6: string | null },
): DesiredDnsRecord[] {
  const records: DesiredDnsRecord[] = [
    {
      type: "A",
      name: target.hostname,
      content: addresses.ipv4,
      proxied: DDNS_PROXIED,
      ttl: DDNS_TTL_SECONDS,
    },
  ];
  if (target.allowIpv6 && addresses.ipv6 !== null) {
    records.push({
      type: "AAAA",
      name: target.hostname,
      content: addresses.ipv6,
      proxied: DDNS_PROXIED,
      ttl: DDNS_TTL_SECONDS,
    });
  }
  return records;
}

async function cloudflareRequest<T extends z.ZodType>(input: {
  fetchImpl: CloudflareFetch;
  token: string;
  path: string;
  method: "GET" | "POST" | "PUT";
  schema: T;
  body?: Record<string, unknown>;
}): Promise<z.infer<T>> {
  const response = await input.fetchImpl(
    `${CLOUDFLARE_API_BASE}${input.path}`,
    {
      method: input.method,
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    },
  );
  const rawText = redactToken(await response.text(), input.token);
  if (!response.ok) {
    throw new Error(
      `Cloudflare API ${input.method} ${input.path} failed with HTTP ${String(response.status)}: ${rawText.slice(0, 500)}`,
    );
  }
  const parsed = CloudflareRawEnvelopeSchema.parse(JSON.parse(rawText));
  if (!parsed.success) {
    const detail = parsed.errors.map((entry) => entry.message).join("; ");
    throw new Error(
      `Cloudflare API ${input.method} ${input.path} returned success=false: ${redactToken(detail, input.token)}`,
    );
  }
  return input.schema.parse(parsed.result);
}

async function resolveZoneId(
  fetchImpl: CloudflareFetch,
  token: string,
): Promise<string> {
  const zones = await cloudflareRequest({
    fetchImpl,
    token,
    method: "GET",
    path: `/zones?name=${encodeURIComponent(DDNS_ZONE_NAME)}&status=active`,
    schema: z.array(CloudflareZoneSchema),
  });
  const zone = zones.find((candidate) => candidate.name === DDNS_ZONE_NAME);
  if (zone === undefined) {
    throw new Error(`Cloudflare active zone "${DDNS_ZONE_NAME}" not found`);
  }
  return zone.id;
}

function recordMatchesDesired(
  existing: CloudflareDnsRecord,
  desired: DesiredDnsRecord,
): boolean {
  return (
    existing.content === desired.content &&
    existing.proxied === desired.proxied &&
    existing.ttl === desired.ttl
  );
}

async function reconcileSingleRecord(input: {
  fetchImpl: CloudflareFetch;
  token: string;
  zoneId: string;
  desired: DesiredDnsRecord;
}): Promise<DdnsRecordOutcome> {
  const { fetchImpl, token, zoneId, desired } = input;
  const query = new URLSearchParams({
    name: desired.name,
    type: desired.type,
  });
  const existingRecords = await cloudflareRequest({
    fetchImpl,
    token,
    method: "GET",
    path: `/zones/${zoneId}/dns_records?${query.toString()}`,
    schema: z.array(CloudflareDnsRecordSchema),
  });

  if (existingRecords.length > 1) {
    throw new Error(
      `Expected at most 1 ${desired.type} record for ${desired.name}, found ${String(existingRecords.length)}`,
    );
  }

  const existing = existingRecords[0];
  if (existing === undefined) {
    const created = await cloudflareRequest({
      fetchImpl,
      token,
      method: "POST",
      path: `/zones/${zoneId}/dns_records`,
      schema: CloudflareDnsRecordSchema,
      body: {
        type: desired.type,
        name: desired.name,
        content: desired.content,
        proxied: desired.proxied,
        ttl: desired.ttl,
      },
    });
    return {
      type: desired.type,
      name: desired.name,
      content: desired.content,
      action: "updated",
      recordId: created.id,
    };
  }

  if (recordMatchesDesired(existing, desired)) {
    return {
      type: desired.type,
      name: desired.name,
      content: desired.content,
      action: "unchanged",
      recordId: existing.id,
    };
  }

  const updated = await cloudflareRequest({
    fetchImpl,
    token,
    method: "PUT",
    path: `/zones/${zoneId}/dns_records/${existing.id}`,
    schema: CloudflareDnsRecordSchema,
    body: {
      type: desired.type,
      name: desired.name,
      content: desired.content,
      proxied: desired.proxied,
      ttl: desired.ttl,
    },
  });
  return {
    type: desired.type,
    name: desired.name,
    content: desired.content,
    action: "updated",
    recordId: updated.id,
  };
}

async function readApiTokenFromFile(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<string> {
  const filePath =
    env["CLOUDFLARE_DDNS_API_TOKEN_FILE"]?.trim() ??
    DEFAULT_DDNS_API_TOKEN_FILE;
  if (filePath === "") {
    throw new Error("CLOUDFLARE_DDNS_API_TOKEN_FILE must not be empty");
  }
  const rawToken = await Bun.file(filePath).text();
  const token = rawToken.trim();
  if (token === "") {
    throw new Error(`Cloudflare DDNS token file at ${filePath} is empty`);
  }
  return token;
}

export async function reconcileDdnsWithDependencies(
  deps: DdnsDependencies,
): Promise<DdnsSyncResult> {
  const token = await deps.readToken();
  try {
    const addresses = await discoverPublicAddresses(deps.traceTransport);
    const zoneId = await resolveZoneId(deps.cloudflareFetch, token);
    const now = deps.now();
    const targetOutcomes: {
      target: DdnsTargetHostname;
      action: DdnsTargetAction;
      records: DdnsRecordOutcome[];
    }[] = [];

    for (const target of DDNS_TARGETS) {
      try {
        const desiredRecords = buildDesiredRecordsForTarget(target, addresses);
        const recordOutcomes: DdnsRecordOutcome[] = [];
        for (const desired of desiredRecords) {
          recordOutcomes.push(
            await reconcileSingleRecord({
              fetchImpl: deps.cloudflareFetch,
              token,
              zoneId,
              desired,
            }),
          );
        }
        const action: DdnsTargetAction = recordOutcomes.some(
          (record) => record.action === "updated",
        )
          ? "updated"
          : "unchanged";
        temporalDdnsUpdatesTotal.inc({
          target: target.hostname,
          action,
          outcome: "succeeded",
        });
        temporalDdnsLastSuccessTimestampSeconds.set(
          { target: target.hostname },
          now.getTime() / 1000,
        );
        targetOutcomes.push({
          target: target.hostname,
          action,
          records: recordOutcomes,
        });
      } catch (targetError: unknown) {
        temporalDdnsUpdatesTotal.inc({
          target: target.hostname,
          action: "failed",
          outcome: "failed",
        });
        throw targetError;
      }
    }

    return {
      observedAt: now.toISOString(),
      ipv4: addresses.ipv4,
      ipv6: addresses.ipv6,
      targets: targetOutcomes,
    };
  } catch (error: unknown) {
    return rethrowRedactedDdnsError(error, token);
  }
}

export async function syncDdnsRecords(): Promise<DdnsSyncResult> {
  return reconcileDdnsWithDependencies({
    readToken: () => readApiTokenFromFile(),
    traceTransport: fetchPublicIpTrace,
    cloudflareFetch: (url, init) => fetch(url, init),
    now: () => new Date(),
  });
}

export const ddnsActivities = { syncDdnsRecords };
export type DdnsActivities = typeof ddnsActivities;
