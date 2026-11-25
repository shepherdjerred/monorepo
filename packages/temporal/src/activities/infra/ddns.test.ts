import { beforeEach, describe, expect, test } from "vitest";
import { z } from "zod/v4";
import { register } from "#observability/metrics.ts";
import {
  temporalDdnsLastSuccessTimestampSeconds,
  temporalDdnsUpdatesTotal,
} from "#observability/metrics-ops-schedules.ts";
import {
  parseCloudflareTraceIp,
  readTraceResponse,
  type TraceResponseStream,
} from "./ddns-trace.ts";
import {
  reconcileDdnsWithDependencies,
  type CloudflareFetch,
  type DdnsRecordType,
} from "./ddns.ts";

type StoredDnsRecord = {
  id: string;
  type: DdnsRecordType;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
};

const MutationPayloadSchema = z.object({
  type: z.enum(["A", "AAAA"]),
  name: z.string(),
  content: z.string(),
  proxied: z.boolean(),
  ttl: z.number().int(),
});

type MutationPayload = z.infer<typeof MutationPayloadSchema>;

type RecordedMutation = {
  method: "POST" | "PUT";
  url: string;
  body: MutationPayload;
};

function parseBody(body: RequestInit["body"]): MutationPayload {
  const raw = typeof body === "string" ? body : "";
  return MutationPayloadSchema.parse(JSON.parse(raw));
}

function createFakeCloudflare(initialRecords: readonly StoredDnsRecord[]) {
  const records = new Map<string, StoredDnsRecord>(
    initialRecords.map((record) => [record.id, { ...record }]),
  );
  const mutations: RecordedMutation[] = [];
  const queries: string[] = [];
  let nextId = 100;

  const fetchImpl: CloudflareFetch = (url, init) => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    if (method === "GET" && parsed.pathname === "/client/v4/zones") {
      return Promise.resolve(
        Response.json({
          success: true,
          errors: [],
          result: [{ id: "zone-sjer-red", name: "sjer.red" }],
        }),
      );
    }

    if (
      method === "GET" &&
      parsed.pathname === "/client/v4/zones/zone-sjer-red/dns_records"
    ) {
      const name = parsed.searchParams.get("name") ?? "";
      const type = parsed.searchParams.get("type") ?? "";
      queries.push(`${type}:${name}`);
      const matching = [...records.values()].filter(
        (record) => record.name === name && record.type === type,
      );
      return Promise.resolve(
        Response.json({
          success: true,
          errors: [],
          result: matching,
        }),
      );
    }

    if (
      method === "POST" &&
      parsed.pathname === "/client/v4/zones/zone-sjer-red/dns_records"
    ) {
      const body = parseBody(init.body);
      mutations.push({ method: "POST", url, body });
      const created: StoredDnsRecord = {
        id: `rec-${String(nextId++)}`,
        ...body,
      };
      records.set(created.id, created);
      return Promise.resolve(
        Response.json({ success: true, errors: [], result: created }),
      );
    }

    if (
      method === "PUT" &&
      parsed.pathname.startsWith("/client/v4/zones/zone-sjer-red/dns_records/")
    ) {
      const id = parsed.pathname.split("/").at(-1) ?? "";
      const body = parseBody(init.body);
      mutations.push({ method: "PUT", url, body });
      const updated: StoredDnsRecord = { id, ...body };
      records.set(id, updated);
      return Promise.resolve(
        Response.json({ success: true, errors: [], result: updated }),
      );
    }

    return Promise.resolve(new Response("unexpected route", { status: 404 }));
  };

  return { fetchImpl, records, mutations, queries };
}

describe("DDNS reconciliation drift and idempotency", () => {
  beforeEach(() => {
    temporalDdnsLastSuccessTimestampSeconds.reset();
    temporalDdnsUpdatesTotal.reset();
  });

  test("reconciles IPv4 and IPv6 drift while keeping ipv4.ddns.sjer.red strictly IPv4-only", async () => {
    const cf = createFakeCloudflare([
      {
        id: "rec-ddns-v4",
        type: "A",
        name: "ddns.sjer.red",
        content: "198.51.100.10",
        proxied: false,
        ttl: 300,
      },
    ]);
    const fixedNow = new Date("2026-11-25T02:00:00.000Z");

    const result = await reconcileDdnsWithDependencies({
      readToken: () => Promise.resolve("cf-secret-token-123"),
      traceTransport: (family) =>
        Promise.resolve(
          family === 4
            ? "fl=12f\nip=203.0.113.42\nts=123\n"
            : "fl=12f\nip=2001:db8::42\nts=123\n",
        ),
      cloudflareFetch: cf.fetchImpl,
      now: () => fixedNow,
    });

    expect(result).toEqual({
      observedAt: "2026-11-25T02:00:00.000Z",
      ipv4: "203.0.113.42",
      ipv6: "2001:db8::42",
      targets: [
        {
          target: "ddns.sjer.red",
          action: "updated",
          records: [
            {
              type: "A",
              name: "ddns.sjer.red",
              content: "203.0.113.42",
              action: "updated",
              recordId: "rec-ddns-v4",
            },
            {
              type: "AAAA",
              name: "ddns.sjer.red",
              content: "2001:db8::42",
              action: "updated",
              recordId: "rec-100",
            },
          ],
        },
        {
          target: "ipv4.ddns.sjer.red",
          action: "updated",
          records: [
            {
              type: "A",
              name: "ipv4.ddns.sjer.red",
              content: "203.0.113.42",
              action: "updated",
              recordId: "rec-101",
            },
          ],
        },
      ],
    });

    expect(cf.queries).toEqual([
      "A:ddns.sjer.red",
      "AAAA:ddns.sjer.red",
      "A:ipv4.ddns.sjer.red",
    ]);
    expect(
      [...cf.records.values()].filter(
        (record) =>
          record.name === "ipv4.ddns.sjer.red" && record.type === "AAAA",
      ),
    ).toEqual([]);
    expect(cf.mutations).toHaveLength(3);

    const metricsText = await register.metrics();
    expect(metricsText).toContain(
      'temporal_ddns_updates_total{target="ddns.sjer.red",action="updated",outcome="succeeded",component="temporal-worker"} 1',
    );
    expect(metricsText).toContain(
      'temporal_ddns_updates_total{target="ipv4.ddns.sjer.red",action="updated",outcome="succeeded",component="temporal-worker"} 1',
    );
    expect(metricsText).toContain(
      `temporal_ddns_last_success_timestamp_seconds{target="ddns.sjer.red",component="temporal-worker"} ${String(fixedNow.getTime() / 1000)}`,
    );
  });

  test("issues zero PUT or POST requests when content, proxied, and ttl already match", async () => {
    const cf = createFakeCloudflare([
      {
        id: "rec-1",
        type: "A",
        name: "ddns.sjer.red",
        content: "203.0.113.42",
        proxied: false,
        ttl: 300,
      },
      {
        id: "rec-2",
        type: "AAAA",
        name: "ddns.sjer.red",
        content: "2001:db8::42",
        proxied: false,
        ttl: 300,
      },
      {
        id: "rec-3",
        type: "A",
        name: "ipv4.ddns.sjer.red",
        content: "203.0.113.42",
        proxied: false,
        ttl: 300,
      },
    ]);

    const result = await reconcileDdnsWithDependencies({
      readToken: () => Promise.resolve("cf-secret-token-123"),
      traceTransport: (family) =>
        Promise.resolve(
          family === 4 ? "ip=203.0.113.42\n" : "ip=2001:db8::42\n",
        ),
      cloudflareFetch: cf.fetchImpl,
      now: () => new Date("2026-11-25T02:05:00.000Z"),
    });

    expect(cf.mutations).toEqual([]);
    expect(result.targets.map((target) => target.action)).toEqual([
      "unchanged",
      "unchanged",
    ]);

    const metricsText = await register.metrics();
    expect(metricsText).toContain(
      'temporal_ddns_updates_total{target="ddns.sjer.red",action="unchanged",outcome="succeeded",component="temporal-worker"} 1',
    );
    expect(metricsText).toContain(
      'temporal_ddns_updates_total{target="ipv4.ddns.sjer.red",action="unchanged",outcome="succeeded",component="temporal-worker"} 1',
    );
  });
});

describe("DDNS IPv6 fallback and failure safety", () => {
  beforeEach(() => {
    temporalDdnsLastSuccessTimestampSeconds.reset();
    temporalDdnsUpdatesTotal.reset();
  });

  test("updates record when proxied or ttl differs and tolerates ENETUNREACH on IPv6", async () => {
    const cf = createFakeCloudflare([
      {
        id: "rec-1",
        type: "A",
        name: "ddns.sjer.red",
        content: "203.0.113.42",
        proxied: true,
        ttl: 1,
      },
      {
        id: "rec-existing-aaaa",
        type: "AAAA",
        name: "ddns.sjer.red",
        content: "2001:db8::99",
        proxied: false,
        ttl: 300,
      },
      {
        id: "rec-3",
        type: "A",
        name: "ipv4.ddns.sjer.red",
        content: "203.0.113.42",
        proxied: false,
        ttl: 600,
      },
    ]);

    const result = await reconcileDdnsWithDependencies({
      readToken: () => Promise.resolve("cf-secret-token-123"),
      traceTransport: (family) => {
        if (family === 6) {
          throw Object.assign(
            new Error("connect ENETUNREACH 2606:4700:4700::1111:443"),
            { code: "ENETUNREACH" },
          );
        }
        return Promise.resolve("ip=203.0.113.42\n");
      },
      cloudflareFetch: cf.fetchImpl,
      now: () => new Date("2026-11-25T02:10:00.000Z"),
    });

    expect(result.ipv4).toBe("203.0.113.42");
    expect(result.ipv6).toBeNull();
    expect(cf.queries).toEqual(["A:ddns.sjer.red", "A:ipv4.ddns.sjer.red"]);
    expect(cf.records.get("rec-existing-aaaa")?.content).toBe("2001:db8::99");
    expect(cf.mutations).toHaveLength(2);
    expect(cf.mutations[0]?.body).toMatchObject({
      name: "ddns.sjer.red",
      proxied: false,
      ttl: 300,
    });
    expect(cf.mutations[1]?.body).toMatchObject({
      name: "ipv4.ddns.sjer.red",
      proxied: false,
      ttl: 300,
    });
  });

  test("rejects malformed trace IP values and redacts token on Cloudflare API errors", async () => {
    expect(() => parseCloudflareTraceIp("ip=not-an-ip\n", 4)).toThrow(
      "expected IPv4",
    );
    expect(() => parseCloudflareTraceIp("ip=2001:db8::1\n", 4)).toThrow(
      "expected IPv4",
    );

    const secretToken = "super-secret-cf-ddns-token";
    await expect(
      reconcileDdnsWithDependencies({
        readToken: () => Promise.resolve(secretToken),
        traceTransport: (family) =>
          Promise.resolve(
            family === 4 ? "ip=203.0.113.42\n" : "ip=2001:db8::42\n",
          ),
        cloudflareFetch: (url) => {
          if (url.includes("/zones?")) {
            return Promise.resolve(
              Response.json({
                success: true,
                errors: [],
                result: [{ id: "zone-1", name: "sjer.red" }],
              }),
            );
          }
          return Promise.resolve(
            new Response(`Forbidden for token ${secretToken}`, { status: 403 }),
          );
        },
        now: () => new Date("2026-11-25T02:20:00.000Z"),
      }),
    ).rejects.toThrow("Forbidden for token <redacted>");

    const metricsText = await register.metrics();
    expect(metricsText).not.toContain(secretToken);
    expect(metricsText).toContain(
      'temporal_ddns_updates_total{target="ddns.sjer.red",action="failed",outcome="failed",component="temporal-worker"} 1',
    );
  });

  test("rejects trace stream when response closes prematurely or emits an error", async () => {
    function createFakeResponse() {
      const dataListeners: ((chunk: Buffer) => void)[] = [];
      const endListeners: (() => void)[] = [];
      const closeListeners: (() => void)[] = [];
      const errorListeners: ((error: Error) => void)[] = [];
      const state = { complete: false, statusCode: 200 };
      const stream: TraceResponseStream = {
        get complete() {
          return state.complete;
        },
        get statusCode() {
          return state.statusCode;
        },
        on(
          event: "data" | "end" | "close" | "error",
          listener: (...args: any[]) => void,
        ) {
          switch (event) {
            case "data": {
              dataListeners.push(listener);
              break;
            }
            case "end": {
              endListeners.push(listener);
              break;
            }
            case "close": {
              closeListeners.push(listener);
              break;
            }
            case "error": {
              errorListeners.push(listener);
              break;
            }
          }
          return stream;
        },
      };
      return {
        stream,
        setComplete(value: boolean) {
          state.complete = value;
        },
        emitData(chunk: Buffer) {
          for (const fn of dataListeners) {
            fn(chunk);
          }
        },
        emitEnd() {
          for (const fn of endListeners) {
            fn();
          }
        },
        emitClose() {
          for (const fn of closeListeners) {
            fn();
          }
        },
        emitError(err: Error) {
          for (const fn of errorListeners) {
            fn(err);
          }
        },
      };
    }

    const truncated = createFakeResponse();
    const truncatedPromise = readTraceResponse(truncated.stream, 4);
    truncated.emitData(Buffer.from("fl=12f\n", "utf8"));
    truncated.emitClose();
    await expect(truncatedPromise).rejects.toThrow(
      "Cloudflare IPv4 trace response closed before completion",
    );

    const errored = createFakeResponse();
    const erroredPromise = readTraceResponse(errored.stream, 6);
    errored.emitError(new Error("socket reset mid-body"));
    await expect(erroredPromise).rejects.toThrow("socket reset mid-body");

    const normal = createFakeResponse();
    const normalPromise = readTraceResponse(normal.stream, 4);
    normal.emitData(Buffer.from("ip=203.0.113.42\n", "utf8"));
    normal.setComplete(true);
    normal.emitEnd();
    normal.emitClose();
    await expect(normalPromise).resolves.toBe("ip=203.0.113.42\n");
  });
});
